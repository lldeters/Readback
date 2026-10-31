import { describe, expect, it } from 'vitest';
import type { PathLookup, PathSearchResult } from './pathSearch';
import {
  expandSettingPath,
  resolveInterpreter,
  type PythonExtensionLookup,
  type ResolveContext,
  type SettingLookup,
} from './resolve';
import type { AttemptOutcome, InterpreterCandidate, PythonProbe } from './types';

function probeOf(executable: string, version: [number, number, number] = [3, 12, 3]): PythonProbe {
  return {
    executable,
    version,
    releaseLevel: 'final',
    implementation: 'cpython',
    platform: 'linux',
    bits64: true,
  };
}

interface Fixture {
  setting?: SettingLookup;
  pythonExtension?: PythonExtensionLookup;
  path?: PathSearchResult;
  onPath?: Record<string, PathLookup>;
  probes?: Record<string, AttemptOutcome>;
  realpaths?: Record<string, string>;
  trusted?: boolean;
  platform?: NodeJS.Platform;
}

function context(fixture: Fixture): ResolveContext & { probed: InterpreterCandidate[] } {
  const probed: InterpreterCandidate[] = [];
  return {
    probed,
    platform: fixture.platform ?? 'linux',
    trusted: fixture.trusted ?? true,
    workspaceFolders: ['/work/repo'],
    homeDirectory: '/home/dev',
    readSetting: () => Promise.resolve(fixture.setting ?? { value: undefined, scope: undefined }),
    pythonExtension: () => Promise.resolve(fixture.pythonExtension ?? { kind: 'notInstalled' }),
    searchPath: () => Promise.resolve(fixture.path ?? { candidates: [], skipped: [] }),
    findOnPath: (name) => Promise.resolve(fixture.onPath?.[name] ?? { kind: 'missing' }),
    probe: (candidate) => {
      probed.push(candidate);
      return Promise.resolve(
        fixture.probes?.[candidate.command] ?? { kind: 'failed', reason: 'notFound' },
      );
    },
    realpath: (path) => Promise.resolve(fixture.realpaths?.[path] ?? path),
  };
}

const ok = (executable: string): AttemptOutcome => ({ kind: 'ok', probe: probeOf(executable) });

describe('resolveInterpreter', () => {
  it('prefers the setting', async () => {
    const result = await resolveInterpreter(
      context({
        setting: { value: '/opt/py/bin/python3', scope: 'user' },
        pythonExtension: { kind: 'found', executable: '/venv/bin/python' },
        probes: { '/opt/py/bin/python3': ok('/opt/py/bin/python3.12') },
      }),
    );
    expect(result.interpreter?.candidate.source).toBe('setting');
    expect(result.interpreter?.probe.executable).toBe('/opt/py/bin/python3.12');
  });

  it('does not fall back when the explicit setting is unusable', async () => {
    const ctx = context({
      setting: { value: '/missing/python', scope: 'user' },
      path: { candidates: [{ command: '/usr/bin/python3', prefixArgs: [] }], skipped: [] },
      probes: { '/usr/bin/python3': ok('/usr/bin/python3') },
    });
    const result = await resolveInterpreter(ctx);
    expect(result.interpreter).toBeUndefined();
    expect(result.blockedBySetting).toBe(true);
    expect(ctx.probed.map((c) => c.command)).toEqual(['/missing/python']);
  });

  it('uses the Python extension next, then PATH', async () => {
    const extension = await resolveInterpreter(
      context({
        pythonExtension: { kind: 'found', executable: '/work/repo/.venv/bin/python' },
        probes: { '/work/repo/.venv/bin/python': ok('/work/repo/.venv/bin/python') },
      }),
    );
    expect(extension.interpreter?.candidate.source).toBe('pythonExtension');

    const path = await resolveInterpreter(
      context({
        pythonExtension: { kind: 'noEnvironment' },
        path: {
          candidates: [
            { command: '/usr/bin/python3', prefixArgs: [] },
            { command: '/usr/local/bin/python', prefixArgs: [] },
          ],
          skipped: [],
        },
        probes: {
          '/usr/bin/python3': {
            kind: 'failed',
            reason: 'tooOld',
            detail: '3.8.10',
          },
          '/usr/local/bin/python': ok('/usr/local/bin/python3.13'),
        },
      }),
    );
    expect(path.interpreter?.candidate).toEqual({
      source: 'path',
      command: '/usr/local/bin/python',
      prefixArgs: [],
    });
    expect(path.attempts.map((a) => [a.source, a.outcome.kind])).toEqual([
      ['setting', 'skipped'],
      ['pythonExtension', 'skipped'],
      ['path', 'failed'],
      ['path', 'ok'],
    ]);
  });

  it('falls back to PATH when the Python extension interpreter fails', async () => {
    const result = await resolveInterpreter(
      context({
        pythonExtension: { kind: 'found', executable: '/old/python' },
        path: { candidates: [{ command: '/usr/bin/python3', prefixArgs: [] }], skipped: [] },
        probes: {
          '/old/python': { kind: 'failed', reason: 'tooOld', detail: '3.9.6' },
          '/usr/bin/python3': ok('/usr/bin/python3'),
        },
      }),
    );
    expect(result.interpreter?.candidate.source).toBe('path');
  });

  it('reports when nothing is found', async () => {
    const result = await resolveInterpreter(context({}));
    expect(result.interpreter).toBeUndefined();
    expect(result.blockedBySetting).toBe(false);
    expect(result.attempts.at(-1)).toEqual({
      source: 'path',
      outcome: { kind: 'skipped', reason: 'notFound' },
    });
  });

  describe('Restricted Mode', () => {
    it('skips the Python extension', async () => {
      const ctx = context({
        trusted: false,
        pythonExtension: { kind: 'found', executable: '/usr/bin/python3' },
        path: { candidates: [{ command: '/usr/bin/python3', prefixArgs: [] }], skipped: [] },
        probes: { '/usr/bin/python3': ok('/usr/bin/python3') },
      });
      const result = await resolveInterpreter(ctx);
      expect(result.attempts[1]).toEqual({
        source: 'pythonExtension',
        outcome: { kind: 'skipped', reason: 'untrustedWorkspace' },
      });
      expect(result.interpreter?.candidate.source).toBe('path');
    });

    it('never runs a user-level interpreter inside the workspace', async () => {
      const ctx = context({
        trusted: false,
        setting: { value: '/work/repo/.venv/bin/python', scope: 'user' },
      });
      const result = await resolveInterpreter(ctx);
      expect(result.interpreter).toBeUndefined();
      expect(result.blockedBySetting).toBe(true);
      expect(result.attempts.at(-1)?.outcome).toEqual({
        kind: 'failed',
        reason: 'insideWorkspace',
      });
      expect(ctx.probed).toEqual([]);
    });

    it('checks the real path, so symlinks out of the workspace do not help', async () => {
      const ctx = context({
        trusted: false,
        setting: { value: '/tmp/innocent-python', scope: 'user' },
        realpaths: { '/tmp/innocent-python': '/work/repo/tools/python' },
      });
      const result = await resolveInterpreter(ctx);
      expect(result.attempts.at(-1)?.outcome).toEqual({
        kind: 'failed',
        reason: 'insideWorkspace',
      });
      expect(ctx.probed).toEqual([]);
    });

    it('records interpreters on PATH that were skipped inside the workspace', async () => {
      const result = await resolveInterpreter(
        context({
          trusted: false,
          path: {
            candidates: [{ command: '/usr/bin/python3', prefixArgs: [] }],
            skipped: [{ command: '/work/repo/bin/python', reason: 'insideWorkspace' }],
          },
          probes: { '/usr/bin/python3': ok('/usr/bin/python3') },
        }),
      );
      expect(result.attempts).toContainEqual({
        source: 'path',
        command: '/work/repo/bin/python',
        outcome: { kind: 'skipped', reason: 'insideWorkspace' },
      });
      expect(result.interpreter?.candidate.command).toBe('/usr/bin/python3');
    });
  });

  it('records a declined workspace value and continues with the user value', async () => {
    const result = await resolveInterpreter(
      context({
        setting: {
          value: '/opt/python',
          scope: 'user',
          declinedWorkspaceValue: './evil/python',
        },
        probes: { '/opt/python': ok('/opt/python') },
      }),
    );
    expect(result.attempts[0]).toEqual({
      source: 'setting',
      command: './evil/python',
      scope: 'workspace',
      outcome: { kind: 'skipped', reason: 'declined' },
    });
    expect(result.attempts[1]).toMatchObject({ source: 'setting', scope: 'user' });
    expect(result.interpreter?.candidate.command).toBe('/opt/python');
  });

  it('looks up bare command names on PATH', async () => {
    const result = await resolveInterpreter(
      context({
        setting: { value: 'python3.12', scope: 'user' },
        onPath: {
          'python3.12': {
            kind: 'found',
            command: '/usr/bin/python3.12',
            realpath: '/usr/bin/python3.12',
          },
        },
        probes: { '/usr/bin/python3.12': ok('/usr/bin/python3.12') },
      }),
    );
    expect(result.interpreter?.candidate.command).toBe('/usr/bin/python3.12');
  });

  it('blocks bare command names that resolve inside an untrusted workspace', async () => {
    const result = await resolveInterpreter(
      context({
        trusted: false,
        setting: { value: 'python', scope: 'user' },
        onPath: {
          python: {
            kind: 'skipped',
            skip: { command: '/work/repo/python', reason: 'insideWorkspace' },
          },
        },
      }),
    );
    expect(result.blockedBySetting).toBe(true);
    expect(result.attempts.at(-1)?.outcome).toEqual({ kind: 'failed', reason: 'insideWorkspace' });
  });

  it('passes the py launcher prefix through to the probe', async () => {
    const ctx = context({
      platform: 'win32',
      path: { candidates: [{ command: 'C:\\Windows\\py.exe', prefixArgs: ['-3'] }], skipped: [] },
      probes: { 'C:\\Windows\\py.exe': ok('C:\\Python313\\python.exe') },
    });
    const result = await resolveInterpreter(ctx);
    expect(ctx.probed[0]?.prefixArgs).toEqual(['-3']);
    // The engine is spawned with sys.executable, never through the launcher.
    expect(result.interpreter?.probe.executable).toBe('C:\\Python313\\python.exe');
  });
});

describe('expandSettingPath', () => {
  const base = {
    platform: 'linux' as const,
    trusted: true,
    workspaceFolders: ['/work/repo'],
    homeDirectory: '/home/dev',
  };

  it('expands home and variables', () => {
    expect(expandSettingPath('~/py/bin/python', base)).toEqual({
      kind: 'path',
      path: '/home/dev/py/bin/python',
    });
    expect(expandSettingPath('${userHome}/py/bin/python', base)).toEqual({
      kind: 'path',
      path: '/home/dev/py/bin/python',
    });
    expect(expandSettingPath('${workspaceFolder}/.venv/bin/python', base)).toEqual({
      kind: 'path',
      path: '/work/repo/.venv/bin/python',
    });
  });

  it('resolves relative paths only in trusted workspaces', () => {
    expect(expandSettingPath('.venv/bin/python', base)).toEqual({
      kind: 'path',
      path: '/work/repo/.venv/bin/python',
    });
    expect(expandSettingPath('.venv/bin/python', { ...base, trusted: false })).toEqual({
      kind: 'invalid',
      problem: 'relativeUntrusted',
    });
    expect(expandSettingPath('${workspaceFolder}/python', { ...base, trusted: false })).toEqual({
      kind: 'invalid',
      problem: 'workspaceFolderUntrusted',
    });
  });

  it('treats bare names as commands and rejects unknown variables', () => {
    expect(expandSettingPath('python3.13', base)).toEqual({ kind: 'command', name: 'python3.13' });
    expect(expandSettingPath('${env:HOME}/python', base)).toEqual({
      kind: 'invalid',
      problem: 'unsupportedVariable',
    });
  });

  it('understands Windows paths', () => {
    const windows = { ...base, platform: 'win32' as const, homeDirectory: 'C:\\Users\\dev' };
    expect(expandSettingPath('C:\\Python313\\python.exe', windows)).toEqual({
      kind: 'path',
      path: 'C:\\Python313\\python.exe',
    });
    expect(expandSettingPath('~\\py\\python.exe', windows)).toEqual({
      kind: 'path',
      path: 'C:\\Users\\dev\\py\\python.exe',
    });
  });
});
