import readline from 'readline';
import chalk from 'chalk';
import ora from 'ora';
import prompts from 'prompts';
import { execa, execaSync } from 'execa';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { ClaudeClient } from './claude-client.js';
import { CommandParser } from './command-parser.js';
import { EnhancedReadline } from './enhanced-readline.js';
import { HistoryManager } from './history/manager.js';
import { CompletionManager } from './completion/manager.js';
import { FzfDetector } from './fuzzy/fzf-detector.js';

export class ClaudeShell {
  constructor(config = {}) {
    this.config = config;
    this.cwd = process.cwd();
    this.shellPath = config.shell?.default || process.env.SHELL || '/bin/sh';
    this.history = [];
    this.isRunning = true;
    
    // History configuration (legacy support)
    this.historyEnabled = config.history?.enabled !== false;
    this.historyFile = this.expandPath(config.history?.file || path.join(os.homedir(), '.aish_history'));
    this.maxHistoryEntries = config.history?.max_entries || 10000;
    
    // Components
    this.parser = new CommandParser(config);
    this.claude = new ClaudeClient(config);
    
    // New enhanced components
    this.enhancedReadline = new EnhancedReadline(config);
    this.historyManager = new HistoryManager(config);
    this.completionManager = new CompletionManager(config);
    this.useEnhancedReadline = config.completion?.enabled !== false;
    
    // Setup process handlers
    process.on('SIGINT', () => {
      // Let individual readline instances handle their own SIGINT
    });
  }
  
  expandPath(filePath) {
    if (!filePath) return filePath;
    if (filePath.startsWith('~/')) {
      return path.join(os.homedir(), filePath.slice(2));
    }
    return filePath;
  }
  
  async loadHistory() {
    if (!this.historyEnabled || !this.historyFile) return;
    
    try {
      const data = await fs.promises.readFile(this.historyFile, 'utf8');
      this.history = data.split('\n').filter(line => line.trim());
      
      // Trim to max entries if needed
      if (this.history.length > this.maxHistoryEntries) {
        this.history = this.history.slice(-this.maxHistoryEntries);
      }
      
      if (process.env.AISH_DEBUG) {
        console.log(chalk.gray(`[DEBUG] Loaded ${this.history.length} history entries from ${this.historyFile}`));
      }
    } catch (error) {
      // File doesn't exist yet, that's fine
      if (error.code !== 'ENOENT') {
        console.error(chalk.yellow('Warning: Could not load history:'), error.message);
      }
    }
  }
  
  async saveHistory() {
    if (!this.historyEnabled || !this.historyFile) return;
    
    try {
      // Ensure directory exists
      const dir = path.dirname(this.historyFile);
      await fs.promises.mkdir(dir, { recursive: true });
      
      // Trim to max entries before saving
      if (this.history.length > this.maxHistoryEntries) {
        this.history = this.history.slice(-this.maxHistoryEntries);
      }
      
      await fs.promises.writeFile(this.historyFile, this.history.join('\n'));
      
      if (process.env.AISH_DEBUG) {
        console.log(chalk.gray(`[DEBUG] Saved ${this.history.length} history entries to ${this.historyFile}`));
      }
    } catch (error) {
      console.error(chalk.yellow('Warning: Could not save history:'), error.message);
    }
  }
  
  async addToHistory(command) {
    if (!command || !command.trim()) return;
    
    // Don't add duplicates of the last command
    if (this.history.length > 0 && this.history[this.history.length - 1] === command) {
      return;
    }
    
    this.history.push(command);
    
    // Trim to max entries
    if (this.history.length > this.maxHistoryEntries) {
      this.history = this.history.slice(-this.maxHistoryEntries);
    }
    
    // Save to file
    await this.saveHistory();
  }
  
  createSpinner(text = 'Thinking...') {
    // Only show spinner if not in debug mode
    if (process.env.AISH_DEBUG) {
      console.log(chalk.gray(`[DEBUG] ${text}`));
      return null;
    }
    
    // Custom spinner with beautiful flower/star symbols
    const customSpinner = {
      frames: ['✻', '✼', '✽', '✾', '✿', '❀', '❃', '❄', '❅', '❆', '❇', '❈', '❉', '❊', '❋'],
      interval: 100
    };
    
    const spinner = ora({
      text,
      spinner: customSpinner,
      color: 'red',
      discardStdin: false
    }).start();
    
    // Animate through red/orange/rust colors
    const colors = ['red', 'redBright', 'yellow', 'yellowBright', 'yellow', 'redBright'];
    let colorIndex = 0;
    const colorInterval = setInterval(() => {
      spinner.color = colors[colorIndex % colors.length];
      colorIndex++;
    }, 200);
    
    // Store interval on spinner for cleanup
    spinner.colorInterval = colorInterval;
    
    return spinner;
  }
  
  stopSpinner(spinner) {
    if (!spinner) return;
    
    if (spinner.colorInterval) {
      clearInterval(spinner.colorInterval);
    }
    spinner.stop();
  }
  
  async start() {
    // Detect and setup FZF
    const fzfDetector = new FzfDetector(this.config);
    const fzfInfo = await fzfDetector.detect();
    
    if (fzfInfo.available) {
      // Add fzf bin directory to internal PATH
      const fzfBinPath = fzfDetector.getFzfBinPath();
      if (fzfBinPath && !process.env.PATH.includes(fzfBinPath)) {
        process.env.PATH = `${fzfBinPath}:${process.env.PATH}`;
        if (process.env.AISH_DEBUG) {
          console.log(chalk.gray(`[DEBUG] Added ${fzfBinPath} to PATH`));
        }
      }
      
      // Store fzf info for use by completion/history managers
      this.fzfPath = fzfInfo.path;
      this.historyManager.setFzfPath(fzfInfo.path);
      this.completionManager.setFzfPath(fzfInfo.path);
      this.enhancedReadline.setFzfPath(fzfInfo.path);
    } else {
      if (process.env.AISH_DEBUG) {
        console.log(chalk.gray('[DEBUG] FZF not available, using fallback fuzzy search'));
      }
    }
    
    // Initialize new managers
    await this.historyManager.initialize();
    await this.completionManager.initialize();
    await this.enhancedReadline.initialize();
    
    // Load history from file (legacy support)
    await this.loadHistory();
    
    // Initialize Claude connection if AI is enabled
    if (!this.config.noAi) {
      await this.claude.initialize();
    }
    
    console.log(chalk.gray('Type "exit" to quit, "?" for AI questions, "!" for AI commands\n'));
    
    while (this.isRunning) {
      try {
        const input = await this.readInput();
        if (input === null) continue; // User pressed Ctrl+C
        
        const trimmed = input.trim();
        if (!trimmed) continue;
        
        // Check for exit
        if (trimmed === 'exit' || trimmed === 'quit') {
          this.isRunning = false;
          break;
        }
        
        // Add to history using new manager
        await this.historyManager.add(trimmed, {
          cwd: this.cwd,
          timestamp: Date.now()
        });
        
        // Also add to legacy history for compatibility
        await this.addToHistory(trimmed);
        
        // Parse and handle command
        const parsed = this.parser.parse(trimmed);
        await this.handleCommand(parsed, trimmed);
        
      } catch (error) {
        console.error(chalk.red('Error:'), error.message);
      }
    }
    
    this.cleanup();
  }
  
  async readInput() {
    // Use enhanced readline if enabled
    if (this.useEnhancedReadline) {
      const prompt = this.getPrompt();
      return this.enhancedReadline.readInput(prompt, {
        history: this.historyEnabled ? [...this.history].reverse() : undefined,
        historySize: this.maxHistoryEntries,
        removeHistoryDuplicates: true
      });
    }
    
    // Fallback to standard readline
    return new Promise((resolve) => {
      const prompt = this.getPrompt();
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt,
        terminal: true,
        history: this.historyEnabled ? [...this.history].reverse() : undefined,
        historySize: this.maxHistoryEntries,
        removeHistoryDuplicates: true
      });
      
      let cancelled = false;
      let lineReceived = false;
      
      rl.on('SIGINT', () => {
        cancelled = true;
        console.log(chalk.yellow('\nUse "exit" to quit aish'));
        rl.close();
      });
      
      rl.on('line', (input) => {
        lineReceived = true;
        rl.close();
        resolve(input);
      });
      
      rl.on('close', () => {
        // If we got here without a line and without SIGINT, it's EOF (Ctrl+D)
        if (!lineReceived && !cancelled) {
          // Check config for EOF behavior
          const eofExits = this.config.shell?.eof_exits ?? false;

          if (eofExits) {
            // Exit immediately
            resolve('exit');
          } else {
            // Show warning and continue
            console.log(chalk.yellow('\nUse "exit" to quit aish'));
            resolve(null);
          }
        } else if (cancelled) {
          resolve(null);
        }
      });
      
      rl.prompt();
    });
  }
  
  async readEditInput(initialValue, promptText = 'Edit: ') {
    return new Promise((resolve) => {
      console.log(chalk.gray('Edit command (press Enter to execute, Ctrl+C to cancel):'));
      
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt: chalk.gray(promptText),
        terminal: true
      });
      
      let cancelled = false;
      
      rl.on('SIGINT', () => {
        cancelled = true;
        console.log(chalk.yellow('\nCancelled'));
        rl.close();
      });
      
      rl.on('line', (input) => {
        rl.close();
        resolve(input);
      });
      
      rl.on('close', () => {
        if (cancelled) {
          resolve(null);
        }
      });
      
      rl.prompt();
      rl.write(initialValue);
    });
  }
  
  async handleCommand(parsed, originalInput) {
    switch (parsed.type) {
      case 'ai_question':
        await this.handleAIQuestion(parsed.query);
        break;

      case 'natural_language':
        await this.handleNaturalLanguage(parsed.query);
        break;

      case 'substitution':
        await this.handleSubstitution(parsed.command, parsed.substitutions);
        break;

      case 'regular':
        await this.executeCommand(originalInput);
        break;
    }
  }
  
  async handleAIQuestion(query) {
    if (this.config.noAi) {
      console.log(chalk.yellow('AI features are disabled'));
      return;
    }
    
    const spinner = this.createSpinner('Thinking...');
    
    // Set up SIGINT handler for canceling the operation
    let operationInterrupted = false;
    const sigintHandler = () => {
      operationInterrupted = true;
      if (this.claude && this.claude.interrupt) {
        this.claude.interrupt();
      }
      this.stopSpinner(spinner);
      console.log(chalk.yellow('\nOperation cancelled'));
    };
    process.once('SIGINT', sigintHandler);

    try {
      const context = {
        query,
        cwd: this.cwd,
        os: os.platform(),
        shell: path.basename(this.shellPath)
      };
      
      // Pass a callback to handle intermediate steps
      const onStep = (step) => {
        // Don't process steps if interrupted
        if (operationInterrupted) return;

        if (spinner) spinner.clear();  // Clear spinner before printing step
        
        // Display tool uses if present
        if (step.toolUses && step.toolUses.length > 0) {
          step.toolUses.forEach(tool => {
            console.log(chalk.gray(`[${tool}]`));
          });
        }
        
        // Display content if present and not just whitespace
        if (step.content && step.content.trim()) {
          if (process.env.AISH_VERBOSE) {
            // Verbose mode: show full content
            console.log(chalk.gray('[Thinking] ' + step.content));
          } else {
            // Normal mode: show abbreviated content
            const abbreviated = step.content.length > 80 ? 
              step.content.substring(0, 77) + '...' : step.content;
            console.log(chalk.gray('[Thinking] ' + abbreviated));
          }
        }
        
        if (spinner && !operationInterrupted) spinner.start();  // Restart spinner after printing
      };
      
      const response = await this.claude.askQuestion(context, onStep);

      // Remove the SIGINT handler if we completed normally
      process.removeListener('SIGINT', sigintHandler);

      this.stopSpinner(spinner);

      // If operation was interrupted, return early
      if (operationInterrupted) {
        return;
      }

      if (process.env.AISH_DEBUG) {
        console.log(chalk.gray('[DEBUG] Response received'));
      }
      
      // Handle the response object properly
      let content = '';
      
      if (typeof response === 'object' && response !== null) {
        content = response.content || '';
      } else {
        content = String(response);
      }
      
      console.log(chalk.cyan('Answer:'), content);
    } catch (error) {
      // Remove the SIGINT handler on error
      process.removeListener('SIGINT', sigintHandler);

      this.stopSpinner(spinner);

      // If it was interrupted, we already showed the message
      if (!operationInterrupted) {
        console.error(chalk.red('Failed to get answer:'), error.message);
      }
    }
  }
  
  async handleNaturalLanguage(query) {
    if (this.config.noAi) {
      console.log(chalk.yellow('AI features are disabled'));
      return;
    }
    
    const spinner = this.createSpinner('Generating command...');
    
    // Set up SIGINT handler for canceling the operation
    let operationInterrupted = false;
    const sigintHandler = () => {
      operationInterrupted = true;
      if (this.claude && this.claude.interrupt) {
        this.claude.interrupt();
      }
      this.stopSpinner(spinner);
      console.log(chalk.yellow('\nOperation cancelled'));
    };
    process.once('SIGINT', sigintHandler);

    try {
      const context = {
        query,
        cwd: this.cwd,
        history: this.history.slice(-5),
        os: os.platform(),
        shell: path.basename(this.shellPath)
      };
      
      const suggestion = await this.claude.generateCommand(context);

      // Remove the SIGINT handler if we completed normally
      process.removeListener('SIGINT', sigintHandler);

      this.stopSpinner(spinner);
      
      // If operation was interrupted, return early
      if (operationInterrupted) {
        return;
      }

      console.log(chalk.cyan('Generated command:'));
      console.log(chalk.bold(suggestion));
      
      const action = await this.promptAction('Execute this command?');
      
      switch(action) {
        case 'yes':
          await this.addToHistory(suggestion);
          await this.executeCommand(suggestion);
          break;
        case 'edit':
          const edited = await this.readEditInput(suggestion);
          if (edited && edited.trim()) {
            await this.addToHistory(edited.trim());
            await this.executeCommand(edited.trim());
          }
          break;
        case 'no':
          // Do nothing
          break;
      }
    } catch (error) {
      // Remove the SIGINT handler on error
      process.removeListener('SIGINT', sigintHandler);

      this.stopSpinner(spinner);

      // If it was interrupted, we already showed the message
      if (!operationInterrupted) {
        console.error(chalk.red('Failed to generate command:'), error.message);
      }
    }
  }
  
  async handleSubstitution(command, substitutions) {
    if (this.config.noAi) {
      console.log(chalk.yellow('AI features are disabled'));
      return;
    }
    
    const spinner = this.createSpinner('Processing substitution...');
    
    // Set up SIGINT handler for canceling the operation
    let operationInterrupted = false;
    const sigintHandler = () => {
      operationInterrupted = true;
      if (this.claude && this.claude.interrupt) {
        this.claude.interrupt();
      }
      this.stopSpinner(spinner);
      console.log(chalk.yellow('\nOperation cancelled'));
    };
    process.once('SIGINT', sigintHandler);

    try {
      const context = {
        command,
        substitutions,
        cwd: this.cwd,
        history: this.history.slice(-5)
      };
      
      const result = await this.claude.processSubstitution(context);

      // Remove the SIGINT handler if we completed normally
      process.removeListener('SIGINT', sigintHandler);

      this.stopSpinner(spinner);
      
      // If operation was interrupted, return early
      if (operationInterrupted) {
        return;
      }

      console.log(chalk.cyan('Suggested command:'));
      console.log(chalk.bold(result));
      
      const action = await this.promptAction('Execute this command?');
      
      switch(action) {
        case 'yes':
          await this.addToHistory(result);
          await this.executeCommand(result);
          break;
        case 'edit':
          const edited = await this.readEditInput(result);
          if (edited && edited.trim()) {
            await this.addToHistory(edited.trim());
            await this.executeCommand(edited.trim());
          }
          break;
        case 'no':
          // Do nothing
          break;
      }
    } catch (error) {
      // Remove the SIGINT handler on error
      process.removeListener('SIGINT', sigintHandler);

      this.stopSpinner(spinner);

      // If it was interrupted, we already showed the message
      if (!operationInterrupted) {
        console.error(chalk.red('Failed to process substitution:'), error.message);
      }
    }
  }
  
  async executeCommand(command) {
    try {
      // Handle cd specially
      if (command.startsWith('cd ')) {
        const dir = command.slice(3).trim();
        const newDir = path.resolve(this.cwd, dir);
        try {
          process.chdir(newDir);
          this.cwd = process.cwd();
        } catch (error) {
          console.error(chalk.red(`cd: ${error.message}`));
        }
        return;
      }
      
      // Execute the command
      const result = await execa(this.shellPath, ['-c', command], {
        cwd: this.cwd,
        env: process.env,
        stdio: 'inherit',
        reject: false
      });
      
      // Check for errors and offer correction
      if (result.exitCode !== 0 && !this.config.noAi) {
        await this.handleErrorCorrection(command, result);
      }
    } catch (error) {
      console.error(chalk.red('Execution error:'), error.message);
    }
  }
  
  async handleErrorCorrection(command, result) {
    // Check if we should ignore this exit code
    const ignoredCodes = this.config.error_handling?.ignore_exit_codes || {};
    const cmdName = command.split(' ')[0];
    if (ignoredCodes[cmdName]?.includes(result.exitCode)) {
      return;
    }
    
    const spinner = this.createSpinner('Analyzing error...');
    
    // Set up SIGINT handler for canceling the analysis
    let analysisInterrupted = false;
    const sigintHandler = () => {
      analysisInterrupted = true;
      if (this.claude && this.claude.interrupt) {
        this.claude.interrupt();
      }
      this.stopSpinner(spinner);
      console.log(chalk.yellow('\nAnalysis cancelled'));
    };
    process.once('SIGINT', sigintHandler);

    try {
      const context = {
        command,
        exitCode: result.exitCode,
        stderr: result.stderr,
        stdout: result.stdout,
        cwd: this.cwd
      };
      
      const suggestion = await this.claude.suggestCorrection(context);

      // Remove the SIGINT handler if we completed normally
      process.removeListener('SIGINT', sigintHandler);

      this.stopSpinner(spinner);
      
      // If analysis was interrupted, return early
      if (analysisInterrupted) {
        return;
      }

      if (suggestion && suggestion !== command) {
        console.log(chalk.yellow('\nCommand failed. Suggested fix:'));
        console.log(chalk.bold(suggestion));
        
        const action = await this.promptAction('Run corrected command?');
        
        switch(action) {
          case 'yes':
            await this.addToHistory(suggestion);
            await this.executeCommand(suggestion);
            break;
          case 'edit':
            const edited = await this.readEditInput(suggestion);
            if (edited && edited.trim()) {
              await this.addToHistory(edited.trim());
              await this.executeCommand(edited.trim());
            }
            break;
          case 'no':
            // Do nothing
            break;
        }
      }
    } catch (error) {
      // Remove the SIGINT handler on error
      process.removeListener('SIGINT', sigintHandler);

      // Silently fail if error correction fails
      this.stopSpinner(spinner);

      // If it was interrupted, we already showed the message
      if (!analysisInterrupted && process.env.AISH_DEBUG) {
        console.log(chalk.gray(`[DEBUG] Error correction failed: ${error.message}`));
      }
    }
  }
  
  async promptAction(message) {
    // Auto-accept if in yes/yolo mode
    if (process.env.AISH_YES === 'true') {
      console.log(chalk.gray(`${message} [auto-accepted]`));
      return 'yes';
    }
    
    const response = await prompts({
      type: 'select',
      name: 'action',
      message,
      choices: [
        { title: 'Yes', value: 'yes' },
        { title: 'No', value: 'no' },
        { title: 'Edit', value: 'edit' }
      ]
    }, {
      onCancel: () => {
        return 'no';
      }
    });
    
    return response.action || 'no';
  }
  
  getPrompt() {
    const dir = this.cwd === os.homedir() ? '~' : path.basename(this.cwd);
    
    // Get git branch if in a git repo
    let gitBranch = '';
    try {
      const result = execaSync('git', ['branch', '--show-current'], {
        cwd: this.cwd,
        reject: false,
        timeout: 100  // Quick timeout to avoid delays
      });
      if (result.exitCode === 0 && result.stdout) {
        gitBranch = result.stdout.trim();
      }
    } catch (e) {
      // Not a git repo or git not available, ignore
    }
    
    const branchPart = gitBranch ? ` (${gitBranch})` : '';
    return chalk.hex('#FF6B35')(`🔥 ${dir}${branchPart} ❯ `);
  }
  
  cleanup() {
    if (this.claude) {
      this.claude.disconnect();
    }
    console.log(chalk.gray('\nGoodbye!'));
    process.exit(0);
  }
  
  stop() {
    this.isRunning = false;
  }
}
