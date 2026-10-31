/**
 * Minimal logging interface. vscode.LogOutputChannel satisfies it structurally, so the engine and
 * interpreter modules stay free of the 'vscode' module and can be unit-tested in plain Node.
 */
export interface Logger {
  trace(message: string): void;
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
}

/** Discards everything; handy as a default in tests. */
export const nullLogger: Logger = {
  trace: () => undefined,
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

/** Error message of an unknown thrown value, for log lines and status details. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
