import { useEffect } from 'react';
import type { HostApi } from '../hostApi';
import { describeError, truncate } from '../text';
import type { WorkerCheck } from '../workerCheck';

/** Runs the layout worker check once per mount and reports the result to the host. */
export function useWorkerCheck(host: HostApi, workerUri: string, check: WorkerCheck): void {
  useEffect(() => {
    const controller = new AbortController();
    const report = (result: Awaited<ReturnType<WorkerCheck>>): void => {
      // An unmounted page (or React's development double mount) reports nothing.
      if (controller.signal.aborted) {
        return;
      }
      host.postMessage(
        result.ok
          ? { type: 'workerReady', roundTripMs: result.roundTripMs }
          : { type: 'workerError', message: truncate(result.message) },
      );
    };
    void check(workerUri, controller.signal).then(report, (error: unknown) => {
      report({ ok: false, message: describeError(error) });
    });
    return () => {
      controller.abort();
    };
  }, [host, workerUri, check]);
}
