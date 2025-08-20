# aish - AI Shell

An intelligent shell wrapper that enhances your command line with AI assistance powered by Claude.

## Features

- **Natural Language Substitution**: Use `~{description}` to embed natural language in commands
- **Command Generation**: Type `? your request` to generate commands from natural language
- **Quick Accept**: Type `++` to accept the previous AI suggestion
- **Error Correction**: Automatic suggestions when commands fail
- **Transparent Pass-through**: Seamlessly works with interactive programs like vim, ssh, etc.

## Installation

```bash
# Clone the repository
git clone https://github.com/shcv/aish.git
cd aish

# Install dependencies
npm install

# Link globally (optional)
npm link
```

## Prerequisites

- Node.js 18 or later
- Claude Code CLI (`claude` command) for AI features

## Usage

Start aish:
```bash
node src/index.js
# or if linked globally:
aish
```

### Examples

Natural language substitution:
```bash
$ ls ~{files modified today}
# Suggests: ls -la -t | grep "$(date +%b\ %d)"
```

Generate commands:
```bash
$ ? show disk usage
# Suggests: df -h
```

Automatic error correction:
```bash
$ git push origin mian
# Error detected, suggests: git push origin main
```

### Options

- `--help, -h` - Show help message
- `--version` - Show version information
- `--config, -c PATH` - Use specific configuration file
- `--shell, -s SHELL` - Override default shell
- `--no-ai` - Disable AI features
- `--debug, -d` - Enable debug mode (show all Claude messages)
- `--verbose, -v` - Show extra detail in responses
- `--quiet, -q` - Minimal output (only show final answers)

### Output Modes

aish provides three output modes for AI responses:

**Normal Mode** (default)
- Shows abbreviated intermediate thinking steps
- Displays tool usage summary
- Shows the final answer
- Best for everyday use with helpful context

**Quiet Mode** (`-q` or `--quiet`)
- Only shows the final answer
- No intermediate steps or tool usage
- Best for scripts or when you just want the result

**Verbose Mode** (`-v` or `--verbose`)  
- Shows full intermediate thinking steps
- Displays detailed tool usage information
- Shows configuration loading details
- Best for debugging or understanding Claude's reasoning

Example with different modes:
```bash
# Normal mode - shows abbreviated steps
$ aish
aish:~$ ? what files are in this directory?
[Step] Let me check the files in the current directory...
[Used tools: LS]
Answer: The directory contains: src/, package.json, README.md...

# Quiet mode - just the answer
$ aish -q
aish:~$ ? what files are in this directory?
Answer: The directory contains: src/, package.json, README.md...

# Verbose mode - full details
$ aish -v
aish:~$ ? what files are in this directory?

[Step] Let me check the files in the current directory using the LS tool
[Tools: LS]
[Used tools: LS]
Answer: The directory contains: src/, package.json, README.md...
```

## Configuration

Create a config file at `~/.config/aish/config.yaml`:

```yaml
shell:
  default: /bin/bash
  args: []

syntax:
  substitution: "~{}"
  command: "?"
  accept: "++"

error_handling:
  enabled: true
  ignore_exit_codes:
    grep: [1]
    diff: [1]

ai:
  model: sonnet
  max_context_lines: 100
  timeout_seconds: 60
```

## Development

Run tests:
```bash
npm test
```

## License

MIT
