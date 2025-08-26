import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { HistoryProvider } from '../../completion/interfaces.js';

/**
 * Fish history provider
 * Reads from ~/.local/share/fish/fish_history or $XDG_DATA_HOME/fish/fish_history
 * Format: YAML-like with timestamps and paths
 */
export class FishHistoryProvider extends HistoryProvider {
  constructor(config = {}) {
    super(config);
    this.historyFile = this.getHistoryFile();
    this.history = [];
    this.loaded = false;
  }

  getHistoryFile() {
    // Check XDG_DATA_HOME first
    const xdgDataHome = process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share');
    const fishHistoryDir = path.join(xdgDataHome, 'fish');
    
    // Fish can have session-specific history files
    const sessionName = process.env.fish_history || 'fish';
    const historyFile = path.join(fishHistoryDir, `${sessionName}_history`);
    
    // Check if the file exists
    try {
      if (require('fs').existsSync(historyFile)) {
        return historyFile;
      }
    } catch {}
    
    // Fallback to default location
    return path.join(fishHistoryDir, 'fish_history');
  }

  parseFishHistory(content) {
    const entries = [];
    const lines = content.split('\n');
    
    let currentEntry = null;
    let inCommand = false;

    for (const line of lines) {
      // Fish history format:
      // - cmd: command text
      //   when: timestamp
      //   paths:
      //     - /path/1
      //     - /path/2
      
      if (line.startsWith('- cmd: ')) {
        // Save previous entry if exists
        if (currentEntry && currentEntry.command) {
          entries.push(currentEntry);
        }
        
        // Start new entry
        const command = line.substring(7); // Remove '- cmd: '
        currentEntry = {
          command,
          timestamp: null,
          paths: [],
          metadata: { source: 'fish' }
        };
        inCommand = true;
      } else if (line.startsWith('  when: ') && currentEntry) {
        // Parse timestamp
        const timestamp = parseInt(line.substring(8));
        if (!isNaN(timestamp)) {
          currentEntry.timestamp = timestamp * 1000; // Convert to ms
        }
      } else if (line === '  paths:' && currentEntry) {
        // Start of paths section
        inCommand = false;
      } else if (line.startsWith('    - ') && currentEntry) {
        // Parse path
        const pathStr = line.substring(6);
        currentEntry.paths.push(pathStr);
      } else if (line.startsWith('  ') && inCommand && currentEntry) {
        // Continuation of multi-line command
        currentEntry.command += `\n${  line.substring(2)}`;
      }
    }

    // Save last entry
    if (currentEntry && currentEntry.command) {
      entries.push(currentEntry);
    }

    return entries;
  }

  async loadHistory() {
    if (this.loaded) return;

    try {
      const content = await fs.readFile(this.historyFile, 'utf8');
      const entries = this.parseFishHistory(content);
      
      this.history = entries.map(entry => ({
        command: entry.command,
        timestamp: entry.timestamp,
        exitCode: null,
        cwd: entry.paths.length > 0 ? entry.paths[0] : null,
        duration: null,
        metadata: {
          ...entry.metadata,
          paths: entry.paths
        }
      }));

      // Sort by timestamp if available
      this.history.sort((a, b) => {
        if (a.timestamp && b.timestamp) {
          return a.timestamp - b.timestamp;
        }
        return 0;
      });

      this.loaded = true;
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error('Error loading fish history:', error);
      }
      this.history = [];
      this.loaded = true;
    }
  }

  async search(query, limit = this.maxResults) {
    await this.loadHistory();

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
    // Fish history is typically managed by the shell itself
    // This method is here for compatibility but won't modify the fish history file
    await this.loadHistory();
    
    this.history.push({
      command,
      timestamp: Date.now(),
      exitCode: metadata.exitCode || null,
      cwd: metadata.cwd || process.cwd(),
      duration: metadata.duration || null,
      metadata: { ...metadata, source: 'fish' }
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
    // Don't actually clear fish history file
    // Just clear our in-memory cache
    this.history = [];
    this.loaded = false;
  }

  /**
   * Check if fish history is available
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
    const directories = new Map();

    for (const item of this.history) {
      const cmd = item.command.split(' ')[0];
      commands.set(cmd, (commands.get(cmd) || 0) + 1);
      
      if (item.cwd) {
        directories.set(item.cwd, (directories.get(item.cwd) || 0) + 1);
      }
    }

    return {
      total: this.history.length,
      unique: new Set(this.history.map(h => h.command)).size,
      topCommands: Array.from(commands.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([cmd, count]) => ({ command: cmd, count })),
      topDirectories: Array.from(directories.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([dir, count]) => ({ directory: dir, count }))
    };
  }
}

export default FishHistoryProvider;