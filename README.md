# aish - AI Shell Integration for Zsh

A Zsh plugin that integrates Claude AI into your terminal. Ask questions, generate commands, and get error corrections - all while preserving your full shell state.

## Features

- **`? question`** - Ask AI anything
- **`! request`** - Generate shell commands from natural language
- **Error correction** - Automatic suggestions when commands fail
- **Session continuity** - Conversations persist per-directory
- **Full shell state** - Variables, jobs, aliases all preserved (it's a plugin, not a wrapper)

## Quick Start

```zsh
# Add to ~/.zshrc
source /path/to/aish/aish.plugin.zsh

# Reload
source ~/.zshrc
```

Requires either:
- `claude` CLI installed (`npm install -g @anthropic-ai/claude-code`)
- Or `ANTHROPIC_API_KEY` environment variable

## Usage

```zsh
# Ask a question
? what does the -r flag do in grep

# Generate a command
! find all python files modified in the last week

# Keybindings
# Alt+J - Generate command from current line
# Alt+K - Ask about current line

# Manage sessions
aish status      # Show session info
aish reset       # Clear current session
aish sessions    # List all sessions
aish compact     # Summarize to reduce context
aish help        # Show all commands
```

## Configuration

Set these before sourcing the plugin:

```zsh
AISH_BACKEND=auto          # auto, claude-code, api
AISH_MODEL=sonnet          # sonnet, opus, haiku
AISH_DEBUG=false           # Show debug output
AISH_ERROR_CORRECTION=true # Prompt on command failures
```

Or change at runtime:

```zsh
aish config debug=true
aish debug  # Toggle debug mode
```

## Data Storage

All data stored in `~/.local/share/aish/` (or `$XDG_DATA_HOME/aish`):

```
~/.local/share/aish/
├── claude/          # Isolated Claude config (credentials symlinked)
└── sessions/        # Per-directory session mappings
```

## License

CC0 - Public Domain
