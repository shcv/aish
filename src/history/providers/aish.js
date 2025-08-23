import fs from 'fs/promises';
import path from 'path';
import os from 'os';
import { HistoryProvider } from '../../completion/interfaces.js';

/**
 * Enhanced Aish history provider
 * Maintains its own history file with rich metadata
 */
export class AishHistoryProvider extends HistoryProvider {
  constructor(config = {}) {
    super(config);
    this.historyFile = this.expandPath(config.history?.file || path.join(os.homedir(), '.aish_history'));
    this.maxEntries = config.history?.max_entries || 10000;
    this.saveCorrections = config.history?.save_corrections !== false;
    this.history = [];
    this.loaded = false;
    this.saveDebounceTimer = null;
  }

  expandPath(filePath) {
    if (filePath.startsWith('~')) {
      return path.join(os.homedir(), filePath.slice(1));
    }
    return filePath;
  }

  parseHistoryFile(content) {
    const lines = content.split('\n').filter(line => line.trim());
    const entries = [];

    for (const line of lines) {
      try {
        // Try to parse as JSON (new format)
        if (line.startsWith('{')) {
          const entry = JSON.parse(line);
          entries.push({
            command: entry.command || entry.cmd || line,
            timestamp: entry.timestamp || entry.ts || null,
            exitCode: entry.exitCode || entry.exit || null,
            cwd: entry.cwd || entry.dir || null,
            duration: entry.duration || entry.dur || null,
            metadata: entry.metadata || {}
          });
        } else {
          // Plain text format (legacy)
          entries.push({
            command: line,
            timestamp: null,
            exitCode: null,
            cwd: null,
            duration: null,
            metadata: {}
          });
        }
      } catch (error) {
        // Fallback to plain text
        entries.push({
          command: line,
          timestamp: null,
          exitCode: null,
          cwd: null,
          duration: null,
          metadata: {}
        });
      }
    }

    return entries;
  }

  formatHistoryEntry(entry) {
    // Store as JSON for rich metadata
    return JSON.stringify({
      command: entry.command,
      timestamp: entry.timestamp || Date.now(),
      exitCode: entry.exitCode,
      cwd: entry.cwd || process.cwd(),
      duration: entry.duration,
      metadata: entry.metadata || {}
    });
  }

  async loadHistory() {
    if (this.loaded) return;

    try {
      const content = await fs.readFile(this.historyFile, 'utf8');
      this.history = this.parseHistoryFile(content);
      
      // Trim to max entries if needed
      if (this.history.length > this.maxEntries) {
        this.history = this.history.slice(-this.maxEntries);
      }
      
      this.loaded = true;
    } catch (error) {
      if (error.code !== 'ENOENT') {
        console.error('Error loading aish history:', error);
      }
      this.history = [];
      this.loaded = true;
    }
  }

  async saveHistory() {
    try {
      // Ensure directory exists
      const dir = path.dirname(this.historyFile);
      await fs.mkdir(dir, { recursive: true });

      // Trim to max entries
      if (this.history.length > this.maxEntries) {
        this.history = this.history.slice(-this.maxEntries);
      }

      // Format entries
      const lines = this.history.map(entry => this.formatHistoryEntry(entry));
      await fs.writeFile(this.historyFile, lines.join('\n'));
    } catch (error) {
      console.error('Error saving aish history:', error);
    }
  }

  async debouncedSave() {
    if (this.saveDebounceTimer) {
      clearTimeout(this.saveDebounceTimer);
    }
    
    this.saveDebounceTimer = setTimeout(async () => {
      await this.saveHistory();
      this.saveDebounceTimer = null;
    }, 1000);
  }

  async search(query, limit = this.maxResults) {
    await this.loadHistory();

    if (!query) {
      return this.history.slice(-limit).reverse();
    }

    const results = [];
    const lowerQuery = query.toLowerCase();
    const seen = new Set();

    // Search from most recent to oldest, deduplicating
    for (let i = this.history.length - 1; i >= 0 && results.length < limit; i--) {
      const item = this.history[i];
      const cmdLower = item.command.toLowerCase();
      
      // Skip duplicates
      if (seen.has(item.command)) continue;
      
      if (cmdLower.includes(lowerQuery)) {
        results.push(item);
        seen.add(item.command);
      }
    }

    return results;
  }

  async add(command, metadata = {}) {
    await this.loadHistory();

    // Skip if duplicate of last command
    if (this.history.length > 0 && 
        this.history[this.history.length - 1].command === command) {
      return;
    }

    // Skip if it's a correction and we don't save corrections
    if (!this.saveCorrections && metadata.isCorrection) {
      return;
    }

    const entry = {
      command,
      timestamp: Date.now(),
      exitCode: metadata.exitCode ?? null,
      cwd: metadata.cwd || process.cwd(),
      duration: metadata.duration ?? null,
      metadata: {
        ...metadata,
        source: 'aish'
      }
    };

    this.history.push(entry);
    await this.debouncedSave();
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
    this.history = [];
    this.loaded = true;
    await this.saveHistory();
  }

  /**
   * Import history from another provider
   */
  async importFrom(provider, options = {}) {
    const { deduplicate = true, maxImport = 1000 } = options;
    
    await this.loadHistory();
    const existingCommands = new Set(this.history.map(h => h.command));
    
    const importedHistory = await provider.getAll();
    let imported = 0;

    for (const item of importedHistory.slice(0, maxImport)) {
      if (!deduplicate || !existingCommands.has(item.command)) {
        this.history.push({
          ...item,
          metadata: {
            ...item.metadata,
            imported: true,
            importedFrom: item.metadata?.source || 'unknown',
            importedAt: Date.now()
          }
        });
        imported++;
      }
    }

    if (imported > 0) {
      await this.saveHistory();
    }

    return imported;
  }

  /**
   * Export history in a specific format
   */
  async exportTo(format = 'json') {
    await this.loadHistory();

    switch (format) {
      case 'json':
        return JSON.stringify(this.history, null, 2);
      
      case 'plain':
        return this.history.map(h => h.command).join('\n');
      
      case 'bash':
        // Export in bash history format
        return this.history.map(h => h.command).join('\n');
      
      case 'zsh':
        // Export in zsh extended history format
        return this.history.map(h => {
          if (h.timestamp) {
            const ts = Math.floor(h.timestamp / 1000);
            const duration = h.duration ? Math.floor(h.duration / 1000) : 0;
            return `: ${ts}:${duration};${h.command}`;
          }
          return h.command;
        }).join('\n');
      
      default:
        throw new Error(`Unsupported export format: ${format}`);
    }
  }

  /**
   * Get statistics about the history
   */
  async getStats() {
    await this.loadHistory();
    
    const commands = new Map();
    const directories = new Map();
    let totalDuration = 0;
    let commandsWithDuration = 0;
    let failedCommands = 0;

    for (const item of this.history) {
      const cmd = item.command.split(' ')[0];
      commands.set(cmd, (commands.get(cmd) || 0) + 1);
      
      if (item.cwd) {
        directories.set(item.cwd, (directories.get(item.cwd) || 0) + 1);
      }
      
      if (item.duration) {
        totalDuration += item.duration;
        commandsWithDuration++;
      }
      
      if (item.exitCode && item.exitCode !== 0) {
        failedCommands++;
      }
    }

    return {
      total: this.history.length,
      unique: new Set(this.history.map(h => h.command)).size,
      failedCommands,
      averageDuration: commandsWithDuration > 0 ? totalDuration / commandsWithDuration : null,
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

export default AishHistoryProvider;