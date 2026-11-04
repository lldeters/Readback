import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as vscode from 'vscode';
import { EngineConnection, type EngineLaunchOptions } from './engineConnection';
import type { ResolutionResult } from './interpreter/types';
import { RestartPolicy } from './restartPolicy';

interface MockState {
  inspected: Record<string, unknown>;
  timeout: unknown;
  configurationListeners: ((event: unknown) => void)[];
}

const mock = vi.hoisted((): MockState => ({
  inspected: {},
  timeout: 30_000,
  configurationListeners: [],
}));

vi.mock('vscode', async () => {
  const stub = await vi.importActual<typeof import('../../test/stubs/vscode')>('vscode');
  return {
    ...stub,
    workspace: {
      ...stub.workspace,
      isTrusted: true,
      workspaceFolders: undefined,
      getConfiguration: () => ({
        get: (key: string, fallback: unknown) =>
          key === 'engine.timeoutMs' ? mock.timeout : fallback,
        inspect: () => mock.inspected,
      }),
      onDidChangeConfiguration: (listener: (event: unknown) => void) => {
        mock.configurationListeners.push(listener);
        return new stub.Disposable(() => undefined);
      },
    },
  };
});

vi.mock('@vscode/python-extension', () => ({
  PythonExtension: { api: () => Promise.reject(new Error('not installed')) },
}));

const { EngineService } = await import('./engineService');

const fakeEngine = fileURLToPath(new URL('../../test/fixtures/fakeEngine.cjs', import.meta.url));

const resolution: ResolutionResult = {
  trusted: true,
  blockedBySetting: false,
  attempts: [],
  interpreter: {
    candidate: { source: 'path', command: '/usr/bin/python3', prefixArgs: [] },
    probe: {
      executable: '/usr/bin/python3',
      version: [3, 12, 3],
      releaseLevel: 'final',
      implementation: 'cpython',
      platform: 'linux',
      bits64: true,
    },
  },
};

interface Harness {
  readonly service: InstanceType<typeof EngineService>;
  readonly lines: string[];
  readonly connections: EngineConnection[];
  readonly setLogLevel: (level: vscode.LogLevel) => void;
  /** Scenario of the fake engine for every following start. */
  scenario: string;
  /** Delay before each start, to widen race windows. */
  startDelayMs: number;
}

let workspace: string;
const harnesses: Harness[] = [];

beforeEach(async () => {
  workspace = await mkdtemp(path.join(os.tmpdir(), 'hearback-service-'));
  await mkdir(path.join(workspace, 'extension', 'engine'), { recursive: true });
  mock.inspected = {};
  mock.timeout = 30_000;
  mock.configurationListeners = [];
});

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((harness) => harness.service.shutdown()));
  await rm(workspace, { recursive: true, force: true });
});

function harness(restartPolicy?: RestartPolicy): Harness {
  const lines: string[] = [];
  const levels = new vscode.EventEmitter<vscode.LogLevel>();
  const write =
    (level: string) =>
    (message: string): void => {
      lines.push(`${level}: ${message}`);
    };
  const log = {
    logLevel: vscode.LogLevel.Info,
    onDidChangeLogLevel: levels.event,
    trace: write('trace'),
    debug: write('debug'),
    info: write('info'),
    warn: write('warn'),
    error: write('error'),
  };
  const values = new Map<string, unknown>();
  const context = {
    extensionUri: vscode.Uri.file(path.join(workspace, 'extension')),
    globalStorageUri: vscode.Uri.file(path.join(workspace, 'storage')),
    globalState: {
      get: (key: string, fallback: unknown) => (values.has(key) ? values.get(key) : fallback),
      update: (key: string, value: unknown) => {
        values.set(key, value);
        return Promise.resolve();
      },
    },
    extension: { id: 'lldeters.hearback', packageJSON: { version: '0.0.1' } },
  };
  const connections: EngineConnection[] = [];
  const created: Harness = {
    lines,
    connections,
    scenario: 'normal',
    startDelayMs: 0,
    setLogLevel: (level) => {
      log.logLevel = level;
      levels.fire(level);
    },
    service: undefined as unknown as InstanceType<typeof EngineService>,
  };
  const service = new EngineService(context as never, log as never, {
    resolveInterpreter: () => Promise.resolve(resolution),
    startConnection: async (options: EngineLaunchOptions) => {
      const scenario = created.scenario;
      await new Promise((resolve) => setTimeout(resolve, created.startDelayMs));
      const connection = await EngineConnection.start({
        ...options,
        spawnProcess: ((_command: string, _args: readonly string[], spawnOptions: object) =>
          spawn(process.execPath, [fakeEngine, scenario], spawnOptions)) as unknown as typeof spawn,
      });
      connections.push(connection);
      return connection;
    },
    restartPolicy:
      restartPolicy ??
      new RestartPolicy({ baseDelayMs: 20, maxDelayMs: 100, maxCrashes: 5, windowMs: 60_000 }),
    interpreterChangeDebounceMs: 20,
  });
  (created as { service: InstanceType<typeof EngineService> }).service = service;
  harnesses.push(created);
  return created;
}

function changeConfiguration(): void {
  for (const listener of mock.configurationListeners) {
    listener({ affectsConfiguration: (key: string) => key === 'hearback.engine.pythonPath' });
  }
}

describe('EngineService', () => {
  it('starts lazily on first use and stops on shutdown', async () => {
    const { service, connections } = harness();
    expect(service.state).toBe('idle');
    await expect(service.ping({ interactive: false })).resolves.toBeGreaterThanOrEqual(0);
    const status = service.status();
    expect(status).toMatchObject({ state: 'running', engine: { engineVersion: '0.0.1' } });
    expect(status.pid).toBe(connections[0]?.pid);
    await service.shutdown();
    expect(service.state).toBe('disposed');
    await expect(connections[0]?.exited).resolves.toMatchObject({ expected: true });
  });

  it('restarts automatically after a crash, with backoff', async () => {
    const test = harness();
    test.scenario = 'crash-on-ping';
    await test.service.ensureStarted({ interactive: false });
    test.scenario = 'normal';
    await expect(test.service.ping({ interactive: false })).rejects.toMatchObject({
      kind: 'unavailable',
    });
    await expect.poll(() => test.connections.length, { timeout: 5_000 }).toBe(2);
    await expect.poll(() => test.service.state, { timeout: 5_000 }).toBe('running');
    expect(test.service.status().automaticRestarts).toBe(1);
    expect(test.lines.some((line) => line.includes('Engine exited unexpectedly'))).toBe(true);
  });

  it('pauses automatic restarts after a crash loop until an explicit restart', async () => {
    const test = harness(
      new RestartPolicy({ baseDelayMs: 20, maxDelayMs: 100, maxCrashes: 1, windowMs: 60_000 }),
    );
    test.scenario = 'crash-on-ping';
    await test.service.ensureStarted({ interactive: false });
    await test.service.ping({ interactive: false }).catch(() => undefined);
    await expect.poll(() => test.connections.length, { timeout: 5_000 }).toBe(2);
    await expect.poll(() => test.service.state, { timeout: 5_000 }).toBe('running');
    await test.service.ping({ interactive: false }).catch(() => undefined);
    await expect.poll(() => test.service.state, { timeout: 5_000 }).toBe('failed');
    expect(test.service.status().failure?.kind).toBe('crashLoop');
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(test.connections).toHaveLength(2);

    test.scenario = 'normal';
    await test.service.restart({ interactive: false });
    expect(test.service.state).toBe('running');
    expect(test.service.status().failure).toBeUndefined();
  });

  it('kills an engine that hangs and restarts it with backoff', async () => {
    const test = harness();
    mock.timeout = 1_000;
    test.scenario = 'hang';
    await test.service.ensureStarted({ interactive: false });
    test.scenario = 'normal';
    await expect(test.service.ping({ interactive: false })).rejects.toMatchObject({
      kind: 'unavailable',
    });
    await expect(test.connections[0]?.exited).resolves.toMatchObject({ hung: true });
    await expect.poll(() => test.connections.length, { timeout: 5_000 }).toBe(2);
    await expect.poll(() => test.service.state, { timeout: 5_000 }).toBe('running');
    expect(test.lines).toContain('error: The engine stopped responding and was killed.');
  }, 20_000);

  it('stops an engine whose start completes after shutdown', async () => {
    const test = harness();
    test.startDelayMs = 200;
    const starting = test.service.ensureStarted({ interactive: false });
    await test.service.shutdown();
    await expect(starting).rejects.toThrow(/disposed/);
    expect(test.connections).toHaveLength(1);
    await expect(test.connections[0]?.exited).resolves.toMatchObject({ expected: true });
    expect(test.service.state).toBe('disposed');
  });

  it('rechecks interpreter changes that arrive during a start', async () => {
    const test = harness();
    test.startDelayMs = 300;
    const starting = test.service.ensureStarted({ interactive: false });
    mock.inspected = { globalValue: '/opt/other/python3' };
    changeConfiguration();
    const connection = await starting;
    expect(connection.isRunning).toBe(true);
    // The engine was started with the old inputs, so it is stopped once the start has settled.
    await expect.poll(() => test.service.state, { timeout: 5_000 }).toBe('idle');
    await expect(connection.exited).resolves.toMatchObject({ expected: true });
  });

  it('ignores configuration events that leave the interpreter inputs unchanged', async () => {
    const test = harness();
    const connection = await test.service.ensureStarted({ interactive: false });
    changeConfiguration();
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(test.service.state).toBe('running');
    expect(connection.isRunning).toBe(true);
  });

  it('clamps hearback.engine.timeoutMs to the manifest range', () => {
    const { service } = harness();
    mock.timeout = 3_000_000_000;
    expect(service.timeoutMs()).toBe(600_000);
    mock.timeout = 10;
    expect(service.timeoutMs()).toBe(1_000);
    mock.timeout = 'soon';
    expect(service.timeoutMs()).toBe(30_000);
    mock.timeout = 45_000;
    expect(service.timeoutMs()).toBe(45_000);
  });

  it('forwards log level changes to the running engine', async () => {
    const test = harness();
    await test.service.ensureStarted({ interactive: false });
    test.setLogLevel(vscode.LogLevel.Debug);
    await expect.poll(() => test.lines, { timeout: 5_000 }).toContain('info: engine: level debug');
  });
});
