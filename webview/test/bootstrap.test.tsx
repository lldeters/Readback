import { act, screen, waitFor } from '@testing-library/react';
import * as l10n from '@vscode/l10n';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WebviewBootData } from '../../src/shared/webviewProtocol';
import { BOOT_ELEMENT_ID } from '../src/bootData';
import { ROOT_ELEMENT_ID, bootstrap, type RunningWebview } from '../src/bootstrap';
import { STYLESHEET_MARKER } from '../src/diagnostics';
import type { WorkerCheck } from '../src/workerCheck';
import { FakeHost, bootData, fixedWorkerCheck } from './fakes';

let host: FakeHost;
let running: RunningWebview | undefined;

/** Builds the page the host renders: boot meta, root element and the applied stylesheet. */
function preparePage(boot: WebviewBootData | string | undefined, withRoot = true): void {
  if (boot !== undefined) {
    const meta = document.createElement('meta');
    meta.id = BOOT_ELEMENT_ID;
    meta.dataset.boot = typeof boot === 'string' ? boot : JSON.stringify(boot);
    document.head.append(meta);
  }
  if (withRoot) {
    const root = document.createElement('div');
    root.id = ROOT_ELEMENT_ID;
    document.body.append(root);
  }
  document.documentElement.style.setProperty(STYLESHEET_MARKER, 'loaded');
}

async function start(checkWorker: WorkerCheck = fixedWorkerCheck({ ok: true, roundTripMs: 2 })) {
  await act(async () => {
    running = bootstrap({ view: window, host, checkWorker });
    await Promise.resolve();
  });
}

beforeEach(() => {
  host = new FakeHost();
});

afterEach(() => {
  act(() => {
    running?.dispose();
  });
  running = undefined;
  document.head.replaceChildren();
  document.body.replaceChildren();
  document.documentElement.style.removeProperty(STYLESHEET_MARKER);
  l10n.config({ contents: {} });
  vi.restoreAllMocks();
});

describe('bootstrap', () => {
  it('renders the graph view and reports ready and the worker result', async () => {
    preparePage(bootData());
    await start();
    expect(screen.getByRole('status').textContent).toContain('No graph to show yet.');
    await waitFor(() => {
      expect(host.types().at(-1)).toBe('workerReady');
    });
    // StrictMode mounts effects twice in development builds, so 'ready' may come twice.
    expect(new Set(host.types().slice(0, -1))).toEqual(new Set(['ready']));
  });

  it('configures l10n from the boot data before rendering', async () => {
    preparePage(
      bootData({ l10nBundle: { 'No graph to show yet.': 'Noch kein Graph vorhanden.' } }),
    );
    await start();
    expect(screen.getByText('Noch kein Graph vorhanden.')).toBeTruthy();
  });

  it('reports invalid boot data and shows a plain error instead of the app', async () => {
    preparePage('{"view":"graph"');
    await start();
    expect(host.messages).toEqual([
      { type: 'error', message: 'Invalid boot data: data-boot is not valid JSON.' },
    ]);
    expect(screen.getByRole('alert').textContent).toBe(
      'Hearback could not display this view. See the Hearback log for details.',
    );
    expect(screen.queryByRole('application')).toBeNull();
  });

  it('reports a missing boot element', async () => {
    preparePage(undefined);
    await start();
    expect(host.types()).toEqual(['error']);
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('reports boot data for an unknown view', async () => {
    preparePage(JSON.stringify({ ...bootData(), view: 'somethingElse' }));
    await start();
    expect(host.messages).toEqual([
      { type: 'error', message: 'Invalid boot data: the view is not "graph".' },
    ]);
  });

  it('reports a stylesheet that was not applied', async () => {
    preparePage(bootData());
    document.documentElement.style.removeProperty(STYLESHEET_MARKER);
    await start();
    expect(host.messages[0]).toEqual({
      type: 'error',
      message: 'The stylesheet main.css was not applied.',
    });
  });

  it('renders into a fallback element when #root is missing', async () => {
    preparePage(bootData(), false);
    await start();
    expect(host.messages[0]).toEqual({ type: 'error', message: 'The #root element is missing.' });
    expect(screen.getByRole('application')).toBeTruthy();
  });

  it('reports CSP violations from the moment it starts', async () => {
    preparePage(bootData());
    await start();
    const event = new Event('securitypolicyviolation', { bubbles: true });
    Object.defineProperties(event, {
      violatedDirective: { value: 'worker-src' },
      blockedURI: { value: 'blob' },
    });
    document.dispatchEvent(event);
    expect(host.ofType('cspViolation')).toEqual([
      { type: 'cspViolation', directive: 'worker-src', blockedUri: 'blob' },
    ]);
  });

  it('replaces a crashed view with the error message and reports the error', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    preparePage(bootData());
    await start(() => {
      throw new Error('render bug');
    });
    expect(screen.getByRole('alert')).toBeTruthy();
    // StrictMode runs the failing effect twice in development builds.
    const reports = host.ofType('error').map((message) => message.message);
    expect(reports.length).toBeGreaterThan(0);
    expect(new Set(reports)).toEqual(new Set(['Rendering failed: Error: render bug']));
  });

  it('removes its listeners and unmounts on dispose', async () => {
    preparePage(bootData());
    await start();
    act(() => {
      running?.dispose();
    });
    running = undefined;
    expect(screen.queryByRole('application')).toBeNull();
    const before = host.messages.length;
    window.dispatchEvent(new ErrorEvent('error', { message: 'after dispose' }));
    expect(host.messages).toHaveLength(before);
  });
});
