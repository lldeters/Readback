// One running engine process: spawn, JSON-RPC connection, initialize handshake, requests with
// timeouts, and an orderly shutdown. vscode-free; lifecycle policy lives in EngineService.
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import path from 'node:path';
import type { Readable, Writable } from 'node:stream';
import {
  CancellationTokenSource,
  createMessageConnection,
  NotificationType,
  NotificationType0,
  RequestType,
  RequestType0,
  ResponseError,
  StreamMessageReader,
  StreamMessageWriter,
  type CancellationToken,
  type MessageConnection,
} from 'vscode-jsonrpc/node';
import type {
  EngineErrorData,
  FatalStartupError,
  InitializeParams,
  InitializeResult,
  LogLevel,
  PingResult,
  SetLogLevelParams,
} from '../shared/generated/engineProtocol';
import { errorMessage, safeLogger, type Logger } from '../util/log';
import { EngineExitCodes, ErrorCodes, Methods, PROTOCOL_VERSION } from './protocol';
import { StderrParser, type StderrRecord } from './stderrLog';

export const InitializeRequest = new RequestType<
  InitializeParams,
  InitializeResult,
  EngineErrorData
>(Methods.initialize);
export const PingRequest = new RequestType0<PingResult, EngineErrorData>(Methods.ping);
export const ShutdownRequest = new RequestType0<null, EngineErrorData>(Methods.shutdown);
export const ExitNotification = new NotificationType0(Methods.exit);
export const SetLogLevelNotification = new NotificationType<SetLogLevelParams>(Methods.setLogLevel);

export type EngineStartFailureKind =
  | 'spawnFailed'
  | 'pythonTooOld'
  | 'bootstrapFailed'
  | 'exitedDuringStartup'
  | 'startupTimeout'
  | 'protocolMismatch'
  | 'initializeFailed';

/**
 * The engine process could not be brought up. The message is English, for the log; the UI
 * localizes by kind (src/engine/messages.ts).
 */
export class EngineStartFailure extends Error {
  constructor(
    readonly kind: EngineStartFailureKind,
    message: string,
    readonly detail?: string,
    readonly fatal?: FatalStartupError,
    /** How the process ended, for 'exitedDuringStartup'. */
    readonly exit?: { readonly code: number | null; readonly signal: NodeJS.Signals | null },
  ) {
    super(message);
    this.name = 'EngineStartFailure';
  }
}

export type EngineRequestFailureKind = 'cancelled' | 'timeout' | 'unavailable' | 'engineError';

/** A request did not produce a result. */
export class EngineRequestFailure extends Error {
  constructor(
    readonly kind: EngineRequestFailureKind,
    message: string,
    readonly code?: number,
    readonly data?: EngineErrorData,
  ) {
    super(message);
    this.name = 'EngineRequestFailure';
  }
}

interface ProcessExit {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

export interface EngineExit extends ProcessExit {
  /** True when the exit was requested (stop/kill), false for crashes. */
  readonly expected: boolean;
  /** True when we killed the engine because it ignored a cancelled request. */
  readonly hung: boolean;
}

type EngineProcess = ChildProcessByStdio<Writable, Readable, Readable>;

export interface EngineLaunchOptions {
  /** Absolute path of the probed interpreter (sys.executable). */
  readonly executable: string;
  /** <extensionPath>/engine, also the working directory. */
  readonly engineDirectory: string;
  readonly env: NodeJS.ProcessEnv;
  readonly client: { readonly name: string; readonly version: string };
  readonly logLevel: LogLevel;
  readonly workspaceTrusted: boolean;
  readonly locale: string;
  readonly startupTimeoutMs: number;
  readonly logger: Logger;
  /** For tests: replaces child_process.spawn. */
  readonly spawnProcess?: typeof spawn;
  /** Bytecode cache outside the extension folder, for read-only installations. */
  readonly pycachePrefix?: string;
}

export interface RequestOptions {
  readonly token?: CancellationToken;
  readonly timeoutMs: number;
}

/** setTimeout fires after 1 ms for anything above this (signed 32-bit milliseconds). */
const MAX_TIMER_MS = 2_147_483_647;

/** Request timeouts are user settings; keep them in the range the timers can represent. */
export function timerSafeTimeout(timeoutMs: number): number {
  return Number.isFinite(timeoutMs) ? Math.min(Math.max(timeoutMs, 0), MAX_TIMER_MS) : MAX_TIMER_MS;
}

/** How long a hung engine gets to answer a cancelled request before it is killed. */
const CANCEL_GRACE_MS = 2_000;
const SHUTDOWN_TIMEOUT_MS = 1_000;
const EXIT_GRACE_MS = 2_000;

/** Interpreter arguments: isolated mode, no site.py/.pth, UTF-8 regardless of locale. */
export function engineArguments(engineDirectory: string, pycachePrefix?: string): string[] {
  const cache = pycachePrefix === undefined ? [] : ['-X', `pycache_prefix=${pycachePrefix}`];
  return ['-I', '-S', '-X', 'utf8', ...cache, path.join(engineDirectory, 'run_engine.py')];
}

function logRecord(logger: Logger, record: StderrRecord): void {
  if (record.kind === 'fatal') {
    logger.error(`engine: ${JSON.stringify(record.error)}`);
    return;
  }
  if (record.kind === 'raw') {
    logger.warn(`engine: ${record.message}`);
    return;
  }
  const message = `engine: ${record.message}`;
  switch (record.level) {
    case 'trace':
      logger.trace(message);
      break;
    case 'debug':
      logger.debug(message);
      break;
    case 'info':
      logger.info(message);
      break;
    case 'warning':
      logger.warn(message);
      break;
    case 'error':
      logger.error(message);
      break;
  }
}

export class EngineConnection {
  private exitInfo: EngineExit | undefined;
  private stopping = false;
  /** Set before we stop or kill the process, so its exit is not mistaken for a crash. */
  private exitRequested = false;
  private killedAfterHang = false;
  private readonly exitListeners = new Set<(exit: EngineExit) => void>();
  readonly exited: Promise<EngineExit>;

  private constructor(
    private readonly child: EngineProcess,
    private readonly connection: MessageConnection,
    readonly initializeResult: InitializeResult,
    private readonly logger: Logger,
    processExit: Promise<ProcessExit>,
  ) {
    this.exited = processExit.then((raw) => {
      const exit: EngineExit = {
        ...raw,
        expected: this.exitRequested,
        hung: this.killedAfterHang,
      };
      this.exitInfo = exit;
      this.connection.dispose();
      for (const listener of this.exitListeners) {
        listener(exit);
      }
      return exit;
    });
  }

  /** Spawns the engine and completes the initialize handshake. */
  static async start(options: EngineLaunchOptions): Promise<EngineConnection> {
    const logger = safeLogger(options.logger);
    const spawnProcess = options.spawnProcess ?? spawn;
    const args = engineArguments(options.engineDirectory, options.pycachePrefix);
    logger.info(`Starting engine: ${options.executable} ${args.join(' ')}`);

    let child: EngineProcess;
    try {
      child = spawnProcess(options.executable, args, {
        cwd: options.engineDirectory,
        env: options.env,
        shell: false,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (error) {
      throw new EngineStartFailure('spawnFailed', errorMessage(error));
    }

    let fatal: FatalStartupError | undefined;
    const stderrTail: string[] = [];
    const parser = new StderrParser((record) => {
      if (record.kind === 'fatal') {
        fatal = record.error;
      } else {
        stderrTail.push(record.message);
        if (stderrTail.length > 20) {
          stderrTail.shift();
        }
      }
      logRecord(logger, record);
    });
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      parser.push(chunk);
    });
    // A dead engine turns writes into EPIPE errors; they surface as failed requests instead.
    child.stdin.on('error', (error) => {
      logger.debug(`engine stdin: ${error.message}`);
    });

    let resolveSpawnError: (error: Error) => void = () => undefined;
    const spawnError = new Promise<Error>((resolve) => {
      resolveSpawnError = resolve;
    });
    child.on('error', (error) => {
      resolveSpawnError(error);
    });
    const exited = new Promise<ProcessExit>((resolve) => {
      child.on('close', (code, signal) => {
        // Exit tracking must survive anything the log output does.
        try {
          parser.flush();
        } finally {
          resolve({ code, signal });
        }
      });
    });

    const connection = createMessageConnection(
      new StreamMessageReader(child.stdout),
      new StreamMessageWriter(child.stdin),
    );
    connection.onError(([error]) => {
      logger.debug(`engine connection: ${error.message}`);
    });
    connection.listen();

    const params: InitializeParams = {
      protocolVersion: PROTOCOL_VERSION,
      client: options.client,
      logLevel: options.logLevel,
      workspaceTrusted: options.workspaceTrusted,
      locale: options.locale,
    };

    const kill = (): void => {
      connection.dispose();
      child.kill('SIGKILL');
    };

    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => {
        resolve('timeout');
      }, options.startupTimeoutMs);
    });
    try {
      const outcome = await Promise.race([
        connection.sendRequest(InitializeRequest, params).then((result) => ({ result })),
        exited.then((exit) => ({ exit })),
        spawnError.then((error) => ({ error })),
        timeout,
      ]);
      if (outcome === 'timeout') {
        kill();
        throw new EngineStartFailure(
          'startupTimeout',
          `The engine did not answer within ${String(options.startupTimeoutMs)} ms.`,
          stderrTail.join('\n'),
        );
      }
      if ('error' in outcome) {
        kill();
        throw new EngineStartFailure('spawnFailed', outcome.error.message);
      }
      if ('exit' in outcome) {
        connection.dispose();
        const detail = stderrTail.join('\n');
        if (outcome.exit.code === EngineExitCodes.pythonTooOld) {
          throw new EngineStartFailure('pythonTooOld', 'Python is too old.', detail, fatal);
        }
        if (outcome.exit.code === EngineExitCodes.bootstrapFailed) {
          throw new EngineStartFailure(
            'bootstrapFailed',
            fatal?.detail ?? 'The engine could not start.',
            detail,
            fatal,
          );
        }
        throw new EngineStartFailure(
          'exitedDuringStartup',
          `The engine exited during startup (code ${String(outcome.exit.code)}, signal ${String(outcome.exit.signal)}).`,
          detail,
          fatal,
          outcome.exit,
        );
      }
      const result = outcome.result;
      if (result.protocolVersion !== PROTOCOL_VERSION) {
        kill();
        throw new EngineStartFailure(
          'protocolMismatch',
          `Engine protocol ${String(result.protocolVersion)} does not match ${String(PROTOCOL_VERSION)}.`,
        );
      }
      logger.info(
        `Engine ${result.engineVersion} ready (pid ${String(result.pid)}, Python ${result.python.version}).`,
      );
      return new EngineConnection(child, connection, result, logger, exited);
    } catch (error) {
      if (error instanceof EngineStartFailure) {
        throw error;
      }
      kill();
      if (error instanceof ResponseError) {
        const data = error.data as EngineErrorData | undefined;
        throw new EngineStartFailure(
          data?.kind === 'protocol-mismatch' ? 'protocolMismatch' : 'initializeFailed',
          error.message,
          data?.detail,
        );
      }
      throw new EngineStartFailure('initializeFailed', errorMessage(error));
    } finally {
      clearTimeout(timer);
    }
  }

  get pid(): number | undefined {
    return this.child.pid;
  }

  get isRunning(): boolean {
    return this.exitInfo === undefined;
  }

  onExit(listener: (exit: EngineExit) => void): { dispose(): void } {
    this.exitListeners.add(listener);
    return {
      dispose: () => {
        this.exitListeners.delete(listener);
      },
    };
  }

  /** Sends a request; cancels it on timeout and kills the engine if it ignores the cancellation. */
  async request<P, R>(
    type: RequestType<P, R, EngineErrorData>,
    params: P,
    options: RequestOptions,
  ): Promise<R>;
  async request<R>(type: RequestType0<R, EngineErrorData>, options: RequestOptions): Promise<R>;
  async request<P, R>(
    type: RequestType<P, R, EngineErrorData> | RequestType0<R, EngineErrorData>,
    paramsOrOptions: P | RequestOptions,
    maybeOptions?: RequestOptions,
  ): Promise<R> {
    const options = (maybeOptions ?? paramsOrOptions) as RequestOptions;
    if (!this.isRunning || this.stopping) {
      throw new EngineRequestFailure('unavailable', 'The engine is not running.');
    }
    const source = new CancellationTokenSource();
    const subscription = options.token?.onCancellationRequested(() => {
      source.cancel();
    });
    // An object, because a plain boolean assigned in the timer callback would be narrowed to false.
    const deadline = { passed: false };
    let killTimer: NodeJS.Timeout | undefined;
    const timeoutTimer = setTimeout(() => {
      deadline.passed = true;
      source.cancel();
      // Cancellation is cooperative; a request stuck in one long call never answers.
      killTimer = setTimeout(() => {
        this.logger.error(`Engine did not answer ${type.method} after cancellation; killing it.`);
        this.kill('hung');
      }, CANCEL_GRACE_MS);
    }, timerSafeTimeout(options.timeoutMs));
    try {
      // The typed overloads above keep call sites type-safe; the method-name form avoids
      // vscode-jsonrpc's conditional parameter types, which do not accept a generic P.
      const pending =
        type instanceof RequestType0
          ? this.connection.sendRequest<R>(type.method, source.token)
          : this.connection.sendRequest<R>(type.method, paramsOrOptions, source.token);
      return await pending;
    } catch (error) {
      if (error instanceof ResponseError) {
        const data = error.data as EngineErrorData | undefined;
        if (error.code === ErrorCodes.requestCancelled) {
          throw deadline.passed
            ? new EngineRequestFailure(
                'timeout',
                `${type.method} timed out after ${String(options.timeoutMs)} ms.`,
              )
            : new EngineRequestFailure('cancelled', `${type.method} was cancelled.`);
        }
        if (error.code > -32100 && error.code < -32000) {
          // vscode-jsonrpc's own codes (e.g. PendingResponseRejected): the connection is gone.
          throw new EngineRequestFailure('unavailable', error.message, error.code);
        }
        throw new EngineRequestFailure('engineError', error.message, error.code, data);
      }
      if (deadline.passed) {
        throw new EngineRequestFailure(
          'timeout',
          `${type.method} timed out after ${String(options.timeoutMs)} ms.`,
        );
      }
      throw new EngineRequestFailure('unavailable', errorMessage(error));
    } finally {
      clearTimeout(timeoutTimer);
      clearTimeout(killTimer);
      subscription?.dispose();
      source.dispose();
    }
  }

  setLogLevel(level: LogLevel): void {
    if (this.isRunning && !this.stopping) {
      this.connection
        .sendNotification(SetLogLevelNotification, { level })
        .catch((error: unknown) => {
          this.logger.debug(`setLogLevel: ${errorMessage(error)}`);
        });
    }
  }

  /** shutdown request, exit notification, end stdin; kill if the engine is still there after 2 s. */
  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }
    if (this.stopping) {
      await this.exited;
      return;
    }
    this.stopping = true;
    this.exitRequested = true;
    try {
      await Promise.race([
        this.connection.sendRequest(ShutdownRequest),
        new Promise((resolve) => setTimeout(resolve, SHUTDOWN_TIMEOUT_MS)),
      ]);
      await this.connection.sendNotification(ExitNotification);
    } catch (error) {
      this.logger.debug(`engine shutdown: ${errorMessage(error)}`);
    }
    this.child.stdin.end();
    const killTimer = setTimeout(() => {
      this.child.kill('SIGKILL');
    }, EXIT_GRACE_MS);
    await this.exited;
    clearTimeout(killTimer);
  }

  /**
   * Terminates the engine immediately; pending requests fail with 'unavailable'. A hung engine
   * counts as a crash (EngineExit.expected false), so the service restarts it with backoff.
   */
  kill(reason: 'requested' | 'hung' = 'requested'): void {
    if (reason === 'hung') {
      this.killedAfterHang = true;
    } else {
      this.exitRequested = true;
    }
    this.connection.dispose();
    this.child.kill('SIGKILL');
  }
}
