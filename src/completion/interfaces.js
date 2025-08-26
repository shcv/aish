/**
 * Core interfaces for completion and history systems
 */

/**
 * Base class for completion providers
 */
export class CompletionProvider {
  constructor(config = {}) {
    this.config = config;
    this.cache = new Map();
    this.cacheTimeout = config.cache_ttl || 300000; // 5 minutes default
  }

  /**
   * Get completions for a partial command
   * @param {string} partial - The partial text to complete
   * @param {Object} context - Context information
   * @param {string} context.cwd - Current working directory
   * @param {Object} context.env - Environment variables
   * @param {Array<string>} context.history - Recent command history
   * @returns {Promise<Array<CompletionItem>>} Array of completion items
   */
  async getCompletions(_partial, _context) {
    throw new Error('getCompletions must be implemented by subclass');
  }

  /**
   * Initialize the provider (setup resources, connections, etc.)
   * @returns {Promise<void>}
   */
  async initialize() {
    // Override in subclass if needed
  }

  /**
   * Cleanup resources
   * @returns {Promise<void>}
   */
  async cleanup() {
    this.cache.clear();
  }

  /**
   * Get cached result or compute new one
   * @protected
   */
  async getCached(key, computeFn) {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.value;
    }

    const value = await computeFn();
    this.cache.set(key, { value, timestamp: Date.now() });
    return value;
  }
}

/**
 * Base class for history providers
 */
export class HistoryProvider {
  constructor(config = {}) {
    this.config = config;
    this.maxResults = config.max_results || 50;
  }

  /**
   * Search history with optional fuzzy matching
   * @param {string} query - Search query
   * @param {number} limit - Maximum results to return
   * @returns {Promise<Array<HistoryItem>>} Matching history items
   */
  async search(_query, _limit = this.maxResults) {
    throw new Error('search must be implemented by subclass');
  }

  /**
   * Add a command to history
   * @param {string} command - Command to add
   * @param {Object} metadata - Optional metadata
   * @returns {Promise<void>}
   */
  async add(_command, _metadata = {}) {
    throw new Error('add must be implemented by subclass');
  }

  /**
   * Get recent commands
   * @param {number} limit - Maximum results to return
   * @returns {Promise<Array<HistoryItem>>} Recent history items
   */
  async getRecent(_limit = 10) {
    throw new Error('getRecent must be implemented by subclass');
  }

  /**
   * Get all history items
   * @returns {Promise<Array<HistoryItem>>} All history items
   */
  async getAll() {
    throw new Error('getAll must be implemented by subclass');
  }

  /**
   * Clear all history
   * @returns {Promise<void>}
   */
  async clear() {
    throw new Error('clear must be implemented by subclass');
  }
}

/**
 * Base class for fuzzy search implementations
 */
export class FuzzySearcher {
  constructor(config = {}) {
    this.config = config;
  }

  /**
   * Search items with fuzzy matching
   * @param {Array<string|Object>} items - Items to search
   * @param {string} query - Search query
   * @param {Object} options - Search options
   * @param {string} options.key - Key to search if items are objects
   * @param {number} options.limit - Maximum results
   * @param {number} options.threshold - Match threshold (0-1)
   * @returns {Promise<Array<SearchResult>>} Ranked search results
   */
  async search(_items, _query, _options = {}) {
    throw new Error('search must be implemented by subclass');
  }

  /**
   * Check if interactive mode is supported
   * @returns {boolean}
   */
  supportsInteractive() {
    return false;
  }

  /**
   * Launch interactive fuzzy search
   * @param {Array<string|Object>} items - Items to search
   * @param {Object} options - Interactive options
   * @returns {Promise<string|Object|null>} Selected item or null if cancelled
   */
  async interactiveSearch(_items, _options = {}) {
    throw new Error('interactiveSearch not supported');
  }
}

/**
 * Completion item structure
 * @typedef {Object} CompletionItem
 * @property {string} text - The completion text
 * @property {string} display - Display text (if different from text)
 * @property {string} description - Description of the completion
 * @property {string} type - Type of completion (command|file|directory|option|argument)
 * @property {number} priority - Priority for sorting (higher = better)
 * @property {Object} metadata - Additional metadata
 */

/**
 * History item structure
 * @typedef {Object} HistoryItem
 * @property {string} command - The command text
 * @property {number} timestamp - Unix timestamp
 * @property {number} exitCode - Exit code if available
 * @property {string} cwd - Working directory when executed
 * @property {number} duration - Execution duration in ms
 * @property {Object} metadata - Additional metadata
 */

/**
 * Search result structure
 * @typedef {Object} SearchResult
 * @property {string|Object} item - The matched item
 * @property {number} score - Match score (0-1, higher = better)
 * @property {Array<[number, number]>} matches - Match positions [start, end]
 * @property {Object} metadata - Additional metadata
 */

export default {
  CompletionProvider,
  HistoryProvider,
  FuzzySearcher
};