// Editor-facing interpreter sources: the readback.engine.pythonPath setting (with the approved
// one-time confirmation for workspace values) and the Python extension's active environment.
import { PythonExtension } from '@vscode/python-extension';
import * as vscode from 'vscode';
import { errorMessage } from '../../util/log';
import { PYTHON_PATH_KEY, PYTHON_PATH_SETTING, SETTING_SECTION } from '../settings';
import type { PythonExtensionLookup, SettingLookup } from './resolve';
import type { SettingScope } from './types';

export const PYTHON_EXTENSION_ID = 'ms-python.python';

const APPROVALS_KEY = 'readback.approvedWorkspaceInterpreters';
const MAX_APPROVALS = 200;
/** The Python extension can take seconds to activate (discovery, experiments). */
const API_TIMEOUT_MS = 10_000;
const RESOLVE_TIMEOUT_MS = 5_000;

/** Local folders of the workspace; virtual folders are not supported (manifest). */
export function workspaceFolderPaths(): string[] {
  return (vscode.workspace.workspaceFolders ?? [])
    .filter((folder) => folder.uri.scheme === 'file')
    .map((folder) => folder.uri.fsPath);
}

/** One engine per window: settings are read for the first workspace folder. */
export function configurationResource(): vscode.Uri | undefined {
  return vscode.workspace.workspaceFolders?.[0]?.uri;
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === undefined || trimmed.length === 0 ? undefined : trimmed;
}

function workspaceIdentity(): string {
  return (
    vscode.workspace.workspaceFile?.toString() ??
    (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.toString()).join('|')
  );
}

export interface ReadOptions {
  /** Whether the user triggered this, so a confirmation dialog may be shown. */
  readonly interactive: boolean;
}

/**
 * readback.engine.pythonPath. Restricted Mode already drops workspace values (manifest
 * restrictedConfigurations). Because some editors ship with Workspace Trust disabled, a value
 * from workspace settings additionally needs a one-time confirmation per (workspace, path).
 */
export class InterpreterSetting {
  private readonly declined = new Set<string>();

  constructor(private readonly globalState: vscode.Memento) {}

  /** The raw values per scope, for change detection. */
  fingerprint(): string {
    const inspected = vscode.workspace
      .getConfiguration(SETTING_SECTION, configurationResource())
      .inspect<string>(PYTHON_PATH_KEY);
    return JSON.stringify([
      inspected?.globalValue,
      inspected?.workspaceValue,
      inspected?.workspaceFolderValue,
      vscode.workspace.isTrusted,
    ]);
  }

  async read(options: ReadOptions): Promise<SettingLookup> {
    const inspected = vscode.workspace
      .getConfiguration(SETTING_SECTION, configurationResource())
      .inspect<string>(PYTHON_PATH_KEY);
    const userValue = nonEmpty(inspected?.globalValue);
    const folderValue = nonEmpty(inspected?.workspaceFolderValue);
    const workspaceValue = nonEmpty(inspected?.workspaceValue);
    const scoped: { value: string; scope: SettingScope } | undefined =
      folderValue !== undefined
        ? { value: folderValue, scope: 'workspaceFolder' }
        : workspaceValue !== undefined
          ? { value: workspaceValue, scope: 'workspace' }
          : undefined;
    if (scoped && (await this.approve(scoped.value, options))) {
      return scoped;
    }
    return {
      value: userValue,
      scope: userValue === undefined ? undefined : 'user',
      ...(scoped ? { declinedWorkspaceValue: scoped.value } : {}),
    };
  }

  private async approve(value: string, options: ReadOptions): Promise<boolean> {
    const key = `${workspaceIdentity()}\n${value}`;
    const approved = this.globalState.get<string[]>(APPROVALS_KEY, []);
    if (approved.includes(key)) {
      return true;
    }
    if (!options.interactive || this.declined.has(key)) {
      return false;
    }
    const allow = vscode.l10n.t('Allow');
    const ignore = vscode.l10n.t('Ignore Workspace Setting');
    const choice = await vscode.window.showWarningMessage(
      vscode.l10n.t('This workspace wants Readback to run "{0}" as its Python interpreter.', value),
      {
        modal: true,
        detail: vscode.l10n.t(
          'The path comes from the workspace settings ({0}). Readback will execute this program. Only allow it if you trust the files in this workspace.',
          PYTHON_PATH_SETTING,
        ),
      },
      allow,
      ignore,
    );
    if (choice !== allow) {
      // Ask again in a later session, not on every engine start in this one.
      this.declined.add(key);
      return false;
    }
    await this.globalState.update(APPROVALS_KEY, [...approved, key].slice(-MAX_APPROVALS));
    return true;
  }
}

const TIMEOUT = Symbol('timeout');

async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | typeof TIMEOUT> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<typeof TIMEOUT>((resolve) => {
        timer = setTimeout(() => {
          resolve(TIMEOUT);
        }, ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/** Gives access to the Python extension's API once it has been acquired successfully. */
export class PythonExtensionSource {
  private api: PythonExtension | undefined;

  /** The environments API, or undefined if the extension is missing, disabled or slow. */
  async environments(): Promise<PythonExtension['environments'] | undefined> {
    if (this.api) {
      return this.api.environments;
    }
    if (!vscode.extensions.getExtension(PYTHON_EXTENSION_ID)) {
      return undefined;
    }
    const api = await withTimeout(PythonExtension.api(), API_TIMEOUT_MS);
    if (api === TIMEOUT) {
      return undefined;
    }
    this.api = api;
    return api.environments;
  }

  /** Only listens if the API was already acquired: listening must never activate the extension. */
  onDidChangeActiveEnvironment(listener: () => void): vscode.Disposable | undefined {
    return this.api?.environments.onDidChangeActiveEnvironmentPath(() => {
      listener();
    });
  }

  async activeInterpreter(resource: vscode.Uri | undefined): Promise<PythonExtensionLookup> {
    if (!vscode.extensions.getExtension(PYTHON_EXTENSION_ID)) {
      return { kind: 'notInstalled' };
    }
    try {
      const api = this.api ?? (await withTimeout(PythonExtension.api(), API_TIMEOUT_MS));
      if (api === TIMEOUT) {
        return { kind: 'timeout' };
      }
      this.api = api;
      const active = api.environments.getActiveEnvironmentPath(resource);
      const resolved = await withTimeout(
        api.environments.resolveEnvironment(active),
        RESOLVE_TIMEOUT_MS,
      );
      if (resolved === TIMEOUT) {
        return { kind: 'timeout' };
      }
      const executable = resolved?.executable.uri?.fsPath;
      return executable ? { kind: 'found', executable } : { kind: 'noEnvironment' };
    } catch (error) {
      return { kind: 'error', detail: errorMessage(error) };
    }
  }
}
