import readline from 'readline';
import chalk from 'chalk';
import CompletionManager from './completion/manager.js';

/**
 * Enhanced readline interface with tab completion and history search
 */
export class EnhancedReadline {
  constructor(config = {}) {
    this.config = config;
    this.completionManager = new CompletionManager(config);
    this.rl = null;
    this.isHistorySearchMode = false;
    this.lastCompletionPrefix = '';
    this.lastCompletions = [];
    this.showCompletionsOnNext = false;
    this.fzfPath = null;
  }

  /**
   * Set the path to fzf for enhanced history search
   */
  setFzfPath(path) {
    this.fzfPath = path;
  }

  async initialize() {
    await this.completionManager.initialize();
  }

  /**
   * Create an enhanced readline interface
   */
  createInterface(options = {}) {
    const enhancedOptions = {
      ...options,
      completer: this.config.completion?.enabled !== false 
        ? (line, callback) => this.completer(line, callback)
        : undefined,
      terminal: true
    };

    this.rl = readline.createInterface(enhancedOptions);
    
    // Set up custom key bindings
    this.setupKeyBindings();
    
    return this.rl;
  }

  /**
   * Parse command line into components
   */
  parseCommandLine(line, cursor) {
    const beforeCursor = line.substring(0, cursor);
    const words = this.tokenize(beforeCursor);
    
    // Determine if we're at the start of a new word
    const endsWithSpace = beforeCursor.endsWith(' ') || beforeCursor.endsWith('\t');
    const currentWord = endsWithSpace ? '' : (words.pop() || '');
    
    return {
      words,           // Previous complete words
      currentWord,     // Word being typed
      isNewWord: endsWithSpace,
      command: words[0] || '',
      position: words.length  // Position in command (0 = command, 1+ = arguments)
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
        } else if (/\s/.test(char)) {
          if (current) {
            words.push(current);
            current = '';
          }
        } else {
          current += char;
        }
      }
    }
    
    if (current) {
      words.push(current);
    }
    
    return words;
  }

  /**
   * Tab completion handler - properly modifies the line
   */
  async completer(line, callback) {
    try {
      // Get cursor position
      const cursor = this.rl ? this.rl.cursor : line.length;
      const parsed = this.parseCommandLine(line, cursor);
      
      // Check if this is a double-tab (same prefix as last time)
      const isDoubleTab = (parsed.currentWord === this.lastCompletionPrefix) && 
                         this.showCompletionsOnNext;
      
      const context = {
        cwd: process.cwd(),
        env: process.env,
        line,
        cursor,
        command: parsed.command,
        position: parsed.position,
        isNewWord: parsed.isNewWord
      };

      // Get completions for the current word
      const completions = await this.completionManager.getCompletions(parsed.currentWord, context);
      
      // Store for double-tab detection
      this.lastCompletionPrefix = parsed.currentWord;
      this.lastCompletions = completions;
      
      if (completions.length === 0) {
        // No completions
        this.showCompletionsOnNext = false;
        callback(null, [[], line]);
        return;
      }

      // Extract completion texts
      const completionTexts = completions.map(c => c.text);
      
      // The readline completer expects us to return what replaces everything up to the cursor
      const beforeCursor = line.substring(0, cursor);
      const afterCursor = line.substring(cursor);
      const beforeWord = beforeCursor.substring(0, beforeCursor.length - parsed.currentWord.length);
      
      if (completions.length === 1) {
        // Single match - complete it fully
        const completed = completions[0].text;
        
        // Add a space after if it's a complete match and not a directory
        const addSpace = !completed.endsWith('/') && !completed.endsWith('=');
        const completion = completed + (addSpace ? ' ' : '');
        
        // Build what should replace everything up to cursor
        const replacement = beforeWord + completion;
        
        this.showCompletionsOnNext = false;
        
        // Update cursor position after completion
        if (this.rl) {
          // Set the new cursor position after the completion happens
          process.nextTick(() => {
            if (this.rl) {
              this.rl.cursor = replacement.length;
            }
          });
        }
        
        // Return the completions array and what replaces everything up to cursor
        callback(null, [[completion], replacement]);
      } else {
        // Multiple matches
        const commonPrefix = this.findCommonPrefix(completionTexts);
        
        if (commonPrefix.length > parsed.currentWord.length) {
          // Can extend to common prefix
          const replacement = beforeWord + commonPrefix;
          
          this.showCompletionsOnNext = true;
          
          // Update cursor position after completion
          if (this.rl) {
            process.nextTick(() => {
              if (this.rl) {
                this.rl.cursor = replacement.length;
              }
            });
          }
          
          callback(null, [completionTexts, replacement]);
        } else if (isDoubleTab || parsed.currentWord === commonPrefix) {
          // Already at common prefix or double-tab - show completions
          this.displayCompletions(completions);
          this.showCompletionsOnNext = false;
          // Don't modify the line when showing completions
          callback(null, [[], line]);
        } else {
          // First tab with no common extension - show completions
          this.displayCompletions(completions);
          this.showCompletionsOnNext = false;
          callback(null, [[], line]);
        }
      }
    } catch (error) {
      console.error('Completion error:', error);
      callback(null, [[], line]);
    }
  }

  /**
   * Display completions in a formatted way
   */
  displayCompletions(completions) {
    if (completions.length === 0) return;

    console.log(); // New line

    // Check if we should use fzf for interactive selection
    if (this.config.completion?.use_fzf !== false) {
      this.tryFzfCompletion(completions);
      return;
    }

    // Group completions by type
    const grouped = {};
    for (const comp of completions) {
      const type = comp.type || 'other';
      if (!grouped[type]) grouped[type] = [];
      grouped[type].push(comp);
    }

    // Display each group
    for (const [type, items] of Object.entries(grouped)) {
      if (items.length === 0) continue;
      
      // Don't show type header if there's only one type
      if (Object.keys(grouped).length > 1) {
        console.log(chalk.gray(`  ${type}:`));
      }
      
      // Calculate column width
      const maxWidth = Math.max(...items.map(i => i.text.length));
      const termWidth = process.stdout.columns || 80;
      const columnWidth = Math.min(maxWidth + 2, 30);
      const columns = Math.max(1, Math.floor((termWidth - 4) / columnWidth));

      // Display in columns
      for (let i = 0; i < items.length; i += columns) {
        const row = items.slice(i, i + columns);
        const formatted = row.map(item => {
          let text = item.text.padEnd(columnWidth);
          
          // Truncate if too long
          if (item.text.length > columnWidth - 2) {
            text = item.text.substring(0, columnWidth - 5) + '...' + '  ';
          }
          
          // Color based on type
          switch (item.type) {
            case 'command':
              return chalk.green(text);
            case 'directory':
              return chalk.blue(text);
            case 'file':
              return chalk.white(text);
            case 'history':
              return chalk.gray(text);
            case 'option':
              return chalk.yellow(text);
            case 'variable':
              return chalk.magenta(text);
            default:
              return text;
          }
        });
        
        console.log('  ' + formatted.join(''));
      }
    }
    
    // Redraw the prompt and current line
    if (this.rl) {
      this.rl.prompt(true);
    }
  }

  /**
   * Try to use fzf for interactive completion selection
   */
  async tryFzfCompletion(completions) {
    try {
      const fuzzySearcher = await this.completionManager.fuzzySearcher.getSearcher();
      
      if (fuzzySearcher.supportsInteractive()) {
        // Format completions for fzf
        const items = completions.map(c => {
          const type = c.type ? `[${c.type}]`.padEnd(12) : '';
          return `${c.text.padEnd(30)} ${chalk.gray(type)}`;
        });
        
        const selected = await fuzzySearcher.interactiveSearch(items, {
          prompt: 'Select: ',
          height: '40%'
        });
        
        if (selected) {
          // Extract the completion text from the formatted string
          const text = selected.trim().split(/\s+/)[0];
          
          // Replace the current word with the selection
          if (this.rl) {
            const line = this.rl.line;
            const cursor = this.rl.cursor;
            const parsed = this.parseCommandLine(line, cursor);
            
            const beforeWord = line.substring(0, cursor - parsed.currentWord.length);
            const afterCursor = line.substring(cursor);
            
            this.rl.line = beforeWord + text + afterCursor;
            this.rl.cursor = beforeWord.length + text.length;
            this.rl._refreshLine();
          }
        }
      } else {
        // Fall back to regular display
        this.displayCompletions(completions);
      }
    } catch (error) {
      // Fall back to regular display
      this.displayCompletions(completions);
    }
  }

  /**
   * Setup custom key bindings
   */
  setupKeyBindings() {
    if (!this.rl) return;

    // Store reference to this for use in listeners
    const self = this;

    // Override _ttyWrite to intercept keystrokes
    const originalTtyWrite = this.rl._ttyWrite;
    
    this.rl._ttyWrite = function(s, key) {
      // Ctrl+R for history search
      if (key && key.ctrl && key.name === 'r') {
        self.handleHistorySearch();
        return;
      }
      
      // Ctrl+Space for AI completion (future feature)
      if (key && key.ctrl && key.name === 'space') {
        self.handleAiCompletion();
        return;
      }
      
      // ESC to cancel completion
      if (key && key.name === 'escape') {
        if (self.isHistorySearchMode) {
          self.exitHistorySearch();
          return;
        }
        // Reset completion state
        self.showCompletionsOnNext = false;
        self.lastCompletionPrefix = '';
      }
      
      // Reset completion state on any non-tab key
      if (key && key.name !== 'tab') {
        self.showCompletionsOnNext = false;
      }
      
      // Call original handler
      originalTtyWrite.call(this, s, key);
    };
  }

  /**
   * Handle Ctrl+R history search with proper fallback
   */
  async handleHistorySearch() {
    if (!this.rl) return;

    // Save current line
    const originalLine = this.rl.line;
    const originalCursor = this.rl.cursor;

    try {
      // Get ALL history items with deduplication
      const historyItems = await this.completionManager.historyManager.search('', { 
        limit: 10000,  // Get all history
        deduplicate: true  // Remove duplicates
      });
      
      if (historyItems.length === 0) {
        console.log(chalk.gray('\nNo history available'));
        this.rl.prompt(true);
        return;
      }

      // Try to use native fzf first
      let selected = null;
      
      try {
        const { FzfNativeSearcher } = await import('./fuzzy/fzf-native.js');
        const fzfNative = new FzfNativeSearcher(this.config);
        
        // Use the detected fzf path if available
        if (this.fzfPath) {
          fzfNative.setFzfPath(this.fzfPath);
        }
        
        const isAvailable = await fzfNative.isAvailable();
        
        if (isAvailable) {
          // Save terminal state and pause readline
          const wasRaw = process.stdin.isRaw;
          this.rl.pause();
          
          // Temporarily disable raw mode to let fzf control the terminal
          if (process.stdin.setRawMode) {
            process.stdin.setRawMode(false);
          }
          
          // Clear the current line completely before starting fzf
          process.stdout.write('\r\x1b[2K\r');
          
          // Use native fzf for history search (like zsh plugin)
          selected = await fzfNative.searchHistory(historyItems, {
            query: originalLine  // Use current line as initial query
          });
          
          // Restore terminal state
          if (process.stdin.setRawMode && wasRaw) {
            process.stdin.setRawMode(true);
          }
          
          // Resume readline after fzf completes
          this.rl.resume();
        } else {
          console.log(chalk.yellow('\nFZF not available at path:', fzfNative.fzfPath));
        }
      } catch (fzfError) {
        // Make sure readline is resumed even on error
        this.rl.resume();
        
        // Only show error if it's not a cancellation
        if (!fzfError.message?.includes('cancelled')) {
          console.error(chalk.red('\nFZF error:'), fzfError.message);
        }
        
        this.rl.prompt(true);
        return;
      }
      
      // If no selection was made (user cancelled), just restore the prompt
      if (!selected) {
        this.rl.prompt(true);
        return;
      }
      
      if (selected) {
        // Replace current line with selected command
        this.rl.line = selected;
        this.rl.cursor = selected.length;
        this.rl._refreshLine();
      }
    } catch (error) {
      console.error('\nHistory search error:', error.message);
      // Restore original line
      this.rl.line = originalLine;
      this.rl.cursor = originalCursor;
      this.rl._refreshLine();
    }
  }

  /**
   * Simple interactive history search without fzf
   */
  async simpleHistorySearch(historyItems, originalLine, originalCursor) {
    console.log(chalk.cyan('\n(reverse-i-search) Type to search, Enter to select, Ctrl+C to cancel:'));
    
    let searchQuery = '';
    let matches = historyItems;
    let selectedIndex = 0;
    
    // Create a temporary readline for search
    const searchRl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: chalk.cyan('> ')
    });
    
    // Function to display matches
    const displayMatches = () => {
      // Clear previous output
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      
      if (matches.length === 0) {
        console.log(chalk.gray('No matches'));
        return;
      }
      
      // Show top 5 matches
      const toShow = matches.slice(0, 5);
      console.log(chalk.gray('\nMatches:'));
      toShow.forEach((item, index) => {
        const cmd = item.command.substring(0, 80);
        if (index === selectedIndex) {
          console.log(chalk.green('→ ') + chalk.white(cmd));
        } else {
          console.log('  ' + chalk.gray(cmd));
        }
      });
      
      if (matches.length > 5) {
        console.log(chalk.gray(`  ... and ${matches.length - 5} more`));
      }
    };
    
    return new Promise((resolve) => {
      searchRl.on('line', (input) => {
        // Select current match
        if (matches.length > selectedIndex) {
          const selected = matches[selectedIndex];
          this.rl.line = selected.command;
          this.rl.cursor = selected.command.length;
          this.rl._refreshLine();
        }
        searchRl.close();
        resolve();
      });
      
      searchRl.on('SIGINT', () => {
        // Cancel - restore original line
        this.rl.line = originalLine;
        this.rl.cursor = originalCursor;
        this.rl._refreshLine();
        searchRl.close();
        resolve();
      });
      
      // Handle character input for search
      searchRl.input.on('data', (key) => {
        const char = key.toString();
        
        if (char === '\u001b[A') { // Up arrow
          selectedIndex = Math.max(0, selectedIndex - 1);
          displayMatches();
        } else if (char === '\u001b[B') { // Down arrow
          selectedIndex = Math.min(matches.length - 1, selectedIndex + 1);
          displayMatches();
        } else if (char === '\u007f' || char === '\b') { // Backspace
          searchQuery = searchQuery.slice(0, -1);
          // Re-filter matches
          matches = this.filterHistory(historyItems, searchQuery);
          selectedIndex = 0;
          displayMatches();
        } else if (char.length === 1 && char >= ' ') {
          searchQuery += char;
          // Filter matches
          matches = this.filterHistory(historyItems, searchQuery);
          selectedIndex = 0;
          displayMatches();
        }
        
        // Update prompt with search query
        searchRl.setPrompt(chalk.cyan(`> ${searchQuery}`));
        searchRl.prompt();
      });
      
      // Initial display
      displayMatches();
      searchRl.prompt();
    });
  }

  /**
   * Filter history items by search query
   */
  filterHistory(items, query) {
    if (!query) return items;
    
    const lowerQuery = query.toLowerCase();
    return items.filter(item => 
      item.command.toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * Handle Ctrl+Space for AI completion
   */
  async handleAiCompletion() {
    // This would integrate with the AI system
    console.log(chalk.gray('\nAI completion not yet implemented'));
    if (this.rl) {
      this.rl.prompt(true);
    }
  }

  /**
   * Find common prefix among strings
   */
  findCommonPrefix(strings) {
    if (strings.length === 0) return '';
    if (strings.length === 1) return strings[0];

    let prefix = '';
    const firstStr = strings[0];

    for (let i = 0; i < firstStr.length; i++) {
      const char = firstStr[i];
      if (strings.every(s => s[i] === char)) {
        prefix += char;
      } else {
        break;
      }
    }

    return prefix;
  }

  /**
   * Read input with enhanced features
   */
  async readInput(prompt, options = {}) {
    await this.initialize();

    return new Promise((resolve) => {
      const rl = this.createInterface({
        input: process.stdin,
        output: process.stdout,
        prompt,
        ...options
      });

      // Store initial prompt for restoration
      rl._initialPrompt = prompt;

      let lineReceived = false;
      
      rl.on('line', (input) => {
        lineReceived = true;
        rl.close();
        resolve(input);
      });

      rl.on('close', () => {
        // Only handle EOF if we didn't receive a line
        if (!lineReceived) {
          // EOF (Ctrl+D) handling
          const eofExits = this.config.shell?.eof_exits ?? false;
          if (eofExits) {
            resolve('exit');
          } else {
            console.log(chalk.yellow('\nUse "exit" to quit aish'));
            // Return empty string instead of null to continue the loop properly
            resolve('');
          }
        }
      });

      rl.on('SIGINT', () => {
        console.log(chalk.yellow('\nUse "exit" to quit'));
        rl.close();
        resolve(null);
      });

      rl.prompt();
    });
  }

  /**
   * Cleanup
   */
  cleanup() {
    if (this.rl) {
      this.rl.close();
      this.rl = null;
    }
  }
}

export default EnhancedReadline;