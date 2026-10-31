// Message handling and recorded state of the graph panel, kept free of 'vscode' so it can be
// unit-tested. src/views/graphPanel.ts applies each outcome: it stores the state, writes the log
// line and posts the reply.
import {
  isWebviewToHostMessage,
  type CspViolation,
  type GraphPanelState,
  type HostToWebviewMessage,
} from '../shared/webviewProtocol';

/**
 * Upper bound for recorded CSP violations and errors, so a misbehaving page cannot grow the state
 * without limit. The earliest entries are kept because they usually show the cause; the log
 * receives every entry.
 */
export const MAX_RECORDED_ENTRIES = 50;

/** State while no graph panel exists. */
export const CLOSED_PANEL_STATE: GraphPanelState = Object.freeze({
  open: false,
  ready: false,
  workerReady: false,
  workerRoundTripMs: undefined,
  cspViolations: Object.freeze([]),
  errors: Object.freeze([]),
});

/** State of a freshly created panel whose page has not reported anything yet. */
export function openedPanelState(): GraphPanelState {
  return { ...CLOSED_PANEL_STATE, open: true };
}

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogLine {
  readonly level: LogLevel;
  readonly message: string;
}

export interface MessageOutcome {
  readonly state: GraphPanelState;
  readonly log: LogLine;
  /** Message to post back to the page, if any. */
  readonly reply: HostToWebviewMessage | undefined;
}

/** Validates one message from the page (untrusted input) and computes the resulting state. */
export function handleWebviewMessage(state: GraphPanelState, message: unknown): MessageOutcome {
  if (!isWebviewToHostMessage(message)) {
    return {
      state,
      reply: undefined,
      log: {
        level: 'warn',
        message: `Graph view: dropped an invalid message (${describeInvalid(message)}).`,
      },
    };
  }
  switch (message.type) {
    case 'ready':
      // A (re)loaded page runs a new worker check, so the previous result no longer applies.
      return {
        state: { ...state, ready: true, workerReady: false, workerRoundTripMs: undefined },
        // Phase 0 has no analysis yet: the page shows its empty state.
        reply: { type: 'setGraph', document: null },
        log: { level: 'debug', message: 'Graph view: page ready.' },
      };
    case 'workerReady':
      return {
        state: { ...state, workerReady: true, workerRoundTripMs: message.roundTripMs },
        reply: undefined,
        log: {
          level: 'info',
          message: `Graph view: layout worker ready (round trip ${formatMilliseconds(message.roundTripMs)} ms).`,
        },
      };
    case 'workerError':
      return {
        state: {
          ...state,
          workerReady: false,
          workerRoundTripMs: undefined,
          errors: append(state.errors, `Layout worker: ${message.message}`),
        },
        reply: undefined,
        log: {
          level: 'error',
          message: `Graph view: layout worker failed: ${oneLine(message.message)}`,
        },
      };
    case 'cspViolation': {
      const violation: CspViolation = {
        directive: message.directive,
        blockedUri: message.blockedUri,
      };
      const blocked = message.blockedUri === '' ? 'a resource' : oneLine(message.blockedUri);
      return {
        state: { ...state, cspViolations: append(state.cspViolations, violation) },
        reply: undefined,
        log: {
          level: 'warn',
          message: `Graph view: the Content Security Policy blocked ${blocked} (${oneLine(message.directive)}).`,
        },
      };
    }
    case 'error':
      return {
        state: { ...state, errors: append(state.errors, message.message) },
        reply: undefined,
        log: { level: 'error', message: `Graph view: ${oneLine(message.message)}` },
      };
  }
}

function append<T>(entries: readonly T[], entry: T): readonly T[] {
  return entries.length >= MAX_RECORDED_ENTRIES ? entries : [...entries, entry];
}

// Text from the page goes into the log; line breaks and control characters would let it forge
// additional log lines.
function oneLine(text: string): string {
  return text.replace(/[\p{Cc}\p{Zl}\p{Zp}]+/gu, ' ');
}

function formatMilliseconds(milliseconds: number): string {
  return milliseconds < 10 ? milliseconds.toFixed(1) : String(Math.round(milliseconds));
}

// Describes a rejected message without echoing its (possibly large) content.
function describeInvalid(value: unknown): string {
  if (value === null) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'an array';
  }
  if (typeof value !== 'object') {
    return `a ${typeof value}`;
  }
  const type = (value as Record<string, unknown>).type;
  return typeof type === 'string'
    ? `type "${oneLine(type).slice(0, 40)}"`
    : 'an object without a string type';
}
