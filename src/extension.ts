import * as vscode from 'vscode';
import { registerEngineCommands } from './engine/commands';
import { EngineService } from './engine/engineService';
import { registerGraphPanel } from './views/graphPanel';

let engine: EngineService | undefined;
let log: vscode.LogOutputChannel | undefined;

/** Activation only registers commands; the engine starts on first use (spec 2.6, 8). */
export function activate(context: vscode.ExtensionContext): void {
  // Not in context.subscriptions: VS Code disposes those synchronously while deactivate() is still
  // stopping the engine, and the engine logs until it has exited.
  log = vscode.window.createOutputChannel('Hearback', { log: true });
  engine = new EngineService(context, log);
  context.subscriptions.push(
    engine,
    registerEngineCommands(engine, log),
    registerGraphPanel(context, log),
  );
}

/** Stops the engine gracefully (shutdown, exit, kill after 2 s), then closes the log. */
export async function deactivate(): Promise<void> {
  try {
    await engine?.shutdown();
  } finally {
    engine = undefined;
    log?.dispose();
    log = undefined;
  }
}
