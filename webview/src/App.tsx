import '@xyflow/react/dist/style.css';
import './theme.css';
import { useCallback, useState } from 'react';
import type { GraphDocument } from '../../src/shared/generated/graph';
import type { HostToWebviewMessage, WebviewBootData } from '../../src/shared/webviewProtocol';
import { EmptyState } from './components/EmptyState';
import { GraphCanvas } from './components/GraphCanvas';
import type { HostApi } from './hostApi';
import { useHostConnection } from './hooks/useHostConnection';
import { useThemeKind } from './hooks/useThemeKind';
import { useWorkerCheck } from './hooks/useWorkerCheck';
import { truncate } from './text';
import type { WorkerCheck } from './workerCheck';

export interface AppProps {
  readonly host: HostApi;
  readonly boot: WebviewBootData;
  readonly checkWorker: WorkerCheck;
}

/** The graph view: a canvas plus, while there is nothing to draw, the empty state. */
export function App({ host, boot, checkWorker }: AppProps) {
  const { colorMode } = useThemeKind();
  // Phase 0 stores the document only; drawing it arrives with the Phase 1 views.
  const [graph, setGraph] = useState<GraphDocument | null>(null);
  // Declared before the worker check so 'ready' always reaches the host first.
  useHostConnection(host, (message: HostToWebviewMessage) => {
    setGraph(message.document);
  });
  useWorkerCheck(host, boot.workerUri, checkWorker);
  const reportFlowError = useCallback(
    (message: string) => {
      host.postMessage({ type: 'error', message: truncate(message) });
    },
    [host],
  );
  return (
    <main className="graph-view">
      <GraphCanvas colorMode={colorMode} onFlowError={reportFlowError} />
      {graph === null ? <EmptyState /> : null}
    </main>
  );
}
