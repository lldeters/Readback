import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { command, extension } from './helpers';

// A root-level hook runs once before the suites of every file, whatever order Mocha loads the
// files in. It activates the extension (the hidden readback._test.* commands are not contributed,
// so calling them would not activate it) and records the engine state right after activation.
let stateAfterActivation: string | undefined;
suiteSetup(async () => {
  await extension().activate();
  stateAfterActivation = await command<string>('readback._test.engineState');
});

suite('Activation', () => {
  test('activates without starting the engine', () => {
    assert.strictEqual(stateAfterActivation, 'idle');
  });

  test('registers every contributed command', async () => {
    const registered = new Set(await vscode.commands.getCommands(true));
    const contributes = (
      extension().packageJSON as { contributes: { commands: { command: string }[] } }
    ).contributes;
    for (const { command: id } of contributes.commands) {
      assert.ok(registered.has(id), `${id} is not registered`);
    }
  });
});
