import { renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HostToWebviewMessage } from '../../src/shared/webviewProtocol';
import { useHostConnection } from '../src/hooks/useHostConnection';
import { FakeHost, postFromHost } from './fakes';

type ListenerCall = readonly [type: string, listener: unknown, ...rest: unknown[]];

/** The listeners of the recorded add- or removeEventListener calls for 'message', in order. */
function messageListeners(calls: readonly ListenerCall[]): unknown[] {
  return calls.filter(([type]) => type === 'message').map(([, listener]) => listener);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useHostConnection', () => {
  it('removes its message listener on unmount', () => {
    const add = vi.spyOn(window, 'addEventListener');
    const remove = vi.spyOn(window, 'removeEventListener');
    const host = new FakeHost();
    const received: HostToWebviewMessage[] = [];
    const { unmount } = renderHook(() => {
      useHostConnection(host, (message) => {
        received.push(message);
      });
    });
    const added = messageListeners(add.mock.calls);
    expect(added).toHaveLength(1);
    postFromHost({ type: 'setGraph', document: null });
    expect(received).toEqual([{ type: 'setGraph', document: null }]);

    unmount();
    const removed = messageListeners(remove.mock.calls);
    expect(removed).toHaveLength(1);
    expect(removed[0]).toBe(added[0]);
    // A page that is gone must not handle host messages any more.
    postFromHost({ type: 'setGraph', document: null });
    expect(received).toHaveLength(1);
  });
});
