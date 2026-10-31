import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleRequest, serveRequests, type WorkerScope } from '../worker/layout.worker';

describe('handleRequest', () => {
  it('answers a ping with a pong carrying the same id', () => {
    expect(handleRequest({ type: 'ping', id: 42 })).toEqual({ type: 'pong', id: 42 });
  });

  it.each([
    ['null', null],
    ['a string', 'ping'],
    ['another type', { type: 'layout', id: 1 }],
    ['a missing id', { type: 'ping' }],
    ['a fractional id', { type: 'ping', id: 1.5 }],
    ['a string id', { type: 'ping', id: '1' }],
  ])('ignores %s', (_name, data) => {
    expect(handleRequest(data)).toBeUndefined();
  });
});

describe('serveRequests', () => {
  function fakeScope() {
    const listeners: ((event: MessageEvent<unknown>) => void)[] = [];
    const posted: unknown[] = [];
    const scope: WorkerScope = {
      addEventListener: (_type, listener) => {
        listeners.push(listener);
      },
      postMessage: (message) => {
        posted.push(message);
      },
    };
    const deliver = (data: unknown): void => {
      for (const listener of listeners) {
        listener(new MessageEvent('message', { data }));
      }
    };
    return { scope, posted, deliver };
  }

  it('answers pings and stays silent otherwise', () => {
    const { scope, posted, deliver } = fakeScope();
    serveRequests(scope);
    deliver({ type: 'ping', id: 1 });
    deliver({ type: 'unknown' });
    deliver({ type: 'ping', id: 2 });
    expect(posted).toEqual([
      { type: 'pong', id: 1 },
      { type: 'pong', id: 2 },
    ]);
  });
});

describe('module start-up', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('does not serve when imported into a page (only a real worker has no document)', async () => {
    const postMessage = vi.spyOn(window, 'postMessage');
    vi.resetModules();
    await import('../worker/layout.worker');
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'ping', id: 9 } }));
    expect(postMessage).not.toHaveBeenCalled();
  });
});
