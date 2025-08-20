# Basic Usage Examples for aish

## Starting aish

```bash
# Start with default settings
aish

# Start in quiet mode (minimal output)
aish -q

# Start in verbose mode (detailed output)
aish -v

# Start with debug output
aish -d
```

## Natural Language Substitution

Use `~{description}` to embed natural language in commands:

```bash
# Find files modified today
aish:~$ ls ~{files modified today}
# Executes: find . -type f -mtime 0

# Count Python files
aish:~$ wc -l ~{all python files}
# Executes: find . -name "*.py" | xargs wc -l

# Delete temporary files
aish:~$ rm ~{temp files in current directory}
# Executes: rm -f *.tmp *.temp
```

## Command Generation

Use `!` to generate commands from natural language:

```bash
# Generate disk usage command
aish:~$ ! show disk usage by directory
# Suggests: du -h --max-depth=1 | sort -hr

# Generate git command
aish:~$ ! undo last commit but keep changes
# Suggests: git reset --soft HEAD~1

# Generate network diagnostic
aish:~$ ! test connection to google
# Suggests: ping -c 4 google.com
```

## Asking Questions

Use `?` to ask questions without executing commands:

```bash
# Ask about files
aish:~$ ? what's the largest file in this directory
# Answer: The largest file is node_modules.tar.gz (152MB)

# Ask about system
aish:~$ ? which process is using port 3000
# Answer: Node.js process (PID 12345) is using port 3000

# Ask about code
aish:~$ ? what does this project do
# Answer: This is an AI-powered shell wrapper that enhances...
```

## Error Correction

When commands fail, aish automatically suggests corrections:

```bash
# Typo in branch name
aish:~$ git checkout mian
# Error: pathspec 'mian' did not match any file(s) known to git
# Suggestion: git checkout main
# Accept? (y/n):

# Missing command
aish:~$ pyhton script.py
# Error: command not found: pyhton
# Suggestion: python script.py
# Accept? (y/n):
```

## Output Modes

### Normal Mode (default)
Shows abbreviated thinking steps:
```bash
aish:~$ ? what files are here
[Step] Let me check the files in the current directory...
[Used tools: LS]
Answer: The directory contains: src/, package.json, README.md...
```

### Quiet Mode (-q)
Only shows the final answer:
```bash
aish:~$ ? what files are here
Answer: The directory contains: src/, package.json, README.md...
```

### Verbose Mode (-v)
Shows full details:
```bash
aish:~$ ? what files are here

[Step] Let me check the files in the current directory using the LS tool
[Tools: LS]
[Used tools: LS]
Answer: The directory contains: src/, package.json, README.md...
```

## Complex Examples

### Multi-step Operations
```bash
# Find and replace across files
aish:~$ ~{replace 'oldFunction' with 'newFunction' in all JS files}

# Clean up project
aish:~$ ! remove all node_modules and reinstall

# Analyze logs
aish:~$ ? what errors appeared in the logs today
```

### Script Mode
Create executable scripts with aish shebang:

```bash
#!/usr/bin/env aish

# This script uses natural language features
echo "Cleaning up project..."
rm ~{all build artifacts}
! optimize images in assets folder
? are there any security vulnerabilities
```