import AishHistoryProvider from './providers/aish.js';
import BashHistoryProvider from './providers/bash.js';
import ZshHistoryProvider from './providers/zsh.js';
import FishHistoryProvider from './providers/fish.js';

/**
 * History manager that orchestrates different history providers
 */
export class HistoryManager {
  constructor(config = {}) {
    this.config = config;
    this.mode = config.history?.mode || 'aish'; // 'aish' | 'shell' | 'unified'
    if (process.env.AISH_DEBUG) {
      console.log(`[DEBUG] HistoryManager mode: ${this.mode}`);
    }
    this.providers = new Map();
    this.currentShell = null;
    this.initialized = false;
    this.fzfPath = null;
  }

  /**
   * Set the path to fzf for enhanced history search
   */
  setFzfPath(path) {
    this.fzfPath = path;
  }

  /**
   * Initialize the history manager
   */
  async initialize() {
    if (this.initialized) return;

    // Always initialize aish history
    this.providers.set('aish', new AishHistoryProvider(this.config));

    // Detect and initialize shell history if needed
    if (this.mode !== 'aish') {
      if (process.env.AISH_DEBUG) {
        console.log(`[DEBUG] Initializing shell history for mode: ${this.mode}`);
      }
      await this.detectAndInitializeShellHistory();
    }


    this.initialized = true;
  }

  /**
   * Detect the current shell and initialize appropriate provider
   */
  async detectAndInitializeShellHistory() {
    // Try to detect shell from environment
    const shellPath = this.config.shell?.default || process.env.SHELL || '/bin/bash';
    const shellName = shellPath.split('/').pop();

    let provider = null;
    
    if (shellName.includes('zsh')) {
      provider = new ZshHistoryProvider(this.config);
      this.currentShell = 'zsh';
    } else if (shellName.includes('fish')) {
      provider = new FishHistoryProvider(this.config);
      this.currentShell = 'fish';
    } else if (shellName.includes('bash') || shellName.includes('sh')) {
      provider = new BashHistoryProvider(this.config);
      this.currentShell = 'bash';
    }

    if (provider) {
      // Check if the shell history is actually available
      const isAvailable = await provider.isAvailable();
      if (process.env.AISH_DEBUG) {
        console.log(`[DEBUG] Shell: ${this.currentShell}, provider available: ${isAvailable}`);
      }
      if (isAvailable) {
        this.providers.set(this.currentShell, provider);
        if (process.env.AISH_DEBUG) {
          console.log(`[DEBUG] Added ${this.currentShell} provider to providers map`);
        }
      } else if (process.env.AISH_DEBUG) {
        console.warn(`[DEBUG] Shell history for ${this.currentShell} not available`);
      }
    } else if (process.env.AISH_DEBUG) {
      console.log(`[DEBUG] No provider created for shell: ${shellName}`);
    }
  }


  /**
   * Search history with optional fuzzy matching
   */
  async search(query, options = {}) {
    await this.initialize();

    // Use explicit limit if provided, otherwise use config, otherwise default to 50
    const limit = options.limit !== undefined ? options.limit : (this.config.history?.search?.max_results || 50);
    const deduplicate = options.deduplicate ?? this.config.history?.search?.deduplicate ?? true;

    let results = [];

    if (this.mode === 'unified') {
      // Merge results from all providers
      const promises = [];
      
      for (const [name, provider] of this.providers) {
        promises.push(provider.search(query, { limit, deduplicate }));
      }
      
      const allResults = await Promise.all(promises);
      if (process.env.AISH_DEBUG) {
        console.log(`[DEBUG] Search results from providers:`, allResults.map(r => r.length));
      }
      results = this.mergeResults(allResults, { deduplicate, limit });
      if (process.env.AISH_DEBUG) {
        console.log(`[DEBUG] After merge: ${results.length} results (limit: ${limit}, deduplicate: ${deduplicate})`);
      }
      
    } else if (this.mode === 'shell' && this.providers.has(this.currentShell)) {
      // Use shell history only
      results = await this.providers.get(this.currentShell).search(query, { limit, deduplicate });
      
    } else {
      // Default to aish history
      results = await this.providers.get('aish').search(query, { limit, deduplicate });
    }

    return results;
  }

  /**
   * Merge and deduplicate results from multiple providers
   */
  mergeResults(resultArrays, options = {}) {
    const { deduplicate = true, limit = 10000 } = options;
    const merged = [];
    const seen = new Set();

    // Flatten and sort by timestamp (most recent first)
    const allResults = resultArrays
      .flat()
      .sort((a, b) => {
        if (a.timestamp && b.timestamp) {
          return b.timestamp - a.timestamp;
        }
        return 0;
      });

    for (const item of allResults) {
      if (deduplicate) {
        if (seen.has(item.command)) continue;
        seen.add(item.command);
      }
      
      merged.push(item);
      
      if (merged.length >= limit) break;
    }

    return merged;
  }

  /**
   * Add a command to history
   */
  async add(command, metadata = {}) {
    await this.initialize();

    // Always add to aish history
    const aishProvider = this.providers.get('aish');
    if (aishProvider) {
      await aishProvider.add(command, metadata);
    }

    // Optionally sync to shell history if configured
    // Note: Most shells don't support external history additions,
    // so this is mainly for future extension
    if (this.config.history?.shell_integration?.sync_commands) {
      // Shell history is typically append-only and managed by the shell
      // We can't easily add to it from outside
    }
  }

  /**
   * Get recent commands
   */
  async getRecent(limit = 10) {
    await this.initialize();

    if (this.mode === 'unified') {
      const promises = [];
      for (const [name, provider] of this.providers) {
        promises.push(provider.getRecent(Math.ceil(limit / this.providers.size)));
      }
      const allResults = await Promise.all(promises);
      return this.mergeResults(allResults, { deduplicate: true, limit });
    }

    const provider = this.getActiveProvider();
    return provider.getRecent(limit);
  }

  /**
   * Get the active provider based on mode
   */
  getActiveProvider() {
    if (this.mode === 'shell' && this.providers.has(this.currentShell)) {
      return this.providers.get(this.currentShell);
    }
    return this.providers.get('aish');
  }

  /**
   * Get statistics about history
   */
  async getStats() {
    await this.initialize();

    const stats = {};
    
    for (const [name, provider] of this.providers) {
      stats[name] = await provider.getStats();
    }

    // Calculate combined stats if in unified mode
    if (this.mode === 'unified') {
      const combined = {
        total: 0,
        unique: 0,
        topCommands: new Map()
      };

      for (const providerStats of Object.values(stats)) {
        combined.total += providerStats.total;
        combined.unique += providerStats.unique;
        
        if (providerStats.topCommands) {
          for (const { command, count } of providerStats.topCommands) {
            combined.topCommands.set(command, 
              (combined.topCommands.get(command) || 0) + count);
          }
        }
      }

      stats.combined = {
        ...combined,
        topCommands: Array.from(combined.topCommands.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10)
          .map(([command, count]) => ({ command, count }))
      };
    }

    return stats;
  }

  /**
   * Clear history (only affects aish history)
   */
  async clear() {
    const aishProvider = this.providers.get('aish');
    if (aishProvider) {
      await aishProvider.clear();
    }
  }

  /**
   * Export history in various formats
   */
  async export(format = 'json') {
    await this.initialize();
    
    const provider = this.getActiveProvider();
    if (provider.exportTo) {
      return provider.exportTo(format);
    }
    
    // Fallback for providers without export
    const history = await provider.getAll();
    
    switch (format) {
      case 'json':
        return JSON.stringify(history, null, 2);
      case 'plain':
        return history.map(h => h.command).join('\n');
      default:
        throw new Error(`Unsupported export format: ${format}`);
    }
  }
}

export default HistoryManager;