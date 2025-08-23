import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { HistoryProvider } from '../../completion/interfaces.js';

/**
 * Zsh history provider
 * Reads from ~/.zsh_history or $HISTFILE
 * Format: `: timestamp:duration;command`
 */
export class ZshHistoryProvider extends HistoryProvider {
  constructor(config = {}) {
    super(config);
    this.historyFile = this.getHistoryFile();
    this.history = [];
    this.loaded = false;
    this.deduplicatedHistory = [];
  }

  getHistoryFile() {
    // Check HISTFILE environment variable first
    if (process.env.HISTFILE) {
      return this.expandPath(process.env.HISTFILE);
    }
    // Try common locations
    const locations = [
      '.zsh_history',
      '.zhistory',
      '.history'
    ];
    
    for (const loc of locations) {
      const fullPath = path.join(os.homedir(), loc);
      try {
        // Check if file exists (sync for constructor)
        if (require('fs').existsSync(fullPath)) {
          return fullPath;
        }
      } catch {}
    }
    
    // Default to ~/.zsh_history
    return path.join(os.homedir(), '.zsh_history');
  }

  expandPath(filePath) {
    if (filePath.startsWith('~')) {
      return path.join(os.homedir(), filePath.slice(1));
    }
    return filePath;
  }

  parseZshHistoryLine(line, previousLine = '') {
    // Zsh extended history format: `: timestamp:duration;command`
    // Example: `: 1635360000:0;echo hello`
    // Also handle simple format without metadata
    // And handle multi-line commands
    
    if (line.startsWith(': ')) {
      const match = line.match(/^: (\d+):(\d+);(.*)$/);
      if (match) {
        return {
          command: match[3],
          timestamp: parseInt(match[1]) * 1000, // Convert to ms
          duration: parseInt(match[2]) * 1000, // Convert to ms
          metadata: { source: 'zsh' }
        };
      }
    }
    
    // Fallback to simple format or continuation of multi-line
    return {
      command: line,
      timestamp: null,
      duration: null,
      metadata: { source: 'zsh' }
    };
  }

  async loadHistory(forceReload = false) {
    // Reload history each time to get latest commands from shell
    if (this.loaded && !forceReload) return;

    try {
      const content = await fs.readFile(this.historyFile, 'utf8');
      const lines = content.split('\n');
      
      this.history = [];
      let currentEntry = null;
      let inMultiline = false;

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // Check if this is the start of a new entry with metadata
        if (line.startsWith(': ') && line.match(/^: \d+:\d+;/)) {
          // Save previous entry if exists
          if (currentEntry && currentEntry.command.trim()) {
            this.history.push(currentEntry);
          }
          
          // Parse new entry
          currentEntry = this.parseZshHistoryLine(line);
          inMultiline = false;
        } else if (currentEntry && !line.startsWith(': ')) {
          // This is a continuation of a multiline command
          currentEntry.command += '\n' + line;
          inMultiline = true;
        } else if (line.trim() && !line.startsWith(': ')) {
          // Simple format without metadata
          if (currentEntry && currentEntry.command.trim()) {
            this.history.push(currentEntry);
          }
          currentEntry = {
            command: line,
            timestamp: null,
            exitCode: null,
            cwd: null,
            duration: null,
            metadata: { source: 'zsh' }
          };
        }
      }

      // Don't forget the last entry
      if (currentEntry && currentEntry.command.trim()) {
        this.history.push(currentEntry);
      }

      // Deduplicate history - keep the most recent occurrence
      this.deduplicateHistory();

      this.loaded = true;
      
      if (process.env.AISH_DEBUG) {
        console.log(`[DEBUG] Loaded ${this.history.length} zsh history entries (${this.deduplicatedHistory.length} unique)`);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error('Error loading zsh history:', error);
      }
      this.history = [];
      this.deduplicatedHistory = [];
      this.loaded = true;
    }
  }

  deduplicateHistory() {
    const seen = new Map();
    const deduplicated = [];
    
    // Process from newest to oldest (reverse order)
    for (let i = this.history.length - 1; i >= 0; i--) {
      const item = this.history[i];
      const command = item.command.trim();
      
      if (!seen.has(command)) {
        seen.set(command, true);
        deduplicated.unshift(item); // Add to beginning to maintain order
      }
    }
    
    this.deduplicatedHistory = deduplicated;
  }

  async search(query, options = {}) {
    // Always reload to get latest history
    await this.loadHistory(true);
    
    const { deduplicate = true, limit = this.maxResults } = options;
    const searchArray = deduplicate ? this.deduplicatedHistory : this.history;

    if (!query) {
      return searchArray.slice(-limit).reverse();
    }

    const results = [];
    const lowerQuery = query.toLowerCase();

    // Search from most recent to oldest
    for (let i = searchArray.length - 1; i >= 0 && results.length < limit; i--) {
      const item = searchArray[i];
      if (item.command.toLowerCase().includes(lowerQuery)) {
        results.push(item);
      }
    }

    return results;
  }

  async add(command, metadata = {}) {
    // Zsh history is typically managed by the shell itself
    // This method is here for compatibility but won't modify the zsh history file
    await this.loadHistory();
    
    const newEntry = {
      command,
      timestamp: Date.now(),
      exitCode: metadata.exitCode || null,
      cwd: metadata.cwd || process.cwd(),
      duration: metadata.duration || null,
      metadata: { ...metadata, source: 'zsh' }
    };
    
    this.history.push(newEntry);
    
    // Re-deduplicate if needed
    const command_trimmed = command.trim();
    const existingIndex = this.deduplicatedHistory.findIndex(h => h.command.trim() === command_trimmed);
    if (existingIndex >= 0) {
      this.deduplicatedHistory.splice(existingIndex, 1);
    }
    this.deduplicatedHistory.push(newEntry);
  }

  async getRecent(limit = 10) {
    await this.loadHistory();
    return this.deduplicatedHistory.slice(-limit).reverse();
  }

  async getAll() {
    await this.loadHistory();
    return [...this.deduplicatedHistory].reverse();
  }

  async getAllRaw() {
    await this.loadHistory();
    return [...this.history].reverse();
  }

  async clear() {
    // Don't actually clear zsh history file
    // Just clear our in-memory cache
    this.history = [];
    this.deduplicatedHistory = [];
    this.loaded = false;
  }

  /**
   * Check if zsh history is available
   */
  async isAvailable() {
    try {
      if (process.env.AISH_DEBUG) {
        console.log(`[DEBUG] Checking zsh history file: ${this.historyFile}`);
      }
      await fs.access(this.historyFile, fs.constants.R_OK);
      if (process.env.AISH_DEBUG) {
        console.log(`[DEBUG] Zsh history file exists and is readable`);
      }
      return true;
    } catch (error) {
      if (process.env.AISH_DEBUG) {
        console.log(`[DEBUG] Zsh history file not accessible:`, error.message);
      }
      return false;
    }
  }

  /**
   * Get statistics about the history
   */
  async getStats() {
    await this.loadHistory();
    
    const commands = new Map();
    let totalDuration = 0;
    let commandsWithDuration = 0;

    for (const item of this.deduplicatedHistory) {
      const cmd = item.command.split(' ')[0];
      commands.set(cmd, (commands.get(cmd) || 0) + 1);
      
      if (item.duration) {
        totalDuration += item.duration;
        commandsWithDuration++;
      }
    }

    return {
      total: this.history.length,
      unique: this.deduplicatedHistory.length,
      averageDuration: commandsWithDuration > 0 ? totalDuration / commandsWithDuration : null,
      topCommands: Array.from(commands.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([cmd, count]) => ({ command: cmd, count }))
    };
  }
}

export default ZshHistoryProvider;