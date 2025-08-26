import prompts from 'prompts';
import chalk from 'chalk';
import fs from 'fs/promises';
import path from 'path';
import yaml from 'js-yaml';
import { xdgConfig } from 'xdg-basedir';
import { 
  CONFIG_SCHEMA, 
  findConfigDifferences, 
  getDefaultConfig,
  getPromptableOptions 
} from './config-schema.js';

/**
 * Interactive configuration updater
 * Handles schema changes and missing configuration values
 */
export class ConfigUpdater {
  constructor(configLoader, configPath = null) {
    this.configLoader = configLoader;
    // Use provided path or detect from loaded config or use default
    this.configPath = configPath || this.getConfigPath();
  }
  
  getConfigPath() {
    // Try to get the actual config path from the loader's metadata
    if (this.configLoader && this.configLoader.configPath) {
      return this.configLoader.configPath;
    }
    // Default path
    return path.join(
      xdgConfig || path.join(process.env.HOME, '.config'), 
      'aish', 
      'config.yaml'
    );
  }

  /**
   * Check and update configuration if needed
   */
  async checkAndUpdate(config) {
    // Check if this is first run (no config file exists)
    const isFirstRun = !(await this.configExists());
    
    // Find differences between schema and current config
    const differences = findConfigDifferences(config);
    
    // If no differences and not first run, we're done
    if (!isFirstRun && differences.length === 0) {
      return config;
    }

    // Check user's update preference
    const updateMode = await this.getUpdateMode(config, isFirstRun);
    
    if (updateMode === 'never') {
      // User doesn't want updates, just use current config
      return config;
    }
    
    if (updateMode === 'auto') {
      // Automatically apply defaults for missing values
      console.log(chalk.cyan('Updating configuration with default values...'));
      return await this.applyDefaults(config, differences);
    }
    
    if (updateMode === 'interactive') {
      // Interactive mode - prompt for values
      if (isFirstRun) {
        console.log(chalk.cyan('Welcome to aish! Let\'s set up your configuration.\n'));
        return await this.interactiveFirstRun(config);
      } else if (differences.length > 0) {
        console.log(chalk.cyan(`Found ${differences.length} configuration updates.\n`));
        return await this.interactiveUpdate(config, differences);
      }
    }
    
    return config;
  }

  /**
   * Check if config file exists
   */
  async configExists() {
    try {
      await fs.access(this.configPath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get or set the update mode preference
   */
  async getUpdateMode(config, isFirstRun) {
    // If already set in config, use that
    if (config._meta?.auto_update) {
      return config._meta.auto_update;
    }
    
    // On first run or if not set, ask the user
    if (isFirstRun || !config._meta) {
      console.log(chalk.yellow('How would you like to handle configuration updates?\n'));
      console.log(`  ${  chalk.green('interactive')  } - Ask me about new configuration options`);
      console.log(`  ${  chalk.blue('auto')  } - Automatically use defaults for new options`);
      console.log(`  ${  chalk.gray('never')  } - Don't update configuration\n`);
      
      const response = await prompts({
        type: 'select',
        name: 'mode',
        message: 'Configuration update mode',
        choices: [
          { title: 'Interactive (recommended)', value: 'interactive' },
          { title: 'Automatic', value: 'auto' },
          { title: 'Never', value: 'never' }
        ],
        initial: 0
      });
      
      // Save this preference
      if (!config._meta) config._meta = {};
      config._meta.auto_update = response.mode || 'interactive';
      
      return response.mode || 'interactive';
    }
    
    return 'interactive'; // Default
  }

  /**
   * Interactive first run setup
   */
  async interactiveFirstRun(config) {
    console.log('I\'ll ask you a few questions to set up aish.\n');
    console.log('Press Enter to use the default value shown in parentheses.\n');
    
    // Ask if they want basic or advanced setup
    const setupLevel = await prompts({
      type: 'select',
      name: 'level',
      message: 'Setup mode',
      choices: [
        { title: 'Basic (recommended)', value: 'basic' },
        { title: 'Advanced (all options)', value: 'advanced' }
      ],
      initial: 0
    });
    
    const onlyBasic = setupLevel.level === 'basic';
    
    // Get all promptable options
    const options = getPromptableOptions(CONFIG_SCHEMA, onlyBasic);
    
    // Create a new config with defaults
    const newConfig = getDefaultConfig();
    
    // Copy over the meta settings
    if (config._meta) {
      newConfig._meta = config._meta;
    }
    
    // Prompt for each option
    for (const option of options) {
      const value = await this.promptForValue(option);
      if (value !== undefined) {
        this.setNestedValue(newConfig, option.path, value);
      }
    }
    
    // Save the configuration
    await this.saveConfig(newConfig);
    
    console.log(chalk.green('\n✓ Configuration saved!\n'));
    console.log(chalk.gray(`You can edit your configuration at: ${this.configPath}\n`));
    
    return newConfig;
  }

  /**
   * Interactive update for schema changes
   */
  async interactiveUpdate(config, differences) {
    console.log('The following configuration options need attention:\n');
    
    // Group differences by whether they have prompts
    const promptable = [];
    const automatic = [];
    
    for (const diff of differences) {
      if (diff.schema.prompt && !diff.schema.advanced) {
        promptable.push(diff);
      } else {
        automatic.push(diff);
      }
    }
    
    // Apply automatic updates
    if (automatic.length > 0) {
      console.log(chalk.gray(`Applying defaults for ${automatic.length} technical options...`));
      for (const diff of automatic) {
        this.setNestedValue(config, diff.path, diff.defaultValue);
      }
    }
    
    // Prompt for user-facing options
    if (promptable.length > 0) {
      console.log(chalk.cyan(`\nPlease configure ${promptable.length} new options:\n`));
      
      for (const diff of promptable) {
        const value = await this.promptForValue({
          path: diff.path,
          schema: diff.schema,
          prompt: diff.schema.prompt
        });
        
        if (value !== undefined) {
          this.setNestedValue(config, diff.path, value);
        } else {
          // Use default if user cancels
          this.setNestedValue(config, diff.path, diff.defaultValue);
        }
      }
    }
    
    // Save the updated configuration
    await this.saveConfig(config);
    
    console.log(chalk.green('\n✓ Configuration updated!\n'));
    
    return config;
  }

  /**
   * Apply defaults for all differences
   */
  async applyDefaults(config, differences) {
    for (const diff of differences) {
      this.setNestedValue(config, diff.path, diff.defaultValue);
    }
    
    // Save the updated configuration
    await this.saveConfig(config);
    
    if (differences.length > 0) {
      console.log(chalk.green(`✓ Applied ${differences.length} default values\n`));
    }
    
    return config;
  }

  /**
   * Prompt user for a configuration value
   */
  async promptForValue(option) {
    const { path, schema, prompt } = option;
    const pathStr = path.join('.');
    
    // Build the prompt based on type
    const promptConfig = {
      name: 'value',
      message: `${prompt || pathStr}`
    };
    
    if (schema.type === 'boolean') {
      promptConfig.type = 'confirm';
      promptConfig.initial = schema.default || false;
    } else if (schema.enum) {
      promptConfig.type = 'select';
      promptConfig.choices = schema.enum.map(v => ({
        title: v,
        value: v
      }));
      const defaultIndex = schema.enum.indexOf(schema.default);
      promptConfig.initial = defaultIndex >= 0 ? defaultIndex : 0;
    } else if (schema.type === 'number') {
      promptConfig.type = 'number';
      promptConfig.initial = schema.default || 0;
    } else {
      promptConfig.type = 'text';
      promptConfig.initial = schema.default || '';
    }
    
    // Add description as hint
    if (schema.description) {
      promptConfig.hint = chalk.gray(schema.description);
    }
    
    const response = await prompts(promptConfig);
    return response.value;
  }

  /**
   * Set a nested value in the config object
   */
  setNestedValue(obj, path, value) {
    const keys = [...path];
    const lastKey = keys.pop();
    
    let current = obj;
    for (const key of keys) {
      if (!current[key] || typeof current[key] !== 'object') {
        current[key] = {};
      }
      current = current[key];
    }
    
    current[lastKey] = value;
  }

  /**
   * Save configuration to file
   */
  async saveConfig(config) {
    // Ensure directory exists
    const dir = path.dirname(this.configPath);
    await fs.mkdir(dir, { recursive: true });
    
    // Convert to YAML with nice formatting
    const yamlStr = yaml.dump(config, {
      indent: 2,
      lineWidth: 120,
      noRefs: true
    });
    
    // Add header comment
    const header = `# aish Configuration File
# Location: ${this.configPath}
# Schema Version: ${config._meta?.version || '1.0.0'}
# Generated: ${new Date().toISOString()}

`;
    
    await fs.writeFile(this.configPath, header + yamlStr, 'utf8');
  }
}

export default ConfigUpdater;