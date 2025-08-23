/**
 * Configuration schema definition and validation
 * This defines the complete structure and types of the configuration
 */

export const CONFIG_SCHEMA = {
  // Meta configuration
  _meta: {
    type: 'object',
    description: 'Configuration management settings',
    properties: {
      auto_update: {
        type: 'string',
        description: 'How to handle configuration updates',
        enum: ['interactive', 'auto', 'never'],
        default: 'interactive',
        prompt: 'How should configuration updates be handled? (interactive: ask for new values, auto: use defaults, never: ignore)'
      },
      version: {
        type: 'string',
        description: 'Configuration schema version',
        default: '1.0.0',
        internal: true // Don't prompt user for this
      }
    }
  },

  // Shell configuration
  shell: {
    type: 'object',
    description: 'Shell configuration',
    properties: {
      default: {
        type: 'string',
        description: 'Default shell to use',
        default: process.env.SHELL || '/bin/bash',
        prompt: 'What shell should aish use?'
      },
      args: {
        type: 'array',
        description: 'Arguments to pass to the shell',
        default: [],
        advanced: true
      },
      eof_exits: {
        type: 'boolean',
        description: 'Whether Ctrl+D exits immediately or shows warning',
        default: false,
        prompt: 'Should Ctrl+D exit immediately? (false = show warning first)'
      }
    }
  },

  // Syntax configuration
  syntax: {
    type: 'object',
    description: 'Syntax configuration for special commands',
    properties: {
      substitution: {
        type: 'string',
        description: 'Natural language substitution syntax',
        default: '~{}',
        prompt: 'What syntax for natural language substitution? (e.g., ~{list files})'
      },
      command: {
        type: 'string',
        description: 'Command generation prefix',
        default: '!',
        prompt: 'What prefix for AI command generation? (e.g., !list all python files)'
      },
      question: {
        type: 'string',
        description: 'Question prefix',
        default: '?',
        prompt: 'What prefix for AI questions? (e.g., ?how do I...)'
      }
    }
  },

  // Error handling
  error_handling: {
    type: 'object',
    description: 'Error handling configuration',
    properties: {
      enabled: {
        type: 'boolean',
        description: 'Enable intelligent error handling',
        default: true,
        prompt: 'Enable AI-powered error correction?'
      },
      ignore_exit_codes: {
        type: 'object',
        description: 'Exit codes to ignore per command',
        default: {
          grep: [1],
          diff: [1],
          test: [1]
        },
        advanced: true
      }
    }
  },

  // AI configuration
  ai: {
    type: 'object',
    description: 'AI configuration',
    properties: {
      model: {
        type: 'string',
        description: 'AI model to use',
        enum: ['sonnet', 'haiku', 'opus'],
        default: 'sonnet',
        prompt: 'Which Claude model to use? (sonnet: balanced, haiku: fast, opus: powerful)'
      },
      max_context_lines: {
        type: 'number',
        description: 'Maximum lines of context to send',
        default: 100,
        advanced: true
      },
      timeout_seconds: {
        type: 'number',
        description: 'Timeout for AI requests',
        default: 60,
        advanced: true
      }
    }
  },

  // Permissions
  permissions: {
    type: 'object',
    description: 'Permission settings for AI actions',
    properties: {
      substitution: {
        type: 'string',
        description: 'Permission for substitutions',
        enum: ['always_ask', 'never_ask', 'filter'],
        default: 'always_ask',
        prompt: 'When to ask permission for substitutions? (always_ask/never_ask/filter)'
      },
      error_correction: {
        type: 'string',
        description: 'Permission for error corrections',
        enum: ['always_ask', 'never_ask', 'filter'],
        default: 'always_ask',
        prompt: 'When to ask permission for error corrections? (always_ask/never_ask/filter)'
      },
      command_generation: {
        type: 'string',
        description: 'Permission for command generation',
        enum: ['always_ask', 'never_ask', 'filter'],
        default: 'always_ask',
        prompt: 'When to ask permission for generated commands? (always_ask/never_ask/filter)'
      }
    }
  },

  // History
  history: {
    type: 'object',
    description: 'History configuration',
    properties: {
      enabled: {
        type: 'boolean',
        description: 'Enable history',
        default: true,
        prompt: 'Enable command history?'
      },
      mode: {
        type: 'string',
        description: 'History mode',
        enum: ['aish', 'shell', 'unified'],
        default: 'unified',
        prompt: 'History mode? (aish: only aish, shell: only shell, unified: both)'
      },
      file: {
        type: 'string',
        description: 'History file location',
        default: '~/.aish_history',
        advanced: true
      },
      max_entries: {
        type: 'number',
        description: 'Maximum history entries',
        default: 10000,
        advanced: true
      },
      save_corrections: {
        type: 'boolean',
        description: 'Save AI corrections to history',
        default: true,
        advanced: true
      },
      shell_integration: {
        type: 'object',
        description: 'Shell history integration',
        properties: {
          enabled: {
            type: 'boolean',
            description: 'Enable shell history integration',
            default: true,
            prompt: 'Integrate with shell history?'
          },
          sync_commands: {
            type: 'boolean',
            description: 'Add aish commands to shell history',
            default: true,
            advanced: true
          }
        }
      },
      search: {
        type: 'object',
        description: 'History search settings',
        properties: {
          fuzzy: {
            type: 'boolean',
            description: 'Enable fuzzy search',
            default: true,
            advanced: true
          },
          max_results: {
            type: 'number',
            description: 'Maximum search results',
            default: 50,
            advanced: true
          },
          include_timestamps: {
            type: 'boolean',
            description: 'Include timestamps in search',
            default: true,
            advanced: true
          },
          deduplicate: {
            type: 'boolean',
            description: 'Remove duplicate entries',
            default: true,
            advanced: true
          }
        }
      },
      custom_providers: {
        type: 'array',
        description: 'Custom history provider commands',
        items: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Provider name'
            },
            command: {
              type: 'string',
              description: 'Command to get history (should output one command per line)'
            },
            format: {
              type: 'string',
              description: 'Output format',
              enum: ['plain', 'json', 'tsv'],
              default: 'plain'
            }
          }
        },
        default: [],
        prompt: 'Add custom history providers? (commands that output history)',
        advanced: true
      }
    }
  },

  // Completion
  completion: {
    type: 'object',
    description: 'Completion configuration',
    properties: {
      enabled: {
        type: 'boolean',
        description: 'Enable tab completion',
        default: true,
        prompt: 'Enable tab completion?'
      },
      backend: {
        type: 'string',
        description: 'Completion backend',
        enum: ['auto', 'bash', 'zsh', 'fish', 'generic'],
        default: 'auto',
        advanced: true
      },
      fuzzy_search: {
        type: 'boolean',
        description: 'Enable fuzzy search in completions',
        default: true,
        advanced: true
      },
      fuzzy_backend: {
        type: 'string',
        description: 'Fuzzy search backend',
        enum: ['auto', 'fzf', 'javascript'],
        default: 'auto',
        advanced: true
      },
      max_suggestions: {
        type: 'number',
        description: 'Maximum completion suggestions',
        default: 10,
        advanced: true
      },
      cache_ttl: {
        type: 'number',
        description: 'Completion cache TTL in seconds',
        default: 300,
        advanced: true
      },
      ai_suggestions: {
        type: 'boolean',
        description: 'Enable AI-powered suggestions',
        default: false,
        prompt: 'Enable AI-powered completion suggestions? (experimental)'
      },
      history_suggestions: {
        type: 'boolean',
        description: 'Show suggestions from history',
        default: true,
        advanced: true
      },
      fzf: {
        type: 'object',
        description: 'FZF integration settings',
        properties: {
          enabled: {
            type: 'string',
            description: 'Enable fzf',
            enum: ['auto', 'true', 'false'],
            default: 'auto',
            advanced: true
          },
          path: {
            type: 'string',
            description: 'Path to fzf binary',
            default: 'auto',
            advanced: true
          },
          install_offer: {
            type: 'boolean',
            description: 'Offer to install fzf if not found',
            default: true,
            advanced: true
          },
          install_path: {
            type: 'string',
            description: 'Where to install fzf',
            default: '~/.fzf',
            advanced: true
          }
        }
      },
      keybindings: {
        type: 'object',
        description: 'Completion keybindings',
        properties: {
          complete: {
            type: 'string',
            description: 'Key for completion',
            default: 'tab',
            advanced: true
          },
          history_search: {
            type: 'string',
            description: 'Key for history search',
            default: 'ctrl-r',
            advanced: true
          },
          ai_complete: {
            type: 'string',
            description: 'Key for AI completion',
            default: 'ctrl-space',
            advanced: true
          }
        }
      }
    }
  },

  // Appearance
  appearance: {
    type: 'object',
    description: 'Appearance settings',
    properties: {
      theme: {
        type: 'string',
        description: 'Display theme',
        enum: ['default', 'minimal', 'verbose'],
        default: 'default',
        prompt: 'Display theme? (default/minimal/verbose)'
      },
      colors: {
        type: 'object',
        description: 'Color settings',
        properties: {
          ai_suggestion: {
            type: 'string',
            description: 'AI suggestion color',
            default: 'cyan',
            advanced: true
          },
          error: {
            type: 'string',
            description: 'Error color',
            default: 'red',
            advanced: true
          },
          success: {
            type: 'string',
            description: 'Success color',
            default: 'green',
            advanced: true
          },
          prompt: {
            type: 'string',
            description: 'Prompt color',
            default: 'yellow',
            advanced: true
          }
        }
      },
      indicators: {
        type: 'object',
        description: 'Status indicators',
        properties: {
          processing: {
            type: 'string',
            description: 'Processing indicator',
            default: '⟳',
            advanced: true
          },
          ai_prefix: {
            type: 'string',
            description: 'AI response prefix',
            default: '✨',
            advanced: true
          },
          error_prefix: {
            type: 'string',
            description: 'Error prefix',
            default: '❌',
            advanced: true
          }
        }
      }
    }
  }
};

/**
 * Get the default configuration based on the schema
 */
export function getDefaultConfig() {
  const config = {};
  
  function extractDefaults(schema, target) {
    for (const [key, value] of Object.entries(schema)) {
      if (value.type === 'object' && value.properties) {
        target[key] = {};
        extractDefaults(value.properties, target[key]);
      } else if (value.default !== undefined) {
        target[key] = value.default;
      }
    }
  }
  
  extractDefaults(CONFIG_SCHEMA, config);
  return config;
}

/**
 * Find all differences between the schema and current config
 */
export function findConfigDifferences(currentConfig, schema = CONFIG_SCHEMA) {
  const differences = [];
  
  function compareSchema(schemaPath, configPath, schemaObj, configObj, path = []) {
    for (const [key, schemaValue] of Object.entries(schemaObj)) {
      const fullPath = [...path, key];
      const configValue = configObj?.[key];
      
      if (schemaValue.internal) {
        continue; // Skip internal fields
      }
      
      if (schemaValue.type === 'object' && schemaValue.properties) {
        // Recurse into nested objects
        if (!configValue || typeof configValue !== 'object') {
          // Entire object is missing
          differences.push({
            path: fullPath,
            type: 'missing',
            schema: schemaValue,
            currentValue: configValue,
            defaultValue: extractObjectDefaults(schemaValue.properties)
          });
        } else {
          compareSchema(schemaValue.properties, configValue, schemaValue.properties, configValue, fullPath);
        }
      } else {
        // Check if value exists and has correct type
        if (configValue === undefined) {
          differences.push({
            path: fullPath,
            type: 'missing',
            schema: schemaValue,
            currentValue: undefined,
            defaultValue: schemaValue.default
          });
        } else if (!validateType(configValue, schemaValue)) {
          differences.push({
            path: fullPath,
            type: 'type_mismatch',
            schema: schemaValue,
            currentValue: configValue,
            defaultValue: schemaValue.default,
            expectedType: schemaValue.type
          });
        } else if (schemaValue.enum && !schemaValue.enum.includes(configValue)) {
          differences.push({
            path: fullPath,
            type: 'invalid_enum',
            schema: schemaValue,
            currentValue: configValue,
            defaultValue: schemaValue.default,
            validValues: schemaValue.enum
          });
        }
      }
    }
  }
  
  compareSchema(schema, currentConfig, schema, currentConfig);
  return differences;
}

function extractObjectDefaults(properties) {
  const defaults = {};
  for (const [key, value] of Object.entries(properties)) {
    if (value.type === 'object' && value.properties) {
      defaults[key] = extractObjectDefaults(value.properties);
    } else if (value.default !== undefined) {
      defaults[key] = value.default;
    }
  }
  return defaults;
}

function validateType(value, schema) {
  switch (schema.type) {
    case 'string':
      return typeof value === 'string';
    case 'number':
      return typeof value === 'number' && !isNaN(value);
    case 'boolean':
      return typeof value === 'boolean';
    case 'array':
      return Array.isArray(value);
    case 'object':
      return value !== null && typeof value === 'object' && !Array.isArray(value);
    default:
      return true;
  }
}

/**
 * Get all configuration options that should be prompted to the user
 */
export function getPromptableOptions(schema = CONFIG_SCHEMA, onlyBasic = true) {
  const options = [];
  
  function collectOptions(schemaObj, path = []) {
    for (const [key, value] of Object.entries(schemaObj)) {
      const fullPath = [...path, key];
      
      if (value.internal) {
        continue; // Skip internal fields
      }
      
      if (value.advanced && onlyBasic) {
        continue; // Skip advanced fields if only showing basic
      }
      
      if (value.type === 'object' && value.properties) {
        // Check if the object itself has a prompt
        if (value.prompt) {
          options.push({
            path: fullPath,
            schema: value,
            prompt: value.prompt
          });
        }
        // Recurse into nested objects
        collectOptions(value.properties, fullPath);
      } else if (value.prompt) {
        options.push({
          path: fullPath,
          schema: value,
          prompt: value.prompt
        });
      }
    }
  }
  
  collectOptions(schema);
  return options;
}

export default CONFIG_SCHEMA;