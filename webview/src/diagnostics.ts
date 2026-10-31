// Reports problems the page cannot show itself (CSP violations, uncaught errors, a missing
// stylesheet) to the host, which logs them and exposes them to the integration tests.
import type { WebviewToHostMessage } from '../../src/shared/webviewProtocol';
import type { HostApi } from './hostApi';
import { describeError, truncate } from './text';

/** Custom property set by theme.css; its absence means main.css was not applied. */
export const STYLESHEET_MARKER = '--readback-stylesheet';

/**
 * Installs the listeners. Call this before anything else runs so early problems are caught too.
 * Returns a function that removes them again.
 */
export function installDiagnostics(view: Window, host: HostApi): () => void {
  const report = (message: WebviewToHostMessage): void => {
    try {
      host.postMessage(message);
    } catch {
      // The host side is gone; there is nobody left to tell.
    }
  };
  const onViolation = (event: SecurityPolicyViolationEvent): void => {
    report({
      type: 'cspViolation',
      directive: truncate(event.violatedDirective),
      blockedUri: truncate(event.blockedURI),
    });
  };
  const onError = (event: ErrorEvent): void => {
    report({ type: 'error', message: truncate(describeErrorEvent(event)) });
  };
  const onRejection = (event: PromiseRejectionEvent): void => {
    report({
      type: 'error',
      message: truncate(`Unhandled promise rejection: ${describeError(event.reason)}`),
    });
  };
  // Violations are dispatched at the offending element or at the document; both reach this listener.
  view.document.addEventListener('securitypolicyviolation', onViolation);
  view.addEventListener('error', onError);
  view.addEventListener('unhandledrejection', onRejection);
  return () => {
    view.document.removeEventListener('securitypolicyviolation', onViolation);
    view.removeEventListener('error', onError);
    view.removeEventListener('unhandledrejection', onRejection);
  };
}

/**
 * Whether main.css was applied. A CSP block of the stylesheet happens while the document is parsed,
 * before main.js can listen for violations, so it is checked this way instead. Parser-inserted
 * scripts wait for pending stylesheets, so the answer is final when main.js runs.
 */
export function isStylesheetApplied(view: Window): boolean {
  const style = view.getComputedStyle(view.document.documentElement);
  return style.getPropertyValue(STYLESHEET_MARKER).trim() !== '';
}

function describeErrorEvent(event: ErrorEvent): string {
  // event.error is null for errors from cross-origin scripts ("Script error.").
  const description =
    event.error !== null && event.error !== undefined
      ? describeError(event.error)
      : event.message || 'Unknown error';
  return event.filename === ''
    ? description
    : `${description} (${event.filename}:${event.lineno}:${event.colno})`;
}
