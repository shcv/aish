# 🔥 aish - AI-Powered Interactive Shell

aish (AI Shell) is an intelligent command-line interface that seamlessly integrates Claude AI into your terminal workflow. It helps you write commands, answer questions, and fix errors—all without leaving your shell.

## ✨ What Can aish Do?

### 🤖 Ask Questions in Natural Language
```bash
🔥 projects (main) ❯ ? what's the largest file in this directory?
[Bash: du -h * | sort -rh | head -1]
Answer: The largest file is node_modules at 42M
```

### 🛠️ Generate Commands from Descriptions
```bash
🔥 docs (main) ❯ ! find all markdown files modified in the last week
[Grep: "\.md$"]
[Thinking] I'll help you find markdown files modified in the last week...
Generated command:
find . -name "*.md" -mtime -7

Execute this command? [Yes/No/Edit] > 
```

### 🔧 Automatic Error Correction
```bash
🔥 myapp (main) ❯ git push origin mian
error: src refspec mian does not match any
[Analyzing error...]

Command failed. Suggested fix:
git push origin main

Run corrected command? [Yes/No/Edit] >
```

### 📚 Intelligent Command History
- Use ↑/↓ arrows to navigate through previous commands
- History persists between sessions
- AI-generated commands are added to history when executed

## 🚀 Quick Start

### Installation

```bash
# Clone the repository
git clone https://github.com/shcv/aish.git
cd aish

# Install dependencies
npm install

# Link globally for easy access
npm link
```

### Prerequisites
- Node.js 18 or later
- Claude CLI (`claude` command) - Install from [claude.ai/cli](https://claude.ai/cli)

### First Run
```bash
# Start aish
aish

# On first run, aish will guide you through setup:
# - Choose your AI model (Sonnet recommended)
# - Enable/disable features
# - Set up command history
```

## 📖 How to Use aish

### Basic Commands

| Command | Description | Example |
|---------|-------------|---------|
| `?` | Ask a question | `? how do I check disk usage?` |
| `!` | Generate a command | `! compress all images in this folder` |
| Regular commands | Execute normally | `ls -la`, `git status`, etc. |
| `exit` | Quit aish | `exit` |

### Interactive Menus

When aish suggests a command, you'll see:
```
Execute this command? 
  ▸ Yes     # Run the command
    No      # Skip it
    Edit    # Modify before running
```

### Visual Feedback

aish provides clear visual indicators:
- 🔥 Orange prompt with current directory and git branch
- `[Read: file.txt]` - Shows when AI reads files
- `[Grep: "pattern"]` - Shows search operations
- `[Thinking]` - AI processing steps
- ✻ ✼ ✽ Animated spinner during AI operations

## ⚙️ Configuration

aish can be configured via `~/.config/aish/config.yaml`:

```yaml
# Shell settings
shell:
  default: /bin/bash

# Command history
history:
  enabled: true
  file: ~/.aish_history
  max_entries: 10000

# AI behavior
ai:
  model: sonnet          # or opus, haiku
  timeout_seconds: 60

# Error handling
error_handling:
  enabled: true
  ignore_exit_codes:
    grep: [1]           # Don't offer corrections for grep "not found"
    diff: [1]           # Or diff with differences

# Visual appearance
appearance:
  theme: default
```

## 🎯 Command-Line Options

```bash
aish [options]

Options:
  -h, --help         Show help
  -v, --verbose      Show detailed AI thinking process
  -q, --quiet        Minimal output, just show results
  -d, --debug        Debug mode with technical details
  --no-ai            Disable AI features (regular shell only)
  -c, --config PATH  Use specific config file
  -s, --shell SHELL  Override default shell
```

## 💡 Pro Tips

1. **Quick Corrections**: When a command fails, aish automatically suggests fixes
2. **History Search**: Use Ctrl+R to search command history
3. **Edit Suggestions**: Choose "Edit" to modify AI suggestions before running
4. **Verbose Mode**: Use `-v` to see Claude's full reasoning process
5. **Quiet Scripts**: Use `-q` for scripting when you only need results

## 🔍 Example Session

```bash
$ aish

🔥 ~ ❯ ? how many Python files are in my projects folder?
[Read: /home/user/projects]
[Grep: "\.py$"]
Answer: You have 47 Python files in your projects folder.

🔥 ~ ❯ ! create a backup of all config files
Generated command:
tar -czf configs_backup_$(date +%Y%m%d).tar.gz ~/.config/

Execute this command? [Yes/No/Edit] > yes
Creating backup...

🔥 ~ ❯ cd /etc/nginx
🔥 nginx (main) ❯ ! show active server blocks
[Read: nginx.conf]
[Grep: "server {"]
Generated command:
grep -l "server {" sites-enabled/*

Execute this command? [Yes/No/Edit] > yes
sites-enabled/default
sites-enabled/myapp.conf

🔥 nginx (main) ❯ exit
Goodbye!
```

## 🐛 Troubleshooting

| Issue | Solution |
|-------|----------|
| "Claude not found" | Install Claude CLI: `npm install -g @anthropic/claude-cli` |
| Commands not working | Check your shell path in config.yaml |
| History not saving | Ensure `~/.aish_history` is writable |
| AI responses slow | Try using `haiku` model for faster responses |

## 📝 License

CC0 - Public Domain

## 🤝 Contributing

Contributions welcome!

## 🔗 Links

- [Report Issues](https://github.com/shcv/aish/issues)
- [Documentation](https://github.com/shcv/aish/wiki)
- [Claude CLI Setup](https://claude.ai/cli)