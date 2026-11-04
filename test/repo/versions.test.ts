// Versions and protocol constants that live in more than one place must agree.
import { describe, expect, it } from 'vitest';
import { MIN_PYTHON, PROTOCOL_VERSION } from '../../src/engine/protocol';
import { asRecord, readJson, readText } from './helpers';

const manifest = asRecord(readJson('package.json'));
const engineInit = readText('engine/hearback_engine/__init__.py');

function pythonConstant(name: string): string {
  const match = new RegExp(`^${name}\\s*=\\s*(.+)$`, 'm').exec(engineInit);
  if (!match?.[1]) {
    throw new Error(`${name} not found in engine/hearback_engine/__init__.py`);
  }
  return match[1].trim();
}

describe('version consistency', () => {
  it('engine version equals the extension version', () => {
    expect(pythonConstant('ENGINE_VERSION')).toBe(`"${String(manifest.version)}"`);
  });

  it('engine/pyproject.toml version equals the extension version', () => {
    const match = /^version\s*=\s*"([^"]+)"/m.exec(readText('engine/pyproject.toml'));
    expect(match?.[1]).toBe(manifest.version);
  });

  it('protocol version matches between TypeScript and Python', () => {
    expect(Number(pythonConstant('PROTOCOL_VERSION'))).toBe(PROTOCOL_VERSION);
  });

  it('graph schema version matches the engine', () => {
    const schema = asRecord(readJson('shared/graph-schema.json'));
    const schemaVersion = asRecord(asRecord(schema.properties).schemaVersion).const;
    expect(Number(pythonConstant('SCHEMA_VERSION'))).toBe(schemaVersion);
  });

  it('minimum Python matches', () => {
    expect(pythonConstant('MIN_PYTHON')).toBe(`(${MIN_PYTHON.major}, ${MIN_PYTHON.minor})`);
  });

  it('@types/vscode is pinned to the minimum engines.vscode version', () => {
    const engines = asRecord(manifest.engines);
    const devDependencies = asRecord(manifest.devDependencies);
    expect(`^${String(devDependencies['@types/vscode'])}`).toBe(engines.vscode);
  });
});
