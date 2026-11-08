/* eslint-disable */
// Generated from shared/engine-protocol.schema.json by scripts/gen-schema-types.mjs. Do not edit.

/**
 * This interface was referenced by `EngineProtocol`'s JSON-Schema
 * via the `definition` "LogLevel".
 */
export type LogLevel = 'trace' | 'debug' | 'info' | 'warning' | 'error' | 'off';
/**
 * outgoing: the callees; incoming: the callers; both.
 *
 * This interface was referenced by `EngineProtocol`'s JSON-Schema
 * via the `definition` "CallDirection".
 */
export type CallDirection = 'outgoing' | 'incoming' | 'both';
/**
 * This interface was referenced by `EngineProtocol`'s JSON-Schema
 * via the `definition` "SourceLanguage".
 */
export type SourceLanguage = 'python';

/**
 * Payloads of the JSON-RPC 2.0 protocol between the extension host and the analysis engine over stdio (Content-Length framing, UTF-8). Methods (protocol version 2): request engine/initialize (InitializeParams -> InitializeResult, must come first), request engine/ping (no params -> PingResult), request engine/shutdown (no params -> null), notification engine/exit (process exits), notification engine/setLogLevel (SetLogLevelParams), notification $/cancelRequest ({id}). Analysis requests, each listed in InitializeResult.capabilities.methods once the engine implements it: python/classAnatomy (ClassAnatomyParams), python/callGraph (CallGraphParams), python/controlFlow (ControlFlowParams) and python/moduleGraph (ModuleGraphParams) -> GraphDocument; python/indexFiles (IndexFilesParams) -> IndexResult; diff/compare (DiffCompareParams) -> ChangeSummary. The results are defined in graph-schema.json; this schema does not reference it. Analysis problems are diagnostics in the result; JSON-RPC errors only mean invalid params, cancellation or an internal error. See docs/architecture.md for error codes.
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
  /**
   * An absolute directory owned by Hearback (the extension's global storage, engine/), created by the host; the engine keeps Jedi's cache in it.
   */
  storageDirectory?: string;
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
 * Zero-based line and UTF-16 code unit offset within the line, like Position in graph-schema.json.
 *
 * This interface was referenced by `EngineProtocol`'s JSON-Schema
 * via the `definition` "TextPosition".
 */
export interface TextPosition {
  line: number;
  character: number;
}
/**
 * The file to analyze.
 *
 * This interface was referenced by `EngineProtocol`'s JSON-Schema
 * via the `definition` "SourceFile".
 */
export interface SourceFile {
  /**
   * Absolute path of the file. The ranges in this file repeat it exactly; ranges in other workspace files repeat their paths, and ranges with a revision of a renamed file the base version's path (BaseVersion.file).
   */
  file: string;
  /**
   * The editor's current text of a dirty document, or null when the file does not exist in the working tree (a deleted file). With null and a base, the file's own nodes, the module included, come from the base version and are deleted: ghosts whose ranges carry the base revision. Without a base it has no nodes. Without text the engine reads the file itself with its safe reader.
   */
  text?: string | null;
}
/**
 * The diff base of a file, read by the host from Git.
 *
 * This interface was referenced by `EngineProtocol`'s JSON-Schema
 * via the `definition` "BaseVersion".
 */
export interface BaseVersion {
  /**
   * The resolved commit SHA of the diff base.
   */
  revision: string;
  /**
   * Absolute path of the file in the base version, when it differs (a renamed file).
   */
  file?: string;
  /**
   * The file's text in the base version, or null when the file does not exist there (an added file).
   */
  text: string | null;
}
/**
 * The current text of a dirty document; it takes precedence over the file on disk.
 *
 * This interface was referenced by `EngineProtocol`'s JSON-Schema
 * via the `definition` "FileOverlay".
 */
export interface FileOverlay {
  /**
   * Absolute path of the document.
   */
  file: string;
  text: string;
}
/**
 * The diff base of one workspace file.
 *
 * This interface was referenced by `EngineProtocol`'s JSON-Schema
 * via the `definition` "FileBase".
 */
export interface FileBase {
  /**
   * Absolute path of the file in the working tree; for a deleted file, its last path.
   */
  file: string;
  base: BaseVersion;
}
/**
 * The side-effect rules file of hearback.sideEffects.rulesFile.
 *
 * This interface was referenced by `EngineProtocol`'s JSON-Schema
 * via the `definition` "RulesSource".
 */
export interface RulesSource {
  /**
   * Absolute path of the rules file, for messages.
   */
  path: string;
  /**
   * The file's text, read by the host (at most 1 MiB).
   */
  text: string;
}
/**
 * Settings that shape an analysis.
 *
 * This interface was referenced by `EngineProtocol`'s JSON-Schema
 * via the `definition` "AnalysisOptions".
 */
export interface AnalysisOptions {
  /**
   * Resolution step 3 (Jedi) for obj.method() calls in python/callGraph; hearback.engine.useJedi, default true.
   */
  useJedi?: boolean;
  /**
   * hearback.graph.maxNodes, default 300: the engine cuts the graph at 10 × maxNodes, at most 10,000 nodes, and sets meta.truncated.
   */
  maxNodes?: number;
  sideEffectRules?: RulesSource;
}
/**
 * The workspace folder of a single-file analysis.
 *
 * This interface was referenced by `EngineProtocol`'s JSON-Schema
 * via the `definition` "WorkspaceRoot".
 */
export interface WorkspaceRoot {
  /**
   * Absolute path of the workspace folder: the source root for module names and imports.
   */
  root: string;
}
/**
 * The Python files of one workspace folder (at most 5,000), the text of its dirty documents and, when the request compares, the diff base of its changed files. The engine reads every other file itself with its safe reader.
 *
 * This interface was referenced by `EngineProtocol`'s JSON-Schema
 * via the `definition` "WorkspaceFiles".
 */
export interface WorkspaceFiles {
  /**
   * Absolute path of the workspace folder.
   */
  root: string;
  /**
   * Absolute paths of the folder's Python files in the working tree, filtered by the host.
   *
   * @maxItems 5000
   */
  files: string[];
  /**
   * The current text of the dirty documents among files.
   *
   * @maxItems 5000
   */
  overlays?: FileOverlay[];
  /**
   * The resolved commit SHA of the folder's diff base. When it is set, the request compares: a file with an entry in bases gets its change status from it, a file in omittedBases gets none, and every other file is unchanged; meta.baseRevision repeats it. Required with bases or omittedBases.
   */
  baseRevision?: string;
  /**
   * The base versions of the changed files. An entry whose file is not in files is a file deleted in the working tree: its nodes come back as ghosts.
   *
   * @maxItems 5000
   */
  bases?: FileBase[];
  /**
   * Absolute paths of changed files whose base the host did not send, for example beyond its 16 MB limit for bases: their nodes get no change status, and the result carries changes-partial.
   *
   * @maxItems 5000
   */
  omittedBases?: string[];
}
/**
 * One batch of python/indexFiles.
 *
 * This interface was referenced by `EngineProtocol`'s JSON-Schema
 * via the `definition` "WorkspaceBatch".
 */
export interface WorkspaceBatch {
  /**
   * Absolute path of the workspace folder.
   */
  root: string;
  /**
   * Absolute paths of the files of this batch; the host sends at most 250 files or 4 MB.
   *
   * @maxItems 500
   */
  files: string[];
  /**
   * @maxItems 500
   */
  overlays?: FileOverlay[];
}
/**
 * python/classAnatomy -> GraphDocument (view classAnatomy) of the whole file, state-matrix data included, with context cards for base classes in other workspace files. It focuses on the class or method named by symbol, else on the one at position, else on none. base compares the source file, workspace.baseRevision the other files (WorkspaceFiles); for the source file, source.text and base take precedence over its entries in workspace.overlays and workspace.bases.
 *
 * This interface was referenced by `EngineProtocol`'s JSON-Schema
 * via the `definition` "ClassAnatomyParams".
 */
export interface ClassAnatomyParams {
  source: SourceFile;
  position?: TextPosition;
  /**
   * Id of the class or method to focus on, e.g. of a Changes tree item or a graph node; it takes precedence over position. The engine looks it up in the working text, then in the base version: a symbol that only the base has (a ghost) is analyzed in the base version, and its nodes come back deleted, with ranges that carry the base revision.
   */
  symbol?: string;
  base?: BaseVersion;
  workspace?: WorkspaceFiles;
  options?: AnalysisOptions;
}
/**
 * python/callGraph -> GraphDocument (view callGraph): callers and callees of the function or method named by symbol, else of the innermost one at position, over hops levels, across the workspace files. It needs position or symbol. base compares the source file, workspace.baseRevision the other files (WorkspaceFiles); for the source file, source.text and base take precedence over its entries in workspace.overlays and workspace.bases.
 *
 * This interface was referenced by `EngineProtocol`'s JSON-Schema
 * via the `definition` "CallGraphParams".
 */
export interface CallGraphParams {
  source: SourceFile;
  position?: TextPosition;
  /**
   * Id of the function or method, e.g. of a Changes tree item or a graph node; it takes precedence over position. The engine looks it up in the working text, then in the base version: a symbol that only the base has (a ghost) is analyzed in the base version, and its nodes come back deleted, with ranges that carry the base revision.
   */
  symbol?: string;
  /**
   * How many call levels to follow (hearback.graph.defaultHops, default 2).
   */
  hops: number;
  direction: CallDirection;
  workspace: WorkspaceFiles;
  base?: BaseVersion;
  options?: AnalysisOptions;
}
/**
 * python/controlFlow -> GraphDocument (view controlFlow) of the function or method named by symbol, else of the innermost one at position. It needs position or symbol. The result is compared when base is given.
 *
 * This interface was referenced by `EngineProtocol`'s JSON-Schema
 * via the `definition` "ControlFlowParams".
 */
export interface ControlFlowParams {
  source: SourceFile;
  position?: TextPosition;
  /**
   * Id of the function or method, e.g. of a Changes tree item or a graph node; it takes precedence over position. The engine looks it up in the working text, then in the base version: a symbol that only the base has (a ghost) is analyzed in the base version, and its nodes come back deleted, with ranges that carry the base revision.
   */
  symbol?: string;
  base?: BaseVersion;
  workspace?: WorkspaceRoot;
  options?: AnalysisOptions;
}
/**
 * python/moduleGraph -> GraphDocument (view moduleGraph): the import dependencies of the workspace folder. The result is compared when workspace.baseRevision is given.
 *
 * This interface was referenced by `EngineProtocol`'s JSON-Schema
 * via the `definition` "ModuleGraphParams".
 */
export interface ModuleGraphParams {
  workspace: WorkspaceFiles;
  /**
   * Absolute paths of the folders selected in the Explorer; without them the whole workspace folder.
   *
   * @maxItems 5000
   */
  scopes?: string[];
  /**
   * Absolute path of the file whose module the graph focuses on.
   */
  focusFile?: string;
  options?: AnalysisOptions;
}
/**
 * python/indexFiles -> IndexResult: fills the engine's per-file summaries for one batch.
 *
 * This interface was referenced by `EngineProtocol`'s JSON-Schema
 * via the `definition` "IndexFilesParams".
 */
export interface IndexFilesParams {
  workspace: WorkspaceBatch;
  options?: AnalysisOptions;
}
/**
 * diff/compare -> ChangeSummary: the change status of every symbol against the base and the line hunks; without a base, the outline of the file.
 *
 * This interface was referenced by `EngineProtocol`'s JSON-Schema
 * via the `definition` "DiffCompareParams".
 */
export interface DiffCompareParams {
  language: SourceLanguage;
  source: SourceFile;
  base?: BaseVersion;
  workspace?: WorkspaceRoot;
  options?: AnalysisOptions;
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
 * Written by engine/run_engine.py as one stderr line 'HEARBACK_ENGINE_FATAL <json>' before exiting with code 3 (python-too-old) or 4 (bootstrap-failed).
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
