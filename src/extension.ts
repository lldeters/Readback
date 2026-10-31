import * as vscode from 'vscode';
import { registerEngineCommands } from './engine/commands';
import { EngineService } from './engine/engineService';

let engine: EngineService | undefined;

/** Activation only registers commands; the engine starts on first use (spec 2.6, 8). */
export function activate(context: vscode.ExtensionContext): void {
  const log = vscode.window.createOutputChannel('Readback', { log: true });
  engine = new EngineService(context, log);
  context.subscriptions.push(log, engine, registerEngineCommands(engine, log));
}

/** Stops the engine gracefully (shutdown, exit, kill after 2 s). */
export async function deactivate(): Promise<void> {
  await engine?.shutdown();
  engine = undefined;
}
