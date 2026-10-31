import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { isWebviewToHostMessage } from '../../src/shared/webviewProtocol';
import { STYLESHEET_MARKER, installDiagnostics, isStylesheetApplied } from '../src/diagnostics';
import { MAX_REPORTED_LENGTH } from '../src/text';
import { FakeHost } from './fakes';

// jsdom has no SecurityPolicyViolationEvent; the listener only reads these two fields.
function violation(violatedDirective: string, blockedURI: string): Event {
  const event = new Event('securitypolicyviolation', { bubbles: true, composed: true });
  Object.defineProperties(event, {
    violatedDirective: { value: violatedDirective },
    blockedURI: { value: blockedURI },
  });
  return event;
}

let host: FakeHost;
let remove: () => void;

beforeEach(() => {
  host = new FakeHost();
  remove = installDiagnostics(window, host);
});

afterEach(() => {
  remove();
});

describe('installDiagnostics', () => {
  it('reports CSP violations raised at an element', () => {
    const link = document.createElement('link');
    document.head.append(link);
    link.dispatchEvent(violation('style-src-elem', 'https://evil.test/x.css'));
    link.remove();
    expect(host.messages).toEqual([
      { type: 'cspViolation', directive: 'style-src-elem', blockedUri: 'https://evil.test/x.css' },
    ]);
  });

  it('reports CSP violations raised at the document', () => {
    document.dispatchEvent(violation('connect-src', 'https://evil.test/data'));
    expect(host.ofType('cspViolation')).toHaveLength(1);
  });

  it('truncates long reports so the host accepts them', () => {
    const blocked = `data:text/css,${'a'.repeat(10_000)}`;
    document.dispatchEvent(violation('style-src-elem', blocked));
    const [message] = host.messages;
    expect(message).toMatchObject({ type: 'cspViolation', directive: 'style-src-elem' });
    expect(message?.type === 'cspViolation' && message.blockedUri.length).toBe(MAX_REPORTED_LENGTH);
    expect(isWebviewToHostMessage(message)).toBe(true);
  });

  it('reports uncaught errors with their location', () => {
    window.dispatchEvent(
      new ErrorEvent('error', {
        error: new TypeError('x is undefined'),
        message: 'Uncaught TypeError: x is undefined',
        filename: 'https://webview.test/main.js',
        lineno: 3,
        colno: 14,
      }),
    );
    expect(host.messages).toEqual([
      { type: 'error', message: 'TypeError: x is undefined (https://webview.test/main.js:3:14)' },
    ]);
  });

  it('reports muted cross-origin errors with the browser message', () => {
    window.dispatchEvent(new ErrorEvent('error', { message: 'Script error.' }));
    expect(host.messages).toEqual([{ type: 'error', message: 'Script error.' }]);
  });

  it('reports unhandled promise rejections', () => {
    window.dispatchEvent(
      new PromiseRejectionEvent('unhandledrejection', {
        promise: Promise.resolve(),
        reason: new Error('nope'),
      }),
    );
    expect(host.messages).toEqual([
      { type: 'error', message: 'Unhandled promise rejection: Error: nope' },
    ]);
  });

  it('keeps going when the host cannot be reached', () => {
    remove();
    remove = installDiagnostics(window, {
      postMessage: () => {
        throw new Error('disposed');
      },
    });
    expect(() => {
      document.dispatchEvent(violation('img-src', 'https://x'));
    }).not.toThrow();
  });

  it('stops reporting once removed', () => {
    remove();
    document.dispatchEvent(violation('img-src', 'https://x'));
    window.dispatchEvent(new ErrorEvent('error', { message: 'late' }));
    expect(host.messages).toEqual([]);
  });
});

describe('isStylesheetApplied', () => {
  afterEach(() => {
    document.documentElement.style.removeProperty(STYLESHEET_MARKER);
  });

  it('is false without theme.css', () => {
    expect(isStylesheetApplied(window)).toBe(false);
  });

  it('is true once the marker property of theme.css applies', () => {
    document.documentElement.style.setProperty(STYLESHEET_MARKER, 'loaded');
    expect(isStylesheetApplied(window)).toBe(true);
  });
});
