// A stand-in for engine/run_engine.py used by src/engine/engineConnection.test.ts. It speaks the
// same JSON-RPC protocol over stdio; the scenario (first argument) selects the behaviour.
'use strict';
const rpc = require('vscode-jsonrpc/node');

const scenario = process.argv[2] ?? 'normal';

if (scenario === 'too-old') {
  process.stderr.write(
    'HEARBACK_ENGINE_FATAL {"code": "python-too-old", "version": "3.9.6", "required": "3.10"}\n',
  );
  process.exit(3);
}
if (scenario === 'bootstrap-failed') {
  process.stderr.write(
    'HEARBACK_ENGINE_FATAL {"code": "bootstrap-failed", "detail": "ImportError: no module"}\n',
  );
  process.exit(4);
}
if (scenario === 'crash-on-start') {
  process.stderr.write('Traceback (most recent call last):\n  boom\n');
  process.exit(1);
}
if (scenario === 'silent') {
  // Never answers initialize.
  setInterval(() => undefined, 1000);
} else {
  const connection = rpc.createMessageConnection(
    new rpc.StreamMessageReader(process.stdin),
    new rpc.StreamMessageWriter(process.stdout),
  );
  let shutdown = false;

  connection.onRequest('engine/initialize', (params) => {
    process.stderr.write(`[info] initialize from ${params.client.name}\n`);
    process.stderr.write('[warning] two-line message\n    continued\n');
    return {
      engineVersion: '0.0.1',
      protocolVersion: scenario === 'wrong-protocol' ? 99 : params.protocolVersion,
      schemaVersion: scenario === 'wrong-schema' ? 1 : 2,
      python: {
        version: '3.12.3',
        versionInfo: { major: 3, minor: 12, micro: 3, releaseLevel: 'final', serial: 0 },
        implementation: 'cpython',
        executable: '/usr/bin/python3.12',
        platform: 'linux',
      },
      vendored: [],
      capabilities: { methods: ['engine/initialize', 'engine/ping', 'engine/shutdown'] },
      pid: process.pid,
      sandboxed: true,
    };
  });

  connection.onRequest('engine/ping', async (token) => {
    if (scenario === 'hang') {
      // Ignores cancellation, like a single long-running call in the real engine.
      await new Promise(() => undefined);
    }
    if (scenario === 'slow') {
      // Cooperative: answers the cancellation with RequestCancelled.
      await new Promise((resolve) => {
        const timer = setTimeout(resolve, 10_000);
        token.onCancellationRequested(() => {
          clearTimeout(timer);
          resolve(undefined);
        });
      });
      if (token.isCancellationRequested) {
        return new rpc.ResponseError(-32800, 'cancelled');
      }
    }
    if (scenario === 'crash-on-ping') {
      process.exit(7);
    }
    if (scenario === 'error') {
      return new rpc.ResponseError(-32603, 'boom', { kind: 'internal', detail: 'boom' });
    }
    return { pong: true };
  });

  connection.onRequest('engine/shutdown', () => {
    shutdown = true;
    // Like the real engine: logs while the extension host may already be closing its channel.
    process.stderr.write('[info] Shutdown requested.\n');
    return null;
  });
  connection.onNotification('engine/exit', () => {
    process.stderr.write('[info] Engine stopped: exit.');
    process.exit(shutdown ? 0 : 1);
  });
  connection.onNotification('engine/setLogLevel', (params) => {
    process.stderr.write(`[info] level ${params.level}\n`);
  });
  connection.onClose(() => {
    process.exit(shutdown ? 0 : 1);
  });
  connection.listen();
}
