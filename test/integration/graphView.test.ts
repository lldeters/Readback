import * as assert from 'node:assert';
import type { GraphPanelState } from '../../src/shared/webviewProtocol';
import { command, waitFor } from './helpers';

suite('Graph view', function () {
  this.timeout(60_000);

  test('opens with a working layout worker and without CSP violations', async () => {
    await command('readback.openGraphView');
    const state = await waitFor(
      async () => {
        const current = await command<GraphPanelState>('readback._test.graphPanelState');
        return current.ready && current.workerReady ? current : undefined;
      },
      30_000,
      'the graph view to report ready and workerReady',
    );
    assert.strictEqual(state.open, true);
    assert.deepStrictEqual(state.cspViolations, []);
    assert.deepStrictEqual(state.errors, []);
    assert.ok((state.workerRoundTripMs ?? -1) >= 0);
  });

  test('reuses the open panel', async () => {
    await command('readback.openGraphView');
    const state = await command<GraphPanelState>('readback._test.graphPanelState');
    assert.strictEqual(state.open, true);
  });
});
