# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

aish (AI Shell) integrates Claude AI into your terminal. It provides natural language command generation, question answering, and on-demand error fixing/explaining while preserving full shell state. Supports both Zsh and Fish shells.

## Installation

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

## Files

- `aish.plugin.zsh` - Zsh plugin (single file)
- `aish.fish` - Fish plugin (single file)

## Usage

### Keybindings

- `Alt+J` - Generate command from current line, fix last error if blank, or interactive mode
- `Alt+K` - Ask question about current line, explain last error if blank, or interactive mode

### Commands

- `aish <command>` - Manage sessions, config, etc.

### Management Commands

- `aish status` - Show current session info and backend status
- `aish reset [--all]` - Reset session for current dir (--all for all sessions)
- `aish compact` - Compact/summarize current session to reduce context
- `aish config [key=val]` - Show/set config (persists to `~/.config/aish/config`)
- `aish config --session key=val` - Set config for current session only
- `aish debug` - Toggle debug mode
- `aish errors` - List recorded errors
- `aish errors <id>` - View error details
- `aish errors rm <id>` - Remove an error record
- `aish errors clear` - Remove all error records
- `aish fix [id]` - Generate fix for error (default: latest)
- `aish explain [id]` - Explain error (default: latest)

### Configuration

Config file: `${XDG_CONFIG_HOME:-~/.config}/aish/config` (key=value format).
Priority: env vars > config file > defaults.

- `backend` - auto, claude-code, api (default: auto)
- `model` - sonnet, opus, haiku (default: haiku)
- `debug` - true/false (default: false)
- `highlighter` - auto, bat, batcat, none, or path (default: auto)
- `data-dir` - Data directory (default: $XDG_DATA_HOME/aish)

### Error Handling

Failed commands are passively recorded to `$AISH_DATA_DIR/errors/`. Signal exits (130/Ctrl+C, 141/SIGPIPE, 143/SIGTERM) are ignored. Successful commands clear the last error state. Users can fix or explain errors on demand via keybindings (Alt+J/Alt+K on blank line) or subcommands (`aish fix`, `aish explain`).

## Architecture

Both plugins extend their respective shells rather than wrapping them, so shell state (variables, jobs, functions, aliases) is fully preserved.

### Session Management
- Sessions are per-shell (tied to the current shell process, not persisted)
- Each shell generates a new UUID on first AI query
- Claude config isolated to `$XDG_DATA_HOME/aish/claude/` with symlinked credentials

### Backend
- Uses `claude` CLI with `--session-id` (new) or `--resume` (continue)
- Falls back to direct API calls if `ANTHROPIC_API_KEY` is set

### Key Functions
- `_aish_query_ai` - Core AI query, handles session/resume logic
- `aish` - Main command dispatcher for management subcommands
- `aish-query`, `aish-generate` - AI query/generate (called by keybindings)
- `_aish_save_error`, `_aish_load_error` - Error record storage
- `_aish_fix_error`, `_aish_explain_error` - On-demand error fix/explain
