import FzfSearcher from './fzf.js';
import JSFuzzySearcher from './js-fuzzy.js';

/**
 * Factory for creating the best available fuzzy searcher
 */
export class FuzzySearcherFactory {
  constructor(config = {}) {
    this.config = config;
    this.searcher = null;
    this.fzfPath = null;
  }

  /**
   * Set the path to fzf binary
   */
  setFzfPath(path) {
    this.fzfPath = path;
    // Reset searcher to force re-initialization with new path
    this.searcher = null;
  }

  /**
   * Get or create the best available searcher
   */
  async getSearcher() {
    if (this.searcher) return this.searcher;

    // Check if user has a preference
    const preference = this.config.completion?.fuzzy_backend;
    
    if (preference === 'fzf' || preference === undefined) {
      // Try fzf first (if preferred or no preference)
      const fzf = new FzfSearcher(this.config);
      // Set the fzf path if we have it
      if (this.fzfPath) {
        fzf.setFzfPath(this.fzfPath);
      }
      if (await fzf.isAvailable()) {
        this.searcher = fzf;
        return this.searcher;
      }
    }

    // Fallback to JavaScript implementation
    this.searcher = new JSFuzzySearcher(this.config);
    return this.searcher;
  }

  /**
   * Search with automatic searcher selection
   */
  async search(items, query, options = {}) {
    const searcher = await this.getSearcher();
    return searcher.search(items, query, options);
  }

  /**
   * Interactive search with automatic searcher selection
   */
  async interactiveSearch(items, options = {}) {
    const searcher = await this.getSearcher();
    
    if (searcher.supportsInteractive()) {
      return searcher.interactiveSearch(items, options);
    }
    
    // Fallback to non-interactive search with the first item
    // In a real implementation, this could use readline to build
    // an interactive selector
    const results = await searcher.search(items, '', { limit: 1 });
    return results.length > 0 ? results[0].item : null;
  }

  /**
   * Get information about available searchers
   */
  async getAvailableSearchers() {
    const info = {
      fzf: false,
      javascript: true // Always available
    };

    const fzf = new FzfSearcher(this.config);
    info.fzf = await fzf.isAvailable();

    return info;
  }
}

export default FuzzySearcherFactory;