# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

aish (AI Shell) integrates Claude AI into your terminal. It provides natural language command generation, question answering, and error correction while preserving full shell state. Supports both Zsh and Fish shells.

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

- `Alt+J` - Generate command from current line, or interactive mode if empty
- `Alt+K` - Ask question about current line, or interactive mode if empty

### Commands

- `aish <command>` - Manage sessions, config, etc.

### Management Commands

- `aish status` - Show current session info and backend status
- `aish reset [--all]` - Reset session for current dir (--all for all sessions)
- `aish compact` - Compact/summarize current session to reduce context
- `aish sessions` - List all sessions
- `aish switch <id>` - Switch to a different session
- `aish config [key=val]` - Show or set configuration
- `aish debug` - Toggle debug mode

### Configuration

- `AISH_BACKEND` - auto, claude-code, api (default: auto)
- `AISH_MODEL` - sonnet, opus, haiku (default: sonnet)
- `AISH_DEBUG` - true/false (default: false)
- `AISH_ERROR_CORRECTION` - true/false (default: true)
- `AISH_DATA_DIR` - Data directory (default: $XDG_DATA_HOME/aish)

### Error Correction

When a command fails, aish sends the command and exit code to Haiku in a single triage+correction call. Signal exits (130/Ctrl+C, 141/SIGPIPE, 143/SIGTERM) are fast-path ignored. If Haiku determines the error is correctable (typos, wrong flags, command not found, etc.), it returns a suggestion; otherwise it stays silent with no user-visible prompt.

## Architecture

Both plugins extend their respective shells rather than wrapping them, so shell state (variables, jobs, functions, aliases) is fully preserved.

### Session Management
- Sessions are per-directory, stored in `$XDG_DATA_HOME/aish/sessions/`
- Each session has a UUID stored in `session-id` file
- Claude config isolated to `$XDG_DATA_HOME/aish/claude/` with symlinked credentials

### Backend
- Uses `claude` CLI with `--session-id` (new) or `--resume` (continue)
- Falls back to direct API calls if `ANTHROPIC_API_KEY` is set

### Key Functions
- `_aish_query_ai` - Core AI query, handles session/resume logic
- `aish` - Main command dispatcher for management subcommands
- `aish-query`, `aish-generate` - AI query/generate (called by keybindings)
- `_aish_check_error` - Haiku-based error triage and correction
