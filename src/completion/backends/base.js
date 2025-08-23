import { CompletionProvider } from '../interfaces.js';
import { execSync } from 'child_process';
import fs from 'fs/promises';
import path from 'path';

/**
 * Base completion backend with common functionality
 */
export class BaseCompletionBackend extends CompletionProvider {
  constructor(config = {}) {
    super(config);
    this.shellPath = config.shell?.default || process.env.SHELL || '/bin/bash';
    this.initialized = false;
  }

  /**
   * Get completions for a specific word based on context
   */
  async getCompletionsForWord(word, context) {
    let completions = [];
    
    // Determine what type of completions to provide
    if (context.isVariable) {
      completions = await this.getEnvironmentCompletions(word);
    } else if (context.isPath) {
      completions = await this.getFileCompletions(word, context);
    } else if (context.isOption) {
      completions = await this.getOptionCompletions(context.command, word);
    } else if (context.isCommand) {
      // Completing a command name
      completions = await this.getCommandCompletions(word);
    } else if (context.isArgument) {
      // Completing an argument - try files first
      completions = await this.getFileCompletions(word, context);
      
      // Also add command-specific completions if available
      if (context.command) {
        const cmdCompletions = await this.getCommandSpecificCompletions(
          context.command, 
          word, 
          context
        );
        completions = [...completions, ...cmdCompletions];
      }
    }
    
    return completions;
  }

  /**
   * Get command-specific completions (override in subclasses)
   */
  async getCommandSpecificCompletions(command, word, context) {
    return [];
  }

  /**
   * Get option completions for a command (override in subclasses)
   */
  async getOptionCompletions(command, word) {
    return [];
  }

  /**
   * Get completions for a partial path (for backwards compatibility)
   */
  async getCompletions(partial, context) {
    const parsed = this.parseCommandLine(partial);
    return this.getCompletionsForWord(parsed.currentWord, {
      ...context,
      command: parsed.command,
      position: parsed.previousWords.length,
      isCommand: parsed.completionType === 'command',
      isArgument: parsed.completionType === 'argument',
      isOption: parsed.currentWord.startsWith('-'),
      isPath: parsed.currentWord.includes('/'),
      isVariable: parsed.currentWord.startsWith('$')
    });
  }

  /**
   * Parse a command line to extract the command and current word
   */
  parseCommandLine(line, cursorPos = null) {
    if (cursorPos === null) cursorPos = line.length;
    
    const beforeCursor = line.substring(0, cursorPos);
    const words = this.tokenize(beforeCursor);
    
    const currentWord = words[words.length - 1] || '';
    const previousWords = words.slice(0, -1);
    
    // Determine completion type based on context
    let completionType = 'command';
    
    if (previousWords.length > 0) {
      // We're completing an argument or option
      if (currentWord.startsWith('-')) {
        completionType = 'option';
      } else if (currentWord.includes('/') || currentWord.startsWith('~')) {
        completionType = 'file';
      } else {
        completionType = 'argument';
      }
    } else if (currentWord.includes('/')) {
      // First word but contains path separator
      completionType = 'file';
    }
    
    return {
      line,
      words,
      currentWord,
      previousWords,
      command: previousWords[0] || '',
      completionType,
      cursorPos
    };
  }

  /**
   * Tokenize a command line into words
   */
  tokenize(line) {
    const words = [];
    let current = '';
    let inQuote = null;
    let escaped = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      
      if (escaped) {
        current += char;
        escaped = false;
        continue;
      }
      
      if (char === '\\') {
        escaped = true;
        current += char;
        continue;
      }
      
      if (inQuote) {
        if (char === inQuote) {
          inQuote = null;
        }
        current += char;
      } else {
        if (char === '"' || char === "'") {
          inQuote = char;
          current += char;
        } else if (char === ' ' || char === '\t') {
          if (current) {
            words.push(current);
            current = '';
          }
        } else {
          current += char;
        }
      }
    }
    
    if (current || line.endsWith(' ')) {
      words.push(current);
    }
    
    return words;
  }

  /**
   * Get completions for files and directories
   */
  async getFileCompletions(partial, context) {
    const dir = partial.includes('/') 
      ? path.dirname(partial) 
      : context.cwd || process.cwd();
    
    const basename = path.basename(partial);
    
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      const completions = [];
      
      for (const entry of entries) {
        if (entry.name.startsWith(basename)) {
          const fullPath = path.join(dir, entry.name);
          const relativePath = partial.includes('/') 
            ? path.join(path.dirname(partial), entry.name)
            : entry.name;
          
          completions.push({
            text: entry.isDirectory() ? relativePath + '/' : relativePath,
            display: entry.name,
            description: entry.isDirectory() ? 'directory' : 'file',
            type: entry.isDirectory() ? 'directory' : 'file',
            priority: entry.isDirectory() ? 2 : 1,
            metadata: {
              isDirectory: entry.isDirectory(),
              path: fullPath
            }
          });
        }
      }
      
      return completions;
    } catch (error) {
      return [];
    }
  }

  /**
   * Get completions for commands in PATH
   */
  async getCommandCompletions(partial) {
    const paths = (process.env.PATH || '').split(':');
    const commands = new Set();
    
    for (const dir of paths) {
      try {
        const entries = await fs.readdir(dir);
        for (const entry of entries) {
          if (entry.startsWith(partial)) {
            const fullPath = path.join(dir, entry);
            try {
              const stats = await fs.stat(fullPath);
              if (stats.isFile() && (stats.mode & 0o111)) { // Check if executable
                commands.add(entry);
              }
            } catch {}
          }
        }
      } catch {}
    }
    
    // Add shell builtins
    const builtins = this.getShellBuiltins();
    for (const builtin of builtins) {
      if (builtin.startsWith(partial)) {
        commands.add(builtin);
      }
    }
    
    return Array.from(commands).map(cmd => ({
      text: cmd,
      display: cmd,
      description: builtins.includes(cmd) ? 'builtin' : 'command',
      type: 'command',
      priority: builtins.includes(cmd) ? 10 : 5,
      metadata: {}
    }));
  }

  /**
   * Get shell builtins (override in subclasses)
   */
  getShellBuiltins() {
    // Common shell builtins
    return [
      'cd', 'pwd', 'echo', 'export', 'alias', 'unalias',
      'source', '.', 'eval', 'exec', 'exit', 'return',
      'break', 'continue', 'shift', 'set', 'unset',
      'readonly', 'declare', 'local', 'typeset',
      'if', 'then', 'else', 'elif', 'fi',
      'for', 'while', 'until', 'do', 'done',
      'case', 'esac', 'select', 'function',
      'bg', 'fg', 'jobs', 'kill', 'wait',
      'true', 'false', 'test', '[', ']'
    ];
  }

  /**
   * Get environment variable completions
   */
  async getEnvironmentCompletions(partial) {
    const prefix = partial.startsWith('$') ? partial.substring(1) : partial;
    const completions = [];
    
    for (const [name, value] of Object.entries(process.env)) {
      if (name.startsWith(prefix)) {
        completions.push({
          text: '$' + name,
          display: '$' + name,
          description: value.substring(0, 50) + (value.length > 50 ? '...' : ''),
          type: 'variable',
          priority: 3,
          metadata: { value }
        });
      }
    }
    
    return completions;
  }

  /**
   * Execute a shell command and return output
   */
  executeShellCommand(command, options = {}) {
    try {
      const output = execSync(command, {
        shell: this.shellPath,
        encoding: 'utf8',
        timeout: options.timeout || 1000,
        ...options
      });
      return output.trim();
    } catch (error) {
      return '';
    }
  }
}

export default BaseCompletionBackend;