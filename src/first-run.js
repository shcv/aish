import prompts from 'prompts';
import chalk from 'chalk';
import { execa } from 'execa';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import yaml from 'js-yaml';
import { xdgConfig } from 'xdg-basedir';

export async function firstRunSetup() {
  console.log(chalk.cyan.bold('\n🎉 Welcome to aish - AI Shell!\n'));
  console.log('Let\'s set up your configuration with a few quick questions.\n');

  // Detect available shells
  const detectedShell = process.env.SHELL || '/bin/bash';
  const availableShells = await detectShells();

  const responses = await prompts([
    {
      type: 'select',
      name: 'shell',
      message: 'Which shell would you like to use?',
      choices: availableShells.map(shell => ({
        title: shell === detectedShell ? `${shell} (current)` : shell,
        value: shell
      })),
      initial: availableShells.indexOf(detectedShell) >= 0 ? availableShells.indexOf(detectedShell) : 0
    },
    {
      type: 'select',
      name: 'aiPermissions',
      message: 'How should AI features request permission?',
      choices: [
        { title: 'Always ask before executing (recommended)', value: 'always_ask' },
        { title: 'Ask only for dangerous commands', value: 'filter' },
        { title: 'Never ask (trust AI completely)', value: 'never_ask' }
      ],
      initial: 0
    },
    {
      type: 'select',
      name: 'errorCorrection',
      message: 'When commands fail, should aish suggest corrections?',
      choices: [
        { title: 'Yes, and ask before running', value: 'always_ask' },
        { title: 'Yes, but only show suggestions', value: 'suggest_only' },
        { title: 'No, disable error correction', value: 'disabled' }
      ],
      initial: 0
    },
    {
      type: 'select',
      name: 'theme',
      message: 'Choose your preferred visual style:',
      choices: [
        { title: 'Default (with colors and icons)', value: 'default' },
        { title: 'Minimal (less visual noise)', value: 'minimal' },
        { title: 'ASCII (no unicode characters)', value: 'ascii' },
        { title: 'Verbose (detailed output)', value: 'verbose' }
      ],
      initial: 0
    },
    {
      type: 'confirm',
      name: 'enableHistory',
      message: 'Save command history and corrections?',
      initial: true
    },
    {
      type: 'confirm',
      name: 'checkClaude',
      message: 'Check if Claude Code CLI is installed?',
      initial: true
    }
  ]);

  // Check Claude installation if requested
  if (responses.checkClaude) {
    await checkClaudeInstallation();
  }

  // Build configuration
  const config = buildConfiguration(responses, detectedShell);
  
  // Save configuration
  const configPath = path.join(
    xdgConfig || path.join(os.homedir(), '.config'),
    'aish',
    'config.yaml'
  );

  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, yaml.dump(config), 'utf8');

  console.log(chalk.green('\n✓ Configuration saved to:'), configPath);
  console.log(chalk.gray('  You can edit this file anytime to change settings.\n'));

  // Show quick start guide
  showQuickStart();

  return config;
}

async function detectShells() {
  const possibleShells = [
    '/bin/bash',
    '/bin/zsh', 
    '/usr/bin/fish',
    '/bin/sh',
    '/usr/local/bin/bash',
    '/usr/local/bin/zsh',
    '/usr/local/bin/fish'
  ];

  const available = [];
  for (const shell of possibleShells) {
    try {
      await fs.access(shell);
      available.push(shell);
    } catch {
      // Shell doesn't exist
    }
  }

  // Add current shell if not in list
  const currentShell = process.env.SHELL;
  if (currentShell && !available.includes(currentShell)) {
    try {
      await fs.access(currentShell);
      available.push(currentShell);
    } catch {
      // Current shell not accessible
    }
  }

  return available.length > 0 ? available : ['/bin/sh'];
}

async function checkClaudeInstallation() {
  const spinner = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  let spinnerIndex = 0;
  
  process.stdout.write('\nChecking Claude Code installation... ');
  
  const interval = setInterval(() => {
    process.stdout.write(`\r\nChecking Claude Code installation... ${spinner[spinnerIndex]}`);
    spinnerIndex = (spinnerIndex + 1) % spinner.length;
  }, 100);

  try {
    const result = await execa('claude', ['--version']);
    clearInterval(interval);
    process.stdout.write('\r');
    console.log(chalk.green('✓ Claude Code is installed'), chalk.gray(`(${result.stdout.trim()})`));
    return true;
  } catch (error) {
    clearInterval(interval);
    process.stdout.write('\r');
    console.log(chalk.yellow('⚠ Claude Code CLI not found'));
    console.log(chalk.gray('  AI features will be limited until you install it:'));
    console.log(chalk.cyan('  npm install -g @anthropic-ai/claude-code'));
    console.log();
    return false;
  }
}

function buildConfiguration(responses, detectedShell) {
  const themeSettings = {
    default: {
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
    },
    minimal: {
      colors: {
        ai_suggestion: 'gray',
        error: 'red',
        success: 'green',
        prompt: 'gray'
      },
      indicators: {
        processing: '...',
        ai_prefix: '>',
        error_prefix: '!'
      }
    },
    ascii: {
      colors: {
        ai_suggestion: 'cyan',
        error: 'red',
        success: 'green',
        prompt: 'yellow'
      },
      indicators: {
        processing: '...',
        ai_prefix: '[AI]',
        error_prefix: '[ERR]'
      }
    },
    verbose: {
      colors: {
        ai_suggestion: 'cyan',
        error: 'red',
        success: 'green',
        prompt: 'yellow'
      },
      indicators: {
        processing: '[Processing]',
        ai_prefix: '[AI Assistant]',
        error_prefix: '[Error]'
      }
    }
  };

  return {
    shell: {
      default: responses.shell || detectedShell,
      args: []
    },
    syntax: {
      substitution: '~{}',
      command: '?',
      question: '?'
    },
    error_handling: {
      enabled: responses.errorCorrection !== 'disabled',
      suggest_only: responses.errorCorrection === 'suggest_only',
      ignore_exit_codes: {
        grep: [1],
        diff: [1],
        test: [1]
      }
    },
    ai: {
      model: 'sonnet',
      max_context_lines: 100,
      timeout_seconds: 60
    },
    permissions: {
      substitution: responses.aiPermissions,
      error_correction: responses.errorCorrection === 'disabled' ? 'never' : responses.aiPermissions,
      command_generation: responses.aiPermissions
    },
    history: {
      enabled: responses.enableHistory,
      file: path.join(os.homedir(), '.aish_history'),
      max_entries: 10000,
      save_corrections: responses.enableHistory
    },
    appearance: {
      theme: responses.theme,
      ...themeSettings[responses.theme]
    }
  };
}

function showQuickStart() {
  console.log(chalk.bold('\n📚 Quick Start Guide:\n'));
  
  console.log(chalk.cyan('Start aish:'));
  console.log('  $ aish\n');
  
  console.log(chalk.cyan('Natural language substitution:'));
  console.log('  aish$ ls ~{files modified today}');
  console.log(chalk.gray('  → Suggests: ls -la -t | head -20\n'));
  
  console.log(chalk.cyan('Generate commands from descriptions:'));
  console.log('  aish$ ! show disk usage');
  console.log(chalk.gray('  → Suggests: df -h\n'));
  
  console.log(chalk.cyan('Automatic error correction:'));
  console.log('  aish$ git push origin mian');
  console.log(chalk.gray('  → Suggests: git push origin main\n'));
  
  console.log(chalk.cyan('Exit aish:'));
  console.log('  aish$ exit\n');
  
  console.log(chalk.gray('For more help, run: aish --help'));
  console.log(chalk.gray('Edit config: ~/.config/aish/config.yaml\n'));
}

export async function isFirstRun() {
  const configPaths = [
    path.join(process.cwd(), '.aish', 'config.yaml'),
    path.join(xdgConfig || path.join(os.homedir(), '.config'), 'aish', 'config.yaml'),
    path.join(os.homedir(), '.config', 'aish', 'config.yaml'),
    path.join(os.homedir(), '.aishrc.yaml'),
    path.join(os.homedir(), '.aishrc'),
    path.join(os.homedir(), '.aish_history')
  ];

  for (const p of configPaths) {
    try {
      await fs.access(p);
      return false; // Found existing config or history
    } catch {
      // Continue checking
    }
  }
  
  return true; // No config or history found
}