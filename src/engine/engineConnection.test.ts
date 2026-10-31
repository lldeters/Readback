import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import type { Logger } from '../util/log';
import {
  EngineConnection,
  EngineRequestFailure,
  EngineStartFailure,
  PingRequest,
  engineArguments,
  type EngineLaunchOptions,
} from './engineConnection';

const fakeEngine = fileURLToPath(new URL('../../test/fixtures/fakeEngine.cjs', import.meta.url));

interface RecordingLogger extends Logger {
  readonly lines: string[];
}

function recordingLogger(): RecordingLogger {
  const lines: string[] = [];
  const add =
    (level: string) =>
    (message: string): void => {
      lines.push(`${level}: ${message}`);
    };
  return {
    lines,
    trace: add('trace'),
    debug: add('debug'),
    info: add('info'),
    warn: add('warn'),
    error: add('error'),
  };
}

const running: EngineConnection[] = [];

function launch(scenario: string, overrides: Partial<EngineLaunchOptions> = {}) {
  const logger = recordingLogger();
  const options: EngineLaunchOptions = {
    executable: 'python-ignored',
    engineDirectory: path.dirname(fakeEngine),
    env: process.env,
    client: { name: 'test', version: '0.0.1' },
    logLevel: 'info',
    workspaceTrusted: true,
    locale: 'en',
    startupTimeoutMs: 5_000,
    logger,
    // Run the Node fake instead of Python; keep the real spawn options.
    spawnProcess: ((_command: string, _args: readonly string[], spawnOptions: object) =>
      spawn(process.execPath, [fakeEngine, scenario], spawnOptions)) as unknown as typeof spawn,
    ...overrides,
  };
  const started = EngineConnection.start(options).then((connection) => {
    running.push(connection);
    return connection;
  });
  return { started, logger };
}

afterEach(async () => {
  await Promise.all(running.splice(0).map((connection) => connection.stop()));
});

describe('engineArguments', () => {
  it('runs the bootstrap isolated, without site and in UTF-8 mode', () => {
    expect(engineArguments('/ext/engine')).toEqual([
      '-I',
      '-S',
      '-X',
      'utf8',
      path.join('/ext/engine', 'run_engine.py'),
    ]);
  });

  it('can move the bytecode cache out of a read-only extension folder', () => {
    expect(engineArguments('/ext/engine', '/storage/pycache')).toEqual([
      '-I',
      '-S',
      '-X',
      'utf8',
      '-X',
      'pycache_prefix=/storage/pycache',
      path.join('/ext/engine', 'run_engine.py'),
    ]);
  });
});

describe('EngineConnection', () => {
  it('completes the handshake and forwards engine logs', async () => {
    const { started, logger } = launch('normal');
    const connection = await started;
    expect(connection.initializeResult.engineVersion).toBe('0.0.1');
    expect(connection.isRunning).toBe(true);
    await expect(connection.request(PingRequest, { timeoutMs: 2_000 })).resolves.toEqual({
      pong: true,
    });
    expect(logger.lines).toContain('info: engine: initialize from test');
    expect(logger.lines).toContain('warn: engine: two-line message');
    expect(logger.lines).toContain('warn: engine:     continued');
  });

  it('stops gracefully with shutdown and exit', async () => {
    const { started } = launch('normal');
    const connection = await started;
    await connection.stop();
    const exit = await connection.exited;
    expect(exit).toMatchObject({ code: 0, expected: true, hung: false });
    await expect(connection.request(PingRequest, { timeoutMs: 1_000 })).rejects.toMatchObject({
      kind: 'unavailable',
    });
  });

  it('reports a too old Python from the fatal stderr line', async () => {
    const failure = await launch('too-old').started.catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(EngineStartFailure);
    expect(failure).toMatchObject({ kind: 'pythonTooOld', fatal: { version: '3.9.6' } });
  });

  it('reports bootstrap failures with their detail', async () => {
    const failure = await launch('bootstrap-failed').started.catch((error: unknown) => error);
    expect(failure).toMatchObject({ kind: 'bootstrapFailed', message: 'ImportError: no module' });
  });

  it('reports an engine that dies during startup', async () => {
    const failure = await launch('crash-on-start').started.catch((error: unknown) => error);
    expect(failure).toMatchObject({ kind: 'exitedDuringStartup' });
  });

  it('gives up when initialize never answers', async () => {
    const failure = await launch('silent', { startupTimeoutMs: 300 }).started.catch(
      (error: unknown) => error,
    );
    expect(failure).toMatchObject({ kind: 'startupTimeout' });
  });

  it('rejects a protocol mismatch', async () => {
    const failure = await launch('wrong-protocol').started.catch((error: unknown) => error);
    expect(failure).toMatchObject({ kind: 'protocolMismatch' });
  });

  it('reports spawn errors', async () => {
    const failure = await launch('normal', {
      spawnProcess: ((_command: string, _args: readonly string[], options: object) =>
        spawn(
          path.join(path.dirname(fakeEngine), 'does-not-exist'),
          [],
          options,
        )) as unknown as typeof spawn,
    }).started.catch((error: unknown) => error);
    expect(failure).toMatchObject({ kind: 'spawnFailed' });
  });

  it('cancels a slow request on timeout', async () => {
    const connection = await launch('slow').started;
    const failure = await connection
      .request(PingRequest, { timeoutMs: 100 })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(EngineRequestFailure);
    expect(failure).toMatchObject({ kind: 'timeout' });
    expect(connection.isRunning).toBe(true);
  });

  it('kills an engine that ignores cancellation', async () => {
    const connection = await launch('hang').started;
    const failure = await connection
      .request(PingRequest, { timeoutMs: 100 })
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({ kind: 'unavailable' });
    const exit = await connection.exited;
    // A hung engine counts as a crash so the service restarts it with backoff.
    expect(exit).toMatchObject({ expected: false, hung: true });
  }, 10_000);

  it('maps engine errors with their data', async () => {
    const connection = await launch('error').started;
    const failure = await connection
      .request(PingRequest, { timeoutMs: 2_000 })
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({
      kind: 'engineError',
      code: -32603,
      data: { kind: 'internal' },
    });
  });

  it('notices an unexpected exit', async () => {
    const connection = await launch('crash-on-ping').started;
    const exits: unknown[] = [];
    connection.onExit((exit) => exits.push(exit));
    const failure = await connection
      .request(PingRequest, { timeoutMs: 2_000 })
      .catch((error: unknown) => error);
    expect(failure).toMatchObject({ kind: 'unavailable' });
    const exit = await connection.exited;
    expect(exit).toMatchObject({ code: 7, expected: false });
    expect(exits).toHaveLength(1);
  });

  it('forwards log level changes', async () => {
    const { started, logger } = launch('normal');
    const connection = await started;
    connection.setLogLevel('debug');
    await connection.request(PingRequest, { timeoutMs: 2_000 });
    await expect.poll(() => logger.lines).toContain('info: engine: level debug');
  });
});
