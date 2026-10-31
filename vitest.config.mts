import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// The 'vscode' module only exists inside the extension host. Unit tests get a small stub that
// individual tests can extend with vi.mock('vscode', ...).
const vscodeStub = fileURLToPath(new URL('./test/stubs/vscode.ts', import.meta.url));

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias: { vscode: vscodeStub } },
        test: {
          name: 'extension',
          include: ['src/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'webview',
          include: ['webview/**/*.test.{ts,tsx}'],
          environment: 'jsdom',
          setupFiles: ['webview/test/setup.ts'],
        },
      },
      {
        test: {
          name: 'repo',
          include: ['test/repo/**/*.test.ts'],
          environment: 'node',
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'webview/src/**/*.{ts,tsx}', 'webview/worker/**/*.ts'],
      exclude: ['**/*.test.{ts,tsx}', 'src/shared/generated/**'],
      reporter: ['text', 'lcov'],
    },
  },
});
