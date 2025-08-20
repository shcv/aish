# aish Examples

This directory contains examples and templates for using aish effectively.

## Configuration Examples

### Basic Configuration
- `aish/settings.yaml` - Standard configuration with all common options
- `minimal-config.yaml` - Minimal configuration to get started
- `advanced-config.yaml` - Advanced configuration with all features
- `aish/appearance.json` - Example appearance customization in JSON format

## Usage Examples

- `basic-usage.md` - Comprehensive guide with common usage patterns

## Script Examples

The `scripts/` directory contains example aish scripts that demonstrate how to use natural language features in shell scripts:

- `backup.aish` - Automated backup script with AI assistance
- `dev-setup.aish` - Development environment setup with intelligent configuration
- `git-workflow.aish` - Git workflow automation with AI-powered suggestions

### Running Scripts

Make sure the scripts are executable:
```bash
chmod +x scripts/*.aish
```

Then run them directly:
```bash
./scripts/backup.aish
./scripts/dev-setup.aish
./scripts/git-workflow.aish {commit|cleanup|review|release|fix}
```

## Quick Start

1. Copy a configuration file to `~/.config/aish/config.yaml`:
   ```bash
   mkdir -p ~/.config/aish
   cp minimal-config.yaml ~/.config/aish/config.yaml
   ```

2. Start aish:
   ```bash
   aish
   ```

3. Try some examples:
   ```bash
   # Natural language substitution
   ls ~{files modified today}
   
   # Command generation
   ! show disk usage
   
   # Ask questions
   ? what's the largest file here
   ```

## Customization Tips

- Start with `minimal-config.yaml` and add options as needed
- Use `advanced-config.yaml` as a reference for all available options
- The `appearance` section lets you customize colors and indicators
- The `permissions` section controls when aish asks for confirmation
- Set `timeout_seconds` higher for complex queries that need more processing time

## Output Modes

Run aish with different verbosity levels:
- `aish` - Normal mode (abbreviated steps)
- `aish -q` - Quiet mode (minimal output)
- `aish -v` - Verbose mode (detailed output)
- `aish -d` - Debug mode (all messages)