import { describe, expect, it } from 'vitest';
import {
  PROBE_ARGS,
  classifyProbe,
  formatVersion,
  parseProbeOutput,
  probeCandidate,
  runProcess,
  type ProcessResult,
} from './probe';

const okOutput = JSON.stringify({
  executable: '/usr/bin/python3.12',
  version: [3, 12, 3],
  releaselevel: 'final',
  implementation: 'cpython',
  platform: 'linux',
  bits64: true,
});

function result(overrides: Partial<ProcessResult>): ProcessResult {
  return { exitCode: 0, stdout: okOutput, stderr: '', timedOut: false, ...overrides };
}

describe('parseProbeOutput', () => {
  it('reads the probe JSON', () => {
    expect(parseProbeOutput(okOutput)).toEqual({
      executable: '/usr/bin/python3.12',
      version: [3, 12, 3],
      releaseLevel: 'final',
      implementation: 'cpython',
      platform: 'linux',
      bits64: true,
    });
  });

  it('rejects anything else', () => {
    expect(parseProbeOutput('Python 3.12.3')).toBeUndefined();
    expect(parseProbeOutput('{"executable": ""}')).toBeUndefined();
    expect(parseProbeOutput('[1, 2]')).toBeUndefined();
  });
});

describe('classifyProbe', () => {
  it('accepts CPython 3.10 and newer', () => {
    expect(classifyProbe(result({})).kind).toBe('ok');
  });

  it('rejects old versions, other implementations and failures', () => {
    const old = okOutput.replace('[3, 12, 3]', '[3, 9, 6]').replace('[3,12,3]', '[3,9,6]');
    expect(classifyProbe(result({ stdout: old }))).toEqual({
      kind: 'failed',
      reason: 'tooOld',
      detail: '3.9.6',
    });
    expect(classifyProbe(result({ stdout: okOutput.replace('cpython', 'pypy') }))).toMatchObject({
      reason: 'notCPython',
    });
    expect(classifyProbe(result({ exitCode: 2, stderr: 'Unknown option: -I\n' }))).toEqual({
      kind: 'failed',
      reason: 'probeFailed',
      detail: 'Unknown option: -I',
    });
    expect(classifyProbe(result({ exitCode: null, timedOut: true }))).toEqual({
      kind: 'failed',
      reason: 'timeout',
    });
    const enoent = Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' });
    expect(classifyProbe(result({ exitCode: null, spawnError: enoent }))).toEqual({
      kind: 'failed',
      reason: 'notFound',
    });
  });
});

describe('formatVersion', () => {
  it('marks pre-releases', () => {
    expect(formatVersion({ version: [3, 15, 0], releaseLevel: 'final' })).toBe('3.15.0');
    expect(formatVersion({ version: [3, 16, 0], releaseLevel: 'beta' })).toBe('3.16.0 (beta)');
  });
});

describe('probeCandidate', () => {
  it('runs the candidate isolated and with the launcher prefix first', async () => {
    const calls: unknown[] = [];
    const outcome = await probeCandidate(
      { source: 'path', command: 'C:\\Windows\\py.exe', prefixArgs: ['-3'] },
      (command, args) => {
        calls.push([command, args]);
        return Promise.resolve(result({}));
      },
      { cwd: '/ext/engine', env: {}, timeoutMs: 1000 },
    );
    expect(outcome.kind).toBe('ok');
    expect(calls).toEqual([['C:\\Windows\\py.exe', ['-3', ...PROBE_ARGS]]]);
    expect(PROBE_ARGS.slice(0, 2)).toEqual(['-I', '-S']);
  });
});

describe('runProcess', () => {
  it('runs a real process and captures its output', async () => {
    const output = await runProcess(process.execPath, ['-e', 'process.stdout.write("hi")'], {
      cwd: process.cwd(),
      env: process.env,
      timeoutMs: 10_000,
    });
    expect(output).toMatchObject({ exitCode: 0, stdout: 'hi', timedOut: false });
  });

  it('kills a process that runs too long', async () => {
    const output = await runProcess(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], {
      cwd: process.cwd(),
      env: process.env,
      timeoutMs: 200,
    });
    expect(output.timedOut).toBe(true);
  });

  it('reports a missing executable', async () => {
    const output = await runProcess('/definitely/not/here/python', [], {
      cwd: process.cwd(),
      env: process.env,
      timeoutMs: 1_000,
    });
    expect(output.spawnError?.code).toBe('ENOENT');
  });
});
