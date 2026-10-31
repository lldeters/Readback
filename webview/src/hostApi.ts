// The only place that touches the VS Code webview API. Everything else receives a HostApi, which
// tests replace with a fake.
import type { WebviewToHostMessage } from '../../src/shared/webviewProtocol';

/** What the app needs from the extension host. */
export interface HostApi {
  postMessage(message: WebviewToHostMessage): void;
}

/**
 * Injected by VS Code into every webview with scripts enabled. A second call per page load throws,
 * so it is declared here, in module scope, and not as a global.
 */
declare function acquireVsCodeApi(): { postMessage(message: unknown): void };

let host: HostApi | undefined;

/** Returns the page's VS Code API handle, acquiring it on first use. */
export function getHostApi(): HostApi {
  if (host === undefined) {
    const api = acquireVsCodeApi();
    host = {
      postMessage: (message) => {
        api.postMessage(message);
      },
    };
  }
  return host;
}
