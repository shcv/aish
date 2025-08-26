import BashCompletionBackend from './backends/bash.js';
import ZshCompletionBackend from './backends/zsh.js';
import BaseCompletionBackend from './backends/base.js';
import FuzzySearcherFactory from '../fuzzy/factory.js';
import HistoryManager from '../history/manager.js';

/**
 * Manages completion from multiple sources
 */
export class CompletionManager {
  constructor(config = {}) {
    this.config = config;
    this.backend = null;
    this.fuzzySearcher = new FuzzySearcherFactory(config);
    this.historyManager = new HistoryManager(config);
    this.cache = new Map();
    this.cacheTimeout = config.completion?.cache_ttl || 300000; // 5 minutes
    this.initialized = false;
    this.fzfPath = null;
  }

  /**
   * Set the path to fzf for enhanced completion
   */
  setFzfPath(path) {
    this.fzfPath = path;
    if (this.fuzzySearcher) {
      this.fuzzySearcher.setFzfPath(path);
    }
  }

  async initialize() {
    if (this.initialized) return;

    // Initialize history manager
    await this.historyManager.initialize();

    // Detect and initialize appropriate backend based on config
    const backendType = this.config.completion?.backend;

    if (backendType && backendType !== 'auto') {
      // Use explicitly configured backend
      switch (backendType) {
      case 'bash':
        this.backend = new BashCompletionBackend(this.config);
        break;
      case 'zsh':
        this.backend = new ZshCompletionBackend(this.config);
        break;
      case 'base':
      case 'generic':
        this.backend = new BaseCompletionBackend(this.config);
        break;
      default:
        console.warn(`Unknown completion backend: ${backendType}, falling back to auto-detection`);
        this.backend = await this.autoDetectBackend();
      }
    } else {
      // Auto-detect based on configured shell
      this.backend = await this.autoDetectBackend();
    }

    await this.backend.initialize();
    this.initialized = true;
  }

  /**
   * Auto-detect the appropriate completion backend based on configured shell
   */
  async autoDetectBackend() {
    // Use configured shell, fallback to SHELL env var, then to /bin/sh
    const shellPath = this.config.shell?.default || process.env.SHELL || '/bin/sh';
    const shellName = shellPath.split('/').pop();

    // Check for shell type in the path (handles Guix-style paths)
    if (shellPath.includes('zsh') || shellName === 'zsh') {
      return new ZshCompletionBackend(this.config);
    } else if (shellPath.includes('bash') || shellName === 'bash') {
      return new BashCompletionBackend(this.config);
    } else if (shellPath.includes('fish') || shellName === 'fish') {
      // TODO: Implement FishCompletionBackend
      return new BaseCompletionBackend(this.config);
    } else {
      // Default to base backend for unknown shells
      return new BaseCompletionBackend(this.config);
    }
  }

  /**
   * Get completions for the given input
   */
  async getCompletions(input, context = {}) {
    await this.initialize();

    // Input is now just the current word being completed, not the whole line
    const currentWord = input;
    
    // Check cache first
    const cacheKey = `${currentWord}:${context.command || ''}:${context.position || 0}:${context.cwd || ''}`;
    const cached = this.getCached(cacheKey);
    if (cached) return cached;

    const completions = [];

    // 1. Get shell completions based on context
    if (this.config.completion?.enabled !== false) {
      // Pass the partial word and context to the backend
      const shellContext = {
        ...context,
        currentWord,
        isCommand: context.position === 0 || !context.command,
        isArgument: context.position > 0,
        isOption: currentWord.startsWith('-'),
        isPath: currentWord.includes('/') || currentWord.startsWith('~'),
        isVariable: currentWord.startsWith('$')
      };
      
      const shellCompletions = await this.backend.getCompletionsForWord(
        currentWord,
        shellContext
      );
      completions.push(...shellCompletions);
    }

    // 2. Get history completions - only for commands (position 0)
    if (this.config.completion?.history_suggestions !== false && context.position === 0) {
      const historyCompletions = await this.getHistoryCompletions(currentWord, context);
      completions.push(...historyCompletions);
    }

    // 3. Apply fuzzy search if enabled and we have input
    if (this.config.completion?.fuzzy_search && currentWord.trim()) {
      const fuzzyResults = await this.applyFuzzySearch(completions, currentWord);
      return this.cacheResult(cacheKey, fuzzyResults);
    }

    // 4. Sort by priority and alphabetically
    const sorted = this.sortCompletions(completions);
    return this.cacheResult(cacheKey, sorted);
  }

  /**
   * Get completions from command history
   */
  async getHistoryCompletions(input, _context) {
    const historyItems = await this.historyManager.search(input, { limit: 20 });
    
    return historyItems.map((item, index) => ({
      text: item.command,
      display: item.command,
      description: item.timestamp 
        ? `history - ${this.formatTimestamp(item.timestamp)}`
        : 'history',
      type: 'history',
      priority: 100 - index, // More recent = higher priority
      metadata: {
        timestamp: item.timestamp,
        exitCode: item.exitCode,
        source: item.metadata?.source
      }
    }));
  }

  /**
   * Apply fuzzy search to completions
   */
  async applyFuzzySearch(completions, query) {
    const searcher = await this.fuzzySearcher.getSearcher();
    
    // Extract text for searching
    const items = completions.map(c => ({
      original: c,
      searchText: c.text
    }));

    const results = await searcher.search(
      items,
      query,
      {
        key: 'searchText',
        limit: this.config.completion?.max_suggestions || 10,
        threshold: 0.3
      }
    );

    return results.map(result => ({
      ...result.item.original,
      score: result.score,
      matches: result.matches
    }));
  }

  /**
   * Sort completions by priority and alphabetically
   */
  sortCompletions(completions) {
    return completions.sort((a, b) => {
      // First sort by priority (higher first)
      if (a.priority !== b.priority) {
        return b.priority - a.priority;
      }
      // Then alphabetically
      return a.text.localeCompare(b.text);
    });
  }

  /**
   * Interactive completion selection
   */
  async selectCompletion(input, context = {}) {
    await this.initialize();

    const completions = await this.getCompletions(input, context);
    
    if (completions.length === 0) {
      return null;
    }

    if (completions.length === 1) {
      return completions[0].text;
    }

    // Try to use fzf for interactive selection
    const searcher = await this.fuzzySearcher.getSearcher();
    
    if (searcher.supportsInteractive()) {
      const items = completions.map(c => ({
        display: `${c.text.padEnd(30)} ${c.description}`,
        value: c.text
      }));

      const selected = await searcher.interactiveSearch(
        items.map(i => i.display),
        {
          prompt: 'Select completion: ',
          height: '40%'
        }
      );

      if (selected) {
        const item = items.find(i => i.display === selected);
        return item ? item.value : selected;
      }
    }

    // Fallback to returning the first completion
    return completions[0].text;
  }

  /**
   * Get completions for Ctrl+R history search
   */
  async historySearch(query = '') {
    await this.initialize();

    const searcher = await this.fuzzySearcher.getSearcher();
    const historyItems = await this.historyManager.search(query, { limit: 100 });

    if (searcher.supportsInteractive()) {
      const items = historyItems.map(item => {
        const time = item.timestamp 
          ? this.formatTimestamp(item.timestamp) 
          : '';
        return `${time.padEnd(20)} ${item.command}`;
      });

      const selected = await searcher.interactiveSearch(items, {
        prompt: 'History search: ',
        height: '50%'
      });

      if (selected) {
        // Extract command from the formatted string
        return selected.substring(20).trim();
      }
    }

    // Fallback to simple search
    return historyItems.length > 0 ? historyItems[0].command : null;
  }

  /**
   * Cache helpers
   */
  getCached(key) {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.value;
    }
    return null;
  }

  cacheResult(key, value) {
    this.cache.set(key, {
      value,
      timestamp: Date.now()
    });
    return value;
  }

  /**
   * Format timestamp for display
   */
  formatTimestamp(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;

    if (diff < 3600000) { // Less than 1 hour
      return `${Math.floor(diff / 60000)}m ago`;
    } else if (diff < 86400000) { // Less than 1 day
      return `${Math.floor(diff / 3600000)}h ago`;
    } else if (diff < 604800000) { // Less than 1 week
      return `${Math.floor(diff / 86400000)}d ago`;
    } else {
      return date.toLocaleDateString();
    }
  }

  /**
   * Clear cache
   */
  clearCache() {
    this.cache.clear();
  }
}

export default CompletionManager;
