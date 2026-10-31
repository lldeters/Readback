// Test doubles shared by the webview tests.
import type { WebviewBootData, WebviewToHostMessage } from '../../src/shared/webviewProtocol';
import type { HostApi } from '../src/hostApi';
import type { WorkerCheck, WorkerCheckResult } from '../src/workerCheck';

/** Records every message the page posts to the extension host. */
export class FakeHost implements HostApi {
  readonly messages: WebviewToHostMessage[] = [];

  postMessage(message: WebviewToHostMessage): void {
    this.messages.push(message);
  }

  /** The message types in the order they were posted. */
  types(): string[] {
    return this.messages.map((message) => message.type);
  }

  ofType<T extends WebviewToHostMessage['type']>(
    type: T,
  ): Extract<WebviewToHostMessage, { type: T }>[] {
    return this.messages.filter(
      (message): message is Extract<WebviewToHostMessage, { type: T }> => message.type === type,
    );
  }
}

export const WORKER_URI = 'https://webview.test/dist/webview/layout.worker.js';

export function bootData(overrides: Partial<WebviewBootData> = {}): WebviewBootData {
  return {
    view: 'graph',
    locale: 'en',
    l10nBundle: undefined,
    workerUri: WORKER_URI,
    ...overrides,
  };
}

/** A worker check that resolves with a fixed result and records how it was called. */
export function fixedWorkerCheck(result: WorkerCheckResult): WorkerCheck & {
  readonly calls: { workerUri: string; signal: AbortSignal }[];
} {
  const calls: { workerUri: string; signal: AbortSignal }[] = [];
  const check: WorkerCheck = (workerUri, signal) => {
    calls.push({ workerUri, signal });
    return Promise.resolve(result);
  };
  return Object.assign(check, { calls });
}

/** A worker check that never finishes unless its signal is aborted. */
export const pendingWorkerCheck: WorkerCheck = (_workerUri, signal) =>
  new Promise((resolve) => {
    signal.addEventListener('abort', () => {
      resolve({ ok: false, message: 'cancelled' });
    });
  });

/** Sends a message to the page the way VS Code delivers host messages. */
export function postFromHost(data: unknown): void {
  window.dispatchEvent(new MessageEvent('message', { data }));
}
