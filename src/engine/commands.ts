// Engine commands. Every engine start here is triggered by the user (spec 2.6: no engine start on
// activation, no unprompted popups). Hidden readback._test.* commands serve the integration tests.
import * as vscode from 'vscode';
import { errorMessage } from '../util/log';
import { EngineUnavailableError, type EngineFailure, type EngineService } from './engineService';
import { describeFailure, formatStatus } from './messages';
import { selectInterpreter } from './selectInterpreter';

const MANAGE_TRUST_COMMAND = 'workbench.trust.manage';

/** Error notification with the actions that can fix the problem. */
export async function showEngineFailure(
  failure: EngineFailure,
  log: vscode.LogOutputChannel,
): Promise<void> {
  const select = vscode.l10n.t('Select Interpreter…');
  const showLog = vscode.l10n.t('Show Log');
  const manageTrust = vscode.l10n.t('Manage Workspace Trust');
  const actions = vscode.workspace.isTrusted ? [select, showLog] : [select, manageTrust, showLog];
  const choice = await vscode.window.showErrorMessage(describeFailure(failure), ...actions);
  if (choice === select) {
    await vscode.commands.executeCommand('readback.selectInterpreter');
  } else if (choice === manageTrust) {
    await vscode.commands.executeCommand(MANAGE_TRUST_COMMAND);
  } else if (choice === showLog) {
    log.show();
  }
}

async function showStatus(service: EngineService, log: vscode.LogOutputChannel): Promise<void> {
  let pingMs: number | undefined;
  try {
    pingMs = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Window,
        title: vscode.l10n.t('Starting Readback engine…'),
      },
      () => service.ping({ interactive: true }),
    );
  } catch (error) {
    if (!(error instanceof EngineUnavailableError)) {
      log.error(`Engine status: ${errorMessage(error)}`);
    }
  }
  const status = service.status();
  const report = formatStatus(status, pingMs);
  const copy = vscode.l10n.t('Copy Details');
  const showLog = vscode.l10n.t('Show Log');
  const select = vscode.l10n.t('Select Interpreter…');
  const manageTrust = vscode.l10n.t('Manage Workspace Trust');
  let choice: string | undefined;
  if (status.failure) {
    log.warn(`Engine status:\n${report}`);
    const actions = status.trusted ? [select, copy, showLog] : [select, manageTrust, copy, showLog];
    choice = await vscode.window.showErrorMessage(
      describeFailure(status.failure),
      { modal: true, detail: report },
      ...actions,
    );
  } else {
    choice = await vscode.window.showInformationMessage(
      vscode.l10n.t('Readback engine status'),
      { modal: true, detail: report },
      copy,
      showLog,
    );
  }
  if (choice === copy) {
    await vscode.env.clipboard.writeText(report);
  } else if (choice === showLog) {
    log.show();
  } else if (choice === select) {
    await vscode.commands.executeCommand('readback.selectInterpreter');
  } else if (choice === manageTrust) {
    await vscode.commands.executeCommand(MANAGE_TRUST_COMMAND);
  }
}

async function restartEngine(service: EngineService, log: vscode.LogOutputChannel): Promise<void> {
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
        'Readback engine restarted (Python {0})',
        connection.initializeResult.python.version,
      ),
      5_000,
    );
  } catch (error) {
    if (error instanceof EngineUnavailableError) {
      await showEngineFailure(error.failure, log);
    } else {
      log.error(`Engine restart: ${errorMessage(error)}`);
    }
  }
}

/** JSON-safe copies for the hidden test commands (Error objects do not survive executeCommand). */
function plain(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_key, inner: unknown) =>
      inner instanceof Error
        ? { ...Object.fromEntries(Object.entries(inner)), name: inner.name, message: inner.message }
        : inner,
    ),
  );
}

export function registerEngineCommands(
  service: EngineService,
  log: vscode.LogOutputChannel,
): vscode.Disposable {
  return vscode.Disposable.from(
    vscode.commands.registerCommand('readback.showEngineStatus', () => showStatus(service, log)),
    vscode.commands.registerCommand('readback.restartEngine', () => restartEngine(service, log)),
    vscode.commands.registerCommand('readback.selectInterpreter', () =>
      selectInterpreter(service, log),
    ),
    vscode.commands.registerCommand('readback.showLog', () => {
      log.show();
    }),
    vscode.commands.registerCommand('readback._test.engineState', () => service.state),
    vscode.commands.registerCommand('readback._test.resolveInterpreter', async () =>
      plain(await service.resolve({ interactive: false })),
    ),
    vscode.commands.registerCommand('readback._test.engineStatus', async () => {
      let pingMs: number | undefined;
      try {
        pingMs = await service.ping({ interactive: false });
      } catch {
        // The failure is part of the status.
      }
      return plain({ ...service.status(), pingMs });
    }),
    vscode.commands.registerCommand('readback._test.restartEngine', async () => {
      try {
        await service.restart({ interactive: false });
      } catch {
        // The failure is part of the status.
      }
      return plain(service.status());
    }),
  );
}
