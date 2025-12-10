# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

aish (AI Shell) is a Zsh plugin that integrates Claude AI into your terminal. It provides natural language command generation, question answering, and error correction while preserving full shell state.

## Installation

```zsh
# Add to ~/.zshrc
source /path/to/aish/aish.plugin.zsh
```

## Files

- `aish.plugin.zsh` - The entire plugin (single file)

## Usage

- `? <question>` - Ask AI a question
- `! <request>` - Generate shell command from description
- `Ctrl+G` - Generate command from current line
- `Ctrl+Q` - Ask about current line
- `aish <command>` - Manage sessions, config, etc.

## Architecture

The plugin extends Zsh rather than wrapping it, so shell state (variables, jobs, functions, aliases) is fully preserved.

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
- `aish-query`, `aish-generate` - User-facing `?` and `!` commands
