import { afterEach, describe, expect, it, vi } from 'vitest';
import { isWebviewToHostMessage } from '../../src/shared/webviewProtocol';
import {
  WORKER_CHECK_TIMEOUT_MS,
  browserWorkerEnvironment,
  checkLayoutWorker,
  checkLayoutWorkerInBrowser,
  type ScriptResponse,
  type WorkerCheckEnvironment,
  type WorkerConnection,
  type WorkerHandlers,
} from '../src/workerCheck';
import { handleRequest } from '../worker/layout.worker';
import { WORKER_URI } from './fakes';

type Behaviour = 'answer' | 'answer-after-noise' | 'fail' | 'fail-during-creation' | 'silent';

/** Stands in for a started worker; answering ones run the real worker's request handler. */
class FakeWorker implements WorkerConnection {
  readonly posted: unknown[] = [];
  terminated = false;

  constructor(
    readonly scriptUrl: string,
    private readonly handlers: WorkerHandlers,
    private readonly behaviour: Behaviour,
  ) {
    if (behaviour === 'fail-during-creation') {
      handlers.onError('The layout worker script could not be started.');
    }
  }

  readonly post = (message: unknown): void => {
    this.posted.push(message);
    setTimeout(() => {
      switch (this.behaviour) {
        case 'answer-after-noise':
          this.handlers.onMessage({ type: 'progress' });
          this.handlers.onMessage({ type: 'pong', id: -1 });
          this.handlers.onMessage(handleRequest(message));
          break;
        case 'answer':
          this.handlers.onMessage(handleRequest(message));
          break;
        case 'fail':
          this.handlers.onError('The layout worker failed: ReferenceError: x is not defined');
          break;
        default:
          break;
      }
    }, 1);
  };

  readonly terminate = (): void => {
    this.terminated = true;
  };
}

interface FakeEnvironmentOptions {
  readonly behaviour?: Behaviour;
  readonly response?: Partial<ScriptResponse>;
  readonly fetchError?: Error;
  readonly hangingFetch?: boolean;
  readonly createWorkerError?: Error;
  readonly times?: readonly number[];
}

function fakeEnvironment(options: FakeEnvironmentOptions = {}) {
  const workers: FakeWorker[] = [];
  const objectUrls: string[] = [];
  const revoked: string[] = [];
  const fetchSignals: AbortSignal[] = [];
  const times = [...(options.times ?? [10, 15])];
  const env: WorkerCheckEnvironment = {
    fetch: (_url, init) => {
      fetchSignals.push(init.signal);
      if (options.hangingFetch) {
        return new Promise<ScriptResponse>(() => undefined);
      }
      if (options.fetchError !== undefined) {
        return Promise.reject(options.fetchError);
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        blob: () => Promise.resolve(new Blob(['self.onmessage = () => {};'])),
        ...options.response,
      });
    },
    createWorker: (scriptUrl, handlers) => {
      if (options.createWorkerError !== undefined) {
        throw options.createWorkerError;
      }
      const worker = new FakeWorker(scriptUrl, handlers, options.behaviour ?? 'answer');
      workers.push(worker);
      return worker;
    },
    createObjectURL: () => {
      const url = `blob:vscode-webview://test/${objectUrls.length + 1}`;
      objectUrls.push(url);
      return url;
    },
    revokeObjectURL: (url) => {
      revoked.push(url);
    },
    now: () => times.shift() ?? 0,
  };
  return { env, workers, objectUrls, revoked, fetchSignals };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('checkLayoutWorker', () => {
  it('starts the fetched script from a blob URL and measures the ping round trip', async () => {
    const fake = fakeEnvironment({ times: [100, 112.5] });
    const result = await checkLayoutWorker(WORKER_URI, fake.env);
    expect(result).toEqual({ ok: true, roundTripMs: 12.5 });
    const [worker] = fake.workers;
    expect(worker?.scriptUrl).toBe(fake.objectUrls[0]);
    expect(worker?.posted).toEqual([{ type: 'ping', id: expect.any(Number) as number }]);
  });

  it('terminates the worker and revokes the blob URL afterwards', async () => {
    const fake = fakeEnvironment();
    await checkLayoutWorker(WORKER_URI, fake.env);
    expect(fake.workers[0]?.terminated).toBe(true);
    expect(fake.revoked).toEqual(fake.objectUrls);
  });

  it('ignores other messages and pongs for other pings', async () => {
    const fake = fakeEnvironment({ behaviour: 'answer-after-noise' });
    await expect(checkLayoutWorker(WORKER_URI, fake.env)).resolves.toMatchObject({ ok: true });
  });

  it('uses a new ping id for every check', async () => {
    const fake = fakeEnvironment({ times: [1, 2, 3, 4] });
    await checkLayoutWorker(WORKER_URI, fake.env);
    await checkLayoutWorker(WORKER_URI, fake.env);
    const ids = fake.workers.map((worker) => (worker.posted[0] as { id: number }).id);
    expect(new Set(ids).size).toBe(2);
  });

  it('reports an HTTP error without starting a worker', async () => {
    const fake = fakeEnvironment({ response: { ok: false, status: 404 } });
    await expect(checkLayoutWorker(WORKER_URI, fake.env)).resolves.toEqual({
      ok: false,
      message: 'Fetching the layout worker failed with HTTP status 404.',
    });
    expect(fake.workers).toHaveLength(0);
  });

  it('reports a failed fetch (for example blocked by connect-src)', async () => {
    const fake = fakeEnvironment({ fetchError: new TypeError('Failed to fetch') });
    await expect(checkLayoutWorker(WORKER_URI, fake.env)).resolves.toEqual({
      ok: false,
      message: 'Fetching the layout worker failed: TypeError: Failed to fetch',
    });
  });

  it('reports a worker that cannot be constructed and still revokes the blob URL', async () => {
    const fake = fakeEnvironment({ createWorkerError: new Error('Worker creation blocked') });
    await expect(checkLayoutWorker(WORKER_URI, fake.env)).resolves.toEqual({
      ok: false,
      message: 'Starting the layout worker failed: Error: Worker creation blocked',
    });
    expect(fake.revoked).toEqual(fake.objectUrls);
  });

  it('reports an error raised by the worker', async () => {
    const fake = fakeEnvironment({ behaviour: 'fail' });
    await expect(checkLayoutWorker(WORKER_URI, fake.env)).resolves.toEqual({
      ok: false,
      message: 'The layout worker failed: ReferenceError: x is not defined',
    });
    expect(fake.workers[0]?.terminated).toBe(true);
  });

  it('terminates a worker that failed while it was being created', async () => {
    const fake = fakeEnvironment({ behaviour: 'fail-during-creation' });
    await expect(checkLayoutWorker(WORKER_URI, fake.env)).resolves.toMatchObject({ ok: false });
    expect(fake.workers[0]?.terminated).toBe(true);
    expect(fake.workers[0]?.posted).toEqual([]);
  });

  it('times out after five seconds when the worker never answers', async () => {
    vi.useFakeTimers();
    const fake = fakeEnvironment({ behaviour: 'silent' });
    const result = checkLayoutWorker(WORKER_URI, fake.env);
    await vi.advanceTimersByTimeAsync(WORKER_CHECK_TIMEOUT_MS - 1);
    expect(fake.workers[0]?.terminated).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toEqual({
      ok: false,
      message: 'The layout worker did not answer within 5000 ms.',
    });
    expect(fake.workers[0]?.terminated).toBe(true);
    expect(fake.revoked).toEqual(fake.objectUrls);
  });

  it('times out a download that hangs and aborts it', async () => {
    vi.useFakeTimers();
    const fake = fakeEnvironment({ hangingFetch: true });
    const result = checkLayoutWorker(WORKER_URI, fake.env);
    await vi.advanceTimersByTimeAsync(WORKER_CHECK_TIMEOUT_MS);
    await expect(result).resolves.toMatchObject({ ok: false });
    expect(fake.fetchSignals[0]?.aborted).toBe(true);
    expect(fake.workers).toHaveLength(0);
  });

  it('honours a custom timeout', async () => {
    vi.useFakeTimers();
    const fake = fakeEnvironment({ behaviour: 'silent' });
    const result = checkLayoutWorker(WORKER_URI, { ...fake.env, timeoutMs: 50 });
    await vi.advanceTimersByTimeAsync(50);
    await expect(result).resolves.toEqual({
      ok: false,
      message: 'The layout worker did not answer within 50 ms.',
    });
  });

  it('cancels when the signal aborts and cleans up', async () => {
    const fake = fakeEnvironment({ behaviour: 'silent' });
    const controller = new AbortController();
    const result = checkLayoutWorker(WORKER_URI, fake.env, controller.signal);
    await vi.waitFor(() => {
      expect(fake.workers).toHaveLength(1);
    });
    controller.abort();
    await expect(result).resolves.toEqual({
      ok: false,
      message: 'The worker check was cancelled.',
    });
    expect(fake.workers[0]?.terminated).toBe(true);
    expect(fake.revoked).toEqual(fake.objectUrls);
  });

  it('does not start at all with an aborted signal', async () => {
    const fake = fakeEnvironment();
    const controller = new AbortController();
    controller.abort();
    await expect(checkLayoutWorker(WORKER_URI, fake.env, controller.signal)).resolves.toMatchObject(
      { ok: false },
    );
    expect(fake.fetchSignals).toHaveLength(0);
  });

  it('never reports a negative round trip, which the host would reject', async () => {
    // A clock that goes backwards (it should not, but performance.now() is not ours).
    const fake = fakeEnvironment({ times: [50, 40] });
    const result = await checkLayoutWorker(WORKER_URI, fake.env);
    expect(result).toEqual({ ok: true, roundTripMs: 0 });
    expect(isWebviewToHostMessage({ type: 'workerReady', roundTripMs: 0 })).toBe(true);
  });
});

/** A minimal Worker for browserWorkerEnvironment: answers through the real worker handler. */
class FakeBrowserWorker extends EventTarget {
  static readonly instances: FakeBrowserWorker[] = [];
  readonly constructorArguments: unknown[];
  terminated = false;

  constructor(...args: unknown[]) {
    super();
    this.constructorArguments = args;
    FakeBrowserWorker.instances.push(this);
  }

  postMessage(message: unknown): void {
    const response = handleRequest(message);
    if (response !== undefined) {
      setTimeout(() => {
        this.dispatchEvent(new MessageEvent('message', { data: response }));
      }, 1);
    }
  }

  terminate(): void {
    this.terminated = true;
  }
}

describe('browserWorkerEnvironment', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    FakeBrowserWorker.instances.length = 0;
  });

  function connect() {
    vi.stubGlobal('Worker', FakeBrowserWorker);
    const onMessage = vi.fn();
    const onError = vi.fn();
    const connection = browserWorkerEnvironment.createWorker('blob:test/1', { onMessage, onError });
    const [worker] = FakeBrowserWorker.instances;
    if (!worker) {
      throw new Error('no worker was created');
    }
    return { connection, worker, onMessage, onError };
  }

  it('creates a classic worker (no module type) for the blob URL', () => {
    const { worker } = connect();
    expect(worker.constructorArguments).toEqual(['blob:test/1']);
  });

  it('forwards messages and terminates', async () => {
    const { connection, worker, onMessage } = connect();
    connection.post({ type: 'ping', id: 7 });
    await vi.waitFor(() => {
      expect(onMessage).toHaveBeenCalledWith({ type: 'pong', id: 7 });
    });
    connection.terminate();
    expect(worker.terminated).toBe(true);
  });

  it('handles worker errors itself so they do not surface as page errors', () => {
    const { worker, onError } = connect();
    const scriptError = new ErrorEvent('error', { message: 'boom', cancelable: true });
    worker.dispatchEvent(scriptError);
    expect(scriptError.defaultPrevented).toBe(true);
    expect(onError).toHaveBeenLastCalledWith('The layout worker failed: boom');

    worker.dispatchEvent(new Event('error', { cancelable: true }));
    expect(onError).toHaveBeenLastCalledWith('The layout worker script could not be started.');
  });

  it('reports messages that cannot be deserialized', () => {
    const { worker, onError } = connect();
    worker.dispatchEvent(new MessageEvent('messageerror'));
    expect(onError).toHaveBeenCalledWith(
      'The layout worker sent a message that could not be read.',
    );
  });

  it('runs the whole check with the browser globals', async () => {
    vi.stubGlobal('Worker', FakeBrowserWorker);
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(new Response('self.onmessage = () => {};'))),
    );
    const createObjectURL = vi.fn(() => 'blob:test/2');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', Object.assign(class extends URL {}, { createObjectURL, revokeObjectURL }));
    const result = await checkLayoutWorkerInBrowser(WORKER_URI, new AbortController().signal);
    expect(result).toMatchObject({ ok: true });
    expect(fetch).toHaveBeenCalledWith(WORKER_URI, expect.objectContaining({}));
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test/2');
  });
});
