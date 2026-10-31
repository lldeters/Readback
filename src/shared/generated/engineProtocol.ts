/* eslint-disable */
// Generated from shared/engine-protocol.schema.json by scripts/gen-schema-types.mjs. Do not edit.

/**
 * This interface was referenced by `EngineProtocol`'s JSON-Schema
 * via the `definition` "LogLevel".
 */
export type LogLevel = 'trace' | 'debug' | 'info' | 'warning' | 'error' | 'off';

/**
 * Payloads of the JSON-RPC 2.0 protocol between the extension host and the analysis engine over stdio (Content-Length framing, UTF-8). Methods (protocol version 1): request engine/initialize (InitializeParams -> InitializeResult, must come first), request engine/ping (no params -> PingResult), request engine/shutdown (no params -> null), notification engine/exit (process exits), notification engine/setLogLevel (SetLogLevelParams), notification $/cancelRequest ({id}). See docs/architecture.md for error codes.
 */
export interface EngineProtocol {
  [k: string]: unknown | undefined;
}
/**
 * This interface was referenced by `EngineProtocol`'s JSON-Schema
 * via the `definition` "ClientInfo".
 */
export interface ClientInfo {
  name: string;
  version: string;
}
/**
 * This interface was referenced by `EngineProtocol`'s JSON-Schema
 * via the `definition` "InitializeParams".
 */
export interface InitializeParams {
  protocolVersion: number;
  client: ClientInfo;
  logLevel: LogLevel;
  workspaceTrusted: boolean;
  locale?: string;
}
/**
 * This interface was referenced by `EngineProtocol`'s JSON-Schema
 * via the `definition` "VersionInfo".
 */
export interface VersionInfo {
  major: number;
  minor: number;
  micro: number;
  releaseLevel: 'alpha' | 'beta' | 'candidate' | 'final';
  serial: number;
}
/**
 * This interface was referenced by `EngineProtocol`'s JSON-Schema
 * via the `definition` "PythonInfo".
 */
export interface PythonInfo {
  /**
   * e.g. 3.12.3
   */
  version: string;
  versionInfo: VersionInfo;
  /**
   * sys.implementation.name, e.g. cpython
   */
  implementation: string;
  /**
   * sys.executable
   */
  executable: string;
  /**
   * sys.platform
   */
  platform: string;
}
/**
 * This interface was referenced by `EngineProtocol`'s JSON-Schema
 * via the `definition` "VendoredPackage".
 */
export interface VendoredPackage {
  name: string;
  version: string;
}
/**
 * This interface was referenced by `EngineProtocol`'s JSON-Schema
 * via the `definition` "Capabilities".
 */
export interface Capabilities {
  /**
   * Request and notification names the engine handles.
   */
  methods: string[];
}
/**
 * This interface was referenced by `EngineProtocol`'s JSON-Schema
 * via the `definition` "InitializeResult".
 */
export interface InitializeResult {
  engineVersion: string;
  protocolVersion: number;
  /**
   * GraphDocument schemaVersion.
   */
  schemaVersion: number;
  python: PythonInfo;
  vendored: VendoredPackage[];
  capabilities: Capabilities;
  pid: number;
  /**
   * True when the audit-hook sandbox (no processes, no sockets) is active.
   */
  sandboxed: boolean;
}
/**
 * This interface was referenced by `EngineProtocol`'s JSON-Schema
 * via the `definition` "PingResult".
 */
export interface PingResult {
  pong: true;
}
/**
 * This interface was referenced by `EngineProtocol`'s JSON-Schema
 * via the `definition` "SetLogLevelParams".
 */
export interface SetLogLevelParams {
  level: LogLevel;
}
/**
 * The data member of JSON-RPC error responses sent by the engine.
 *
 * This interface was referenced by `EngineProtocol`'s JSON-Schema
 * via the `definition` "EngineErrorData".
 */
export interface EngineErrorData {
  /**
   * Machine-readable error kind, e.g. not-initialized, shutting-down, invalid-params, internal.
   */
  kind: string;
  detail?: string;
}
/**
 * Written by engine/run_engine.py as one stderr line 'READBACK_ENGINE_FATAL <json>' before exiting with code 3 (python-too-old) or 4 (bootstrap-failed).
 *
 * This interface was referenced by `EngineProtocol`'s JSON-Schema
 * via the `definition` "FatalStartupError".
 */
export interface FatalStartupError {
  code: 'python-too-old' | 'bootstrap-failed';
  /**
   * Running Python version, e.g. 3.9.6
   */
  version?: string;
  /**
   * Minimum Python version, e.g. 3.10
   */
  required?: string;
  detail?: string;
}
