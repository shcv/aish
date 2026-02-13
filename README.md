# aish - AI Shell Integration

A shell plugin that integrates Claude AI into your terminal. Ask questions, generate commands, and fix errors on demand - all while preserving your full shell state. Supports both Zsh and Fish.

## Features

- **`Alt+K`** - Ask AI anything, or explain last error if blank
- **`Alt+J`** - Generate shell commands, or fix last error if blank
- **Error recording** - Failed commands saved for on-demand fix/explain
- **Session continuity** - Conversations persist per shell session
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
# Keybindings
Alt+J    Generate command from current line
         Fix last error if line is blank
         Interactive mode if no error
Alt+K    Ask about current line
         Explain last error if line is blank
         Interactive mode if no error

# Management
aish status      # Show session info
aish reset       # Clear current session
aish compact     # Summarize to reduce context
aish config      # Show current config
aish debug       # Toggle debug mode
aish help        # Show all commands

# Error management
aish errors      # List recorded errors
aish errors 1    # View error #1 details
aish fix         # Fix latest error
aish fix 1       # Fix error #1
aish explain     # Explain latest error
aish explain 1   # Explain error #1
aish errors rm 1 # Remove error #1
aish errors clear # Clear all errors
```

## Configuration

Config is loaded from `~/.config/aish/config` (key=value format). Environment variables take precedence over the config file.

```
# Set persistently (writes to config file)
aish config model=opus
aish config backend=api

# Set for current session only
aish config --session model=opus

# Show current config
aish config
```

Available keys:

| Key | Values | Default |
|-----|--------|---------|
| `backend` | auto, claude-code, api | auto |
| `model` | sonnet, opus, haiku | haiku |
| `debug` | true, false | false |
| `highlighter` | auto, bat, batcat, none | auto |

## Data Storage

```
~/.config/aish/
└── config               # Persistent configuration (key=value)

~/.local/share/aish/
├── claude/              # Isolated Claude config (credentials symlinked)
└── errors/              # Recorded command failures
```

## License

CC0 - Public Domain
