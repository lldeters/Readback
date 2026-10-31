// @ts-check
import js from '@eslint/js';
import prettier from 'eslint-config-prettier/flat';
import reactHooks from 'eslint-plugin-react-hooks';
import { defineConfig, globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

const TEXT_ONLY = 'Render identifiers from analysed code as text only (spec 5.5).';

export default defineConfig(
  globalIgnores([
    'dist/',
    'out/',
    'coverage/',
    '.vscode-test/',
    '.vitest/',
    '.cache/',
    'engine/',
    'node_modules/',
  ]),
  js.configs.recommended,
  {
    rules: {
      'no-eval': 'error',
      'no-new-func': 'error',
    },
  },
  {
    files: ['**/*.{ts,tsx,mts}'],
    extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ['vitest.config.mts'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['webview/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended],
    languageOptions: { globals: globals.browser },
    rules: {
      'no-restricted-syntax': [
        'error',
        { selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']", message: TEXT_ONLY },
        {
          selector: 'MemberExpression[property.name=/^(innerHTML|outerHTML)$/]',
          message: TEXT_ONLY,
        },
        {
          selector: "CallExpression[callee.property.name='insertAdjacentHTML']",
          message: TEXT_ONLY,
        },
        {
          selector: "CallExpression[callee.property.name='write'][callee.object.name='document']",
          message: TEXT_ONLY,
        },
      ],
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: { globals: globals.node },
  },
  prettier,
);
