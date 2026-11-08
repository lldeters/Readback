import { Ajv2020 } from 'ajv/dist/2020';
import * as assert from 'node:assert';
import * as vscode from 'vscode';
import protocolSchema from '../../shared/engine-protocol.schema.json';
import { command, packageVersion, type Resolution, type Status } from './helpers';

const validateInitializeResult = (() => {
  const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
  ajv.addSchema(protocolSchema);
  const validate = ajv.getSchema(`${protocolSchema.$id}#/$defs/InitializeResult`);
  assert.ok(validate);
  return validate;
})();

suite('Engine', function () {
  this.timeout(60_000);

  test('finds an interpreter on PATH without the Python extension', async () => {
    const result = await command<Resolution>('hearback._test.resolveInterpreter');
    assert.ok(result.interpreter, JSON.stringify(result.attempts, undefined, 2));
    assert.strictEqual(result.interpreter.candidate.source, 'path');
    const [major = 0, minor = 0] = result.interpreter.probe.version;
    assert.ok(
      major > 3 || (major === 3 && minor >= 10),
      `Python ${String(major)}.${String(minor)}`,
    );
    const extensionAttempt = result.attempts.find(
      (attempt) => attempt.source === 'pythonExtension',
    );
    assert.deepStrictEqual(extensionAttempt?.outcome, { kind: 'skipped', reason: 'notInstalled' });
  });

  test('starts the engine on first use and reports its status', async () => {
    const status = await command<Status>('hearback._test.engineStatus');
    assert.strictEqual(status.state, 'running', JSON.stringify(status.failure));
    assert.ok(status.engine);
    assert.ok(
      validateInitializeResult(status.engine),
      JSON.stringify(validateInitializeResult.errors),
    );
    assert.strictEqual(status.engine.engineVersion, packageVersion());
    assert.strictEqual(status.engine.protocolVersion, 2);
    assert.strictEqual(status.engine.schemaVersion, 2);
    assert.strictEqual(status.engine.sandboxed, true);
    assert.strictEqual(typeof status.pingMs, 'number');
    // CI vendors the packages before the tests; a plain checkout may not have them yet.
    const names = status.engine.vendored.map((pkg) => pkg.name);
    if (names.length > 0) {
      assert.deepStrictEqual(names, ['jedi', 'parso', 'sqlglot']);
    }
  });

  test('restarts with a new process', async () => {
    const before = await command<Status>('hearback._test.engineStatus');
    const after = await command<Status>('hearback._test.restartEngine');
    assert.strictEqual(after.state, 'running', JSON.stringify(after.failure));
    assert.notStrictEqual(after.pid, before.pid);
  });

  test('stops on an unusable interpreter setting instead of falling back', async () => {
    const config = vscode.workspace.getConfiguration('hearback');
    await config.update(
      'engine.pythonPath',
      '/definitely/not/a/python',
      vscode.ConfigurationTarget.Global,
    );
    try {
      const status = await command<Status>('hearback._test.restartEngine');
      assert.strictEqual(status.state, 'failed');
      assert.strictEqual(status.failure?.kind, 'settingUnusable');
    } finally {
      await config.update('engine.pythonPath', undefined, vscode.ConfigurationTarget.Global);
    }
    const recovered = await command<Status>('hearback._test.restartEngine');
    assert.strictEqual(recovered.state, 'running', JSON.stringify(recovered.failure));
  });
});
