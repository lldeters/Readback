// Starts the webview app. main.tsx calls this with the real window and VS Code API; tests call it
// with fakes.
import * as l10n from '@vscode/l10n';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { readBootData } from './bootData';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ViewError } from './components/ViewError';
import { installDiagnostics, isStylesheetApplied } from './diagnostics';
import type { HostApi } from './hostApi';
import { describeError, truncate } from './text';
import { checkLayoutWorkerInBrowser, type WorkerCheck } from './workerCheck';

/** Must match ROOT_ELEMENT_ID in src/views/webviewHtml.ts. */
export const ROOT_ELEMENT_ID = 'root';

export interface BootstrapOptions {
  readonly view: Window;
  readonly host: HostApi;
  readonly checkWorker?: WorkerCheck;
}

export interface RunningWebview {
  /** Unmounts the app and removes the listeners (used by tests). */
  dispose(): void;
}

export function bootstrap({
  view,
  host,
  checkWorker = checkLayoutWorkerInBrowser,
}: BootstrapOptions): RunningWebview {
  // First of all, so that problems during startup are reported as well.
  const removeDiagnostics = installDiagnostics(view, host);
  const reportError = (message: string): void => {
    host.postMessage({ type: 'error', message: truncate(message) });
  };

  if (!isStylesheetApplied(view)) {
    reportError('The stylesheet main.css was not applied.');
  }
  const document = view.document;
  let container = document.getElementById(ROOT_ELEMENT_ID);
  if (container === null) {
    reportError(`The #${ROOT_ELEMENT_ID} element is missing.`);
    container = document.body.appendChild(document.createElement('div'));
  }
  const root = createRoot(container);

  const boot = readBootData(document);
  if (boot.ok) {
    // Before the first render: l10n.t() reads the bundle that is configured at call time.
    if (boot.data.l10nBundle !== undefined) {
      l10n.config({ contents: boot.data.l10nBundle });
    }
    root.render(
      <StrictMode>
        <ErrorBoundary
          onError={(error) => {
            reportError(`Rendering failed: ${describeError(error)}`);
          }}
        >
          <App host={host} boot={boot.data} checkWorker={checkWorker} />
        </ErrorBoundary>
      </StrictMode>,
    );
  } else {
    // Without valid boot data there is no l10n bundle either, so the message stays English.
    reportError(`Invalid boot data: ${boot.reason}.`);
    root.render(<ViewError />);
  }

  return {
    dispose: () => {
      root.unmount();
      removeDiagnostics();
    },
  };
}
