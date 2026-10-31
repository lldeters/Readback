import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('getHostApi', () => {
  it('acquires the VS Code API exactly once and forwards messages', async () => {
    const postMessage = vi.fn();
    const acquireVsCodeApi = vi.fn(() => ({ postMessage }));
    vi.stubGlobal('acquireVsCodeApi', acquireVsCodeApi);
    const { getHostApi } = await import('../src/hostApi');

    const first = getHostApi();
    const second = getHostApi();
    first.postMessage({ type: 'ready' });
    second.postMessage({ type: 'workerReady', roundTripMs: 1 });

    expect(acquireVsCodeApi).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(postMessage.mock.calls).toEqual([
      [{ type: 'ready' }],
      [{ type: 'workerReady', roundTripMs: 1 }],
    ]);
  });
});
