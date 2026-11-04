import { beforeEach, describe, expect, it, vi } from 'vitest';

interface Inspected {
  globalValue?: string;
  workspaceValue?: string;
  workspaceFolderValue?: string;
}

interface Dialog {
  message: string;
  options: unknown;
  items: string[];
}

interface MockState {
  inspected: Inspected;
  answer: string | undefined;
  prompts: string[];
  dialogs: Dialog[];
  /** Paths of the open workspace folders. */
  folders: string[];
  pythonExtensionInstalled: boolean;
  api: unknown;
}

const state = vi.hoisted((): MockState => ({
  inspected: {},
  answer: undefined,
  prompts: [],
  dialogs: [],
  folders: ['/work'],
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
    get workspaceFolders() {
      return state.folders.map((fsPath) => ({
        uri: { scheme: 'file', fsPath, toString: () => `file://${fsPath}` },
      }));
    },
    getConfiguration: () => ({ inspect: () => state.inspected }),
  },
  window: {
    showWarningMessage: (message: string, options: unknown, ...items: string[]) => {
      state.prompts.push(message);
      state.dialogs.push({ message, options, items });
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

const { InterpreterSetting, PythonExtensionApprovals, PythonExtensionSource } =
  await import('./sources');

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
  state.dialogs = [];
  state.folders = ['/work'];
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
      'This workspace wants Hearback to run "./.venv/bin/python" as its Python interpreter.',
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

describe('PythonExtensionApprovals', () => {
  const venv = '/work/.venv/bin/python';
  const interactive = { interactive: true };

  it('asks once in an interactive start and remembers the approval', async () => {
    state.answer = 'Allow';
    const globalState = memento();
    const approvals = new PythonExtensionApprovals(globalState as never);
    await expect(approvals.confirm(venv, interactive)).resolves.toBe('approved');
    expect(state.dialogs).toEqual([
      {
        message: `The Python extension selected "${venv}", which lies inside this workspace.`,
        options: {
          modal: true,
          detail:
            'Hearback will run this program to analyze your code. Only allow it if you trust the files in this workspace.',
        },
        items: ['Allow', "Don't Allow"],
      },
    ]);
    await expect(approvals.confirm(venv, interactive)).resolves.toBe('approved');
    // A later session (new instance, same global state), also without user interaction.
    const later = new PythonExtensionApprovals(globalState as never);
    await expect(later.confirm(venv, { interactive: false })).resolves.toBe('approved');
    expect(state.prompts).toHaveLength(1);
  });

  it('remembers a decline for the session and asks again in the next one', async () => {
    state.answer = "Don't Allow";
    const globalState = memento();
    const approvals = new PythonExtensionApprovals(globalState as never);
    await expect(approvals.confirm(venv, interactive)).resolves.toBe('declinedInSession');
    await expect(approvals.confirm(venv, interactive)).resolves.toBe('declinedInSession');
    await expect(approvals.confirm(venv, { interactive: false })).resolves.toBe(
      'declinedInSession',
    );
    expect(state.prompts).toHaveLength(1);
    expect(globalState.keys()).toEqual([]);

    state.answer = 'Allow';
    const next = new PythonExtensionApprovals(globalState as never);
    await expect(next.confirm(venv, interactive)).resolves.toBe('approved');
    expect(state.prompts).toHaveLength(2);
  });

  it('treats a dismissed dialog as a decline', async () => {
    const approvals = new PythonExtensionApprovals(memento() as never);
    await expect(approvals.confirm(venv, interactive)).resolves.toBe('declinedInSession');
    await approvals.confirm(venv, interactive);
    expect(state.prompts).toHaveLength(1);
  });

  it('never asks without user interaction', async () => {
    state.answer = 'Allow';
    const globalState = memento();
    const approvals = new PythonExtensionApprovals(globalState as never);
    await expect(approvals.confirm(venv, { interactive: false })).resolves.toBe('notConfirmed');
    expect(state.prompts).toEqual([]);
    expect(globalState.keys()).toEqual([]);
    // Not counted as a decline: the next interactive start asks.
    await expect(approvals.confirm(venv, interactive)).resolves.toBe('approved');
    expect(state.prompts).toHaveLength(1);
  });

  it('keeps its approvals apart from the pythonPath approvals', async () => {
    state.answer = 'Allow';
    state.inspected = { workspaceValue: venv };
    // Allowing the workspace pythonPath does not allow the same path from the Python extension.
    const settingFirst = memento();
    await new InterpreterSetting(settingFirst as never).read(interactive);
    const approvals = new PythonExtensionApprovals(settingFirst as never);
    await expect(approvals.confirm(venv, { interactive: false })).resolves.toBe('notConfirmed');
    await expect(approvals.confirm(venv, interactive)).resolves.toBe('approved');
    expect(settingFirst.values.get('hearback.approvedWorkspaceInterpreters')).toEqual([
      `file:///work\n${venv}`,
    ]);
    expect(settingFirst.values.get('hearback.approvedPythonExtensionInterpreters')).toEqual([
      `file:///work\n${venv}`,
    ]);
    // Nor the other way round.
    const extensionFirst = memento();
    await new PythonExtensionApprovals(extensionFirst as never).confirm(venv, interactive);
    await expect(
      new InterpreterSetting(extensionFirst as never).read({ interactive: false }),
    ).resolves.toMatchObject({ declinedWorkspaceValue: venv });
  });

  it('asks again for the same path in another workspace', async () => {
    state.answer = 'Allow';
    const approvals = new PythonExtensionApprovals(memento() as never);
    await approvals.confirm(venv, interactive);
    state.folders = ['/other'];
    await expect(approvals.confirm(venv, { interactive: false })).resolves.toBe('notConfirmed');
    await expect(approvals.confirm(venv, interactive)).resolves.toBe('approved');
    expect(state.prompts).toHaveLength(2);
  });

  it('keeps the list of approvals bounded', async () => {
    state.answer = 'Allow';
    const globalState = memento();
    const old = Array.from({ length: 200 }, (_, index) => `file:///old\n/old/${String(index)}`);
    await globalState.update('hearback.approvedPythonExtensionInterpreters', old);
    await new PythonExtensionApprovals(globalState as never).confirm(venv, interactive);
    const stored = globalState.values.get('hearback.approvedPythonExtensionInterpreters');
    expect(stored).toHaveLength(200);
    expect(stored).toEqual([...old.slice(1), `file:///work\n${venv}`]);
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
