// Entry point of the layout Web Worker (dist/webview/layout.worker.js); in Phase 1 it runs the
// graph layout off the UI thread. Webviews cannot start workers from their resource URLs, so the
// page fetches this file and starts it from a blob: URL as a classic worker.
//
// Keep this file free of imports and never load anything from inside the worker (no import(),
// importScripts() or fetch()): webview workers cannot reach webview resources, and since VS Code
// 1.118 such requests hang (microsoft/vscode#315494). The page imports the message types below.

/** Asks the worker to prove that it is running. */
export interface PingRequest {
  readonly type: 'ping';
  readonly id: number;
}

/** Answer to a PingRequest with the same id. */
export interface PongResponse {
  readonly type: 'pong';
  readonly id: number;
}

export type LayoutWorkerRequest = PingRequest;
export type LayoutWorkerResponse = PongResponse;

/** The part of the worker scope the request loop uses; tests pass a fake. */
export interface WorkerScope {
  addEventListener(type: 'message', listener: (event: MessageEvent<unknown>) => void): void;
  postMessage(message: LayoutWorkerResponse): void;
}

// A short stretch of arithmetic before answering, so a pong shows that the worker executes code.
const PING_WORK_ITERATIONS = 100_000;

// Each ping stores its result here so the loop cannot be optimized away.
let workResult = 0;

/** Computes the response to one message; unknown messages get none. */
export function handleRequest(data: unknown): LayoutWorkerResponse | undefined {
  if (!isPingRequest(data)) {
    return undefined;
  }
  let accumulator = workResult;
  for (let step = 0; step < PING_WORK_ITERATIONS; step++) {
    accumulator = (accumulator * 31 + step) | 0;
  }
  workResult = accumulator;
  return { type: 'pong', id: data.id };
}

/** Answers every message the scope receives. */
export function serveRequests(scope: WorkerScope): void {
  scope.addEventListener('message', (event) => {
    const response = handleRequest(event.data);
    if (response !== undefined) {
      scope.postMessage(response);
    }
  });
}

function isPingRequest(value: unknown): value is PingRequest {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const { type, id } = value as Partial<Record<keyof PingRequest, unknown>>;
  return type === 'ping' && Number.isSafeInteger(id);
}

// The page and the tests import this module for its types and functions; only a real worker,
// which has no document, starts serving.
if (!('document' in globalThis)) {
  serveRequests(self);
}
