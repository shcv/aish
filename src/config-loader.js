import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import yaml from 'js-yaml';
import { xdgConfig } from 'xdg-basedir';
import { execa } from 'execa';
import chalk from 'chalk';

// Environment variable mappings
const ENV_MAPPINGS = {
  // Shell settings
  'AISH_SHELL': 'shell.default',
  'AISH_SHELL_ARGS': 'shell.args',
  
  // Syntax
  'AISH_SUBSTITUTION': 'syntax.substitution',
  'AISH_COMMAND': 'syntax.command',
  'AISH_QUESTION': 'syntax.question',
  
  // AI settings
  'AISH_MODEL': 'ai.model',
  'AISH_TIMEOUT': 'ai.timeout_seconds',
  'AISH_MAX_CONTEXT': 'ai.max_context_lines',
  'AISH_NO_AI': 'ai.disabled',
  
  // Permissions
  'AISH_PERM_SUBSTITUTION': 'permissions.substitution',
  'AISH_PERM_ERROR': 'permissions.error_correction',
  'AISH_PERM_COMMAND': 'permissions.command_generation',
  
  // History
  'AISH_HISTORY': 'history.enabled',
  'AISH_HISTORY_FILE': 'history.file',
  'AISH_HISTORY_MAX': 'history.max_entries',
  
  // Appearance
  'AISH_THEME': 'appearance.theme',
  'AISH_COLOR_AI': 'appearance.colors.ai_suggestion',
  'AISH_COLOR_ERROR': 'appearance.colors.error',
  'AISH_COLOR_SUCCESS': 'appearance.colors.success',
  'AISH_COLOR_PROMPT': 'appearance.colors.prompt',
  
  // Error handling
  'AISH_ERROR_HANDLING': 'error_handling.enabled',
  
  // Misc
  'AISH_VERBOSE': '_verbose',
  'AISH_DEBUG': '_debug'
};

export class ConfigLoader {
  constructor() {
    this.defaultConfig = this.getDefaultConfig();
    this.config = { ...this.defaultConfig };
    this.configSources = [];
  }

  getDefaultConfig() {
    return {
      shell: {
        default: process.env.SHELL || '/bin/bash',
        args: []
      },
      syntax: {
        substitution: '~{}',
        command: '?',
        question: '?'
      },
      error_handling: {
        enabled: true,
        ignore_exit_codes: {
          grep: [1],
          diff: [1],
          test: [1]
        }
      },
      ai: {
        model: 'sonnet',
        max_context_lines: 100,
        timeout_seconds: 60,
        disabled: false
      },
      permissions: {
        substitution: 'always_ask',
        error_correction: 'always_ask',
        command_generation: 'always_ask'
      },
      history: {
        enabled: true,
        file: path.join(os.homedir(), '.clsh_history'),
        max_entries: 10000,
        save_corrections: true
      },
      appearance: {
        theme: 'default',
        colors: {
          ai_suggestion: 'cyan',
          error: 'red',
          success: 'green',
          prompt: 'yellow'
        },
        indicators: {
          processing: '⟳',
          ai_prefix: '✨',
          error_prefix: '❌'
        }
      }
    };
  }

  async load(configPath) {
    // Reset to defaults
    this.config = { ...this.defaultConfig };
    this.configSources = [];

    // 1. Load from config directories/files
    const configLocations = this.getConfigLocations(configPath);
    for (const location of configLocations) {
      await this.loadLocation(location);
    }

    // 2. Apply environment variables (highest priority)
    this.applyEnvironmentVariables();

    // 3. Add metadata
    this.config._metadata = {
      sources: this.configSources,
      loaded: this.configSources.length > 0
    };

    return this.config;
  }

  getConfigLocations(explicitPath) {
    const locations = [];
    
    if (explicitPath) {
      locations.push({ path: explicitPath, priority: 'explicit' });
    }

    // Config directories (can contain multiple files)
    locations.push(
      { path: '/etc/clsh', priority: 'system' },
      { path: path.join(xdgConfig || path.join(os.homedir(), '.config'), 'clsh'), priority: 'user' },
      { path: path.join(os.homedir(), '.clsh'), priority: 'user' },
      { path: path.join(process.cwd(), '.clsh'), priority: 'project' }
    );

    // RC files (executed through clsh)
    locations.push(
      { path: '/etc/clshrc', priority: 'system' },
      { path: path.join(os.homedir(), '.clshrc'), priority: 'user' },
      { path: path.join(process.cwd(), '.clshrc'), priority: 'project' }
    );

    return locations;
  }

  async loadLocation(location) {
    const { path: locationPath, priority } = location;
    
    try {
      const stats = await fs.stat(locationPath);
      
      if (stats.isDirectory()) {
        await this.loadDirectory(locationPath, priority);
      } else if (stats.isFile()) {
        await this.loadFile(locationPath, priority);
      }
    } catch (error) {
      // Location doesn't exist or isn't accessible
    }
  }

  async loadDirectory(dirPath, priority) {
    try {
      const files = await fs.readdir(dirPath);
      
      // Sort files for consistent loading order
      const sortedFiles = files.sort();
      
      for (const file of sortedFiles) {
        // Skip hidden files except .clshrc
        if (file.startsWith('.') && file !== '.clshrc') continue;
        
        const filePath = path.join(dirPath, file);
        await this.loadFile(filePath, priority);
      }
    } catch (error) {
      // Directory not readable
    }
  }

  async loadFile(filePath, priority) {
    try {
      const stats = await fs.stat(filePath);
      if (!stats.isFile()) return;

      const ext = path.extname(filePath).toLowerCase();
      const basename = path.basename(filePath);
      
      let loaded = false;

      // Check if it's an rc file (no extension or ends with 'rc')
      if (basename.endsWith('rc') && !ext) {
        await this.executeRcFile(filePath, priority);
        loaded = true;
      } else {
        // Parse based on extension
        switch (ext) {
          case '.yaml':
          case '.yml':
            await this.loadYamlFile(filePath, priority);
            loaded = true;
            break;
          case '.json':
            await this.loadJsonFile(filePath, priority);
            loaded = true;
            break;
          case '.js':
          case '.mjs':
            await this.loadJsFile(filePath, priority);
            loaded = true;
            break;
          case '.env':
            await this.loadEnvFile(filePath, priority);
            loaded = true;
            break;
        }
      }

      if (loaded) {
        this.configSources.push({ path: filePath, priority, type: ext || 'rc' });
      }
    } catch (error) {
      if (process.env.AISH_DEBUG) {
        console.error(chalk.yellow(`Failed to load config from ${filePath}:`), error.message);
      }
    }
  }

  async loadYamlFile(filePath, priority) {
    const content = await fs.readFile(filePath, 'utf8');
    const data = yaml.load(content);
    this.mergeConfig(data);
  }

  async loadJsonFile(filePath, priority) {
    const content = await fs.readFile(filePath, 'utf8');
    const data = JSON.parse(content);
    this.mergeConfig(data);
  }

  async loadJsFile(filePath, priority) {
    // Dynamic import of JS config
    const module = await import(filePath);
    const data = module.default || module.config || module;
    this.mergeConfig(data);
  }

  async loadEnvFile(filePath, priority) {
    const content = await fs.readFile(filePath, 'utf8');
    const lines = content.split('\n');
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      
      const [key, ...valueParts] = trimmed.split('=');
      const value = valueParts.join('=');
      
      // Apply if it's a CLSH variable
      if (key.startsWith('CLSH_')) {
        process.env[key] = value;
      }
    }
  }

  async executeRcFile(filePath, priority) {
    // Check for shebang to determine shell
    let shellToUse = this.config.shell.default;
    
    try {
      const content = await fs.readFile(filePath, 'utf8');
      const firstLine = content.split('\n')[0];
      
      if (firstLine.startsWith('#!')) {
        // Parse shebang
        const shebangMatch = firstLine.match(/^#!\s*(\S+)(?:\s+(.*))?/);
        if (shebangMatch) {
          const [, interpreter, args] = shebangMatch;
          
          // Check if it's a clsh shebang
          if (interpreter.includes('clsh')) {
            // Parse clsh arguments from shebang
            if (args && args.includes('--shell')) {
              const shellMatch = args.match(/--shell\s+(\S+)/);
              if (shellMatch) {
                shellToUse = shellMatch[1];
              }
            }
          } else {
            // Use the specified interpreter
            shellToUse = interpreter;
          }
        }
      }
    } catch (error) {
      // Couldn't read file for shebang
    }

    // Execute the rc file and capture environment changes
    try {
      const result = await execa(shellToUse, [filePath], {
        env: process.env,
        shell: true
      });
      
      // Parse any exported CLSH variables from output
      // In a more sophisticated implementation, we'd capture env changes
      if (result.stdout && result.stdout.includes('CLSH_')) {
        // Parse and apply any CLSH environment variables
        const lines = result.stdout.split('\n');
        for (const line of lines) {
          if (line.startsWith('export CLSH_')) {
            const match = line.match(/export\s+(\w+)=(.*)/);
            if (match) {
              process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
            }
          }
        }
      }
    } catch (error) {
      if (process.env.AISH_DEBUG) {
        console.error(chalk.yellow(`Failed to execute rc file ${filePath}:`), error.message);
      }
    }
  }

  applyEnvironmentVariables() {
    for (const [envVar, configPath] of Object.entries(ENV_MAPPINGS)) {
      const value = process.env[envVar];
      if (value !== undefined) {
        this.setConfigValue(configPath, this.parseEnvValue(value));
      }
    }
  }

  parseEnvValue(value) {
    // Try to parse as JSON first (for arrays/objects)
    try {
      return JSON.parse(value);
    } catch {
      // Not JSON, treat as string
      // Convert string booleans
      if (value === 'true') return true;
      if (value === 'false') return false;
      // Convert numbers
      if (/^\d+$/.test(value)) return parseInt(value, 10);
      if (/^\d*\.\d+$/.test(value)) return parseFloat(value);
      // Return as string
      return value;
    }
  }

  setConfigValue(path, value) {
    const parts = path.split('.');
    let current = this.config;
    
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!current[part]) {
        current[part] = {};
      }
      current = current[part];
    }
    
    current[parts[parts.length - 1]] = value;
  }

  mergeConfig(override) {
    this.config = this.deepMerge(this.config, override);
  }

  deepMerge(base, override) {
    const result = { ...base };
    
    for (const key in override) {
      if (typeof override[key] === 'object' && 
          !Array.isArray(override[key]) && 
          override[key] !== null &&
          typeof base[key] === 'object' &&
          !Array.isArray(base[key]) &&
          base[key] !== null) {
        result[key] = this.deepMerge(base[key], override[key]);
      } else {
        result[key] = override[key];
      }
    }
    
    return result;
  }
}