import minimist from 'minimist';

export function parseArgs(argv) {
  const args = minimist(argv, {
    string: ['config', 'shell', 'execute'],
    boolean: ['help', 'version', 'no-ai', 'init', 'debug', 'verbose', 'quiet', 'yes', 'yolo'],
    alias: {
      h: 'help',
      v: 'verbose',  // Changed: -v is now verbose, --version has no shortcut
      c: 'config',
      s: 'shell',
      e: 'execute',
      d: 'debug',
      q: 'quiet',
      y: 'yes'      // -y for auto-accept
    },
    default: {
      'no-ai': false,
      'debug': false,
      'verbose': false,
      'quiet': false,
      'yes': false,
      'yolo': false
    }
  });

  return {
    help: args.help,
    version: args.version,
    config: args.config,
    shell: args.shell,
    noAi: args['no-ai'],
    init: args.init,
    execute: args.execute,
    debug: args.debug,
    verbose: args.verbose,
    quiet: args.quiet,
    yes: args.yes || args.yolo,  // --yolo is an alias for --yes
    _: args._
  };
}

export function parseShebangArgs(shebangLine) {
  // Parse arguments from shebang line like:
  // #!/usr/bin/env clsh --shell /bin/zsh
  // #!/usr/local/bin/clsh -s /bin/bash --no-ai
  
  if (!shebangLine || !shebangLine.startsWith('#!')) {
    return {};
  }
  
  // Remove #! and split the line
  const line = shebangLine.slice(2).trim();
  const parts = line.split(/\s+/);
  
  // Find where clsh appears
  const clshIndex = parts.findIndex(part => part.includes('clsh'));
  if (clshIndex === -1) {
    return {};
  }
  
  // Parse arguments after clsh
  const clshArgs = parts.slice(clshIndex + 1);
  return parseArgs(clshArgs);
}