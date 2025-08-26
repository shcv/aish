import { FuzzySearcher } from '../completion/interfaces.js';

/**
 * Pure JavaScript fuzzy searcher
 * Fallback when fzf is not available
 */
export class JSFuzzySearcher extends FuzzySearcher {
  constructor(config = {}) {
    super(config);
  }

  /**
   * Calculate fuzzy match score between query and target
   */
  calculateScore(query, target, options = {}) {
    const { caseInsensitive = true } = options;
    
    const q = caseInsensitive ? query.toLowerCase() : query;
    const t = caseInsensitive ? target.toLowerCase() : target;
    
    if (q === t) return { score: 1.0, matches: [[0, target.length]] };
    if (t.startsWith(q)) return { score: 0.9, matches: [[0, q.length]] };
    if (t.includes(q)) {
      const index = t.indexOf(q);
      return { score: 0.8, matches: [[index, index + q.length]] };
    }

    // Fuzzy matching algorithm
    let score = 0;
    const matches = [];
    let queryIndex = 0;
    let targetIndex = 0;
    let matchStart = -1;
    let consecutiveMatches = 0;

    while (queryIndex < q.length && targetIndex < t.length) {
      if (q[queryIndex] === t[targetIndex]) {
        if (matchStart === -1) {
          matchStart = targetIndex;
        }
        
        queryIndex++;
        consecutiveMatches++;
        
        // Bonus for consecutive matches
        score += 1 + (consecutiveMatches * 0.5);
        
        // Bonus for matching at word boundaries
        if (targetIndex === 0 || t[targetIndex - 1] === ' ' || t[targetIndex - 1] === '_' || t[targetIndex - 1] === '-') {
          score += 2;
        }
      } else {
        if (matchStart !== -1) {
          matches.push([matchStart, targetIndex]);
          matchStart = -1;
        }
        consecutiveMatches = 0;
      }
      
      targetIndex++;
    }

    if (matchStart !== -1) {
      matches.push([matchStart, targetIndex]);
    }

    // Check if all query characters were matched
    if (queryIndex < q.length) {
      return { score: 0, matches: [] };
    }

    // Normalize score
    const maxScore = q.length * 3; // Approximate maximum possible score
    const normalizedScore = Math.min(score / maxScore, 1.0);

    // Penalty for long targets (prefer shorter matches)
    const lengthPenalty = 1 - (t.length - q.length) / t.length * 0.2;
    
    return {
      score: normalizedScore * lengthPenalty,
      matches
    };
  }

  /**
   * Search items with fuzzy matching
   */
  async search(items, query, options = {}) {
    const {
      key = null,
      limit = 10,
      threshold = 0.0,
      caseInsensitive = true
    } = options;

    if (!query) {
      // Return first items if no query
      return items.slice(0, limit).map(item => ({
        item,
        score: 1.0,
        matches: [],
        metadata: {}
      }));
    }

    const results = [];

    for (const item of items) {
      const target = key && typeof item === 'object' ? item[key] : item.toString();
      const { score, matches } = this.calculateScore(query, target, { caseInsensitive });

      if (score >= threshold) {
        results.push({
          item,
          score,
          matches,
          metadata: {}
        });
      }
    }

    // Sort by score (highest first)
    results.sort((a, b) => b.score - a.score);

    return results.slice(0, limit);
  }

  /**
   * Highlight matches in text
   */
  highlightMatches(text, matches, highlightStart = '\x1b[1m', highlightEnd = '\x1b[0m') {
    if (matches.length === 0) return text;

    let result = '';
    let lastEnd = 0;

    for (const [start, end] of matches) {
      result += text.slice(lastEnd, start);
      result += highlightStart + text.slice(start, end) + highlightEnd;
      lastEnd = end;
    }

    result += text.slice(lastEnd);
    return result;
  }

  supportsInteractive() {
    return false; // Could be implemented with readline
  }
}

/**
 * Levenshtein distance for more sophisticated fuzzy matching
 */
export function levenshteinDistance(str1, str2) {
  const len1 = str1.length;
  const len2 = str2.length;
  const dp = Array(len1 + 1).fill(null).map(() => Array(len2 + 1).fill(0));

  for (let i = 0; i <= len1; i++) {
    dp[i][0] = i;
  }

  for (let j = 0; j <= len2; j++) {
    dp[0][j] = j;
  }

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(
          dp[i - 1][j],     // deletion
          dp[i][j - 1],     // insertion
          dp[i - 1][j - 1]  // substitution
        );
      }
    }
  }

  return dp[len1][len2];
}

/**
 * Alternative fuzzy matching using Levenshtein distance
 */
export class LevenshteinFuzzySearcher extends JSFuzzySearcher {
  calculateScore(query, target, options = {}) {
    const { caseInsensitive = true, maxDistance = 3 } = options;
    
    const q = caseInsensitive ? query.toLowerCase() : query;
    const t = caseInsensitive ? target.toLowerCase() : target;
    
    const distance = levenshteinDistance(q, t);
    
    if (distance > maxDistance) {
      return { score: 0, matches: [] };
    }
    
    // Convert distance to score (0-1)
    const score = 1 - (distance / Math.max(q.length, t.length));
    
    // For Levenshtein, we don't have specific match positions
    // Could be enhanced with a diff algorithm
    return { score, matches: [] };
  }
}

export default JSFuzzySearcher;