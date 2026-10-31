// Parses the engine's stderr. The engine writes one log record per line as "[<level>] <message>";
// continuation lines (tracebacks) start with four spaces. Anything else (stray prints, interpreter
// errors before logging is configured) is reported as raw output.
import type { FatalStartupError } from '../shared/generated/engineProtocol';
import { FATAL_PREFIX } from './protocol';

export type EngineLogLevel = 'trace' | 'debug' | 'info' | 'warning' | 'error';

export type StderrRecord =
  | { readonly kind: 'log'; readonly level: EngineLogLevel; readonly message: string }
  | { readonly kind: 'fatal'; readonly error: FatalStartupError }
  | { readonly kind: 'raw'; readonly message: string };

const RECORD = /^\[(trace|debug|info|warning|error)\] (.*)$/;
const CONTINUATION = '    ';
/** Longer lines are cut so a runaway engine cannot flood the log. */
const MAX_LINE = 16_384;

function parseFatal(json: string): FatalStartupError | undefined {
  try {
    const value: unknown = JSON.parse(json);
    if (typeof value === 'object' && value !== null && 'code' in value) {
      const code = value.code;
      if (code === 'python-too-old' || code === 'bootstrap-failed') {
        return value as FatalStartupError;
      }
    }
  } catch {
    // Not JSON: report the line as raw output instead.
  }
  return undefined;
}

/** Splits a stream of stderr chunks into records. */
export class StderrParser {
  private buffer = '';
  private lastLevel: EngineLogLevel | undefined;

  constructor(private readonly onRecord: (record: StderrRecord) => void) {}

  push(chunk: string): void {
    this.buffer += chunk;
    let newline = this.buffer.indexOf('\n');
    while (newline >= 0) {
      this.emit(this.buffer.slice(0, newline));
      this.buffer = this.buffer.slice(newline + 1);
      newline = this.buffer.indexOf('\n');
    }
    if (this.buffer.length > MAX_LINE) {
      this.emit(this.buffer);
      this.buffer = '';
    }
  }

  /** Emits a trailing line without newline, e.g. when the process has exited. */
  flush(): void {
    if (this.buffer.length > 0) {
      this.emit(this.buffer);
      this.buffer = '';
    }
  }

  private emit(rawLine: string): void {
    const line = rawLine.replace(/\r$/, '').slice(0, MAX_LINE);
    if (line.length === 0) {
      return;
    }
    if (line.startsWith(FATAL_PREFIX)) {
      const error = parseFatal(line.slice(FATAL_PREFIX.length));
      if (error) {
        this.onRecord({ kind: 'fatal', error });
        return;
      }
    }
    const match = RECORD.exec(line);
    if (match) {
      const level = match[1] as EngineLogLevel;
      this.lastLevel = level;
      this.onRecord({ kind: 'log', level, message: match[2] ?? '' });
      return;
    }
    if (line.startsWith(CONTINUATION) && this.lastLevel) {
      this.onRecord({ kind: 'log', level: this.lastLevel, message: line });
      return;
    }
    this.lastLevel = undefined;
    this.onRecord({ kind: 'raw', message: line });
  }
}
