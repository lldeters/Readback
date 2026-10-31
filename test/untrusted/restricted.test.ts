// Runs in a VS Code instance that opened an untrusted workspace (Restricted Mode). The workspace
// contains a fake interpreter that writes a marker file when executed; it must never run.
import * as assert from 'node:assert';
import { existsSync } from 'node:fs';
import * as vscode from 'vscode';
import { command, extension, type Resolution, type Status } from '../integration/helpers';

function required(name: string): string {
  const value = process.env[name];
  assert.ok(value, `${name} is not set; run this suite through scripts/test-untrusted.mjs`);
  return value;
}

const marker = required('READBACK_UNTRUSTED_MARKER');
const workspaceFolder = required('READBACK_UNTRUSTED_WORKSPACE');
const fakeInterpreter = required('READBACK_FAKE_INTERPRETER');

suite('Restricted Mode', function () {
  this.timeout(60_000);

  // The hidden readback._test.* commands are not contributed, so they do not activate the extension.
  suiteSetup(async () => {
    await extension().activate();
  });

  test('the workspace is not trusted', () => {
    assert.strictEqual(vscode.workspace.isTrusted, false);
  });

  test('ignores readback.engine.pythonPath from the workspace settings', () => {
    const config = vscode.workspace.getConfiguration('readback');
    assert.strictEqual(config.get('engine.pythonPath'), '');
    assert.strictEqual(config.inspect('engine.pythonPath')?.workspaceValue, undefined);
  });

  test('skips the Python extension and uses an interpreter outside the workspace', async () => {
    const result = await command<Resolution>('readback._test.resolveInterpreter');
    assert.strictEqual(result.trusted, false);
    const extensionAttempt = result.attempts.find(
      (attempt) => attempt.source === 'pythonExtension',
    );
    assert.deepStrictEqual(extensionAttempt?.outcome, {
      kind: 'skipped',
      reason: 'untrustedWorkspace',
    });
    assert.ok(result.interpreter, JSON.stringify(result.attempts, undefined, 2));
    assert.ok(!result.interpreter.probe.executable.startsWith(workspaceFolder));
  });

  test('rejects a user-level interpreter path that points into the workspace', async () => {
    const config = vscode.workspace.getConfiguration('readback');
    await config.update('engine.pythonPath', fakeInterpreter, vscode.ConfigurationTarget.Global);
    try {
      const result = await command<Resolution>('readback._test.resolveInterpreter');
      assert.strictEqual(result.interpreter, undefined);
      assert.strictEqual(result.blockedBySetting, true);
      assert.deepStrictEqual(result.attempts.at(-1)?.outcome, {
        kind: 'failed',
        reason: 'insideWorkspace',
      });
    } finally {
      await config.update('engine.pythonPath', undefined, vscode.ConfigurationTarget.Global);
    }
  });

  test('the engine still runs, sandboxed', async () => {
    const status = await command<Status>('readback._test.engineStatus');
    assert.strictEqual(status.state, 'running', JSON.stringify(status.failure));
    assert.strictEqual(status.trusted, false);
    assert.strictEqual(status.engine?.sandboxed, true);
  });

  test('the interpreter inside the workspace was never executed', () => {
    assert.strictEqual(existsSync(marker), false);
  });
});
