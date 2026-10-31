// Contract between the extension host (src/views) and the webview app (webview/src).
// Pure types plus runtime guards: no 'vscode' or DOM imports, so both sides can use it.
import type { GraphDocument } from './generated/graph';

/** Data the host embeds in the webview HTML (data-boot attribute of #readback-boot, HTML-escaped JSON). */
export interface WebviewBootData {
  /** Which view the panel shows. Phase 0 only has the empty graph view. */
  readonly view: 'graph';
  /** vscode.env.language, e.g. 'en' or 'de'. */
  readonly locale: string;
  /** vscode.l10n.bundle (undefined for English): passed to l10n.config({ contents }) in the webview. */
  readonly l10nBundle: Record<string, string> | undefined;
  /** asWebviewUri of dist/webview/layout.worker.js; fetched and started from a blob: URL. */
  readonly workerUri: string;
}

/** Replaces the displayed graph; null shows the empty state. */
export interface SetGraphMessage {
  readonly type: 'setGraph';
  readonly document: GraphDocument | null;
}

/** Messages from the host to the webview. */
export type HostToWebviewMessage = SetGraphMessage;

/** A Content Security Policy violation observed in the webview (securitypolicyviolation event). */
export interface CspViolation {
  readonly directive: string;
  readonly blockedUri: string;
}

/** Messages from the webview to the host. Always validate with isWebviewToHostMessage. */
export type WebviewToHostMessage =
  | { readonly type: 'ready' }
  | { readonly type: 'workerReady'; readonly roundTripMs: number }
  | { readonly type: 'workerError'; readonly message: string }
  | ({ readonly type: 'cspViolation' } & CspViolation)
  | { readonly type: 'error'; readonly message: string };

const MAX_TEXT = 2000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isShortString(value: unknown): value is string {
  return typeof value === 'string' && value.length <= MAX_TEXT;
}

/** Runtime guard for messages arriving from the webview (untrusted input). */
export function isWebviewToHostMessage(value: unknown): value is WebviewToHostMessage {
  if (!isRecord(value) || typeof value.type !== 'string') {
    return false;
  }
  switch (value.type) {
    case 'ready':
      return true;
    case 'workerReady':
      return (
        typeof value.roundTripMs === 'number' &&
        Number.isFinite(value.roundTripMs) &&
        value.roundTripMs >= 0
      );
    case 'workerError':
    case 'error':
      return isShortString(value.message);
    case 'cspViolation':
      return isShortString(value.directive) && isShortString(value.blockedUri);
    default:
      return false;
  }
}

/** Runtime guard for messages arriving from the host. */
export function isHostToWebviewMessage(value: unknown): value is HostToWebviewMessage {
  return (
    isRecord(value) &&
    value.type === 'setGraph' &&
    (value.document === null || isRecord(value.document))
  );
}

/** State the host records per graph panel; exposed to integration tests via a hidden command. */
export interface GraphPanelState {
  readonly open: boolean;
  readonly ready: boolean;
  readonly workerReady: boolean;
  readonly workerRoundTripMs: number | undefined;
  readonly cspViolations: readonly CspViolation[];
  readonly errors: readonly string[];
}
