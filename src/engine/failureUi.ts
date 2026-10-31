// Error notification for engine failures, shared by the commands and the interpreter picker.
import * as vscode from 'vscode';
import type { EngineFailure } from './engineService';
import { describeFailure } from './messages';

export const MANAGE_TRUST_COMMAND = 'workbench.trust.manage';

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
