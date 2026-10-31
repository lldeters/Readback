// "Readback: Select Python Interpreter": pick a detected interpreter, type a path or browse for
// one. The choice is stored in the user settings (never in the workspace), then the engine
// restarts with it. A pythonPath in workspace settings would override that choice, so the user
// decides first whether to ignore it.
import * as vscode from 'vscode';
import { errorMessage } from '../util/log';
import { EngineUnavailableError, type EngineService } from './engineService';
import { showEngineFailure } from './failureUi';
import { formatVersion } from './interpreter/probe';
import { describeOutcome, scopeLabel, sourceLabel } from './messages';
import { PYTHON_PATH_KEY, PYTHON_PATH_SETTING, SETTING_SECTION } from './settings';

type InterpreterItem = vscode.QuickPickItem &
  (
    | { readonly action: 'use'; readonly path: string }
    | { readonly action: 'rejected'; readonly reason: string }
    | { readonly action: 'enter' | 'browse' | 'automatic' | 'none' }
  );

async function detectedItems(service: EngineService): Promise<InterpreterItem[]> {
  const detected = await service.detectInterpreters();
  const usable: InterpreterItem[] = [];
  const rejected: InterpreterItem[] = [];
  for (const entry of detected) {
    if (entry.outcome.kind === 'ok') {
      const probe = entry.outcome.probe;
      usable.push({
        action: 'use',
        path: probe.executable,
        label: vscode.l10n.t('Python {0}', formatVersion(probe)),
        description: probe.executable,
        detail: sourceLabel(entry.source),
      });
    } else {
      const reason = describeOutcome(entry.outcome);
      rejected.push({
        action: 'rejected',
        reason,
        label: entry.command,
        description: reason,
        detail: sourceLabel(entry.source),
      });
    }
  }
  return rejected.length === 0
    ? usable
    : [
        ...usable,
        {
          kind: vscode.QuickPickItemKind.Separator,
          label: vscode.l10n.t('Not usable'),
          action: 'none',
        },
        ...rejected,
      ];
}

/** Lets the user pick; resolves to the chosen item and the typed text, or undefined. */
async function pickInterpreter(service: EngineService, log: vscode.LogOutputChannel) {
  const pick = vscode.window.createQuickPick<InterpreterItem>();
  pick.title = vscode.l10n.t('Readback: Python interpreter for the analysis engine');
  pick.placeholder = vscode.l10n.t('Python 3.10 or newer');
  pick.busy = true;
  pick.matchOnDescription = true;
  const fixed: InterpreterItem[] = [
    { action: 'enter', label: vscode.l10n.t('Enter interpreter path…'), alwaysShow: true },
    { action: 'browse', label: vscode.l10n.t('Browse…'), alwaysShow: true },
    {
      action: 'automatic',
      label: vscode.l10n.t('Use automatic detection'),
      description: vscode.l10n.t('Python extension, then PATH'),
      alwaysShow: true,
    },
  ];
  pick.items = fixed;
  pick.show();
  detectedItems(service)
    .then((items) => {
      pick.items = [
        ...items,
        { kind: vscode.QuickPickItemKind.Separator, label: '', action: 'none' },
        ...fixed,
      ];
    })
    .catch((error: unknown) => {
      log.warn(`Interpreter detection failed: ${errorMessage(error)}`);
    })
    .finally(() => {
      pick.busy = false;
    });

  const typed = { value: '' };
  const chosen = await new Promise<InterpreterItem | undefined>((resolve) => {
    pick.onDidAccept(() => {
      const item = pick.selectedItems[0];
      if (item?.action === 'rejected') {
        // Not usable: explain why and keep the picker open instead of storing a broken path.
        void vscode.window.showWarningMessage(
          vscode.l10n.t('This interpreter cannot be used: {0}', item.reason),
        );
        return;
      }
      typed.value = pick.value;
      resolve(item);
      pick.hide();
    });
    pick.onDidHide(() => {
      resolve(undefined);
    });
  });
  pick.dispose();
  return chosen === undefined ? undefined : { item: chosen, typed: typed.value };
}

async function askForPath(initial: string): Promise<string | undefined> {
  const value = await vscode.window.showInputBox({
    title: vscode.l10n.t('Python interpreter for Readback'),
    prompt: vscode.l10n.t('Full path of a Python 3.10+ executable, or a command on PATH'),
    value: initial,
    ignoreFocusOut: true,
    validateInput: (text) =>
      text.trim().length === 0 ? vscode.l10n.t('Enter a path or command.') : undefined,
  });
  return value?.trim();
}

async function browseForPath(): Promise<string | undefined> {
  const files = await vscode.window.showOpenDialog({
    canSelectMany: false,
    openLabel: vscode.l10n.t('Select Interpreter'),
    title: vscode.l10n.t('Python interpreter for Readback'),
    ...(process.platform === 'win32'
      ? { filters: { [vscode.l10n.t('Executables')]: ['exe'] } }
      : {}),
  });
  return files?.[0]?.fsPath;
}

/**
 * Workspace settings win over user settings. Returns false when the user cancels; true when the
 * pick can take effect (no workspace value, or the user chose to ignore it in this workspace).
 */
async function resolveWorkspaceOverride(service: EngineService): Promise<boolean> {
  const scoped = service.workspaceInterpreterSetting();
  if (!scoped) {
    return true;
  }
  const ignore = vscode.l10n.t('Ignore Workspace Setting');
  const open = vscode.l10n.t('Open Workspace Settings');
  const choice = await vscode.window.showWarningMessage(
    vscode.l10n.t(
      'The {0} set {1} to "{2}".',
      scopeLabel(scoped.scope),
      PYTHON_PATH_SETTING,
      scoped.value,
    ),
    {
      modal: true,
      detail: vscode.l10n.t(
        'This value takes precedence over your user settings. Ignore it in this workspace so your choice applies, or change it in the workspace settings.',
      ),
    },
    ignore,
    open,
  );
  if (choice === ignore) {
    await service.ignoreWorkspaceInterpreterSetting(scoped.value);
    return true;
  }
  if (choice === open) {
    await vscode.commands.executeCommand(
      scoped.scope === 'workspaceFolder'
        ? 'workbench.action.openFolderSettings'
        : 'workbench.action.openWorkspaceSettings',
      { query: PYTHON_PATH_SETTING },
    );
  }
  return false;
}

export async function selectInterpreter(
  service: EngineService,
  log: vscode.LogOutputChannel,
): Promise<void> {
  const picked = await pickInterpreter(service, log);
  if (!picked) {
    return;
  }
  let value: string | undefined;
  switch (picked.item.action) {
    case 'use':
      value = picked.item.path;
      break;
    case 'enter':
      value = await askForPath(picked.typed);
      if (!value) {
        return;
      }
      break;
    case 'browse':
      value = await browseForPath();
      if (!value) {
        return;
      }
      break;
    case 'automatic':
      value = undefined;
      break;
    default:
      return;
  }
  if (!(await resolveWorkspaceOverride(service))) {
    return;
  }

  await vscode.workspace
    .getConfiguration(SETTING_SECTION)
    .update(PYTHON_PATH_KEY, value, vscode.ConfigurationTarget.Global);
  try {
    const connection = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Window,
        title: vscode.l10n.t('Restarting Readback engine…'),
      },
      () => service.restart({ interactive: true }),
    );
    vscode.window.setStatusBarMessage(
      vscode.l10n.t(
        'Readback engine runs on Python {0}',
        connection.initializeResult.python.version,
      ),
      5_000,
    );
  } catch (error) {
    if (error instanceof EngineUnavailableError) {
      await showEngineFailure(error.failure, log);
    } else {
      log.error(`Engine restart after interpreter change failed: ${errorMessage(error)}`);
    }
  }
}
