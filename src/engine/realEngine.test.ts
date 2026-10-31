// End-to-end without VS Code: our own interpreter discovery, EngineConnection and the real Python
// engine in engine/. Skipped when no CPython >= 3.10 is on PATH (set READBACK_TEST_PYTHON to pick
// one explicitly). CI's package job points READBACK_ENGINE_DIR at the engine inside the unpacked
// VSIX and sets READBACK_EXPECT_VENDORED=1, so the shipped layout is executed too.
import { Ajv2020 } from 'ajv/dist/2020';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import protocolSchema from '../../shared/engine-protocol.schema.json';
import { nullLogger } from '../util/log';
import { EngineConnection, EngineRequestFailure, PingRequest } from './engineConnection';
import { nodeFs, searchPath } from './interpreter/pathSearch';
import { sanitizedEnv } from './interpreter/policy';
import { probeCandidate, runProcess } from './interpreter/probe';
import type { InterpreterCandidate } from './interpreter/types';
import { Methods, PROTOCOL_VERSION } from './protocol';

const engineDirectory =
  process.env.READBACK_ENGINE_DIR ?? fileURLToPath(new URL('../../engine', import.meta.url));
const expectVendored = process.env.READBACK_EXPECT_VENDORED === '1';

async function findPython(): Promise<string | undefined> {
  const explicit = process.env.READBACK_TEST_PYTHON;
  const candidates: InterpreterCandidate[] = explicit
    ? [{ source: 'setting', command: explicit, prefixArgs: [] }]
    : (
        await searchPath({
          platform: process.platform,
          pathEnv: process.env.PATH ?? process.env.Path,
          excludeFolders: [],
          fs: nodeFs,
        })
      ).candidates.map((candidate) => ({ source: 'path', ...candidate }));
  for (const candidate of candidates) {
    const outcome = await probeCandidate(candidate, runProcess, {
      cwd: engineDirectory,
      env: sanitizedEnv(process.env),
      timeoutMs: 15_000,
    });
    if (outcome.kind === 'ok') {
      return outcome.probe.executable;
    }
  }
  return undefined;
}

const python = await findPython();

const validateInitializeResult = (() => {
  const ajv = new Ajv2020({ allErrors: true, allowUnionTypes: true });
  ajv.addSchema(protocolSchema);
  const validate = ajv.getSchema(`${protocolSchema.$id}#/$defs/InitializeResult`);
  if (!validate) {
    throw new Error('InitializeResult missing from the protocol schema');
  }
  return validate;
})();

function start(executable: string): Promise<EngineConnection> {
  return EngineConnection.start({
    executable,
    engineDirectory,
    env: sanitizedEnv(process.env),
    client: { name: 'readback-unit-test', version: '0.0.1' },
    logLevel: 'info',
    workspaceTrusted: true,
    locale: 'en',
    startupTimeoutMs: 20_000,
    logger: nullLogger,
  });
}

describe.skipIf(python === undefined)('the real engine', () => {
  const executable = python ?? '';

  it('completes the handshake with a schema-valid result and stops cleanly', async () => {
    const connection = await start(executable);
    try {
      const result = connection.initializeResult;
      expect(
        validateInitializeResult(result),
        JSON.stringify(validateInitializeResult.errors),
      ).toBe(true);
      expect(result.protocolVersion).toBe(PROTOCOL_VERSION);
      expect(result.sandboxed).toBe(true);
      expect(result.pid).toBe(connection.pid);
      expect(result.capabilities.methods).toEqual(Object.values(Methods));
      if (expectVendored) {
        expect(result.vendored.map((pkg) => pkg.name)).toEqual(['jedi', 'parso', 'sqlglot']);
      }
      await expect(connection.request(PingRequest, { timeoutMs: 10_000 })).resolves.toEqual({
        pong: true,
      });
    } finally {
      await connection.stop();
    }
    await expect(connection.exited).resolves.toMatchObject({ code: 0, expected: true });
  }, 60_000);

  it('answers unknown methods with an error instead of hanging', async () => {
    const connection = await start(executable);
    try {
      const unknown = new (await import('vscode-jsonrpc/node')).RequestType0<unknown, never>(
        'engine/doesNotExist',
      );
      const failure = await connection
        .request(unknown as never, { timeoutMs: 10_000 })
        .catch((error: unknown) => error);
      expect(failure).toBeInstanceOf(EngineRequestFailure);
      expect(failure).toMatchObject({ kind: 'engineError', code: -32601 });
    } finally {
      await connection.stop();
    }
  }, 60_000);
});
