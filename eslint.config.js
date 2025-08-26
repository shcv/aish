import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: [
      'node_modules/**',
      'refs/**',
      'examples/**',
      'assets/**'
    ]
  },
  {
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node
      }
    },
    rules: {
      // Styling
      'indent': ['error', 2],
      'quotes': ['error', 'single'],
      'semi': ['error', 'always'],
      'comma-dangle': ['error', 'never'],
      
      // Best practices
      'no-unused-vars': ['error', { 
        'argsIgnorePattern': '^_',
        'varsIgnorePattern': '^_' 
      }],
      'no-console': 'off', // We use console for CLI output
      'prefer-const': 'error',
      'no-var': 'error',
      
      // ES6+
      'arrow-spacing': 'error',
      'object-shorthand': 'error',
      'prefer-template': 'error',
      
      // Spacing
      'space-before-function-paren': ['error', 'never'],
      'keyword-spacing': 'error',
      'space-infix-ops': 'error',
      
      // Line length - be reasonable for terminal apps
      'max-len': ['warn', { 
        'code': 100,
        'ignoreUrls': true,
        'ignoreStrings': true,
        'ignoreTemplateLiterals': true
      }]
    }
  }
];