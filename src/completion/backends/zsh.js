import BaseCompletionBackend from './base.js';
import { execSync } from 'child_process';

/**
 * Zsh-specific completion backend
 */
export class ZshCompletionBackend extends BaseCompletionBackend {
  constructor(config = {}) {
    super(config);
    this.zshPath = config.shell?.default || '/usr/bin/zsh';
  }

  async initialize() {
    if (this.initialized) return;
    this.initialized = true;
  }

  async getCompletionsForWord(word, context) {
    let completions = [];
    
    // Use parent implementation for basic completions
    completions = await super.getCompletionsForWord(word, context);
    
    // Add zsh-specific completions
    if (context.isCommand) {
      const cmdCompletions = await this.getCommandCompletions(word);
      // Merge, avoiding duplicates
      const existing = new Set(completions.map(c => c.text));
      for (const comp of cmdCompletions) {
        if (!existing.has(comp.text)) {
          completions.push(comp);
        }
      }
    }
    
    return completions;
  }

  /**
   * Get command completions using PATH search
   */
  async getCommandCompletions(partial) {
    const completions = [];
    const seen = new Set();
    
    // Get executables from PATH
    const pathDirs = (process.env.PATH || '').split(':').filter(Boolean);
    
    for (const dir of pathDirs) {
      try {
        // Use find for more reliable results (include symlinks with -L)
        const cmd = partial 
          ? `find -L "${dir}" -maxdepth 1 -type f -executable -name "${partial}*" 2>/dev/null | head -20`
          : `find -L "${dir}" -maxdepth 1 -type f -executable 2>/dev/null | head -20`;
        
        const output = execSync(cmd, {
          encoding: 'utf8',
          timeout: 200
        });
        
        const files = output.split('\n').filter(Boolean);
        for (const filePath of files) {
          const fileName = filePath.split('/').pop();
          if (!seen.has(fileName) && fileName.startsWith(partial)) {
            seen.add(fileName);
            completions.push({
              text: fileName,
              display: fileName,
              description: 'command',
              type: 'command',
              priority: 10,
              metadata: {}
            });
          }
        }
        
        // Stop after finding enough completions
        if (completions.length >= 50) break;
      } catch {
        // Try simpler ls approach if find fails
        try {
          const cmd = partial
            ? `ls -1 "${dir}" 2>/dev/null | grep "^${partial}" | head -20`
            : `ls -1 "${dir}" 2>/dev/null | head -20`;
          
          const output = execSync(cmd, {
            encoding: 'utf8',
            timeout: 100
          });
          
          const files = output.split('\n').filter(Boolean);
          for (const file of files) {
            if (!seen.has(file) && file.startsWith(partial)) {
              seen.add(file);
              completions.push({
                text: file,
                display: file,
                description: 'command',
                type: 'command',
                priority: 8,
                metadata: {}
              });
            }
          }
        } catch {}
      }
    }
    
    // Also include shell builtins
    const builtins = this.getShellBuiltins();
    for (const builtin of builtins) {
      if (builtin.startsWith(partial) && !seen.has(builtin)) {
        seen.add(builtin);
        completions.push({
          text: builtin,
          display: builtin,
          description: 'builtin',
          type: 'command',
          priority: 9,
          metadata: {}
        });
      }
    }
    
    // Sort by priority and alphabetically
    return completions.sort((a, b) => {
      if (a.priority !== b.priority) {
        return b.priority - a.priority;
      }
      return a.text.localeCompare(b.text);
    });
  }

  /**
   * Get command-specific completions
   */
  async getCommandSpecificCompletions(command, partial, context) {
    const completions = [];
    
    // Special handling for common commands
    switch (command) {
    case 'cd':
    case 'pushd':
      // Only directories for cd
      return this.getDirectoryCompletions(partial);
        
    case 'git':
      return this.getGitCompletions(partial, context);
        
    case 'npm':
      return this.getNpmCompletions(partial, context);
        
    case 'docker':
      return this.getDockerCompletions(partial, context);
        
    case 'kill':
      return this.getProcessCompletions(partial);
        
    case 'ssh':
    case 'scp':
    case 'rsync':
      return this.getHostnameCompletions(partial);
    }
    
    return completions;
  }

  /**
   * Get directory completions
   */
  async getDirectoryCompletions(partial) {
    const completions = [];
    
    try {
      // Expand path if it starts with ~
      const expandedPartial = partial.startsWith('~') 
        ? partial.replace(/^~/, process.env.HOME)
        : partial;
      
      const dir = expandedPartial.includes('/') 
        ? expandedPartial.substring(0, expandedPartial.lastIndexOf('/') + 1)
        : './';
      
      const prefix = expandedPartial.includes('/')
        ? expandedPartial.substring(expandedPartial.lastIndexOf('/') + 1)
        : expandedPartial;
      
      const output = execSync(`ls -1d "${dir}"*/ 2>/dev/null | head -20`, {
        encoding: 'utf8',
        timeout: 200
      });
      
      const dirs = output.split('\n').filter(Boolean);
      
      for (const dirPath of dirs) {
        const name = dirPath.replace(dir, '');
        if (name.startsWith(prefix)) {
          const displayPath = partial.includes('/') 
            ? partial.substring(0, partial.lastIndexOf('/') + 1) + name
            : name;
          
          completions.push({
            text: displayPath,
            display: displayPath,
            description: 'directory',
            type: 'directory',
            priority: 9,
            metadata: {}
          });
        }
      }
    } catch {}
    
    return completions;
  }

  /**
   * Get git-specific completions
   */
  async getGitCompletions(partial, context) {
    const { words } = context;
    const lastWord = words[words.length - 1];
    
    // Git subcommands
    if (words.length === 1) {
      const subcommands = [
        'add', 'commit', 'push', 'pull', 'clone', 'checkout',
        'branch', 'merge', 'rebase', 'status', 'diff', 'log',
        'stash', 'fetch', 'remote', 'tag', 'reset', 'revert',
        'init', 'mv', 'rm', 'show', 'blame', 'grep'
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
    if (['checkout', 'merge', 'rebase', 'branch', 'diff', 'log'].includes(lastWord)) {
      try {
        const output = execSync('git for-each-ref --format="%(refname:short)" refs/', {
          encoding: 'utf8',
          timeout: 500
        });
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
    
    // Git files for add, rm, diff
    if (['add', 'rm', 'diff'].includes(lastWord)) {
      try {
        const output = execSync('git status --porcelain', {
          encoding: 'utf8',
          timeout: 500
        });
        
        const files = output.split('\n')
          .filter(Boolean)
          .map(line => line.substring(3))
          .filter(file => file.startsWith(partial));
        
        return files.map(file => ({
          text: file,
          display: file,
          description: 'modified file',
          type: 'file',
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
  async getNpmCompletions(partial, context) {
    const { words } = context;
    
    if (words.length === 1) {
      const scripts = await this.getNpmScripts();
      const commands = [
        'install', 'uninstall', 'run', 'test', 'start',
        'init', 'publish', 'update', 'audit', 'ci',
        'ls', 'outdated', 'prune', 'rebuild', 'link'
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
    
    if (words[words.length - 1] === 'run') {
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
      const packageJson = execSync('cat package.json 2>/dev/null', {
        encoding: 'utf8',
        timeout: 100
      });
      
      const pkg = JSON.parse(packageJson);
      const scripts = pkg.scripts || {};
      
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
  async getDockerCompletions(partial, context) {
    const { words } = context;
    
    if (words.length === 1) {
      const commands = [
        'run', 'exec', 'ps', 'build', 'pull', 'push',
        'images', 'container', 'volume', 'network',
        'stop', 'start', 'restart', 'rm', 'rmi',
        'logs', 'inspect', 'compose', 'swarm'
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
    const lastWord = words[words.length - 1];
    if (['exec', 'stop', 'start', 'restart', 'rm', 'logs', 'inspect'].includes(lastWord)) {
      try {
        const output = execSync('docker ps --format "{{.Names}}"', {
          encoding: 'utf8',
          timeout: 500
        });
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
    
    // Docker images for run, rmi
    if (['run', 'rmi'].includes(lastWord)) {
      try {
        const output = execSync('docker images --format "{{.Repository}}:{{.Tag}}"', {
          encoding: 'utf8',
          timeout: 500
        });
        const images = output.split('\n').filter(Boolean);
        
        return images
          .filter(img => img.startsWith(partial) && !img.includes('<none>'))
          .map(img => ({
            text: img,
            display: img,
            description: 'docker image',
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
      const output = execSync('ps -eo pid,comm --no-headers', {
        encoding: 'utf8',
        timeout: 500
      });
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
              description: command.substring(0, 30),
              type: 'argument',
              priority: 7,
              metadata: { command }
            });
          }
        }
      }
      
      return completions.slice(0, 20);
    } catch {
      return [];
    }
  }

  /**
   * Get hostname completions
   */
  async getHostnameCompletions(partial) {
    const completions = [];
    const seen = new Set();
    
    // 1. SSH known hosts
    try {
      const output = execSync(
        'cut -d " " -f1 ~/.ssh/known_hosts 2>/dev/null | cut -d "," -f1 | sort -u',
        { encoding: 'utf8', timeout: 200 }
      );
      const hosts = output.split('\n').filter(Boolean);
      
      for (const host of hosts) {
        if (host.startsWith(partial) && !host.startsWith('[') && !seen.has(host)) {
          seen.add(host);
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
      const output = execSync(
        'grep "^Host " ~/.ssh/config 2>/dev/null | cut -d " " -f2-',
        { encoding: 'utf8', timeout: 200 }
      );
      const hosts = output.split('\n').filter(Boolean);
      
      for (const hostLine of hosts) {
        const hostNames = hostLine.split(/\s+/);
        for (const host of hostNames) {
          if (host.startsWith(partial) && host !== '*' && !seen.has(host)) {
            seen.add(host);
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
      }
    } catch {}
    
    // 3. /etc/hosts
    try {
      const output = execSync(
        'grep -v "^#" /etc/hosts 2>/dev/null | awk \'{for(i=2;i<=NF;i++) print $i}\'',
        { encoding: 'utf8', timeout: 200 }
      );
      const hosts = output.split('\n').filter(Boolean);
      
      for (const host of hosts) {
        if (host.startsWith(partial) && !seen.has(host)) {
          seen.add(host);
          completions.push({
            text: host,
            display: host,
            description: '/etc/hosts',
            type: 'hostname',
            priority: 7,
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
      const output = execSync(
        `${command} --help 2>&1 | grep -E "^\\s*-" | head -20`,
        { encoding: 'utf8', timeout: 500 }
      );
      
      const lines = output.split('\n').filter(Boolean);
      const completions = [];
      const seen = new Set();
      
      for (const line of lines) {
        // Match patterns like: -h, --help    Show help
        const matches = line.matchAll(/(-\w|--[\w-]+)/g);
        for (const match of matches) {
          const option = match[1];
          if (option.startsWith(partial) && !seen.has(option)) {
            seen.add(option);
            completions.push({
              text: option,
              display: option,
              description: line.trim().replace(/\s+/g, ' ').substring(0, 50),
              type: 'option',
              priority: 6,
              metadata: {}
            });
          }
        }
      }
      
      return completions;
    } catch {
      // Fallback to common options
      const commonOptions = [
        { opt: '--help', desc: 'Show help' },
        { opt: '-h', desc: 'Show help' },
        { opt: '--version', desc: 'Show version' },
        { opt: '-v', desc: 'Verbose output' },
        { opt: '--verbose', desc: 'Verbose output' },
        { opt: '-q', desc: 'Quiet mode' },
        { opt: '--quiet', desc: 'Quiet mode' },
        { opt: '-f', desc: 'Force' },
        { opt: '--force', desc: 'Force operation' }
      ];
      
      return commonOptions
        .filter(({ opt }) => opt.startsWith(partial))
        .map(({ opt, desc }) => ({
          text: opt,
          display: opt,
          description: desc,
          type: 'option',
          priority: 5,
          metadata: {}
        }));
    }
  }

  getShellBuiltins() {
    // Zsh-specific builtins
    return [
      ...super.getShellBuiltins(),
      'autoload', 'bindkey', 'builtin', 'chdir', 'compctl', 'compadd',
      'compdef', 'dirs', 'disable', 'disown', 'echotc', 'echoti',
      'emulate', 'enable', 'fc', 'float', 'functions', 'getln',
      'getopts', 'hash', 'history', 'integer', 'jobs', 'kill',
      'limit', 'local', 'log', 'logout', 'popd', 'print', 'pushd',
      'pushln', 'pwd', 'r', 'read', 'readonly', 'rehash', 'sched',
      'setopt', 'source', 'suspend', 'times', 'trap', 'ttyctl',
      'type', 'typeset', 'ulimit', 'umask', 'unalias', 'unfunction',
      'unhash', 'unlimit', 'unset', 'unsetopt', 'vared', 'wait',
      'whence', 'where', 'which', 'zcompile', 'zformat', 'zftp',
      'zle', 'zmodload', 'zparseopts', 'zprof', 'zpty', 'zregexparse',
      'zsocket', 'zstyle', 'ztcp'
    ];
  }
}

export default ZshCompletionBackend;