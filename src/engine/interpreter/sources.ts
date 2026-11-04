// Editor-facing interpreter sources: the hearback.engine.pythonPath setting (with the approved
// one-time confirmation for workspace values), the Python extension's active environment and the
// one-time confirmation for interpreters it selected inside the workspace.
import { PythonExtension } from '@vscode/python-extension';
import * as vscode from 'vscode';
import { errorMessage } from '../../util/log';
import { PYTHON_PATH_KEY, PYTHON_PATH_SETTING, SETTING_SECTION } from '../settings';
import type { Confirmation, PythonExtensionLookup, SettingLookup } from './resolve';
import type { SettingScope } from './types';

export const PYTHON_EXTENSION_ID = 'ms-python.python';

/** Workspace values of hearback.engine.pythonPath the user allowed. */
const APPROVALS_KEY = 'hearback.approvedWorkspaceInterpreters';
/** Workspace values the user chose to ignore, e.g. by picking another interpreter. */
const IGNORED_KEY = 'hearback.ignoredWorkspaceInterpreters';
/** Python extension interpreters inside the workspace the user allowed; a list of its own. */
const EXTENSION_APPROVALS_KEY = 'hearback.approvedPythonExtensionInterpreters';
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

/** Approvals are stored per (workspace, path). */
function approvalKey(value: string): string {
  return `${workspaceIdentity()}\n${value}`;
}

export interface ReadOptions {
  /** Whether the user triggered this, so a confirmation dialog may be shown. */
  readonly interactive: boolean;
}

/**
 * hearback.engine.pythonPath. Restricted Mode already drops workspace values (manifest
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

  /** The value from workspace or folder settings that would override the user setting, if any. */
  workspaceValue(): { readonly value: string; readonly scope: SettingScope } | undefined {
    const inspected = vscode.workspace
      .getConfiguration(SETTING_SECTION, configurationResource())
      .inspect<string>(PYTHON_PATH_KEY);
    const folderValue = nonEmpty(inspected?.workspaceFolderValue);
    const workspaceValue = nonEmpty(inspected?.workspaceValue);
    return folderValue !== undefined
      ? { value: folderValue, scope: 'workspaceFolder' }
      : workspaceValue !== undefined
        ? { value: workspaceValue, scope: 'workspace' }
        : undefined;
  }

  /**
   * Stops using a workspace value in this workspace (persisted), so the user setting applies. Used
   * when the user explicitly picks another interpreter.
   */
  async ignoreWorkspaceValue(value: string): Promise<void> {
    const key = approvalKey(value);
    const approved = this.globalState.get<string[]>(APPROVALS_KEY, []);
    await this.globalState.update(
      APPROVALS_KEY,
      approved.filter((entry) => entry !== key),
    );
    const ignored = this.globalState.get<string[]>(IGNORED_KEY, []);
    if (!ignored.includes(key)) {
      await this.globalState.update(IGNORED_KEY, [...ignored, key].slice(-MAX_APPROVALS));
    }
  }

  async read(options: ReadOptions): Promise<SettingLookup> {
    const inspected = vscode.workspace
      .getConfiguration(SETTING_SECTION, configurationResource())
      .inspect<string>(PYTHON_PATH_KEY);
    const userValue = nonEmpty(inspected?.globalValue);
    const scoped = this.workspaceValue();
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
    const key = approvalKey(value);
    if (this.globalState.get<string[]>(IGNORED_KEY, []).includes(key)) {
      return false;
    }
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
      vscode.l10n.t('This workspace wants Hearback to run "{0}" as its Python interpreter.', value),
      {
        modal: true,
        detail: vscode.l10n.t(
          'The path comes from the workspace settings ({0}). Hearback will execute this program. Only allow it if you trust the files in this workspace.',
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

/**
 * Interpreters that the Python extension selected inside the workspace. A repository can steer that
 * choice (a committed .venv, python.defaultInterpreterPath), and editors without Workspace Trust
 * count every folder as trusted, so such an interpreter runs only after a one-time confirmation per
 * (workspace, path), like a workspace value of hearback.engine.pythonPath.
 */
export class PythonExtensionApprovals {
  private readonly declined = new Set<string>();

  constructor(private readonly globalState: vscode.Memento) {}

  /** A stored approval, a decline from this session, or (interactive only) the user's answer. */
  async confirm(path: string, options: ReadOptions): Promise<Confirmation> {
    const key = approvalKey(path);
    if (this.globalState.get<string[]>(EXTENSION_APPROVALS_KEY, []).includes(key)) {
      return 'approved';
    }
    if (this.declined.has(key)) {
      return 'declinedInSession';
    }
    if (!options.interactive) {
      return 'notConfirmed';
    }
    const allow = vscode.l10n.t('Allow');
    const decline = vscode.l10n.t("Don't Allow");
    const choice = await vscode.window.showWarningMessage(
      vscode.l10n.t('The Python extension selected "{0}", which lies inside this workspace.', path),
      {
        modal: true,
        detail: vscode.l10n.t(
          'Hearback will run this program to analyze your code. Only allow it if you trust the files in this workspace.',
        ),
      },
      allow,
      decline,
    );
    if (choice !== allow) {
      // Ask again in a later session; until then the resolution continues with PATH.
      this.declined.add(key);
      return 'declinedInSession';
    }
    const approved = this.globalState.get<string[]>(EXTENSION_APPROVALS_KEY, []);
    await this.globalState.update(
      EXTENSION_APPROVALS_KEY,
      [...approved.filter((entry) => entry !== key), key].slice(-MAX_APPROVALS),
    );
    return 'approved';
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
export class PythonExtensionSource implements vscode.Disposable {
  private api: PythonExtension | undefined;
  private listener: vscode.Disposable | undefined;

  /**
   * @param onDidChangeActiveEnvironment called when the Python extension reports a new active
   *   environment. Only subscribed once the API has been acquired: listening alone must never
   *   activate the Python extension.
   */
  constructor(private readonly onDidChangeActiveEnvironment: () => void = () => undefined) {}

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
    this.acquired(api);
    return api.environments;
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
      this.acquired(api);
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

  dispose(): void {
    this.listener?.dispose();
    this.listener = undefined;
  }

  private acquired(api: PythonExtension): void {
    if (this.api) {
      return;
    }
    this.api = api;
    this.listener = api.environments.onDidChangeActiveEnvironmentPath(() => {
      this.onDidChangeActiveEnvironment();
    });
  }
}
