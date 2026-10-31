// Starts the layout worker the only way webviews allow (fetch the script, start it from a blob:
// URL) and checks that it answers. Phase 0 reports the result to the host; Phase 1 keeps the worker
// for the graph layout.
import type { LayoutWorkerRequest } from '../worker/layout.worker';
import { describeError } from './text';

/** How long the whole check (fetch, start, first answer) may take. */
export const WORKER_CHECK_TIMEOUT_MS = 5000;

export type WorkerCheckResult =
  | { readonly ok: true; readonly roundTripMs: number }
  | { readonly ok: false; readonly message: string };

/** Runs the check for the worker script at workerUri; aborting the signal cancels it. */
export type WorkerCheck = (workerUri: string, signal: AbortSignal) => Promise<WorkerCheckResult>;

/** The response fields the check reads; a fetch Response has them. */
export interface ScriptResponse {
  readonly ok: boolean;
  readonly status: number;
  blob(): Promise<Blob>;
}

export interface WorkerHandlers {
  readonly onMessage: (data: unknown) => void;
  /** The worker failed to start or threw; the message is for the log. */
  readonly onError: (message: string) => void;
}

export interface WorkerConnection {
  readonly post: (message: LayoutWorkerRequest) => void;
  readonly terminate: () => void;
}

/** Browser APIs the check uses, injectable for tests (jsdom has no Worker). */
export interface WorkerCheckEnvironment {
  readonly fetch: (url: string, init: { signal: AbortSignal }) => Promise<ScriptResponse>;
  readonly createWorker: (scriptUrl: string, handlers: WorkerHandlers) => WorkerConnection;
  readonly createObjectURL: (blob: Blob) => string;
  readonly revokeObjectURL: (url: string) => void;
  readonly now: () => number;
  readonly timeoutMs?: number;
}

/** The real browser implementation. */
export const browserWorkerEnvironment: WorkerCheckEnvironment = {
  fetch: (url, init) => fetch(url, init),
  createWorker: (scriptUrl, handlers) => {
    // A classic worker: the bundle is one self-contained script, and module workers bring no benefit.
    const worker = new Worker(scriptUrl);
    worker.addEventListener('message', (event: MessageEvent<unknown>) => {
      handlers.onMessage(event.data);
    });
    worker.addEventListener('messageerror', () => {
      handlers.onError('The layout worker sent a message that could not be read.');
    });
    worker.addEventListener('error', (event: Event) => {
      // Handled here; without this the error would also surface as an uncaught page error.
      event.preventDefault();
      handlers.onError(describeWorkerError(event));
    });
    return {
      post: (message) => {
        worker.postMessage(message);
      },
      terminate: () => {
        worker.terminate();
      },
    };
  },
  createObjectURL: (blob) => URL.createObjectURL(blob),
  revokeObjectURL: (url) => {
    URL.revokeObjectURL(url);
  },
  now: () => performance.now(),
};

/** Checks the layout worker in the browser. */
export const checkLayoutWorkerInBrowser: WorkerCheck = (workerUri, signal) =>
  checkLayoutWorker(workerUri, browserWorkerEnvironment, signal);

const CANCELLED: WorkerCheckResult = { ok: false, message: 'The worker check was cancelled.' };

let nextPingId = 1;

/**
 * Fetches the worker script, starts it from a blob: URL, sends a ping and waits for the matching
 * pong. Never rejects. The worker is terminated and the blob URL revoked afterwards.
 */
export function checkLayoutWorker(
  workerUri: string,
  env: WorkerCheckEnvironment,
  signal?: AbortSignal,
): Promise<WorkerCheckResult> {
  const timeoutMs = env.timeoutMs ?? WORKER_CHECK_TIMEOUT_MS;
  const { promise, resolve } = Promise.withResolvers<WorkerCheckResult>();
  const download = new AbortController();
  let worker: WorkerConnection | undefined;
  let scriptUrl: string | undefined;
  let settled = false;
  // Read through a function: callbacks change the flag, which TypeScript's narrowing cannot see.
  const isSettled = (): boolean => settled;

  const settle = (result: WorkerCheckResult): void => {
    if (settled) {
      return;
    }
    settled = true;
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
    download.abort();
    worker?.terminate();
    if (scriptUrl !== undefined) {
      env.revokeObjectURL(scriptUrl);
    }
    resolve(result);
  };
  const cancel = (): void => {
    settle(CANCELLED);
  };
  const timer = setTimeout(() => {
    settle(failure(`The layout worker did not answer within ${timeoutMs} ms.`));
  }, timeoutMs);

  const start = async (): Promise<void> => {
    let script: Blob;
    try {
      const response = await env.fetch(workerUri, { signal: download.signal });
      if (!response.ok) {
        settle(failure(`Fetching the layout worker failed with HTTP status ${response.status}.`));
        return;
      }
      script = await response.blob();
    } catch (error) {
      settle(failure(`Fetching the layout worker failed: ${describeError(error)}`));
      return;
    }
    // The check may have timed out or been cancelled while the script was downloading.
    if (isSettled()) {
      return;
    }
    try {
      scriptUrl = env.createObjectURL(script);
      const id = nextPingId++;
      // Measured from creation: the ping waits in the worker's queue until its script has run.
      const sentAt = env.now();
      worker = env.createWorker(scriptUrl, {
        onMessage: (data) => {
          if (isPong(data, id)) {
            settle({ ok: true, roundTripMs: Math.max(0, env.now() - sentAt) });
          }
        },
        onError: (message) => {
          settle(failure(message));
        },
      });
      // A handler that fired during creation settled the check before the worker was assigned.
      if (isSettled()) {
        worker.terminate();
        return;
      }
      worker.post({ type: 'ping', id });
    } catch (error) {
      settle(failure(`Starting the layout worker failed: ${describeError(error)}`));
    }
  };

  if (signal?.aborted) {
    cancel();
  } else {
    signal?.addEventListener('abort', cancel, { once: true });
    void start();
  }
  return promise;
}

function failure(message: string): WorkerCheckResult {
  return { ok: false, message };
}

function isPong(data: unknown, id: number): boolean {
  if (typeof data !== 'object' || data === null) {
    return false;
  }
  const response = data as { readonly type?: unknown; readonly id?: unknown };
  return response.type === 'pong' && response.id === id;
}

function describeWorkerError(event: Event): string {
  // Script errors arrive as ErrorEvent; a script that cannot be loaded at all fires a plain Event.
  if (event instanceof ErrorEvent && event.message !== '') {
    return `The layout worker failed: ${event.message}`;
  }
  return 'The layout worker script could not be started.';
}
