import { act, render, screen, waitFor } from '@testing-library/react';
import * as l10n from '@vscode/l10n';
import { StrictMode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import type { GraphDocument } from '../../src/shared/generated/graph';
import { isWebviewToHostMessage } from '../../src/shared/webviewProtocol';
import { App } from '../src/App';
import { MAX_REPORTED_LENGTH } from '../src/text';
import type { WorkerCheck } from '../src/workerCheck';
import {
  FakeHost,
  WORKER_URI,
  bootData,
  fixedWorkerCheck,
  pendingWorkerCheck,
  postFromHost,
} from './fakes';

const EMPTY_TITLE = 'No graph to show yet.';
/** A complete document without nodes, typed so that it follows the current graph schema. */
const EMPTY_DOCUMENT: GraphDocument = {
  schemaVersion: 2,
  view: 'classAnatomy',
  nodes: [],
  edges: [],
  diagnostics: [],
  meta: { engineVersion: '0.0.1', durationMs: 0 },
};
const EMPTY_DETAIL = 'Hearback visualizations will appear here.';

function renderApp(checkWorker: WorkerCheck = pendingWorkerCheck, host = new FakeHost()) {
  const view = render(<App host={host} boot={bootData()} checkWorker={checkWorker} />);
  return { host, ...view };
}

afterEach(() => {
  l10n.config({ contents: {} });
  document.body.className = '';
});

describe('App', () => {
  it('announces itself with ready after mounting', () => {
    const { host } = renderApp();
    expect(host.types()).toEqual(['ready']);
  });

  it('posts ready before the worker result', async () => {
    const check = fixedWorkerCheck({ ok: true, roundTripMs: 3.5 });
    const { host } = renderApp(check);
    await waitFor(() => {
      expect(host.types()).toEqual(['ready', 'workerReady']);
    });
    expect(host.ofType('workerReady')).toEqual([{ type: 'workerReady', roundTripMs: 3.5 }]);
    expect(check.calls.map((call) => call.workerUri)).toEqual([WORKER_URI]);
  });

  it('reports a failed worker check with a message the host accepts', async () => {
    const { host } = renderApp(fixedWorkerCheck({ ok: false, message: 'x'.repeat(5000) }));
    await waitFor(() => {
      expect(host.ofType('workerError')).toHaveLength(1);
    });
    const [report] = host.ofType('workerError');
    expect(report?.message).toHaveLength(MAX_REPORTED_LENGTH);
    expect(isWebviewToHostMessage(report)).toBe(true);
  });

  it('reports a worker check that rejects', async () => {
    const { host } = renderApp(() => Promise.reject(new Error('unexpected')));
    await waitFor(() => {
      expect(host.ofType('workerError')).toEqual([
        { type: 'workerError', message: 'Error: unexpected' },
      ]);
    });
  });

  it('cancels the worker check on unmount and reports nothing afterwards', async () => {
    const calls: AbortSignal[] = [];
    const { host, unmount } = renderApp((uri, signal) => {
      calls.push(signal);
      return pendingWorkerCheck(uri, signal);
    });
    unmount();
    expect(calls[0]?.aborted).toBe(true);
    await Promise.resolve();
    expect(host.types()).toEqual(['ready']);
  });

  it('reports the worker result once under StrictMode double mounting', async () => {
    const host = new FakeHost();
    const check = fixedWorkerCheck({ ok: true, roundTripMs: 1 });
    render(
      <StrictMode>
        <App host={host} boot={bootData()} checkWorker={check} />
      </StrictMode>,
    );
    await waitFor(() => {
      expect(host.ofType('workerReady')).toHaveLength(1);
    });
    expect(check.calls[0]?.signal.aborted).toBe(true);
  });

  it('shows the empty state over an accessible canvas', () => {
    renderApp();
    expect(screen.getByRole('main')).toBeTruthy();
    const status = screen.getByRole('status');
    expect(status.textContent).toBe(`${EMPTY_TITLE}${EMPTY_DETAIL}`);
    expect(screen.getByRole('application', { name: 'Graph canvas' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Graph controls' })).toBeTruthy();
  });

  it('offers keyboard-reachable zoom controls without the interactivity toggle', () => {
    renderApp();
    for (const name of ['Zoom in', 'Zoom out', 'Fit view']) {
      const button = screen.getByRole('button', { name });
      expect(button.tagName).toBe('BUTTON');
      expect(button.tabIndex).toBe(0);
    }
    expect(screen.queryByRole('button', { name: /interactiv/i })).toBeNull();
  });

  it('renders its texts through the l10n bundle', () => {
    l10n.config({
      contents: {
        [EMPTY_TITLE]: 'Noch kein Graph vorhanden.',
        [EMPTY_DETAIL]: 'Hier erscheinen die Visualisierungen von Hearback.',
        'Zoom in': 'Vergrößern',
        'Graph canvas': 'Graph-Zeichenfläche',
      },
    });
    renderApp();
    expect(screen.getByText('Noch kein Graph vorhanden.')).toBeTruthy();
    expect(screen.getByText('Hier erscheinen die Visualisierungen von Hearback.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Vergrößern' })).toBeTruthy();
    expect(screen.getByRole('application', { name: 'Graph-Zeichenfläche' })).toBeTruthy();
  });

  it('hides the empty state while a graph is set and shows it again for null', () => {
    renderApp();
    act(() => {
      postFromHost({ type: 'setGraph', document: EMPTY_DOCUMENT });
    });
    expect(screen.queryByRole('status')).toBeNull();
    act(() => {
      postFromHost({ type: 'setGraph', document: null });
    });
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('ignores messages that are not from the host protocol', () => {
    renderApp();
    act(() => {
      postFromHost({ type: 'setGraph', document: 'not a document' });
      postFromHost({ type: 'somethingElse' });
      postFromHost('setGraph');
    });
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('follows the VS Code theme with the React Flow color mode', async () => {
    document.body.className = 'vscode-light';
    const { container } = renderApp();
    const flow = container.querySelector('.react-flow');
    expect(flow?.classList.contains('light')).toBe(true);
    await act(async () => {
      document.body.className = 'vscode-dark';
      await Promise.resolve();
    });
    expect(flow?.classList.contains('dark')).toBe(true);
  });
});
