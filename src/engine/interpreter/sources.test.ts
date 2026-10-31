import { beforeEach, describe, expect, it, vi } from 'vitest';

interface Inspected {
  globalValue?: string;
  workspaceValue?: string;
  workspaceFolderValue?: string;
}

interface MockState {
  inspected: Inspected;
  answer: string | undefined;
  prompts: string[];
  pythonExtensionInstalled: boolean;
  api: unknown;
}

const state = vi.hoisted((): MockState => ({
  inspected: {},
  answer: undefined,
  prompts: [],
  pythonExtensionInstalled: false,
  api: undefined,
}));

vi.mock('vscode', () => ({
  l10n: {
    t: (message: string, ...args: unknown[]) =>
      message.replace(/\{(\d+)\}/g, (_m, index: string) => String(args[Number(index)])),
  },
  workspace: {
    get isTrusted() {
      return true;
    },
    workspaceFile: undefined,
    workspaceFolders: [
      { uri: { scheme: 'file', fsPath: '/work', toString: () => 'file:///work' } },
    ],
    getConfiguration: () => ({ inspect: () => state.inspected }),
  },
  window: {
    showWarningMessage: (message: string) => {
      state.prompts.push(message);
      return Promise.resolve(state.answer);
    },
  },
  extensions: {
    getExtension: () => (state.pythonExtensionInstalled ? {} : undefined),
  },
}));

vi.mock('@vscode/python-extension', () => ({
  PythonExtension: { api: () => Promise.resolve(state.api) },
}));

const { InterpreterSetting, PythonExtensionSource } = await import('./sources');

function memento() {
  const values = new Map<string, unknown>();
  return {
    values,
    get: <T>(key: string, fallback: T): T => (values.has(key) ? (values.get(key) as T) : fallback),
    update: (key: string, value: unknown) => {
      values.set(key, value);
      return Promise.resolve();
    },
    keys: () => [...values.keys()],
  };
}

beforeEach(() => {
  state.inspected = {};
  state.answer = undefined;
  state.prompts = [];
  state.pythonExtensionInstalled = false;
  state.api = undefined;
});

describe('InterpreterSetting', () => {
  it('uses a user-level value without asking', async () => {
    state.inspected = { globalValue: ' /opt/python ' };
    const setting = new InterpreterSetting(memento() as never);
    await expect(setting.read({ interactive: true })).resolves.toEqual({
      value: '/opt/python',
      scope: 'user',
    });
    expect(state.prompts).toEqual([]);
  });

  it('asks once before running a workspace value and remembers the approval', async () => {
    state.inspected = { globalValue: '/opt/python', workspaceValue: './.venv/bin/python' };
    state.answer = 'Allow';
    const globalState = memento();
    const setting = new InterpreterSetting(globalState as never);
    await expect(setting.read({ interactive: true })).resolves.toEqual({
      value: './.venv/bin/python',
      scope: 'workspace',
    });
    expect(state.prompts).toEqual([
      'This workspace wants Readback to run "./.venv/bin/python" as its Python interpreter.',
    ]);
    // A new session (new instance) with the same global state does not ask again.
    await new InterpreterSetting(globalState as never).read({ interactive: true });
    expect(state.prompts).toHaveLength(1);
  });

  it('falls back to the user value when the workspace value is declined', async () => {
    state.inspected = { globalValue: '/opt/python', workspaceValue: '/evil/python' };
    state.answer = 'Ignore Workspace Setting';
    const setting = new InterpreterSetting(memento() as never);
    await expect(setting.read({ interactive: true })).resolves.toEqual({
      value: '/opt/python',
      scope: 'user',
      declinedWorkspaceValue: '/evil/python',
    });
    // Not asked again in this session.
    await setting.read({ interactive: true });
    expect(state.prompts).toHaveLength(1);
  });

  it('treats a dismissed dialog as declined', async () => {
    state.inspected = { workspaceValue: '/evil/python' };
    const setting = new InterpreterSetting(memento() as never);
    await expect(setting.read({ interactive: true })).resolves.toEqual({
      value: undefined,
      scope: undefined,
      declinedWorkspaceValue: '/evil/python',
    });
  });

  it('never asks or runs a workspace value without user interaction', async () => {
    state.inspected = { workspaceValue: '/evil/python' };
    const setting = new InterpreterSetting(memento() as never);
    await expect(setting.read({ interactive: false })).resolves.toMatchObject({
      value: undefined,
      declinedWorkspaceValue: '/evil/python',
    });
    expect(state.prompts).toEqual([]);
  });

  it('prefers the folder value over the workspace value', async () => {
    state.inspected = { workspaceValue: '/a/python', workspaceFolderValue: '/b/python' };
    state.answer = 'Allow';
    const setting = new InterpreterSetting(memento() as never);
    await expect(setting.read({ interactive: true })).resolves.toEqual({
      value: '/b/python',
      scope: 'workspaceFolder',
    });
  });

  it('ignores a workspace value for good once the user picked another interpreter', async () => {
    state.inspected = { globalValue: '/opt/python', workspaceValue: '/repo/.venv/bin/python' };
    state.answer = 'Allow';
    const globalState = memento();
    const setting = new InterpreterSetting(globalState as never);
    await expect(setting.read({ interactive: true })).resolves.toMatchObject({
      scope: 'workspace',
    });
    expect(setting.workspaceValue()).toEqual({
      value: '/repo/.venv/bin/python',
      scope: 'workspace',
    });
    await setting.ignoreWorkspaceValue('/repo/.venv/bin/python');
    // Also in a later session, and without asking again.
    state.prompts = [];
    await expect(
      new InterpreterSetting(globalState as never).read({ interactive: true }),
    ).resolves.toEqual({
      value: '/opt/python',
      scope: 'user',
      declinedWorkspaceValue: '/repo/.venv/bin/python',
    });
    expect(state.prompts).toEqual([]);
  });

  it('changes its fingerprint when a scope value changes', () => {
    const setting = new InterpreterSetting(memento() as never);
    state.inspected = { globalValue: '/a' };
    const before = setting.fingerprint();
    state.inspected = { globalValue: '/a', workspaceValue: '/b' };
    expect(setting.fingerprint()).not.toBe(before);
  });
});

describe('PythonExtensionSource', () => {
  it('reports a missing Python extension without loading anything', async () => {
    await expect(new PythonExtensionSource().activeInterpreter(undefined)).resolves.toEqual({
      kind: 'notInstalled',
    });
  });

  it('resolves the active environment to its executable', async () => {
    state.pythonExtensionInstalled = true;
    const listeners: (() => void)[] = [];
    state.api = {
      environments: {
        getActiveEnvironmentPath: () => ({ id: 'venv', path: '/work/.venv' }),
        resolveEnvironment: () =>
          Promise.resolve({ executable: { uri: { fsPath: '/work/.venv/bin/python' } } }),
        onDidChangeActiveEnvironmentPath: (listener: () => void) => {
          listeners.push(listener);
          return { dispose: () => listeners.splice(listeners.indexOf(listener), 1) };
        },
      },
    };
    let changes = 0;
    const source = new PythonExtensionSource(() => {
      changes += 1;
    });
    await expect(source.activeInterpreter(undefined)).resolves.toEqual({
      kind: 'found',
      executable: '/work/.venv/bin/python',
    });
    // Subscribed as soon as the API was acquired, exactly once.
    await source.activeInterpreter(undefined);
    expect(listeners).toHaveLength(1);
    listeners[0]?.();
    expect(changes).toBe(1);
    source.dispose();
    expect(listeners).toHaveLength(0);
  });

  it('handles environments without executable and API errors', async () => {
    state.pythonExtensionInstalled = true;
    const noListener = () => ({ dispose: () => undefined });
    state.api = {
      environments: {
        getActiveEnvironmentPath: () => ({ id: 'x', path: '/x' }),
        resolveEnvironment: () => Promise.resolve(undefined),
        onDidChangeActiveEnvironmentPath: noListener,
      },
    };
    await expect(new PythonExtensionSource().activeInterpreter(undefined)).resolves.toEqual({
      kind: 'noEnvironment',
    });
    state.api = {
      environments: {
        getActiveEnvironmentPath: () => {
          throw new Error('not ready');
        },
        onDidChangeActiveEnvironmentPath: noListener,
      },
    };
    await expect(new PythonExtensionSource().activeInterpreter(undefined)).resolves.toEqual({
      kind: 'error',
      detail: 'not ready',
    });
  });
});
