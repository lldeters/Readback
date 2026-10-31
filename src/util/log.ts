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

/**
 * A logger that never throws. VS Code closes the output channel while asynchronous clean-up (the
 * engine shutdown) may still be logging; a throwing logger must not break that clean-up.
 */
export function safeLogger(logger: Logger): Logger {
  const guard =
    (write: (message: string) => void) =>
    (message: string): void => {
      try {
        write(message);
      } catch {
        // The channel is closed; nothing useful is left to do with the message.
      }
    };
  return {
    trace: guard((message) => {
      logger.trace(message);
    }),
    debug: guard((message) => {
      logger.debug(message);
    }),
    info: guard((message) => {
      logger.info(message);
    }),
    warn: guard((message) => {
      logger.warn(message);
    }),
    error: guard((message) => {
      logger.error(message);
    }),
  };
}

/** Error message of an unknown thrown value, for log lines and status details. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
