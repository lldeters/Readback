// Engine JSON-RPC protocol constants. Payload types are generated from
// shared/engine-protocol.schema.json; the Python side mirrors these names in
// engine/readback_engine/protocol.py (test/repo/versions.test.ts keeps both in sync).

/** Bump on every incompatible protocol change (and in engine/readback_engine/__init__.py). */
export const PROTOCOL_VERSION = 1;

export const Methods = {
  initialize: 'engine/initialize',
  ping: 'engine/ping',
  shutdown: 'engine/shutdown',
  exit: 'engine/exit',
  setLogLevel: 'engine/setLogLevel',
} as const;

/** JSON-RPC 2.0 error codes used by the engine. */
export const ErrorCodes = {
  parseError: -32700,
  invalidRequest: -32600,
  methodNotFound: -32601,
  invalidParams: -32602,
  internalError: -32603,
  /** Request arrived before engine/initialize (LSP ServerNotInitialized). */
  notInitialized: -32002,
  /** Request was cancelled via $/cancelRequest or hit its deadline (LSP RequestCancelled). */
  requestCancelled: -32800,
} as const;

/** Exit codes of engine/run_engine.py, reported together with a READBACK_ENGINE_FATAL stderr line. */
export const EngineExitCodes = {
  ok: 0,
  pythonTooOld: 3,
  bootstrapFailed: 4,
} as const;

/** Prefix of the single machine-readable stderr line written before a fatal startup exit. */
export const FATAL_PREFIX = 'READBACK_ENGINE_FATAL ';

/** Minimum Python version the engine supports. */
export const MIN_PYTHON = { major: 3, minor: 10 } as const;
