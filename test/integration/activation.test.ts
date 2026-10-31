import * as assert from 'node:assert';
import * as vscode from 'vscode';
import { command, extension } from './helpers';

suite('Activation', () => {
  test('activates without starting the engine', async () => {
    await extension().activate();
    assert.strictEqual(await command<string>('readback._test.engineState'), 'idle');
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
