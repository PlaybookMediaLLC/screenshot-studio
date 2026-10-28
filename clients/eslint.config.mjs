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
    // Zapier's native runtime loads CommonJS modules.
    files: ['integrations/zapier/**/*.js'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { Buffer: 'readonly', URL: 'readonly' },
    },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    // Browser specs are written one way (apps/web/test/e2e/README.md): one
    // import, state from the framework's fixtures, and waits on state, not time.
    files: ['apps/web/test/e2e/*.spec.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@playwright/test'],
              message: 'Import test, expect and Playwright types from ./framework.',
            },
            {
              group: ['./framework/*'],
              message: 'Import from ./framework, the one entry point.',
            },
          ],
        },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.property.name='waitForTimeout']",
          message:
            'Wait for a state, not a time. A deliberate window needs an eslint-disable comment that says why.',
        },
        {
          selector: "Literal[value='networkidle']",
          message: 'networkidle never settles on a live app. Wait for what the person sees.',
        },
        {
          selector:
            "CallExpression[callee.property.name=/^(check|click|dblclick|dragTo|fill|hover|press|selectOption|setChecked|tap|uncheck)$/] Property[key.name='force'][value.value=true]",
          message: 'force skips the checks a real click makes. Wait until the control can be used.',
        },
        {
          selector: "CallExpression[callee.object.name='test'][callee.property.name='slow']",
          message: "Tag a long test { tag: '@journey' } instead.",
        },
      ],
    },
  },
  {
    files: ['apps/web/test/e2e/fixtures/*.mjs'],
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
      'apps/web/app/api/cleanup-cache/route.ts',
      'apps/web/app/api/auth/**/*.ts',
      'apps/web/app/api/audit-logs/**/*.ts',
      'apps/web/app/api/enterprise/**/*.ts',
      'apps/web/app/api/export/route.ts',
      'apps/web/app/api/image-proxy/route.ts',
      'apps/web/app/api/screenshot/**/*.ts',
      'apps/web/lib/api/**/*.ts',
      'apps/web/lib/audit/**/*.ts',
      'apps/web/lib/auth/**/*.ts',
      'apps/web/lib/rate-limit.ts',
      'apps/web/lib/redis.ts',
      'apps/web/lib/screenshot-cache.ts',
      'apps/web/lib/screenshot-service.ts',
      'apps/web/lib/storage/**/*.ts',
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
      'apps/web/.next/**',
      'apps/web/out/**',
      'apps/web/build/**',
      'packages/*/dist/**',
      '*.config.js',
      '*.config.mjs',
      'apps/web/*.config.js',
      'apps/web/*.config.mjs',
      'apps/web/*.config.ts',
      'apps/web/public/**',
      'apps/web/.vercel/**',
      'apps/web/coverage/**',
      'apps/web/scripts/**',
      '**/*.tsbuildinfo',
      'apps/web/next-env.d.ts',
      'integrations/raycast/raycast-env.d.ts',
    ],
  },
]);
