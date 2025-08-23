import BaseCompletionBackend from './base.js';

/**
 * Bash-specific completion backend
 */
export class BashCompletionBackend extends BaseCompletionBackend {
  constructor(config = {}) {
    super(config);
    this.compgenAvailable = null;
  }

  async initialize() {
    if (this.initialized) return;
    
    // Check if compgen is available
    try {
      this.executeShellCommand('compgen -A command ls', { timeout: 500 });
      this.compgenAvailable = true;
    } catch {
      this.compgenAvailable = false;
    }
    
    this.initialized = true;
  }

  async getCompletionsForWord(word, context) {
    await this.initialize();
    
    // Use parent implementation but add bash-specific enhancements
    let completions = await super.getCompletionsForWord(word, context);
    
    // Add bash-specific completions using compgen if available
    if (this.compgenAvailable && context.isCommand) {
      const compgenCompletions = await this.getCompgenCompletions('command', word);
      // Merge, avoiding duplicates
      const existing = new Set(completions.map(c => c.text));
      for (const comp of compgenCompletions) {
        if (!existing.has(comp.text)) {
          completions.push(comp);
        }
      }
    }
    
    return completions;
  }

  async getCompletions(partial, context) {
    // For backwards compatibility
    return this.getCompletionsForWord(partial, context);
  }

  /**
   * Use bash's compgen to get completions
   */
  async getCompgenCompletions(type, partial) {
    if (!this.compgenAvailable) return [];
    
    try {
      const output = this.executeShellCommand(
        `compgen -A ${type} -- "${partial}"`,
        { timeout: 500 }
      );
      
      if (!output) return [];
      
      return output.split('\n').filter(Boolean).map(text => ({
        text,
        display: text,
        description: type,
        type: this.mapCompgenType(type),
        priority: 5,
        metadata: {}
      }));
    } catch {
      return [];
    }
  }

  /**
   * Map compgen type to our completion type
   */
  mapCompgenType(compgenType) {
    const mapping = {
      'command': 'command',
      'alias': 'command',
      'builtin': 'command',
      'function': 'command',
      'file': 'file',
      'directory': 'directory',
      'variable': 'variable',
      'export': 'variable',
      'hostname': 'hostname',
      'user': 'user',
      'group': 'group'
    };
    return mapping[compgenType] || 'other';
  }

  /**
   * Get command-specific completions
   */
  async getCommandSpecificCompletions(command, partial, parsed) {
    const completions = [];
    
    // Special handling for common commands
    switch (command) {
      case 'cd':
      case 'pushd':
        // Only directories for cd
        return this.getCompgenCompletions('directory', partial);
        
      case 'git':
        return this.getGitCompletions(partial, parsed);
        
      case 'npm':
        return this.getNpmCompletions(partial, parsed);
        
      case 'docker':
        return this.getDockerCompletions(partial, parsed);
        
      case 'kill':
        return this.getProcessCompletions(partial);
        
      case 'ssh':
      case 'scp':
      case 'rsync':
        return this.getHostnameCompletions(partial);
    }
    
    // Try to get completions using bash completion if available
    if (this.compgenAvailable) {
      const bashCompletions = await this.getBashCompletions(command, partial, parsed);
      completions.push(...bashCompletions);
    }
    
    return completions;
  }

  /**
   * Get completions using bash-completion if available
   */
  async getBashCompletions(command, partial, parsed) {
    // This is complex as it requires sourcing bash-completion
    // For now, return empty array
    // In a full implementation, this would:
    // 1. Source /etc/bash_completion or /usr/share/bash-completion/bash_completion
    // 2. Call the appropriate completion function
    // 3. Parse the COMPREPLY array
    return [];
  }

  /**
   * Get git-specific completions
   */
  async getGitCompletions(partial, parsed) {
    const { previousWords } = parsed;
    const lastWord = previousWords[previousWords.length - 1];
    
    // Git subcommands
    if (previousWords.length === 1) {
      const subcommands = [
        'add', 'commit', 'push', 'pull', 'clone', 'checkout',
        'branch', 'merge', 'rebase', 'status', 'diff', 'log',
        'stash', 'fetch', 'remote', 'tag', 'reset', 'revert'
      ];
      
      return subcommands
        .filter(cmd => cmd.startsWith(partial))
        .map(cmd => ({
          text: cmd,
          display: cmd,
          description: 'git subcommand',
          type: 'argument',
          priority: 8,
          metadata: {}
        }));
    }
    
    // Git branches for checkout, merge, rebase
    if (['checkout', 'merge', 'rebase', 'branch'].includes(lastWord)) {
      try {
        const output = this.executeShellCommand('git branch --format="%(refname:short)"');
        const branches = output.split('\n').filter(Boolean);
        
        return branches
          .filter(branch => branch.startsWith(partial))
          .map(branch => ({
            text: branch,
            display: branch,
            description: 'git branch',
            type: 'argument',
            priority: 8,
            metadata: {}
          }));
      } catch {}
    }
    
    return [];
  }

  /**
   * Get npm-specific completions
   */
  async getNpmCompletions(partial, parsed) {
    const { previousWords } = parsed;
    
    if (previousWords.length === 1) {
      const scripts = await this.getNpmScripts();
      const commands = [
        'install', 'uninstall', 'run', 'test', 'start',
        'init', 'publish', 'update', 'audit', 'ci'
      ];
      
      const allCompletions = [
        ...commands.map(cmd => ({
          text: cmd,
          display: cmd,
          description: 'npm command',
          type: 'argument',
          priority: 8,
          metadata: {}
        })),
        ...scripts
      ];
      
      return allCompletions.filter(c => c.text.startsWith(partial));
    }
    
    if (previousWords[previousWords.length - 1] === 'run') {
      return this.getNpmScripts().then(scripts => 
        scripts.filter(s => s.text.startsWith(partial))
      );
    }
    
    return [];
  }

  /**
   * Get npm scripts from package.json
   */
  async getNpmScripts() {
    try {
      const output = this.executeShellCommand('npm run --json', { timeout: 1000 });
      const scripts = JSON.parse(output);
      
      return Object.keys(scripts).map(name => ({
        text: name,
        display: name,
        description: scripts[name].substring(0, 50),
        type: 'argument',
        priority: 9,
        metadata: { script: scripts[name] }
      }));
    } catch {
      return [];
    }
  }

  /**
   * Get Docker-specific completions
   */
  async getDockerCompletions(partial, parsed) {
    const { previousWords } = parsed;
    
    if (previousWords.length === 1) {
      const commands = [
        'run', 'exec', 'ps', 'build', 'pull', 'push',
        'images', 'container', 'volume', 'network',
        'stop', 'start', 'restart', 'rm', 'rmi'
      ];
      
      return commands
        .filter(cmd => cmd.startsWith(partial))
        .map(cmd => ({
          text: cmd,
          display: cmd,
          description: 'docker command',
          type: 'argument',
          priority: 8,
          metadata: {}
        }));
    }
    
    // Docker container names for exec, stop, start, etc.
    const lastWord = previousWords[previousWords.length - 1];
    if (['exec', 'stop', 'start', 'restart', 'rm'].includes(lastWord)) {
      try {
        const output = this.executeShellCommand('docker ps --format "{{.Names}}"');
        const containers = output.split('\n').filter(Boolean);
        
        return containers
          .filter(name => name.startsWith(partial))
          .map(name => ({
            text: name,
            display: name,
            description: 'docker container',
            type: 'argument',
            priority: 8,
            metadata: {}
          }));
      } catch {}
    }
    
    return [];
  }

  /**
   * Get process completions for kill command
   */
  async getProcessCompletions(partial) {
    try {
      const output = this.executeShellCommand('ps -eo pid,comm --no-headers');
      const lines = output.split('\n').filter(Boolean);
      const completions = [];
      
      for (const line of lines) {
        const match = line.match(/^\s*(\d+)\s+(.+)$/);
        if (match) {
          const [, pid, command] = match;
          if (pid.startsWith(partial)) {
            completions.push({
              text: pid,
              display: pid,
              description: command,
              type: 'argument',
              priority: 7,
              metadata: { command }
            });
          }
        }
      }
      
      return completions;
    } catch {
      return [];
    }
  }

  /**
   * Get hostname completions
   */
  async getHostnameCompletions(partial) {
    const completions = [];
    
    // Try to get hostnames from various sources
    
    // 1. SSH known hosts
    try {
      const output = this.executeShellCommand(
        'cut -d " " -f1 ~/.ssh/known_hosts 2>/dev/null | cut -d "," -f1 | sort -u'
      );
      const hosts = output.split('\n').filter(Boolean);
      
      for (const host of hosts) {
        if (host.startsWith(partial) && !host.startsWith('[')) {
          completions.push({
            text: host,
            display: host,
            description: 'known host',
            type: 'hostname',
            priority: 8,
            metadata: {}
          });
        }
      }
    } catch {}
    
    // 2. SSH config hosts
    try {
      const output = this.executeShellCommand(
        'grep "^Host " ~/.ssh/config 2>/dev/null | cut -d " " -f2'
      );
      const hosts = output.split('\n').filter(Boolean);
      
      for (const host of hosts) {
        if (host.startsWith(partial) && host !== '*') {
          completions.push({
            text: host,
            display: host,
            description: 'ssh config',
            type: 'hostname',
            priority: 9,
            metadata: {}
          });
        }
      }
    } catch {}
    
    return completions;
  }

  /**
   * Get option completions for a command
   */
  async getOptionCompletions(command, partial) {
    if (!command) return [];
    
    // Try to get help text and parse options
    try {
      const output = this.executeShellCommand(
        `${command} --help 2>&1 | grep -E "^\\s*-" | head -20`,
        { timeout: 500 }
      );
      
      const lines = output.split('\n').filter(Boolean);
      const completions = [];
      const seen = new Set();
      
      for (const line of lines) {
        // Match patterns like: -h, --help    Show help
        const match = line.match(/^\s*(-\w|--[\w-]+)/);
        if (match) {
          const option = match[1];
          if (option.startsWith(partial) && !seen.has(option)) {
            seen.add(option);
            completions.push({
              text: option,
              display: option,
              description: line.trim().substring(option.length).trim(),
              type: 'option',
              priority: 6,
              metadata: {}
            });
          }
        }
      }
      
      return completions;
    } catch {
      return [];
    }
  }

  getShellBuiltins() {
    // Bash-specific builtins
    return [
      ...super.getShellBuiltins(),
      'bind', 'builtin', 'caller', 'command', 'compgen', 'complete',
      'compopt', 'dirs', 'disown', 'enable', 'help', 'history',
      'logout', 'mapfile', 'popd', 'pushd', 'readarray', 'shopt',
      'suspend', 'times', 'type', 'ulimit', 'umask'
    ];
  }
}

export default BashCompletionBackend;