// @ts-check
// Runs test/untrusted inside VS Code with Workspace Trust enabled and an untrusted workspace.
// @vscode/test-electron's runTests() always adds --disable-workspace-trust, so this script
// downloads VS Code through test-electron but launches it itself. POSIX only (the fake
// interpreter is a shell script); CI runs it on Linux under xvfb-run.
//   npm run test:untrusted            (VSCODE_TEST_VERSION selects the VS Code version)
import { downloadAndUnzipVSCode } from '@vscode/test-electron';
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform === 'win32') {
  console.error('test-untrusted runs on Linux and macOS only.');
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testsEntry = path.join(root, 'out', 'test', 'untrusted', 'index.js');
if (!existsSync(testsEntry)) {
  console.error('Missing out/test/untrusted; run "node esbuild.mjs --tests" first.');
  process.exit(1);
}

const version = process.env.VSCODE_TEST_VERSION ?? 'stable';
const executable = await downloadAndUnzipVSCode({
  version,
  cachePath: path.join(root, '.vscode-test'),
});

const sandbox = await mkdtemp(path.join(os.tmpdir(), 'hearback-untrusted-'));
const workspace = path.join(sandbox, 'workspace');
const userData = path.join(sandbox, 'user-data');
const extensions = path.join(sandbox, 'extensions');
const marker = path.join(sandbox, 'workspace-interpreter-was-executed');
const fakeInterpreter = path.join(workspace, '.venv', 'bin', 'python');

await mkdir(path.dirname(fakeInterpreter), { recursive: true });
await writeFile(
  fakeInterpreter,
  `#!/bin/sh\necho executed > ${JSON.stringify(marker)}\nexit 1\n`,
  'utf8',
);
await chmod(fakeInterpreter, 0o755);
await mkdir(path.join(workspace, '.vscode'), { recursive: true });
await writeFile(
  path.join(workspace, '.vscode', 'settings.json'),
  JSON.stringify({ 'hearback.engine.pythonPath': fakeInterpreter }, undefined, 2),
);
await writeFile(path.join(workspace, 'sample.py'), 'print("untrusted")\n');
await mkdir(path.join(userData, 'User'), { recursive: true });
await writeFile(
  path.join(userData, 'User', 'settings.json'),
  JSON.stringify(
    {
      'security.workspace.trust.enabled': true,
      'security.workspace.trust.startupPrompt': 'never',
      'security.workspace.trust.banner': 'never',
      'telemetry.telemetryLevel': 'off',
      'update.mode': 'none',
      'extensions.autoUpdate': false,
      'extensions.autoCheckUpdates': false,
    },
    undefined,
    2,
  ),
);

const args = [
  '--no-sandbox',
  '--disable-gpu-sandbox',
  '--disable-updates',
  '--skip-welcome',
  '--skip-release-notes',
  '--disable-extensions',
  `--user-data-dir=${userData}`,
  `--extensions-dir=${extensions}`,
  `--extensionDevelopmentPath=${root}`,
  `--extensionTestsPath=${testsEntry}`,
  workspace,
];

console.log(`Running Restricted Mode tests with VS Code ${version} in ${sandbox}`);
const exitCode = await new Promise((resolve) => {
  const child = spawn(executable, args, {
    stdio: 'inherit',
    env: {
      ...process.env,
      HEARBACK_UNTRUSTED_MARKER: marker,
      HEARBACK_UNTRUSTED_WORKSPACE: workspace,
      HEARBACK_FAKE_INTERPRETER: fakeInterpreter,
    },
  });
  child.on('error', (error) => {
    console.error(error);
    resolve(1);
  });
  child.on('exit', (code, signal) => {
    resolve(code ?? (signal ? 1 : 0));
  });
});

const executed = existsSync(marker);
await rm(sandbox, { recursive: true, force: true });
if (executed) {
  console.error('The interpreter inside the untrusted workspace was executed.');
  process.exit(1);
}
process.exit(Number(exitCode));
