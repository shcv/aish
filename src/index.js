#!/usr/bin/env node

import { ClaudeShell } from './claude-shell.js';
import { parseArgs, parseShebangArgs } from './utils/args.js';
import { loadConfig, initConfig } from './config.js';
import { firstRunSetup } from './first-run.js';
import { execa } from 'execa';
import fs from 'fs/promises';
import chalk from 'chalk';

async function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    
    // Set debug mode if requested
    if (args.debug) {
      process.env.AISH_DEBUG = 'true';
    }
    
    // Set verbose mode if requested
    if (args.verbose) {
      process.env.AISH_VERBOSE = 'true';
    }
    
    // Set quiet mode if requested
    if (args.quiet) {
      process.env.AISH_QUIET = 'true';
    }
    
    // Set auto-accept mode if requested
    if (args.yes) {
      process.env.AISH_YES = 'true';
    }
    
    // Check if we're executing a file
    if (args._.length > 0 || args.execute) {
      const filePath = args.execute || args._[0];
      await executeFile(filePath, args);
      return;
    }
    
    if (args.help) {
      showHelp();
      process.exit(0);
    }
    
    if (args.version) {
      showVersion();
      process.exit(0);
    }

    if (args.config === 'show') {
      await showConfig();
      process.exit(0);
    }

    if (args.init) {
      await initializeConfig();
      process.exit(0);
    }

    // Check for first run
    const { isFirstRun } = await import('./first-run.js');
    if (!args.config && await isFirstRun()) {
      const config = await firstRunSetup();

      // Override EOF behavior if specified in CLI args
      if (args['eof-exits'] !== undefined) {
        config.shell = config.shell || {};
        config.shell.eof_exits = true;
      } else if (args['no-eof-exits'] !== undefined) {
        config.shell = config.shell || {};
        config.shell.eof_exits = false;
      }

      const shell = new ClaudeShell(config);
      await shell.start();
    } else {
      const config = await loadConfig(args.config);
      
      // Show config source if in verbose mode
      if (config._metadata?.source && process.env.AISH_VERBOSE) {
        console.log(chalk.gray(`Loaded config from: ${config._metadata.source.path}`));
      }
      
      // Override EOF behavior if specified in CLI args
      if (args['eof-exits'] !== undefined) {
        config.shell = config.shell || {};
        config.shell.eof_exits = true;
      } else if (args['no-eof-exits'] !== undefined) {
        config.shell = config.shell || {};
        config.shell.eof_exits = false;
      }

      const shell = new ClaudeShell(config);
      await shell.start();
    }
  } catch (error) {
    console.error(chalk.red('Error:'), error.message);
    if (process.env.AISH_DEBUG) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

function showHelp() {
  console.log(`
${chalk.bold('aish - AI Shell')}

An intelligent shell wrapper with AI assistance.

${chalk.bold('Usage:')}
  aish [options]

${chalk.bold('Options:')}
  --help, -h         Show this help message
  --version          Show version information
  --config, -c PATH  Use specific configuration file
  --shell, -s SHELL  Override default shell
  --no-ai           Disable AI features
  --debug, -d        Enable debug mode (show all Claude messages)
  --verbose, -v      Show extra detail in responses
  --quiet, -q       Minimal output (only show final answers)
  --yes, -y         Auto-accept AI suggestions (useful for scripts)
  --yolo            Same as --yes (live dangerously)
  --eof-exits       Make Ctrl+D exit immediately (like bash)
  --no-eof-exits    Make Ctrl+D show warning instead of exiting

${chalk.bold('Features:')}
  ${chalk.cyan('~{text}')}         Natural language substitution
  ${chalk.cyan('! request')}       Generate command from natural language
  ${chalk.cyan('? question')}      Ask a question without executing
  ${chalk.cyan('Error correction')} Automatic suggestions on command failure

${chalk.bold('Configuration:')}
  Config file: ~/.config/aish/config.yaml
  
${chalk.bold('Examples:')}
  $ ls ~{files modified today}
  $ ! show disk usage
  $ git push origin mian  ${chalk.gray('# Will suggest: git push origin main')}
`);
}

function showVersion() {
  console.log('aish version 0.1.0');
}

async function executeFile(filePath, args) {
  try {
    // Read the file to check for shebang
    const content = await fs.readFile(filePath, 'utf8');
    const lines = content.split('\n');
    const firstLine = lines[0];
    
    let shellToUse = args.shell;
    let configToUse = args.config;
    
    // Check for aish shebang
    if (firstLine.startsWith('#!') && firstLine.includes('aish')) {
      const shebangArgs = parseShebangArgs(firstLine);
      
      // Shebang args override command line args
      shellToUse = shebangArgs.shell || shellToUse;
      configToUse = shebangArgs.config || configToUse;
      
      // Load config and start aish in script mode
      const config = await loadConfig(configToUse);
      
      // Override shell if specified
      if (shellToUse) {
        config.shell.default = shellToUse;
      }
      
      // Execute the script through aish
      console.log(chalk.cyan(`Executing ${filePath} through aish...`));
      
      // Set script mode and auto-accept for scripts by default
      process.env.AISH_SCRIPT_MODE = 'true';
      if (!process.env.AISH_YES) {
        // Auto-accept by default for scripts unless explicitly disabled
        process.env.AISH_YES = 'true';
        console.log(chalk.gray('Auto-accept mode enabled for script execution (use --no-yes to disable)'));
      }
      
      // For now, execute with shell but aish features work through the shebang
      // The script will call back to aish for natural language processing
      const result = await execa(config.shell.default, [filePath], {
        stdio: 'inherit',
        env: process.env
      });
      
      process.exit(result.exitCode);
    } else {
      // Not a aish script, execute with default shell
      const shell = shellToUse || process.env.SHELL || '/bin/bash';
      const result = await execa(shell, [filePath], {
        stdio: 'inherit'
      });
      process.exit(result.exitCode);
    }
  } catch (error) {
    console.error(chalk.red('Error executing file:'), error.message);
    process.exit(1);
  }
}

async function showConfig() {
  const config = await loadConfig();
  console.log(chalk.cyan('Current aish configuration:'));
  console.log(JSON.stringify(config, null, 2));
}

async function initializeConfig() {
  await initConfig();
}

main().catch(console.error);
