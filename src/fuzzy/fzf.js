import { spawn } from 'child_process';
import { FuzzySearcher } from '../completion/interfaces.js';

/**
 * FZF-based fuzzy searcher using native fzf binary
 */
export class FzfSearcher extends FuzzySearcher {
  constructor(config = {}) {
    super(config);
    this.fzfPath = config.fzf_path || 'fzf';
    this.available = null;
  }

  /**
   * Set the path to fzf binary
   */
  setFzfPath(path) {
    this.fzfPath = path;
    // Reset availability check
    this.available = null;
  }

  /**
   * Check if fzf is available on the system
   */
  async isAvailable() {
    if (this.available !== null) return this.available;

    return new Promise((resolve) => {
      const proc = spawn(this.fzfPath, ['--version'], {
        stdio: ['ignore', 'ignore', 'ignore']
      });

      proc.on('error', (err) => {
        // fzf not found or not executable
        this.available = false;
        resolve(false);
      });

      proc.on('exit', (code) => {
        // fzf exits with 0 when --version is used
        this.available = code === 0;
        resolve(this.available);
      });

      // Set a timeout in case spawn hangs
      setTimeout(() => {
        if (this.available === null) {
          proc.kill();
          this.available = false;
          resolve(false);
        }
      }, 1000);
    });
  }

  /**
   * Search items using fzf
   */
  async search(items, query, options = {}) {
    const available = await this.isAvailable();
    if (!available) {
      throw new Error('fzf is not available');
    }

    const {
      limit = 10,
      exact = false,
      caseInsensitive = true
    } = options;

    return new Promise((resolve, reject) => {
      const args = [
        '--filter', query,
        '--no-sort',
        '--tiebreak=index'
      ];

      if (exact) args.push('--exact');
      if (caseInsensitive) args.push('-i');

      const proc = spawn(this.fzfPath, args, {
        stdio: ['pipe', 'pipe', 'ignore']
      });

      const results = [];
      let output = '';

      // Send items to fzf
      const input = items.map(item => 
        typeof item === 'string' ? item : JSON.stringify(item)
      ).join('\n');
      
      proc.stdin.write(input);
      proc.stdin.end();

      proc.stdout.on('data', (data) => {
        output += data.toString();
      });

      proc.on('error', (error) => {
        reject(error);
      });

      proc.on('exit', (code) => {
        if (code !== 0 && code !== 1) {
          reject(new Error(`fzf exited with code ${code}`));
          return;
        }

        const lines = output.trim().split('\n').filter(Boolean);
        
        for (let i = 0; i < Math.min(lines.length, limit); i++) {
          const line = lines[i];
          let item = line;
          
          // Try to parse back to object if it was JSON
          if (line.startsWith('{')) {
            try {
              item = JSON.parse(line);
            } catch {}
          }

          results.push({
            item,
            score: 1.0 - (i / lines.length), // Higher score for earlier matches
            matches: [], // fzf doesn't provide match positions
            metadata: {}
          });
        }

        resolve(results);
      });
    });
  }

  supportsInteractive() {
    return true;
  }

  /**
   * Launch interactive fzf selector
   */
  async interactiveSearch(items, options = {}) {
    const available = await this.isAvailable();
    if (!available) {
      throw new Error('fzf is not available');
    }

    const {
      prompt = '> ',
      preview = null,
      multiSelect = false,
      height = '40%'
    } = options;

    return new Promise((resolve, reject) => {
      const args = [
        '--prompt', prompt,
        '--height', height,
        '--layout=reverse',
        '--info=inline',
        '--ansi'  // Enable ANSI color codes
      ];

      if (multiSelect) args.push('--multi');
      if (preview) args.push('--preview', preview);

      const proc = spawn(this.fzfPath, args, {
        stdio: ['pipe', 'pipe', 'inherit']
      });

      // Send items to fzf
      const input = items.map(item => 
        typeof item === 'string' ? item : JSON.stringify(item)
      ).join('\n');
      
      proc.stdin.write(input);
      proc.stdin.end();

      let output = '';

      proc.stdout.on('data', (data) => {
        output += data.toString();
      });

      proc.on('error', (error) => {
        reject(error);
      });

      proc.on('exit', (code) => {
        if (code === 130) {
          // User cancelled (Ctrl+C or ESC)
          resolve(null);
          return;
        }

        if (code !== 0) {
          reject(new Error(`fzf exited with code ${code}`));
          return;
        }

        const selected = output.trim();
        if (!selected) {
          resolve(null);
          return;
        }

        if (multiSelect) {
          const lines = selected.split('\n').filter(Boolean);
          const results = lines.map(line => {
            if (line.startsWith('{')) {
              try {
                return JSON.parse(line);
              } catch {}
            }
            return line;
          });
          resolve(results);
        } else {
          let result = selected;
          if (selected.startsWith('{')) {
            try {
              result = JSON.parse(selected);
            } catch {}
          }
          resolve(result);
        }
      });
    });
  }
}

export default FzfSearcher;