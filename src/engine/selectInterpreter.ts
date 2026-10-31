// "Readback: Select Python Interpreter": pick a detected interpreter or browse for one. The choice
// is stored in the user settings (never in the workspace), then the engine restarts with it.
import * as vscode from 'vscode';
import { errorMessage } from '../util/log';
import type { EngineService } from './engineService';
import { formatVersion } from './interpreter/probe';
import { PYTHON_PATH_KEY, SETTING_SECTION } from './settings';
import { describeOutcome, sourceLabel } from './messages';

interface InterpreterItem extends vscode.QuickPickItem {
  readonly action: 'use' | 'browse' | 'automatic';
  readonly path?: string;
}

async function detectedItems(service: EngineService): Promise<InterpreterItem[]> {
  const detected = await service.detectInterpreters();
  // Usable interpreters first, then the rejected ones with the reason.
  const ordered = [
    ...detected.filter((entry) => entry.outcome.kind === 'ok'),
    ...detected.filter((entry) => entry.outcome.kind !== 'ok'),
  ];
  return ordered.map((entry): InterpreterItem => {
    if (entry.outcome.kind === 'ok') {
      const probe = entry.outcome.probe;
      return {
        action: 'use',
        path: probe.executable,
        label: vscode.l10n.t('Python {0}', formatVersion(probe)),
        description: probe.executable,
        detail: sourceLabel(entry.source),
      };
    }
    return {
      action: 'use',
      path: entry.command,
      label: entry.command,
      description: describeOutcome(entry.outcome),
      detail: sourceLabel(entry.source),
    };
  });
}

export async function selectInterpreter(service: EngineService, log: vscode.LogOutputChannel) {
  const pick = vscode.window.createQuickPick<InterpreterItem>();
  pick.title = vscode.l10n.t('Readback: Python interpreter for the analysis engine');
  pick.placeholder = vscode.l10n.t('Python 3.10 or newer');
  pick.busy = true;
  pick.matchOnDescription = true;
  const fixed: InterpreterItem[] = [
    {
      action: 'browse',
      label: vscode.l10n.t('Enter interpreter path…'),
      alwaysShow: true,
    },
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
        { kind: vscode.QuickPickItemKind.Separator, label: '', action: 'browse' },
        ...fixed,
      ];
    })
    .catch((error: unknown) => {
      log.warn(`Interpreter detection failed: ${errorMessage(error)}`);
    })
    .finally(() => {
      pick.busy = false;
    });

  const chosen = await new Promise<InterpreterItem | undefined>((resolve) => {
    pick.onDidAccept(() => {
      resolve(pick.selectedItems[0]);
      pick.hide();
    });
    pick.onDidHide(() => {
      resolve(undefined);
    });
  });
  pick.dispose();
  if (!chosen) {
    return;
  }

  let value: string | undefined;
  if (chosen.action === 'browse') {
    const files = await vscode.window.showOpenDialog({
      canSelectMany: false,
      openLabel: vscode.l10n.t('Select Interpreter'),
      title: vscode.l10n.t('Python interpreter for Readback'),
      ...(process.platform === 'win32'
        ? { filters: { [vscode.l10n.t('Executables')]: ['exe'] } }
        : {}),
    });
    const file = files?.[0];
    if (!file) {
      return;
    }
    value = file.fsPath;
  } else if (chosen.action === 'use') {
    value = chosen.path;
  }

  await vscode.workspace
    .getConfiguration(SETTING_SECTION)
    .update(PYTHON_PATH_KEY, value, vscode.ConfigurationTarget.Global);
  try {
    const connection = await service.restart({ interactive: true });
    vscode.window.setStatusBarMessage(
      vscode.l10n.t(
        'Readback engine runs on Python {0}',
        connection.initializeResult.python.version,
      ),
      5_000,
    );
  } catch (error) {
    log.warn(`Engine restart after interpreter change failed: ${errorMessage(error)}`);
    await vscode.commands.executeCommand('readback.showEngineStatus');
  }
}
