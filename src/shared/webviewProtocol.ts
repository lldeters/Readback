// Contract between the extension host (src/views) and the webview app (webview/src).
// Pure types plus runtime guards: no 'vscode' or DOM imports, so both sides can use it.
import type { GraphDocument } from './generated/graph';

/** Id of the <meta> element whose data-boot attribute carries the WebviewBootData. */
export const BOOT_ELEMENT_ID = 'readback-boot';

/** Id of the element the webview app renders into. */
export const ROOT_ELEMENT_ID = 'root';

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

export type BootDataResult =
  | { readonly ok: true; readonly data: WebviewBootData }
  | { readonly ok: false; readonly reason: string };

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === 'string');
}

/**
 * Validates parsed boot data. The attribute is the only input the page gets before it can talk to
 * the host, so it is checked like a message.
 */
export function parseWebviewBootData(value: unknown): BootDataResult {
  const invalid = (reason: string): BootDataResult => ({ ok: false, reason });
  if (!isRecord(value)) {
    return invalid('the boot data is not an object');
  }
  const { view, locale, l10nBundle, workerUri } = value;
  if (view !== 'graph') {
    return invalid('the view is not "graph"');
  }
  if (typeof locale !== 'string') {
    return invalid('the locale is not a string');
  }
  // JSON has no undefined: an English page has no l10nBundle property at all.
  if (l10nBundle !== undefined && l10nBundle !== null && !isStringRecord(l10nBundle)) {
    return invalid('the l10n bundle is not a map of strings');
  }
  if (typeof workerUri !== 'string' || workerUri === '') {
    return invalid('the worker URI is missing');
  }
  return { ok: true, data: { view, locale, l10nBundle: l10nBundle ?? undefined, workerUri } };
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
