// Engine commands. Every engine start here is triggered by the user (spec 2.6: no engine start on
// activation, no unprompted popups). Hidden hearback._test.* commands serve the integration tests.
import * as vscode from 'vscode';
import { errorMessage } from '../util/log';
import { EngineRequestFailure } from './engineConnection';
import { EngineUnavailableError, type EngineService } from './engineService';
import { MANAGE_TRUST_COMMAND, showEngineFailure } from './failureUi';
import { describeFailure, formatStatus } from './messages';
import { selectInterpreter } from './selectInterpreter';

async function showStatus(service: EngineService, log: vscode.LogOutputChannel): Promise<void> {
  let pingMs: number | undefined;
  let pingError: EngineRequestFailure | undefined;
  try {
    pingMs = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Window,
        title: vscode.l10n.t('Checking Hearback engine…'),
      },
      () => service.ping({ interactive: true }),
    );
  } catch (error) {
    if (error instanceof EngineRequestFailure) {
      // The engine started but did not answer: report it, never a healthy-looking status.
      pingError = error;
      log.warn(`Engine status: ping failed (${error.kind}): ${error.message}`);
    } else if (!(error instanceof EngineUnavailableError)) {
      log.error(`Engine status: ${errorMessage(error)}`);
    }
  }
  const status = service.status();
  const report = formatStatus(status, pingMs, pingError);
  const copy = vscode.l10n.t('Copy Details');
  const showLog = vscode.l10n.t('Show Log');
  const select = vscode.l10n.t('Select Interpreter…');
  const manageTrust = vscode.l10n.t('Manage Workspace Trust');
  const restart = vscode.l10n.t('Restart Engine');
  let choice: string | undefined;
  if (status.failure) {
    log.warn(`Engine status:\n${report}`);
    const actions = status.trusted ? [select, copy, showLog] : [select, manageTrust, copy, showLog];
    choice = await vscode.window.showErrorMessage(
      describeFailure(status.failure),
      { modal: true, detail: report },
      ...actions,
    );
  } else if (pingError) {
    log.warn(`Engine status:\n${report}`);
    choice = await vscode.window.showErrorMessage(
      vscode.l10n.t('The Hearback engine does not respond.'),
      { modal: true, detail: report },
      restart,
      copy,
      showLog,
    );
  } else {
    choice = await vscode.window.showInformationMessage(
      vscode.l10n.t('Hearback engine status'),
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
    await vscode.commands.executeCommand('hearback.selectInterpreter');
  } else if (choice === manageTrust) {
    await vscode.commands.executeCommand(MANAGE_TRUST_COMMAND);
  } else if (choice === restart) {
    await vscode.commands.executeCommand('hearback.restartEngine');
  }
}

async function restartEngine(service: EngineService, log: vscode.LogOutputChannel): Promise<void> {
  try {
    const connection = await vscode.window.withProgress(
      {
        location: vscode.ProgressLocation.Window,
        title: vscode.l10n.t('Restarting Hearback engine…'),
      },
      () => service.restart({ interactive: true }),
    );
    vscode.window.setStatusBarMessage(
      vscode.l10n.t(
        'Hearback engine restarted (Python {0})',
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
    vscode.commands.registerCommand('hearback.showEngineStatus', () => showStatus(service, log)),
    vscode.commands.registerCommand('hearback.restartEngine', () => restartEngine(service, log)),
    vscode.commands.registerCommand('hearback.selectInterpreter', () =>
      selectInterpreter(service, log),
    ),
    vscode.commands.registerCommand('hearback.showLog', () => {
      log.show();
    }),
    vscode.commands.registerCommand('hearback._test.engineState', () => service.state),
    vscode.commands.registerCommand('hearback._test.resolveInterpreter', async () =>
      plain(await service.resolve({ interactive: false })),
    ),
    vscode.commands.registerCommand('hearback._test.engineStatus', async () => {
      let pingMs: number | undefined;
      try {
        pingMs = await service.ping({ interactive: false });
      } catch {
        // The failure is part of the status.
      }
      return plain({ ...service.status(), pingMs });
    }),
    vscode.commands.registerCommand('hearback._test.restartEngine', async () => {
      try {
        await service.restart({ interactive: false });
      } catch {
        // The failure is part of the status.
      }
      return plain(service.status());
    }),
  );
}
