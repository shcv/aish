import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { HistoryProvider } from '../../completion/interfaces.js';

/**
 * Bash history provider
 * Reads from ~/.bash_history or $HISTFILE
 */
export class BashHistoryProvider extends HistoryProvider {
  constructor(config = {}) {
    super(config);
    this.historyFile = this.getHistoryFile();
    this.history = [];
    this.loaded = false;
  }

  getHistoryFile() {
    // Check HISTFILE environment variable first
    if (process.env.HISTFILE) {
      return this.expandPath(process.env.HISTFILE);
    }
    // Default to ~/.bash_history
    return path.join(os.homedir(), '.bash_history');
  }

  expandPath(filePath) {
    if (filePath.startsWith('~')) {
      return path.join(os.homedir(), filePath.slice(1));
    }
    return filePath;
  }

  async loadHistory(forceReload = false) {
    // Reload history each time to get latest commands from shell
    if (this.loaded && !forceReload) return;

    try {
      const content = await fs.readFile(this.historyFile, 'utf8');
      const lines = content.split('\n').filter(line => line.trim());
      
      this.history = [];
      let currentCommand = '';
      let isMultiline = false;

      for (const line of lines) {
        // Handle HISTTIMEFORMAT (lines starting with #timestamp)
        if (line.startsWith('#') && line.match(/^#\d+$/)) {
          // This is a timestamp line, skip it but note we saw it
          continue;
        }

        // Handle multi-line commands (lines ending with \)
        if (line.endsWith('\\')) {
          currentCommand += line.slice(0, -1) + '\n';
          isMultiline = true;
        } else {
          currentCommand += line;
          
          if (currentCommand.trim()) {
            this.history.push({
              command: currentCommand,
              timestamp: null, // Bash history doesn't include timestamps by default
              exitCode: null,
              cwd: null,
              duration: null,
              metadata: { source: 'bash' }
            });
          }
          
          currentCommand = '';
          isMultiline = false;
        }
      }

      this.loaded = true;
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error('Error loading bash history:', error);
      }
      this.history = [];
      this.loaded = true;
    }
  }

  async search(query, limit = this.maxResults) {
    // Always reload to get latest history
    await this.loadHistory(true);

    if (!query) {
      return this.history.slice(-limit).reverse();
    }

    const results = [];
    const lowerQuery = query.toLowerCase();

    // Search from most recent to oldest
    for (let i = this.history.length - 1; i >= 0 && results.length < limit; i--) {
      const item = this.history[i];
      if (item.command.toLowerCase().includes(lowerQuery)) {
        results.push(item);
      }
    }

    return results;
  }

  async add(command, metadata = {}) {
    // Bash history is typically managed by the shell itself
    // This method is here for compatibility but won't modify the bash history file
    await this.loadHistory();
    
    this.history.push({
      command,
      timestamp: Date.now(),
      exitCode: metadata.exitCode || null,
      cwd: metadata.cwd || process.cwd(),
      duration: metadata.duration || null,
      metadata: { ...metadata, source: 'bash' }
    });
  }

  async getRecent(limit = 10) {
    await this.loadHistory();
    return this.history.slice(-limit).reverse();
  }

  async getAll() {
    await this.loadHistory();
    return [...this.history].reverse();
  }

  async clear() {
    // Don't actually clear bash history file
    // Just clear our in-memory cache
    this.history = [];
    this.loaded = false;
  }

  /**
   * Check if bash history is available
   */
  async isAvailable() {
    try {
      await fs.access(this.historyFile, fs.constants.R_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get statistics about the history
   */
  async getStats() {
    await this.loadHistory();
    
    const commands = new Map();
    for (const item of this.history) {
      const cmd = item.command.split(' ')[0];
      commands.set(cmd, (commands.get(cmd) || 0) + 1);
    }

    return {
      total: this.history.length,
      unique: new Set(this.history.map(h => h.command)).size,
      topCommands: Array.from(commands.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([cmd, count]) => ({ command: cmd, count }))
    };
  }
}

export default BashHistoryProvider;