import * as assert from 'node:assert';
import * as vscode from 'vscode';

suite('Activation', () => {
  test('extension is present', () => {
    assert.ok(vscode.extensions.getExtension('lldeters.readback-code'));
  });
});
