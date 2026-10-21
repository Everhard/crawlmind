import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: { globals: globals.node },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-console': 'error',
    },
  },
  {
    files: ['scripts/**/*.mjs'],
    rules: { 'no-console': 'off' },
  },
  {
    // The engine must stay usable without MCP or the CLI.
    files: ['packages/crawlmind/src/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@modelcontextprotocol/*'],
              message: 'core/ must not depend on the MCP SDK.',
            },
            {
              group: ['**/mcp/**', '**/cli/**'],
              message: 'core/ must not import the MCP or CLI layers.',
            },
            {
              group: ['commander', 'picocolors', 'ora', 'cli-table3'],
              message: 'core/ must not depend on CLI libraries.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['packages/crawlmind/src/mcp/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['**/cli/**'], message: 'mcp/ must not import cli/.' }] },
      ],
    },
  },
  {
    files: ['packages/crawlmind/src/cli/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/mcp/**'],
              message: 'cli/ must not import mcp/; src/cli.ts injects the MCP runner.',
            },
          ],
        },
      ],
    },
  },
);
