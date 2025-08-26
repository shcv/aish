import { spawn, spawnSync } from 'child_process';
import { FuzzySearcher } from '../completion/interfaces.js';

/**
 * Native FZF integration that pipes directly to fzf
 * Similar to how zsh plugins work
 */
export class FzfNativeSearcher extends FuzzySearcher {
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

    try {
      const result = spawnSync(this.fzfPath, ['--version'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      });
      this.available = result.status === 0;
    } catch {
      this.available = false;
    }
    
    return this.available;
  }

  /**
   * Run fzf with the given items and options
   * This directly spawns fzf and returns the selected item(s)
   */
  async runFzf(items, options = {}) {
    const {
      prompt = '> ',
      multi = false,
      preview = null,
      height = '40%',
      layout = 'reverse',
      query = '',
      exact = false,
      caseInsensitive = true,
      tiebreak = 'index',
      noSort = false,
      bind = [],
      header = null,
      delimiter = null,
      withNth = null,
      nth = null,
      ansi = true
    } = options;

    const args = [
      '--height', height,
      '--layout', layout,
      '--prompt', prompt,
      '--tiebreak', tiebreak
    ];

    if (multi) args.push('--multi');
    if (ansi) args.push('--ansi');
    if (exact) args.push('--exact');
    if (caseInsensitive) args.push('-i');
    if (noSort) args.push('--no-sort');
    if (query) args.push('--query', query);
    if (preview) args.push('--preview', preview);
    if (header) args.push('--header', header);
    if (delimiter) args.push('--delimiter', delimiter);
    if (withNth) args.push('--with-nth', withNth);
    if (nth) args.push('--nth', nth);
    
    // Add custom key bindings
    for (const b of bind) {
      args.push('--bind', b);
    }

    return new Promise((resolve, _reject) => {
      // fzf needs access to /dev/tty for interactive mode
      // stdin: pipe (for sending the list)
      // stdout: pipe (for getting the selection)  
      // stderr: inherit (for the interactive UI)
      const fzf = spawn(this.fzfPath, args, {
        stdio: ['pipe', 'pipe', 'inherit']
      });

      let output = '';
      const _error = '';

      // Write items to stdin
      const input = Array.isArray(items) ? items.join('\n') : items;
      fzf.stdin.write(input);
      fzf.stdin.end();

      fzf.stdout.on('data', (data) => {
        output += data.toString();
      });

      fzf.on('error', (err) => {
        _reject(err);
      });

      fzf.on('exit', (code) => {
        if (code === 0) {
          // User made a selection
          const selected = output.trim();
          if (multi) {
            resolve(selected ? selected.split('\n') : []);
          } else {
            resolve(selected || null);
          }
        } else if (code === 1) {
          // No match found
          resolve(multi ? [] : null);
        } else if (code === 2) {
          // Error
          reject(new Error(`fzf exited with code ${code}`));
        } else if (code === 130) {
          // User cancelled (Ctrl+C)
          resolve(multi ? [] : null);
        } else {
          resolve(multi ? [] : null);
        }
      });
    });
  }

  /**
   * Search for history like Ctrl+R in zsh with fzf
   */
  async searchHistory(historyItems, options = {}) {
    const available = await this.isAvailable();
    if (!available) {
      throw new Error('fzf is not available');
    }

    // Format history items similar to zsh's fzf history widget
    // Include line numbers for selection
    const formattedItems = historyItems.map((item, index) => {
      const num = (historyItems.length - index).toString().padStart(5);
      const _timestamp = item.timestamp 
        ? new Date(item.timestamp).toLocaleString() 
        : '';
      // Format: "number  command"
      return `${num}  ${item.command}`;
    });

    const selected = await this.runFzf(formattedItems, {
      prompt: 'History> ',
      height: '50%',
      layout: 'reverse',
      noSort: true,
      tiebreak: 'index',
      bind: [
        'ctrl-r:toggle-sort',
        'ctrl-a:beginning-of-line',
        'ctrl-e:end-of-line',
        'ctrl-u:unix-line-discard',
        'ctrl-k:kill-line',
        'ctrl-w:backward-kill-word',
        'alt-b:backward-word',
        'alt-f:forward-word',
        'ctrl-d:delete-char',
        'ctrl-h:backward-delete-char'
      ],
      header: 'CTRL-R: toggle sort | CTRL-A/E: start/end | Enter: select',
      // Search in command part only (after line number)
      nth: '2..',
      query: options.query || '',
      ansi: true
    });

    if (selected) {
      // Extract the command part (remove line number)
      const parts = selected.split(/\s+/);
      parts.shift(); // Remove line number
      return parts.join(' ');
    }

    return null;
  }

  /**
   * Search for completions with fzf
   */
  async searchCompletions(completions, options = {}) {
    const available = await this.isAvailable();
    if (!available) {
      throw new Error('fzf is not available');
    }

    // Format completions with descriptions
    const maxTextLength = Math.max(...completions.map(c => c.text.length));
    const formattedItems = completions.map(comp => {
      const text = comp.text.padEnd(maxTextLength + 2);
      const type = comp.type ? `[${comp.type}]` : '';
      const desc = comp.description || '';
      return `${text} ${type} ${desc}`.trim();
    });

    const selected = await this.runFzf(formattedItems, {
      prompt: 'Complete> ',
      height: '40%',
      layout: 'reverse',
      multi: options.multi || false,
      query: options.query || '',
      header: 'TAB: select | Enter: confirm',
      // Search in text part only
      nth: '1',
      delimiter: ' ',
      ansi: true
    });

    if (selected) {
      if (options.multi) {
        return selected.map(line => line.split(/\s+/)[0]);
      } else {
        // Extract just the completion text
        return selected.split(/\s+/)[0];
      }
    }

    return options.multi ? [] : null;
  }

  /**
   * Directory navigation with fzf
   */
  async searchDirectories(basePath = '.', options = {}) {
    const available = await this.isAvailable();
    if (!available) {
      throw new Error('fzf is not available');
    }

    // Use find command to get directories
    const findCmd = `find ${basePath} -type d -not -path '*/\\.*' 2>/dev/null | head -1000`;
    
    return new Promise((resolve, _reject) => {
      const find = spawn('sh', ['-c', findCmd], {
        stdio: ['ignore', 'pipe', 'ignore']
      });

      let dirs = '';
      find.stdout.on('data', (data) => {
        dirs += data.toString();
      });

      find.on('exit', async() => {
        const selected = await this.runFzf(dirs, {
          prompt: 'Directory> ',
          height: '40%',
          preview: 'ls -la {}',
          header: 'Select directory',
          ...options
        });
        resolve(selected);
      });
    });
  }

  /**
   * Generic file search with fzf
   */
  async searchFiles(pattern = '', options = {}) {
    const available = await this.isAvailable();
    if (!available) {
      throw new Error('fzf is not available');
    }

    // Use fd if available, otherwise find
    const searchCmd = pattern 
      ? `(fd ${pattern} 2>/dev/null || find . -name "*${pattern}*" 2>/dev/null) | head -1000`
      : '(fd . 2>/dev/null || find . -type f 2>/dev/null) | head -1000';
    
    return new Promise((resolve, _reject) => {
      const search = spawn('sh', ['-c', searchCmd], {
        stdio: ['ignore', 'pipe', 'ignore']
      });

      let files = '';
      search.stdout.on('data', (data) => {
        files += data.toString();
      });

      search.on('exit', async() => {
        const selected = await this.runFzf(files, {
          prompt: 'File> ',
          height: '40%',
          preview: 'head -50 {}',
          header: 'Select file',
          multi: options.multi || false,
          ...options
        });
        resolve(selected);
      });
    });
  }

  // Implement base class methods for compatibility
  async search(items, query, options = {}) {
    const available = await this.isAvailable();
    if (!available) {
      throw new Error('fzf is not available');
    }

    const selected = await this.runFzf(items, {
      query,
      multi: true,
      noSort: true,
      ...options
    });

    if (!selected) return [];

    const results = (Array.isArray(selected) ? selected : [selected]).map((item, index) => ({
      item,
      score: 1.0 - (index * 0.1),
      matches: [],
      metadata: {}
    }));

    return results.slice(0, options.limit || 10);
  }

  supportsInteractive() {
    return true;
  }

  async interactiveSearch(items, options = {}) {
    return this.runFzf(items, options);
  }
}

export default FzfNativeSearcher;