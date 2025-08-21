import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import yaml from 'js-yaml';
import { xdgConfig } from 'xdg-basedir';
import chalk from 'chalk';
import { ConfigLoader } from './config-loader.js';

const EXAMPLE_CONFIG = `# aish Configuration File
# Location: ~/.config/aish/config.yaml

# Shell configuration
shell:
  default: ${process.env.SHELL || '/bin/bash'}
  args: []
  eof_exits: false         # Whether Ctrl+D exits immediately (true) or shows warning (false)

# Syntax configuration
syntax:
  substitution: "~{}"      # Natural language substitution
  command: "!"             # Command generation prefix
  question: "?"            # Question prefix

# Error handling
error_handling:
  enabled: true
  ignore_exit_codes:
    grep: [1]              # No matches found
    diff: [1]              # Files differ
    test: [1]              # Test failure

# AI configuration
ai:
  model: sonnet
  max_context_lines: 100
  timeout_seconds: 60

# Permissions
permissions:
  substitution: always_ask  # always_ask | never_ask | filter
  error_correction: always_ask
  command_generation: always_ask

# History
history:
  enabled: true
  file: ~/.aish_history
  max_entries: 10000
  save_corrections: true

# Appearance
appearance:
  theme: default  # default | minimal | verbose
  colors:
    ai_suggestion: cyan
    error: red
    success: green
    prompt: yellow
  indicators:
    processing: "⟳"    # or "..." for ASCII
    ai_prefix: "✨"    # or "[AI]" for ASCII
    error_prefix: "❌" # or "[ERR]" for ASCII
`;

export async function loadConfig(configPath) {
  // Use the new ConfigLoader
  const loader = new ConfigLoader();
  const config = await loader.load(configPath);
  
  // Show loaded sources in verbose mode
  if (process.env.AISH_VERBOSE && config._metadata.sources.length > 0) {
    console.log(chalk.gray('Loaded configuration from:'));
    for (const source of config._metadata.sources) {
      console.log(chalk.gray(`  - ${source.path} (${source.type})`));
    }
  }
  
  return config;
}

export async function initConfig() {
  // Called on first run to set up configuration
  const configPath = path.join(xdgConfig || path.join(os.homedir(), '.config'), 'aish', 'config.yaml');
  
  try {
    await fs.access(configPath);
    console.log(chalk.gray(`Configuration file exists at ${configPath}`));
  } catch {
    console.log(chalk.cyan('Welcome to aish! Setting up your configuration...'));
    // Create directory if it doesn't exist
    await fs.mkdir(path.dirname(configPath), { recursive: true });
    // Write example config
    await fs.writeFile(configPath, EXAMPLE_CONFIG, 'utf8');
    console.log(chalk.green(`✓ Created configuration file at ${configPath}`));
    console.log(chalk.gray('  You can customize aish by editing this file'));
    console.log();
  }
}