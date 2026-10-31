// Runs a candidate interpreter once with a tiny script to learn its real executable and version.
import { spawn } from 'node:child_process';
import { MIN_PYTHON } from '../protocol';
import type { AttemptOutcome, InterpreterCandidate, PythonProbe } from './types';

/** Single quotes only, so the script survives Windows command-line quoting unchanged. */
export const PROBE_SCRIPT =
  "import sys, json; sys.stdout.write(json.dumps({'executable': sys.executable, " +
  "'version': list(sys.version_info[:3]), 'releaselevel': sys.version_info[3], " +
  "'implementation': sys.implementation.name, 'platform': sys.platform, " +
  "'bits64': sys.maxsize > 2**32}))";

/** -I: ignore PYTHON* variables, user site and cwd; -S: do not run site.py or .pth files. */
export const PROBE_ARGS: readonly string[] = ['-I', '-S', '-c', PROBE_SCRIPT];

export interface ProcessResult {
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly spawnError?: NodeJS.ErrnoException;
}

export interface ProcessOptions {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly timeoutMs: number;
}

export type ProcessRunner = (
  command: string,
  args: readonly string[],
  options: ProcessOptions,
) => Promise<ProcessResult>;

const MAX_OUTPUT = 65_536;

/** Spawns without a shell (paths with spaces stay intact), with a hard timeout and no stdin. */
export const runProcess: ProcessRunner = (command, args, options) =>
  new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let settled = false;
    const finish = (result: ProcessResult): void => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(result);
      }
    };
    const child = spawn(command, [...args], {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, options.timeoutMs);
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (data: string) => {
      if (stdout.length < MAX_OUTPUT) {
        stdout += data;
      }
    });
    child.stderr.on('data', (data: string) => {
      if (stderr.length < MAX_OUTPUT) {
        stderr += data;
      }
    });
    child.on('error', (error: NodeJS.ErrnoException) => {
      finish({ exitCode: null, stdout, stderr, timedOut, spawnError: error });
    });
    child.on('close', (exitCode) => {
      finish({ exitCode, stdout, stderr, timedOut });
    });
  });

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function parseProbeOutput(stdout: string): PythonProbe | undefined {
  let value: unknown;
  try {
    value = JSON.parse(stdout.trim());
  } catch {
    return undefined;
  }
  if (!isRecord(value)) {
    return undefined;
  }
  const { executable, version, releaselevel, implementation, platform, bits64 } = value;
  if (
    typeof executable !== 'string' ||
    executable.length === 0 ||
    !Array.isArray(version) ||
    version.length !== 3 ||
    !version.every((part) => Number.isInteger(part)) ||
    typeof releaselevel !== 'string' ||
    typeof implementation !== 'string' ||
    typeof platform !== 'string' ||
    typeof bits64 !== 'boolean'
  ) {
    return undefined;
  }
  const [major, minor, micro] = version as [number, number, number];
  return {
    executable,
    version: [major, minor, micro],
    releaseLevel: releaselevel,
    implementation,
    platform,
    bits64,
  };
}

export function formatVersion(probe: Pick<PythonProbe, 'version' | 'releaseLevel'>): string {
  const base = probe.version.join('.');
  return probe.releaseLevel === 'final' ? base : `${base} (${probe.releaseLevel})`;
}

function firstLines(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > 300 ? `${trimmed.slice(0, 300)}…` : trimmed;
}

export function classifyProbe(result: ProcessResult): AttemptOutcome {
  if (result.spawnError) {
    const code = result.spawnError.code;
    if (code === 'ENOENT') {
      return { kind: 'failed', reason: 'notFound' };
    }
    if (code === 'EACCES' || code === 'EPERM') {
      return { kind: 'failed', reason: 'notExecutable', detail: result.spawnError.message };
    }
    return { kind: 'failed', reason: 'probeFailed', detail: result.spawnError.message };
  }
  if (result.timedOut) {
    return { kind: 'failed', reason: 'timeout' };
  }
  if (result.exitCode !== 0) {
    const detail = firstLines(result.stderr) || `exit code ${String(result.exitCode)}`;
    return { kind: 'failed', reason: 'probeFailed', detail };
  }
  const probe = parseProbeOutput(result.stdout);
  if (!probe) {
    return { kind: 'failed', reason: 'probeFailed', detail: firstLines(result.stdout) };
  }
  if (probe.implementation !== 'cpython') {
    return { kind: 'failed', reason: 'notCPython', detail: probe.implementation };
  }
  const [major, minor] = probe.version;
  if (major < MIN_PYTHON.major || (major === MIN_PYTHON.major && minor < MIN_PYTHON.minor)) {
    return { kind: 'failed', reason: 'tooOld', detail: formatVersion(probe) };
  }
  return { kind: 'ok', probe };
}

export async function probeCandidate(
  candidate: InterpreterCandidate,
  runner: ProcessRunner,
  options: ProcessOptions,
): Promise<AttemptOutcome> {
  return classifyProbe(
    await runner(candidate.command, [...candidate.prefixArgs, ...PROBE_ARGS], options),
  );
}
