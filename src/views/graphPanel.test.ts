// Exercises the thin VS Code adapter against fake panels; the message logic itself is covered by
// graphPanelState.test.ts.
import type * as vscode from 'vscode';
import { Uri } from 'vscode';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GraphPanelState, WebviewBootData } from '../shared/webviewProtocol';
import {
  GRAPH_PANEL_STATE_COMMAND,
  GRAPH_VIEW_TYPE,
  OPEN_GRAPH_VIEW_COMMAND,
  registerGraphPanel,
} from './graphPanel';

const fake = vi.hoisted(() => {
  type Listener = (value: unknown) => void;

  class Emitter {
    private readonly listeners = new Set<Listener>();
    readonly event = (listener: Listener): { dispose(): void } => {
      this.listeners.add(listener);
      return {
        dispose: () => {
          this.listeners.delete(listener);
        },
      };
    };
    get listenerCount(): number {
      return this.listeners.size;
    }
    fire(value: unknown): void {
      for (const listener of [...this.listeners]) {
        listener(value);
      }
    }
  }

  class FakeWebview {
    html = '';
    readonly cspSource = "'self' https://csp.test";
    readonly received = new Emitter();
    readonly onDidReceiveMessage = this.received.event;
    readonly postMessage = vi.fn((_message: unknown) => Promise.resolve(true));
    asWebviewUri(uri: { path: string }): { toString(): string } {
      return { toString: () => `https://webview.test${uri.path}` };
    }
  }

  class FakeWebviewPanel {
    readonly webview = new FakeWebview();
    readonly disposed = new Emitter();
    readonly onDidDispose = this.disposed.event;
    readonly reveal = vi.fn();
    isDisposed = false;
    constructor(
      readonly viewType: string,
      readonly title: string,
      readonly showOptions: unknown,
      readonly options: Record<string, unknown>,
    ) {}
    dispose(): void {
      if (!this.isDisposed) {
        this.isDisposed = true;
        this.disposed.fire(undefined);
      }
    }
  }

  return {
    FakeWebviewPanel,
    panels: [] as FakeWebviewPanel[],
    commands: new Map<string, () => unknown>(),
    activeTextEditor: undefined as object | undefined,
  };
});

vi.mock('vscode', async (importOriginal) => {
  const stub = await importOriginal<typeof import('../../test/stubs/vscode')>();
  return {
    ...stub,
    ViewColumn: { Active: -1, Beside: -2 },
    window: {
      ...stub.window,
      get activeTextEditor() {
        return fake.activeTextEditor;
      },
      createWebviewPanel: (
        viewType: string,
        title: string,
        showOptions: unknown,
        options: Record<string, unknown>,
      ) => {
        const panel = new fake.FakeWebviewPanel(viewType, title, showOptions, options);
        fake.panels.push(panel);
        return panel;
      },
    },
    commands: {
      ...stub.commands,
      registerCommand: (id: string, handler: () => unknown) => {
        fake.commands.set(id, handler);
        return new stub.Disposable(() => {
          fake.commands.delete(id);
        });
      },
    },
  };
});

function createLog() {
  return { trace: vi.fn(), debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function run(command: string): unknown {
  const handler = fake.commands.get(command);
  if (!handler) {
    throw new Error(`${command} is not registered`);
  }
  return handler();
}

function panelState(): GraphPanelState {
  return run(GRAPH_PANEL_STATE_COMMAND) as GraphPanelState;
}

function onlyPanel() {
  expect(fake.panels).toHaveLength(1);
  const [panel] = fake.panels;
  if (!panel) {
    throw new Error('no panel');
  }
  return panel;
}

function bootDataOf(html: string): WebviewBootData {
  const match = /data-boot="([^"]*)"/.exec(html);
  const encoded = match?.[1] ?? '';
  const decoded = encoded
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
  return JSON.parse(decoded) as WebviewBootData;
}

let log: ReturnType<typeof createLog>;
let registration: vscode.Disposable;

beforeEach(() => {
  fake.panels.length = 0;
  fake.commands.clear();
  fake.activeTextEditor = undefined;
  log = createLog();
  const context = { extensionUri: Uri.file('/ext') } as unknown as vscode.ExtensionContext;
  registration = registerGraphPanel(context, log as unknown as vscode.LogOutputChannel);
});

afterEach(() => {
  registration.dispose();
});

describe('registerGraphPanel', () => {
  it('registers the open command and the hidden state command', () => {
    expect([...fake.commands.keys()].sort()).toEqual(
      [GRAPH_PANEL_STATE_COMMAND, OPEN_GRAPH_VIEW_COMMAND].sort(),
    );
    expect(panelState().open).toBe(false);
  });

  it('opens one locked-down panel that only loads the bundled webview assets', () => {
    run(OPEN_GRAPH_VIEW_COMMAND);
    const panel = onlyPanel();
    expect(panel.viewType).toBe(GRAPH_VIEW_TYPE);
    expect(panel.title).toBe('Readback');
    expect(panel.showOptions).toBe(-1);
    const { localResourceRoots, ...flags } = panel.options;
    expect(flags).toEqual({
      enableScripts: true,
      enableForms: false,
      enableCommandUris: false,
      retainContextWhenHidden: false,
    });
    expect(localResourceRoots).toEqual([Uri.joinPath(Uri.file('/ext'), 'dist', 'webview')]);
    expect(panelState()).toMatchObject({ open: true, ready: false });
    expect(log.info).toHaveBeenCalledWith('Graph view opened.');
  });

  it('opens beside the active editor', () => {
    fake.activeTextEditor = {};
    run(OPEN_GRAPH_VIEW_COMMAND);
    expect(onlyPanel().showOptions).toBe(-2);
  });

  it('reveals the existing panel instead of opening a second one', () => {
    run(OPEN_GRAPH_VIEW_COMMAND);
    run(OPEN_GRAPH_VIEW_COMMAND);
    expect(onlyPanel().reveal).toHaveBeenCalledTimes(1);
  });

  it('renders the page with webview URIs, the CSP source and the boot data', () => {
    run(OPEN_GRAPH_VIEW_COMMAND);
    const { html, cspSource } = onlyPanel().webview;
    expect(html).toContain(`style-src ${cspSource.replaceAll("'", '&#39;')};`);
    expect(html).toContain('href="https://webview.test/ext/dist/webview/main.css"');
    expect(html).toContain('src="https://webview.test/ext/dist/webview/main.js"');
    expect(bootDataOf(html)).toEqual({
      view: 'graph',
      locale: 'en',
      workerUri: 'https://webview.test/ext/dist/webview/layout.worker.js',
    });
  });

  it('answers ready with an empty graph and exposes the recorded state', () => {
    run(OPEN_GRAPH_VIEW_COMMAND);
    const { webview } = onlyPanel();
    webview.received.fire({ type: 'ready' });
    webview.received.fire({ type: 'workerReady', roundTripMs: 8 });
    expect(webview.postMessage).toHaveBeenCalledExactlyOnceWith({
      type: 'setGraph',
      document: null,
    });
    expect(panelState()).toMatchObject({ ready: true, workerReady: true, workerRoundTripMs: 8 });
  });

  it('logs CSP violations as warnings and errors as errors', () => {
    run(OPEN_GRAPH_VIEW_COMMAND);
    const { webview } = onlyPanel();
    webview.received.fire({
      type: 'cspViolation',
      directive: 'connect-src',
      blockedUri: 'https://x',
    });
    webview.received.fire({ type: 'error', message: 'boom' });
    expect(log.warn).toHaveBeenCalledWith(
      'Graph view: the Content Security Policy blocked https://x (connect-src).',
    );
    expect(log.error).toHaveBeenCalledWith('Graph view: boom');
    expect(panelState()).toMatchObject({
      cspViolations: [{ directive: 'connect-src', blockedUri: 'https://x' }],
      errors: ['boom'],
    });
  });

  it('drops invalid messages', () => {
    run(OPEN_GRAPH_VIEW_COMMAND);
    const { webview } = onlyPanel();
    const before = panelState();
    webview.received.fire({ type: 'setGraph', document: null });
    expect(panelState()).toBe(before);
    expect(webview.postMessage).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith(
      'Graph view: dropped an invalid message (type "setGraph").',
    );
  });

  it('logs a failed reply without throwing', async () => {
    run(OPEN_GRAPH_VIEW_COMMAND);
    const { webview } = onlyPanel();
    webview.postMessage.mockRejectedValueOnce(new Error('gone'));
    webview.received.fire({ type: 'ready' });
    await vi.waitFor(() => {
      expect(log.warn).toHaveBeenCalledWith("Graph view: posting 'setGraph' failed: Error: gone");
    });
  });

  it('resets the state when the user closes the panel and can open a new one', () => {
    run(OPEN_GRAPH_VIEW_COMMAND);
    const first = onlyPanel();
    first.webview.received.fire({ type: 'ready' });
    first.dispose();
    expect(panelState()).toEqual({
      open: false,
      ready: false,
      workerReady: false,
      workerRoundTripMs: undefined,
      cspViolations: [],
      errors: [],
    });
    expect(first.webview.received.listenerCount).toBe(0);
    expect(log.info).toHaveBeenCalledWith('Graph view closed.');

    run(OPEN_GRAPH_VIEW_COMMAND);
    expect(fake.panels).toHaveLength(2);
    expect(panelState()).toMatchObject({ open: true, ready: false });
  });

  it('closes the panel and unregisters the commands when disposed', () => {
    run(OPEN_GRAPH_VIEW_COMMAND);
    const panel = onlyPanel();
    registration.dispose();
    expect(panel.isDisposed).toBe(true);
    expect(fake.commands.size).toBe(0);
  });
});
