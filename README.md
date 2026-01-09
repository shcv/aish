# aish - AI Shell Integration

A shell plugin that integrates Claude AI into your terminal. Ask questions, generate commands, and get error corrections - all while preserving your full shell state. Supports both Zsh and Fish.

## Features

- **`Alt+K`** - Ask AI anything (recommended)
- **`Alt+J`** - Generate shell commands from natural language (recommended)
- **`? question`** - Ask AI (simple queries)
- **`! request`** - Generate commands (zsh only; conflicts with fish history)
- **Error correction** - Suggestions when commands fail (configurable exit codes)
- **Session continuity** - Conversations persist per-directory
- **Full shell state** - Variables, jobs, aliases all preserved (it's a plugin, not a wrapper)

## Installation

Requires either:
- `claude` CLI installed (`npm install -g @anthropic-ai/claude-code`)
- Or `ANTHROPIC_API_KEY` environment variable

### Zsh

```zsh
# Add to ~/.zshrc
source /path/to/aish/aish.plugin.zsh
```

### Fish

```fish
# Add to ~/.config/fish/config.fish
source /path/to/aish/aish.fish
```

## Usage

```
# Keybindings (recommended - handles quotes and special chars)
Alt+J    Generate command from current line (or interactive if empty)
Alt+K    Ask about current line (or interactive if empty)

# Commands
? what does the -r flag do in grep
! find all python files modified in the last week    # zsh only

# Management
aish status      # Show session info
aish reset       # Clear current session
aish sessions    # List all sessions
aish compact     # Summarize to reduce context
aish config      # Show/set configuration
aish config trap # Manage error trap codes
aish help        # Show all commands
```

## Configuration

Set these before sourcing the plugin:

```
AISH_BACKEND=auto              # auto, claude-code, api
AISH_MODEL=sonnet              # sonnet, opus, haiku
AISH_DEBUG=false               # Show debug output
AISH_ERROR_CORRECTION=true     # Prompt on command failures
AISH_ERROR_TRAP_CODES="2 126 127"  # Exit codes to offer correction
```

Or change at runtime:

```
aish config debug=true
aish config trap add 1      # Add exit code to trap list
aish config trap remove 127 # Remove from list
aish debug                  # Toggle debug mode
```

### Error Trap Codes

By default, error correction only triggers for specific exit codes:
- 2 = Syntax/usage error
- 126 = Permission denied
- 127 = Command not found

This avoids prompting for common "expected" failures like grep finding no matches (exit 1) or Ctrl+C (exit 130).

## Data Storage

All data stored in `~/.local/share/aish/` (or `$XDG_DATA_HOME/aish`):

```
~/.local/share/aish/
├── claude/          # Isolated Claude config (credentials symlinked)
└── sessions/        # Per-directory session mappings
```

## License

CC0 - Public Domain
