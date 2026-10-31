// The "Readback" graph panel: a single webview panel that hosts the React app from webview/src.
// This file only adapts the VS Code API; message handling and state live in graphPanelState.ts.
import * as vscode from 'vscode';
import type { GraphPanelState, WebviewBootData } from '../shared/webviewProtocol';
import {
  CLOSED_PANEL_STATE,
  handleWebviewMessage,
  openedPanelState,
  type LogLine,
} from './graphPanelState';
import { createNonce, renderWebviewHtml } from './webviewHtml';

export const GRAPH_VIEW_TYPE = 'readback.graph';
export const OPEN_GRAPH_VIEW_COMMAND = 'readback.openGraphView';
/** Not contributed in package.json: integration tests read the panel state through it. */
export const GRAPH_PANEL_STATE_COMMAND = 'readback._test.graphPanelState';

/** Registers the graph panel commands. Disposing the result also closes an open panel. */
export function registerGraphPanel(
  context: vscode.ExtensionContext,
  log: vscode.LogOutputChannel,
): vscode.Disposable {
  const panel = new GraphPanel(context.extensionUri, log);
  return vscode.Disposable.from(
    vscode.commands.registerCommand(OPEN_GRAPH_VIEW_COMMAND, () => {
      panel.show();
    }),
    vscode.commands.registerCommand(GRAPH_PANEL_STATE_COMMAND, () => panel.state),
    panel,
  );
}

interface OpenPanel {
  readonly panel: vscode.WebviewPanel;
  readonly subscriptions: readonly vscode.Disposable[];
}

class GraphPanel implements vscode.Disposable {
  private current: OpenPanel | undefined;
  private recorded: GraphPanelState = CLOSED_PANEL_STATE;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly log: vscode.LogOutputChannel,
  ) {}

  get state(): GraphPanelState {
    return this.recorded;
  }

  show(): void {
    if (this.current) {
      this.current.panel.reveal();
      return;
    }
    const assets = vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview');
    const panel = vscode.window.createWebviewPanel(
      GRAPH_VIEW_TYPE,
      vscode.l10n.t('Readback'),
      // Beside the code it visualizes; in the active group when no editor is open.
      vscode.window.activeTextEditor ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active,
      {
        enableScripts: true,
        enableForms: false,
        enableCommandUris: false,
        // The page is cheap to rebuild; it re-announces itself with 'ready' after every reload.
        retainContextWhenHidden: false,
        // Only the bundled webview assets, never workspace files.
        localResourceRoots: [assets],
      },
    );
    this.recorded = openedPanelState();
    // Subscribe before setting the HTML so no message from the new page is missed.
    const subscriptions = [
      panel.webview.onDidReceiveMessage((message: unknown) => {
        this.receive(panel.webview, message);
      }),
      panel.onDidDispose(() => {
        this.closed();
      }),
    ];
    this.current = { panel, subscriptions };
    panel.webview.html = renderPage(panel.webview, assets);
    this.log.info('Graph view opened.');
  }

  dispose(): void {
    const current = this.current;
    this.closed();
    current?.panel.dispose();
  }

  private receive(webview: vscode.Webview, message: unknown): void {
    const outcome = handleWebviewMessage(this.recorded, message);
    this.recorded = outcome.state;
    write(this.log, outcome.log);
    if (outcome.reply) {
      const type = outcome.reply.type;
      void webview.postMessage(outcome.reply).then(
        (delivered) => {
          if (!delivered) {
            this.log.debug(`Graph view: '${type}' was not delivered (page not loaded).`);
          }
        },
        (error: unknown) => {
          this.log.warn(`Graph view: posting '${type}' failed: ${String(error)}`);
        },
      );
    }
  }

  private closed(): void {
    if (!this.current) {
      return;
    }
    for (const subscription of this.current.subscriptions) {
      subscription.dispose();
    }
    this.current = undefined;
    this.recorded = CLOSED_PANEL_STATE;
    this.log.info('Graph view closed.');
  }
}

function renderPage(webview: vscode.Webview, assets: vscode.Uri): string {
  const asset = (file: string): string =>
    webview.asWebviewUri(vscode.Uri.joinPath(assets, file)).toString();
  const boot: WebviewBootData = {
    view: 'graph',
    locale: vscode.env.language,
    l10nBundle: vscode.l10n.bundle,
    workerUri: asset('layout.worker.js'),
  };
  return renderWebviewHtml({
    cspSource: webview.cspSource,
    nonce: createNonce(),
    scriptUri: asset('main.js'),
    styleUri: asset('main.css'),
    boot,
    lang: vscode.env.language,
  });
}

function write(log: vscode.LogOutputChannel, line: LogLine): void {
  log[line.level](line.message);
}
