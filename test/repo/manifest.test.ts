// Manifest rules from the spec: lazy activation, restricted mode, remote placement, naming.
import { describe, expect, it } from 'vitest';
import { asRecord, readJson } from './helpers';

const manifest = asRecord(readJson('package.json'));
const contributes = asRecord(manifest.contributes);

describe('package.json', () => {
  it('never activates eagerly (spec 8: no engine start, no * activation)', () => {
    const events = manifest.activationEvents as string[];
    for (const event of events) {
      expect(event).not.toBe('*');
      expect(event).not.toBe('onStartupFinished');
      expect(event).toMatch(/^(onCommand|onView|onLanguage|onWebviewPanel):/);
    }
  });

  it('runs where the code lives', () => {
    expect(manifest.extensionKind).toEqual(['workspace']);
  });

  it('restricts the interpreter path in untrusted workspaces', () => {
    const trust = asRecord(asRecord(manifest.capabilities).untrustedWorkspaces);
    expect(trust.supported).toBe('limited');
    expect(trust.restrictedConfigurations).toContain('readback.engine.pythonPath');
  });

  it('contributes only readback.* commands in the Readback category', () => {
    for (const command of contributes.commands as Record<string, unknown>[]) {
      expect(command.command).toMatch(/^readback\.[a-zA-Z]+$/);
      expect(command.category).toBe('Readback');
      expect(command.title).toMatch(/^%command\.[a-zA-Z]+\.title%$/);
    }
  });

  it('contributes only readback.* settings with localized descriptions', () => {
    const properties = asRecord(asRecord(contributes.configuration).properties);
    for (const [key, value] of Object.entries(properties)) {
      expect(key).toMatch(/^readback\./);
      expect(asRecord(value).markdownDescription).toMatch(/^%config\.[\w.]+%$/);
    }
  });

  it('does not hard-depend on other extensions (spec 2.5)', () => {
    expect(manifest.extensionDependencies).toBeUndefined();
    expect(manifest.extensionPack).toBeUndefined();
  });
});
