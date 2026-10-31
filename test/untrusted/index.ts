// Mocha entry for scripts/test-untrusted.mjs (--extensionTestsPath). @vscode/test-cli is not used
// here because @vscode/test-electron always launches VS Code with --disable-workspace-trust.
import Mocha from 'mocha';
import path from 'node:path';

export function run(): Promise<void> {
  const mocha = new Mocha({ ui: 'tdd', timeout: 60_000, color: true });
  mocha.addFile(path.join(__dirname, 'restricted.test.js'));
  return new Promise((resolve, reject) => {
    mocha.run((failures) => {
      if (failures > 0) {
        reject(new Error(`${String(failures)} Restricted Mode test(s) failed.`));
      } else {
        resolve();
      }
    });
  });
}
