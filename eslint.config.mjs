// @ts-check
import eslint from '@eslint/js';
import { defineConfig } from 'eslint/config';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

export default defineConfig([
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  react.configs.flat.recommended,
  reactHooks.configs.flat.recommended,
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
    },
    settings: {
      react: {
        version: 'detect',
      },
    },
    rules: {
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
        },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/explicit-module-boundary-types': 'off',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/purity': 'off',
      'react-hooks/preserve-manual-memoization': 'off',
    },
  },
  {
    files: ['**/*.js', '**/*.jsx'],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: ['e2e/fixtures/*.mjs'],
    languageOptions: {
      globals: {
        AbortSignal: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        fetch: 'readonly',
        process: 'readonly',
      },
    },
  },
  {
    files: [
      'app/api/cleanup-cache/route.ts',
      'app/api/auth/**/*.ts',
      'app/api/audit-logs/**/*.ts',
      'app/api/enterprise/**/*.ts',
      'app/api/export/route.ts',
      'app/api/image-proxy/route.ts',
      'app/api/screenshot/**/*.ts',
      'lib/api/**/*.ts',
      'lib/audit/**/*.ts',
      'lib/auth/**/*.ts',
      'lib/rate-limit.ts',
      'lib/redis.ts',
      'lib/screenshot-cache.ts',
      'lib/screenshot-service.ts',
      'lib/storage/**/*.ts',
    ],
    rules: {
      complexity: ['error', 10],
      'max-depth': ['error', 3],
      'max-lines': ['error', { max: 300, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': ['error', { max: 40, skipBlankLines: true, skipComments: true }],
      'max-params': ['error', 4],
    },
  },
  // The vendored Plate.js editor (packages/platejs-editor/UPSTREAM.md) keeps
  // its upstream source unformatted and unedited. These rules flag Plate's own
  // conventions there: hyperscript node props, forwardRef components, and the
  // latest-value ref pattern. Code the fork writes in the package still gets
  // every other rule.
  {
    files: ['packages/platejs-editor/**/*.{ts,tsx}'],
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    rules: {
      'react/display-name': 'off',
      'react/no-unescaped-entities': 'off',
      'react/no-unknown-property': 'off',
      'react-hooks/exhaustive-deps': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/unsupported-syntax': 'off',
      '@typescript-eslint/no-empty-object-type': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { args: 'none', ignoreRestSiblings: true, varsIgnorePattern: '^_' }],
      '@typescript-eslint/triple-slash-reference': 'off',
    },
  },
  {
    ignores: [
      'node_modules/**',
      '.context/**',
      '.local/**',
      '.next/**',
      'out/**',
      'build/**',
      'dist/**',
      'packages/*/dist/**',
      '*.config.js',
      '*.config.mjs',
      '*.config.ts',
      'public/**',
      '.vercel/**',
      'coverage/**',
      'services/screenshot-studio-backend/internal/helpers/testdata/**',
      'scripts/**',
      '*.tsbuildinfo',
      'next-env.d.ts',
    ],
  },
]);
