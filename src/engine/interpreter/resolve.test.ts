import { describe, expect, it } from 'vitest';
import type { PathLookup, PathSearchResult } from './pathSearch';
import {
  checkWorkspaceInterpreter,
  expandSettingPath,
  resolveInterpreter,
  type Confirmation,
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
  /** Answers per path for interpreters inside the workspace; 'notConfirmed' when missing. */
  confirmations?: Record<string, Confirmation>;
  path?: PathSearchResult;
  onPath?: Record<string, PathLookup>;
  probes?: Record<string, AttemptOutcome>;
  realpaths?: Record<string, string>;
  trusted?: boolean;
  platform?: NodeJS.Platform;
  workspaceFolders?: string[];
}

interface Recorded {
  probed: InterpreterCandidate[];
  /** Paths passed to confirmWorkspaceInterpreter. */
  asked: string[];
  /** Confirmations and probes in the order they happened. */
  events: string[];
  pythonExtensionLookups: number;
}

function context(fixture: Fixture): ResolveContext & Recorded {
  const recorded: Recorded = { probed: [], asked: [], events: [], pythonExtensionLookups: 0 };
  return Object.assign(recorded, {
    platform: fixture.platform ?? 'linux',
    trusted: fixture.trusted ?? true,
    workspaceFolders: fixture.workspaceFolders ?? ['/work/repo'],
    homeDirectory: '/home/dev',
    readSetting: () => Promise.resolve(fixture.setting ?? { value: undefined, scope: undefined }),
    pythonExtension: () => {
      recorded.pythonExtensionLookups += 1;
      return Promise.resolve(fixture.pythonExtension ?? { kind: 'notInstalled' });
    },
    confirmWorkspaceInterpreter: (path: string) => {
      recorded.asked.push(path);
      recorded.events.push(`confirm ${path}`);
      return Promise.resolve(fixture.confirmations?.[path] ?? 'notConfirmed');
    },
    searchPath: () => Promise.resolve(fixture.path ?? { candidates: [], skipped: [] }),
    findOnPath: (name: string) => Promise.resolve(fixture.onPath?.[name] ?? { kind: 'missing' }),
    probe: (candidate: InterpreterCandidate) => {
      recorded.probed.push(candidate);
      recorded.events.push(`probe ${candidate.command}`);
      return Promise.resolve(
        fixture.probes?.[candidate.command] ?? { kind: 'failed', reason: 'notFound' },
      );
    },
    realpath: (path: string) => Promise.resolve(fixture.realpaths?.[path] ?? path),
  } satisfies ResolveContext);
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
        pythonExtension: { kind: 'found', executable: '/home/dev/venvs/tools/bin/python' },
        probes: { '/home/dev/venvs/tools/bin/python': ok('/home/dev/venvs/tools/bin/python') },
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

    it('still skips the Python extension without asking for its interpreter', async () => {
      const ctx = context({
        trusted: false,
        pythonExtension: { kind: 'found', executable: '/work/repo/.venv/bin/python' },
        confirmations: { '/work/repo/.venv/bin/python': 'approved' },
        path: { candidates: [{ command: '/usr/bin/python3', prefixArgs: [] }], skipped: [] },
        probes: { '/usr/bin/python3': ok('/usr/bin/python3') },
      });
      const result = await resolveInterpreter(ctx);
      expect(ctx.pythonExtensionLookups).toBe(0);
      expect(ctx.asked).toEqual([]);
      expect(ctx.probed.map((c) => c.command)).toEqual(['/usr/bin/python3']);
      expect(result.attempts).toContainEqual({
        source: 'pythonExtension',
        outcome: { kind: 'skipped', reason: 'untrustedWorkspace' },
      });
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

  describe('Python extension interpreters inside the workspace', () => {
    const venv = '/work/repo/.venv/bin/python';
    const onPath: PathSearchResult = {
      candidates: [{ command: '/usr/bin/python3', prefixArgs: [] }],
      skipped: [],
    };

    it('asks before anything runs and uses the interpreter once approved', async () => {
      const ctx = context({
        pythonExtension: { kind: 'found', executable: venv },
        confirmations: { [venv]: 'approved' },
        probes: { [venv]: ok(venv) },
      });
      const result = await resolveInterpreter(ctx);
      expect(ctx.events).toEqual([`confirm ${venv}`, `probe ${venv}`]);
      expect(result.interpreter?.candidate).toEqual({
        source: 'pythonExtension',
        command: venv,
        prefixArgs: [],
      });
    });

    it('never runs an unconfirmed interpreter and continues with PATH', async () => {
      // What every non-interactive start (automatic restart) gets without a stored approval.
      const ctx = context({
        pythonExtension: { kind: 'found', executable: venv },
        path: onPath,
        probes: { [venv]: ok(venv), '/usr/bin/python3': ok('/usr/bin/python3') },
      });
      const result = await resolveInterpreter(ctx);
      expect(ctx.asked).toEqual([venv]);
      expect(ctx.probed.map((c) => c.command)).toEqual(['/usr/bin/python3']);
      expect(result.attempts).toContainEqual({
        source: 'pythonExtension',
        command: venv,
        outcome: { kind: 'skipped', reason: 'notConfirmed' },
      });
      expect(result.interpreter?.candidate.source).toBe('path');
      expect(result.blockedBySetting).toBe(false);
    });

    it('falls back to PATH after a decline in this session', async () => {
      const ctx = context({
        pythonExtension: { kind: 'found', executable: venv },
        confirmations: { [venv]: 'declinedInSession' },
        path: onPath,
        probes: { [venv]: ok(venv), '/usr/bin/python3': ok('/usr/bin/python3') },
      });
      const result = await resolveInterpreter(ctx);
      expect(ctx.probed.map((c) => c.command)).toEqual(['/usr/bin/python3']);
      expect(result.attempts.map((a) => [a.source, a.command, a.outcome.kind])).toEqual([
        ['setting', undefined, 'skipped'],
        ['pythonExtension', venv, 'skipped'],
        ['path', '/usr/bin/python3', 'ok'],
      ]);
      expect(result.attempts[1]?.outcome).toEqual({ kind: 'skipped', reason: 'declinedInSession' });
      expect(result.interpreter?.candidate.command).toBe('/usr/bin/python3');
    });

    it('detects a symlink into the workspace through its real path', async () => {
      const ctx = context({
        pythonExtension: { kind: 'found', executable: '/opt/tools/python' },
        realpaths: { '/opt/tools/python': '/work/repo/tools/python' },
        path: onPath,
        probes: { '/usr/bin/python3': ok('/usr/bin/python3') },
      });
      const result = await resolveInterpreter(ctx);
      expect(ctx.asked).toEqual(['/opt/tools/python']);
      expect(ctx.probed.map((c) => c.command)).toEqual(['/usr/bin/python3']);
      expect(result.interpreter?.candidate.source).toBe('path');
    });

    it('also compares with the real path of a workspace folder', async () => {
      // The folder was opened through a symlink; the venv's python links to a base interpreter.
      const executable = '/Volumes/Data/code/repo/.venv/bin/python';
      const ctx = context({
        platform: 'darwin',
        workspaceFolders: ['/Users/dev/code/repo'],
        realpaths: {
          '/Users/dev/code/repo': '/Volumes/Data/code/repo',
          [executable]: '/opt/homebrew/Cellar/python@3.13/3.13.1/bin/python3.13',
        },
        pythonExtension: { kind: 'found', executable },
        probes: { [executable]: ok(executable) },
      });
      await resolveInterpreter(ctx);
      expect(ctx.asked).toEqual([executable]);
      expect(ctx.probed).toEqual([]);
    });

    it('never asks for interpreters outside the workspace', async () => {
      for (const executable of [
        '/usr/bin/python3.12',
        '/home/dev/.pyenv/versions/3.12.3/bin/python',
        '/home/dev/miniconda3/envs/tools/bin/python',
        // A sibling folder only shares the name prefix.
        '/work/repo-tools/.venv/bin/python',
      ]) {
        const ctx = context({
          pythonExtension: { kind: 'found', executable },
          probes: { [executable]: ok(executable) },
        });
        const result = await resolveInterpreter(ctx);
        expect(ctx.asked, executable).toEqual([]);
        expect(result.interpreter?.candidate.command).toBe(executable);
      }
    });

    it('compares paths with the platform rules', async () => {
      const executable = 'c:\\work\\repo\\.venv\\Scripts\\python.exe';
      const ctx = context({
        platform: 'win32',
        workspaceFolders: ['C:\\Work\\Repo'],
        pythonExtension: { kind: 'found', executable },
        probes: { [executable]: ok(executable) },
      });
      const result = await resolveInterpreter(ctx);
      expect(ctx.asked).toEqual([executable]);
      expect(ctx.probed).toEqual([]);
      expect(result.interpreter).toBeUndefined();
    });

    it('checks sys.executable when it differs from the reported path', async () => {
      const shim = '/usr/local/bin/python3';
      const declined = context({
        pythonExtension: { kind: 'found', executable: shim },
        path: onPath,
        probes: { [shim]: ok(venv), '/usr/bin/python3': ok('/usr/bin/python3') },
      });
      const fallback = await resolveInterpreter(declined);
      expect(declined.asked).toEqual([venv]);
      expect(fallback.attempts).toContainEqual({
        source: 'pythonExtension',
        command: venv,
        outcome: { kind: 'skipped', reason: 'notConfirmed' },
      });
      expect(fallback.interpreter?.candidate.source).toBe('path');

      const approved = context({
        pythonExtension: { kind: 'found', executable: shim },
        confirmations: { [venv]: 'approved' },
        probes: { [shim]: ok(venv) },
      });
      const result = await resolveInterpreter(approved);
      expect(approved.events).toEqual([`probe ${shim}`, `confirm ${venv}`]);
      expect(result.interpreter?.probe.executable).toBe(venv);
    });

    it('counts relative paths as inside, wherever the working directory is', async () => {
      const relative = 'repo/.venv/bin/python';
      const reported = context({
        pythonExtension: { kind: 'found', executable: relative },
        path: onPath,
        probes: { [relative]: ok(relative), '/usr/bin/python3': ok('/usr/bin/python3') },
      });
      const result = await resolveInterpreter(reported);
      expect(reported.asked).toEqual([relative]);
      expect(reported.probed.map((c) => c.command)).toEqual(['/usr/bin/python3']);
      expect(result.interpreter?.candidate.source).toBe('path');

      // A relative sys.executable of an interpreter outside the workspace needs the answer too.
      const shim = '/usr/local/bin/python3';
      const executable = context({
        pythonExtension: { kind: 'found', executable: shim },
        path: onPath,
        probes: { [shim]: ok('python3.12'), '/usr/bin/python3': ok('/usr/bin/python3') },
      });
      const fallback = await resolveInterpreter(executable);
      expect(executable.asked).toEqual(['python3.12']);
      expect(fallback.interpreter?.candidate.source).toBe('path');
    });

    it('asks only once when an approved interpreter reports another path inside', async () => {
      const ctx = context({
        pythonExtension: { kind: 'found', executable: venv },
        confirmations: { [venv]: 'approved' },
        probes: { [venv]: ok('/work/repo/.venv/bin/python3.12') },
      });
      const result = await resolveInterpreter(ctx);
      expect(ctx.asked).toEqual([venv]);
      expect(result.interpreter?.probe.executable).toBe('/work/repo/.venv/bin/python3.12');
    });

    it('runs a user setting inside a trusted workspace without asking', async () => {
      // Hearback's own picker writes the chosen interpreter to the user settings.
      const ctx = context({
        setting: { value: venv, scope: 'user' },
        probes: { [venv]: ok(venv) },
      });
      const result = await resolveInterpreter(ctx);
      expect(ctx.asked).toEqual([]);
      expect(result.interpreter?.candidate).toEqual({
        source: 'setting',
        command: venv,
        prefixArgs: [],
      });
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

describe('checkWorkspaceInterpreter', () => {
  it('reports interpreters outside the workspace without asking', async () => {
    const ctx = context({ realpaths: { '/usr/bin/python3': '/usr/bin/python3.12' } });
    await expect(checkWorkspaceInterpreter('/usr/bin/python3', ctx)).resolves.toBe('outside');
    expect(ctx.asked).toEqual([]);
  });

  it('passes on the answer for interpreters inside the workspace', async () => {
    const ctx = context({
      confirmations: { '/work/repo/.venv/bin/python': 'declinedInSession' },
      realpaths: { '/home/dev/link': '/work/repo/bin/python' },
    });
    await expect(checkWorkspaceInterpreter('/work/repo/.venv/bin/python', ctx)).resolves.toBe(
      'declinedInSession',
    );
    await expect(checkWorkspaceInterpreter('/home/dev/link', ctx)).resolves.toBe('notConfirmed');
    expect(ctx.asked).toEqual(['/work/repo/.venv/bin/python', '/home/dev/link']);
    expect(ctx.probed).toEqual([]);
  });

  it('asks for relative paths, which cannot be placed', async () => {
    for (const [platform, path] of [
      ['linux', '.venv/bin/python'],
      ['darwin', 'python3'],
      ['win32', '.venv\\Scripts\\python.exe'],
      // Relative to the current directory of drive C:.
      ['win32', 'C:python.exe'],
    ] as const) {
      const ctx = context({ platform });
      await expect(checkWorkspaceInterpreter(path, ctx), path).resolves.toBe('notConfirmed');
      expect(ctx.asked, path).toEqual([path]);
    }
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
