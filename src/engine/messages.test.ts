import { describe, expect, it } from 'vitest';
import { EngineStartFailure } from './engineConnection';
import type { EngineStatus } from './engineService';
import type { ResolutionResult } from './interpreter/types';
import { describeAttempt, describeFailure, formatStatus } from './messages';

const resolution: ResolutionResult = {
  trusted: true,
  blockedBySetting: false,
  attempts: [
    { source: 'setting', outcome: { kind: 'skipped', reason: 'notConfigured' } },
    { source: 'pythonExtension', outcome: { kind: 'skipped', reason: 'notInstalled' } },
    {
      source: 'path',
      command: '/usr/bin/python3',
      outcome: {
        kind: 'ok',
        probe: {
          executable: '/usr/bin/python3.12',
          version: [3, 12, 3],
          releaseLevel: 'final',
          implementation: 'cpython',
          platform: 'linux',
          bits64: true,
        },
      },
    },
  ],
  interpreter: {
    candidate: { source: 'path', command: '/usr/bin/python3', prefixArgs: [] },
    probe: {
      executable: '/usr/bin/python3.12',
      version: [3, 12, 3],
      releaseLevel: 'final',
      implementation: 'cpython',
      platform: 'linux',
      bits64: true,
    },
  },
};

const running: EngineStatus = {
  state: 'running',
  trusted: true,
  resolution,
  pid: 4242,
  startupMs: 412.4,
  failure: undefined,
  automaticRestarts: 0,
  engine: {
    engineVersion: '0.0.1',
    protocolVersion: 1,
    schemaVersion: 1,
    python: {
      version: '3.12.3',
      versionInfo: { major: 3, minor: 12, micro: 3, releaseLevel: 'final', serial: 0 },
      implementation: 'cpython',
      executable: '/usr/bin/python3.12',
      platform: 'linux',
    },
    vendored: [
      { name: 'jedi', version: '0.20.1' },
      { name: 'sqlglot', version: '30.27.0' },
    ],
    capabilities: { methods: [] },
    pid: 4242,
    sandboxed: true,
  },
};

describe('formatStatus', () => {
  it('lists interpreter, versions, sandbox, trust and the search', () => {
    expect(formatStatus(running, 3.2).split('\n')).toEqual([
      'State: running (process 4242)',
      'Interpreter: /usr/bin/python3.12 (from PATH)',
      'Python: 3.12.3 (cpython, linux)',
      'Engine: 0.0.1 · protocol 1 · graph schema 1',
      'Bundled packages: jedi 0.20.1, sqlglot 30.27.0',
      'Sandbox: active (no processes, no network)',
      'Workspace: trusted',
      'Startup: 412 ms · ping 3 ms',
      '',
      'Interpreter search:',
      '  · readback.engine.pythonPath – not set',
      '  · Python extension – not installed',
      '  ✓ PATH: /usr/bin/python3 – Python 3.12.3',
    ]);
  });

  it('shows Restricted Mode and the problem when the engine failed', () => {
    const text = formatStatus({
      ...running,
      state: 'failed',
      trusted: false,
      engine: undefined,
      pid: undefined,
      startupMs: undefined,
      failure: { kind: 'noInterpreter', resolution },
    });
    expect(text).toContain('State: failed');
    expect(text).toContain('Workspace: Restricted Mode');
    expect(text).toContain(
      'Problem: Readback needs Python 3.10 or newer, but no suitable interpreter was found.',
    );
  });
});

describe('formatStatus with a failed ping', () => {
  it('reports an engine that does not answer instead of a healthy status', async () => {
    const { EngineRequestFailure } = await import('./engineConnection');
    const text = formatStatus(running, undefined, new EngineRequestFailure('timeout', 'x'));
    expect(text).toContain('Ping: failed (no answer in time)');
    expect(text).toContain('Problem: The Readback engine does not respond.');
  });
});

describe('describeFailure', () => {
  it('explains an unusable setting with the reason', () => {
    expect(
      describeFailure({
        kind: 'settingUnusable',
        resolution: {
          ...resolution,
          interpreter: undefined,
          blockedBySetting: true,
          attempts: [
            {
              source: 'setting',
              command: '/work/.venv/bin/python',
              scope: 'user',
              outcome: { kind: 'failed', reason: 'insideWorkspace' },
            },
          ],
        },
      }),
    ).toBe(
      'The interpreter in readback.engine.pythonPath (user settings) cannot be used: rejected: lies inside the untrusted workspace.',
    );
  });

  it('reports a too old Python with its version', () => {
    expect(
      describeFailure({
        kind: 'start',
        resolution,
        error: new EngineStartFailure('pythonTooOld', 'old', undefined, {
          code: 'python-too-old',
          version: '3.9.6',
          required: '3.10',
        }),
      }),
    ).toBe('Python 3.9.6 is too old for Readback. Python 3.10 or newer is required.');
  });
});

describe('describeAttempt', () => {
  it('marks failures and names the command', () => {
    expect(
      describeAttempt({
        source: 'path',
        command: '/usr/bin/python3',
        outcome: { kind: 'failed', reason: 'tooOld', detail: '3.8.10' },
      }),
    ).toBe('· PATH: /usr/bin/python3 – Python 3.8.10 is too old (needs 3.10 or newer)');
  });
});
