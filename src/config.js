import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import yaml from 'js-yaml';
import { xdgConfig } from 'xdg-basedir';
import chalk from 'chalk';
import { ConfigLoader } from './config-loader.js';
import { ConfigUpdater } from './config-updater.js';

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
  mode: unified  # aish | shell | unified
  file: ~/.aish_history
  max_entries: 10000
  save_corrections: true
  
  # Shell history integration
  shell_integration:
    enabled: true
    sync_commands: true     # Add aish commands to shell history
    
  # Search settings
  search:
    fuzzy: true
    max_results: 50
    include_timestamps: true
    deduplicate: true

# Completion
completion:
  enabled: true
  backend: auto  # auto | bash | zsh | fish | generic
  fuzzy_search: true
  fuzzy_backend: auto  # auto | fzf | javascript
  max_suggestions: 10
  cache_ttl: 300
  ai_suggestions: false  # Future feature
  history_suggestions: true
  
  # FZF integration
  fzf:
    enabled: auto  # auto | true | false
    path: auto     # auto | system | ~/.fzf/bin/fzf | /path/to/fzf
    install_offer: true  # Offer to install fzf if not found
    install_path: ~/.fzf  # Where to install fzf
  
  keybindings:
    complete: tab
    history_search: ctrl-r
    ai_complete: ctrl-space

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
  let config = await loader.load(configPath);
  
  // Check for schema updates and handle them
  const updater = new ConfigUpdater(loader);
  config = await updater.checkAndUpdate(config);
  
  // Show loaded sources in verbose mode
  if (process.env.AISH_VERBOSE && config._metadata?.sources?.length > 0) {
    console.log(chalk.gray('Loaded configuration from:'));
    for (const source of config._metadata.sources) {
      console.log(chalk.gray(`  - ${source.path} (${source.type})`));
    }
  }
  
  return config;
}

export async function initConfig() {
  // This is now handled by the ConfigUpdater during loadConfig
  // Keeping this function for backward compatibility but it's a no-op
  return;
}