// Owns the engine for this window: lazy start on first use, automatic restart with backoff after
// crashes, restart on interpreter changes, and the status snapshot for "Show Engine Status".
import { constants as fsConstants } from 'node:fs';
import { access, mkdir, readdir, realpath, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import * as vscode from 'vscode';
import type { InitializeResult, LogLevel } from '../shared/generated/engineProtocol';
import { errorMessage } from '../util/log';
import {
  EngineConnection,
  EngineStartFailure,
  PingRequest,
  type EngineExit,
} from './engineConnection';
import { findOnPath, nodeFs, searchPath, type PathSearchOptions } from './interpreter/pathSearch';
import { sanitizedEnv } from './interpreter/policy';
import { probeCandidate, runProcess } from './interpreter/probe';
import { resolveInterpreter } from './interpreter/resolve';
import {
  InterpreterSetting,
  PYTHON_EXTENSION_ID,
  PythonExtensionSource,
  configurationResource,
  workspaceFolderPaths,
  type ReadOptions,
} from './interpreter/sources';
import type {
  AttemptOutcome,
  InterpreterCandidate,
  InterpreterSource,
  ResolutionResult,
} from './interpreter/types';
import { RestartPolicy } from './restartPolicy';
import { PYTHON_PATH_SETTING, SETTING_SECTION, TIMEOUT_KEY } from './settings';

export type EngineStateKind = 'idle' | 'starting' | 'running' | 'failed' | 'disposed';

export type EngineFailure =
  | { readonly kind: 'noInterpreter'; readonly resolution: ResolutionResult }
  | { readonly kind: 'settingUnusable'; readonly resolution: ResolutionResult }
  | {
      readonly kind: 'start';
      readonly error: EngineStartFailure;
      readonly resolution: ResolutionResult;
    }
  | { readonly kind: 'crashLoop'; readonly lastExit: EngineExit };

/** Thrown by ensureStarted/request when no engine is available; carries the reason. */
export class EngineUnavailableError extends Error {
  constructor(readonly failure: EngineFailure) {
    super(`Readback engine unavailable: ${failure.kind}`);
    this.name = 'EngineUnavailableError';
  }
}

export interface EngineStatus {
  readonly state: EngineStateKind;
  readonly trusted: boolean;
  readonly resolution: ResolutionResult | undefined;
  readonly engine: InitializeResult | undefined;
  readonly pid: number | undefined;
  readonly startupMs: number | undefined;
  readonly failure: EngineFailure | undefined;
  readonly automaticRestarts: number;
}

export interface DetectedInterpreter {
  readonly source: InterpreterSource;
  readonly command: string;
  readonly outcome: AttemptOutcome;
}

const STARTUP_TIMEOUT_MS = 20_000;
/** Upper bound for "Select Python Interpreter", e.g. with many conda environments. */
const MAX_DETECTED = 25;
const PROBE_TIMEOUT_MS = { setting: 15_000, pythonExtension: 15_000, path: 5_000 } as const;
const INTERPRETER_CHANGE_DEBOUNCE_MS = 1_000;
const DEFAULT_TIMEOUT_MS = 30_000;

export function toEngineLogLevel(level: vscode.LogLevel): LogLevel {
  switch (level) {
    case vscode.LogLevel.Trace:
      return 'trace';
    case vscode.LogLevel.Debug:
      return 'debug';
    case vscode.LogLevel.Info:
      return 'info';
    case vscode.LogLevel.Warning:
      return 'warning';
    case vscode.LogLevel.Error:
      return 'error';
    case vscode.LogLevel.Off:
      return 'off';
  }
}

export class EngineService implements vscode.Disposable {
  private connection: EngineConnection | undefined;
  private starting: Promise<EngineConnection> | undefined;
  private failure: EngineFailure | undefined;
  private resolution: ResolutionResult | undefined;
  private startupMs: number | undefined;
  private automaticRestarts = 0;
  private disposed = false;
  private restartTimer: NodeJS.Timeout | undefined;
  private changeTimer: NodeJS.Timeout | undefined;
  /** Interpreter inputs the running engine was started with; see interpreterInputsChanged. */
  private startedWith: string | undefined;
  private readonly restartPolicy = new RestartPolicy();
  private readonly setting: InterpreterSetting;
  private readonly pythonExtension = new PythonExtensionSource();
  private pythonExtensionListener: vscode.Disposable | undefined;
  private readonly probeCache = new Map<string, AttemptOutcome>();
  private pythonExtensionInstalled =
    vscode.extensions.getExtension(PYTHON_EXTENSION_ID) !== undefined;
  private readonly stateEmitter = new vscode.EventEmitter<EngineStateKind>();
  private readonly disposables: vscode.Disposable[] = [];
  readonly onDidChangeState = this.stateEmitter.event;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly log: vscode.LogOutputChannel,
  ) {
    this.setting = new InterpreterSetting(context.globalState);
    this.disposables.push(
      this.stateEmitter,
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration(PYTHON_PATH_SETTING)) {
          this.interpreterInputsChanged('setting changed');
        }
      }),
      vscode.workspace.onDidGrantWorkspaceTrust(() => {
        this.interpreterInputsChanged('workspace trusted');
      }),
      vscode.extensions.onDidChange(() => {
        const installed = vscode.extensions.getExtension(PYTHON_EXTENSION_ID) !== undefined;
        if (installed !== this.pythonExtensionInstalled) {
          this.pythonExtensionInstalled = installed;
          this.interpreterInputsChanged('Python extension installed or removed');
        }
      }),
      log.onDidChangeLogLevel((level) => {
        this.connection?.setLogLevel(toEngineLogLevel(level));
      }),
    );
  }

  get state(): EngineStateKind {
    if (this.disposed) {
      return 'disposed';
    }
    if (this.connection?.isRunning) {
      return 'running';
    }
    if (this.starting) {
      return 'starting';
    }
    return this.failure ? 'failed' : 'idle';
  }

  get engineDirectory(): string {
    return vscode.Uri.joinPath(this.context.extensionUri, 'engine').fsPath;
  }

  /** Starts the engine unless it runs; concurrent callers share one start. */
  async ensureStarted(options: ReadOptions): Promise<EngineConnection> {
    if (this.disposed) {
      throw new Error('The Readback engine service has been disposed.');
    }
    if (this.connection?.isRunning) {
      return this.connection;
    }
    this.starting ??= this.start(options).finally(() => {
      this.starting = undefined;
      this.fireState();
    });
    this.fireState();
    return this.starting;
  }

  /** Explicit restart by the user: also clears the crash history. */
  async restart(options: ReadOptions): Promise<EngineConnection> {
    this.restartPolicy.reset();
    clearTimeout(this.restartTimer);
    await this.starting?.catch(() => undefined);
    await this.stopEngine();
    this.failure = undefined;
    this.probeCache.clear();
    return this.ensureStarted(options);
  }

  private pathSearchOptions(
    trusted: boolean,
    workspaceFolders: readonly string[],
  ): PathSearchOptions {
    return {
      platform: process.platform,
      pathEnv: process.env.PATH ?? process.env.Path,
      excludeFolders: trusted ? [] : workspaceFolders,
      fs: nodeFs,
      developerDirectory: () => this.developerDirectory(),
    };
  }

  /** Runs the interpreter resolution without starting anything. */
  async resolve(options: ReadOptions): Promise<ResolutionResult> {
    const platform = process.platform;
    const trusted = vscode.workspace.isTrusted;
    const workspaceFolders = workspaceFolderPaths();
    const pathOptions = this.pathSearchOptions(trusted, workspaceFolders);
    return resolveInterpreter({
      platform,
      trusted,
      workspaceFolders,
      homeDirectory: os.homedir(),
      readSetting: () => this.setting.read(options),
      pythonExtension: () => this.pythonExtension.activeInterpreter(configurationResource()),
      searchPath: () => searchPath(pathOptions),
      findOnPath: (name) => findOnPath(name, pathOptions),
      probe: (candidate) => this.probe(candidate),
      realpath: (path) => realpath(path),
    });
  }

  /**
   * Every interpreter the user could pick (Python extension environments, all PATH matches), each
   * probed. Unlike resolve() this does not stop at the first usable one.
   */
  async detectInterpreters(): Promise<DetectedInterpreter[]> {
    const trusted = vscode.workspace.isTrusted;
    const workspaceFolders = workspaceFolderPaths();
    const found: { source: InterpreterSource; command: string; prefixArgs: string[] }[] = [];
    if (trusted) {
      const active = await this.pythonExtension.activeInterpreter(configurationResource());
      if (active.kind === 'found') {
        found.push({ source: 'pythonExtension', command: active.executable, prefixArgs: [] });
      }
      const environments = await this.pythonExtension.environments();
      for (const environment of environments?.known ?? []) {
        const executable = environment.executable.uri?.fsPath;
        if (executable) {
          found.push({ source: 'pythonExtension', command: executable, prefixArgs: [] });
        }
      }
    }
    const { candidates } = await searchPath(this.pathSearchOptions(trusted, workspaceFolders));
    for (const candidate of candidates) {
      found.push({
        source: 'path',
        command: candidate.command,
        prefixArgs: [...candidate.prefixArgs],
      });
    }
    const seen = new Set<string>();
    const detected: DetectedInterpreter[] = [];
    for (const candidate of found.slice(0, MAX_DETECTED)) {
      const outcome = await this.probe(candidate);
      const key = outcome.kind === 'ok' ? outcome.probe.executable : candidate.command;
      if (!seen.has(key)) {
        seen.add(key);
        detected.push({ source: candidate.source, command: candidate.command, outcome });
      }
    }
    return detected;
  }

  /** Round trip of engine/ping in milliseconds (starts the engine if needed). */
  async ping(options: ReadOptions): Promise<number> {
    const connection = await this.ensureStarted(options);
    const started = performance.now();
    await connection.request(PingRequest, { timeoutMs: this.timeoutMs() });
    return performance.now() - started;
  }

  status(): EngineStatus {
    return {
      state: this.state,
      trusted: vscode.workspace.isTrusted,
      resolution: this.resolution,
      engine: this.connection?.isRunning ? this.connection.initializeResult : undefined,
      pid: this.connection?.isRunning ? this.connection.pid : undefined,
      startupMs: this.connection?.isRunning ? this.startupMs : undefined,
      failure: this.failure,
      automaticRestarts: this.automaticRestarts,
    };
  }

  timeoutMs(): number {
    const value = vscode.workspace
      .getConfiguration(SETTING_SECTION)
      .get<number>(TIMEOUT_KEY, DEFAULT_TIMEOUT_MS);
    return Number.isFinite(value) && value >= 1_000 ? value : DEFAULT_TIMEOUT_MS;
  }

  /** Stops the engine and waits for it (deactivate). */
  async shutdown(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    clearTimeout(this.restartTimer);
    clearTimeout(this.changeTimer);
    await this.starting?.catch(() => undefined);
    await this.stopEngine();
    this.pythonExtensionListener?.dispose();
    for (const disposable of this.disposables) {
      disposable.dispose();
    }
  }

  dispose(): void {
    void this.shutdown();
  }

  private async start(options: ReadOptions): Promise<EngineConnection> {
    clearTimeout(this.restartTimer);
    const fingerprint = this.setting.fingerprint();
    const resolution = await this.resolve(options);
    this.resolution = resolution;
    this.logResolution(resolution);
    const interpreter = resolution.interpreter;
    if (!interpreter) {
      this.failure = resolution.blockedBySetting
        ? { kind: 'settingUnusable', resolution }
        : { kind: 'noInterpreter', resolution };
      throw new EngineUnavailableError(this.failure);
    }
    const started = performance.now();
    const pycachePrefix = await this.pycachePrefix();
    let connection: EngineConnection;
    try {
      connection = await EngineConnection.start({
        ...(pycachePrefix === undefined ? {} : { pycachePrefix }),
        executable: interpreter.probe.executable,
        engineDirectory: this.engineDirectory,
        env: sanitizedEnv(process.env),
        client: {
          name: this.context.extension.id,
          version: String((this.context.extension.packageJSON as { version: unknown }).version),
        },
        logLevel: toEngineLogLevel(this.log.logLevel),
        workspaceTrusted: vscode.workspace.isTrusted,
        locale: vscode.env.language,
        startupTimeoutMs: STARTUP_TIMEOUT_MS,
        logger: this.log,
      });
    } catch (error) {
      const startError =
        error instanceof EngineStartFailure
          ? error
          : new EngineStartFailure('spawnFailed', errorMessage(error));
      this.log.error(`Engine start failed (${startError.kind}): ${startError.message}`);
      this.failure = { kind: 'start', error: startError, resolution };
      throw new EngineUnavailableError(this.failure);
    }
    if (this.disposed) {
      await connection.stop();
      throw new Error('The Readback engine service has been disposed.');
    }
    this.startupMs = performance.now() - started;
    this.connection = connection;
    this.failure = undefined;
    this.startedWith = fingerprint;
    connection.onExit((exit) => {
      this.handleExit(connection, exit);
    });
    this.pythonExtensionListener?.dispose();
    this.pythonExtensionListener = this.pythonExtension.onDidChangeActiveEnvironment(() => {
      this.interpreterInputsChanged('Python extension environment changed');
    });
    return connection;
  }

  private handleExit(connection: EngineConnection, exit: EngineExit): void {
    if (this.connection !== connection) {
      return;
    }
    this.connection = undefined;
    if (exit.expected || this.disposed) {
      this.fireState();
      return;
    }
    this.log.error(
      exit.hung
        ? 'The engine stopped responding and was killed.'
        : `Engine exited unexpectedly (code ${String(exit.code)}, signal ${String(exit.signal)}).`,
    );
    const delay = this.restartPolicy.recordCrash();
    if (delay === undefined) {
      this.failure = { kind: 'crashLoop', lastExit: exit };
      this.log.error(
        'The engine crashed repeatedly; automatic restarts are paused until "Readback: Restart Engine".',
      );
      this.fireState();
      return;
    }
    this.log.info(`Restarting the engine in ${String(delay)} ms.`);
    this.fireState();
    this.restartTimer = setTimeout(() => {
      this.automaticRestarts += 1;
      this.ensureStarted({ interactive: false }).catch((error: unknown) => {
        this.log.error(`Automatic engine restart failed: ${errorMessage(error)}`);
      });
    }, delay);
  }

  /**
   * The interpreter may have changed (setting, trust, Python extension). Stop the engine; the next
   * use starts it again with a fresh resolution. Ignore events that did not change our inputs.
   */
  private interpreterInputsChanged(reason: string): void {
    clearTimeout(this.changeTimer);
    this.changeTimer = setTimeout(() => {
      this.probeCache.clear();
      if (this.failure?.kind !== 'crashLoop') {
        this.failure = undefined;
      }
      const running = this.connection?.isRunning ?? false;
      if (
        running &&
        reason === 'setting changed' &&
        this.setting.fingerprint() === this.startedWith
      ) {
        return;
      }
      if (running) {
        this.log.info(
          `Interpreter inputs changed (${reason}); stopping the engine until next use.`,
        );
        void this.stopEngine();
      }
      this.fireState();
    }, INTERPRETER_CHANGE_DEBOUNCE_MS);
  }

  private async stopEngine(): Promise<void> {
    const connection = this.connection;
    this.connection = undefined;
    if (connection) {
      await connection.stop();
      this.fireState();
    }
  }

  /** Probes are cheap (~30 ms) but run often; cache them per file version. */
  private async probe(candidate: InterpreterCandidate): Promise<AttemptOutcome> {
    let version = 'unknown';
    try {
      const info = await stat(candidate.command);
      version = `${String(info.mtimeMs)}:${String(info.size)}`;
    } catch {
      // Missing files are reported by the probe itself.
    }
    const key = [candidate.command, ...candidate.prefixArgs, version].join('\0');
    const cached = this.probeCache.get(key);
    if (cached) {
      return cached;
    }
    const outcome = await probeCandidate(candidate, runProcess, {
      cwd: this.engineDirectory,
      env: sanitizedEnv(process.env),
      timeoutMs: PROBE_TIMEOUT_MS[candidate.source],
    });
    if (outcome.kind !== 'failed' || outcome.reason !== 'timeout') {
      this.probeCache.set(key, outcome);
    }
    return outcome;
  }

  /**
   * CPython writes bytecode next to the engine sources. If the extension folder is read-only
   * (system-wide or container installs), use a versioned folder in global storage instead, so
   * the engine does not recompile on every start; folders of other versions are removed.
   */
  private async pycachePrefix(): Promise<string | undefined> {
    try {
      await access(this.engineDirectory, fsConstants.W_OK);
      return undefined;
    } catch {
      const root = path.join(this.context.globalStorageUri.fsPath, 'pycache');
      const version = String((this.context.extension.packageJSON as { version: unknown }).version);
      try {
        await mkdir(path.join(root, version), { recursive: true });
        for (const entry of await readdir(root)) {
          if (entry !== version) {
            await rm(path.join(root, entry), { recursive: true, force: true });
          }
        }
        return path.join(root, version);
      } catch (error) {
        this.log.debug(`No bytecode cache folder: ${errorMessage(error)}`);
        return undefined;
      }
    }
  }

  private async developerDirectory(): Promise<string | undefined> {
    const result = await runProcess('/usr/bin/xcode-select', ['-p'], {
      cwd: this.engineDirectory,
      env: sanitizedEnv(process.env),
      timeoutMs: 3_000,
    });
    const directory = result.stdout.trim();
    return result.exitCode === 0 && directory.length > 0 ? directory : undefined;
  }

  private logResolution(resolution: ResolutionResult): void {
    for (const attempt of resolution.attempts) {
      const outcome = attempt.outcome;
      const detail =
        outcome.kind === 'ok'
          ? `ok (${outcome.probe.executable}, Python ${outcome.probe.version.join('.')})`
          : `${outcome.kind}: ${outcome.reason}${outcome.detail ? ` (${outcome.detail})` : ''}`;
      this.log.info(`Interpreter ${attempt.source} ${attempt.command ?? ''}: ${detail}`);
    }
  }

  private fireState(): void {
    this.stateEmitter.fire(this.state);
  }
}
