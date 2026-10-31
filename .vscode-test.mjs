// @ts-check
import { defineConfig } from '@vscode/test-cli';

// CI sets VSCODE_TEST_VERSION to the minimum supported version (engines.vscode) or 'stable'.
const version = process.env.VSCODE_TEST_VERSION ?? 'stable';

export default defineConfig({
  tests: [
    {
      label: 'integration',
      files: 'out/test/integration/**/*.test.js',
      version,
      workspaceFolder: './test/fixtures/workspace',
      // A fresh profile without other extensions: exercises the PATH fallback (no Python extension).
      launchArgs: ['--disable-extensions'],
      mocha: { ui: 'tdd', timeout: 30000 },
    },
  ],
});
