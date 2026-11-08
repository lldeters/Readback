"""Engine protocol: payload types, method names, error codes and exit codes.

Python mirror of shared/engine-protocol.schema.json (the contract) and src/engine/protocol.ts.
The TypedDicts are hand-written with stdlib typing only (no typing_extensions at runtime);
engine/tests/test_schema_conformance.py and test_protocol_sync.py keep them in sync with the
schema and with the TypeScript constants.

Optional keys use a required base class plus a ``total=False`` subclass, because
``typing.NotRequired`` needs Python 3.11 and the engine supports 3.10.
"""

from typing import Literal, TypedDict

# --- Enumerations -----------------------------------------------------------------------------

LogLevel = Literal["trace", "debug", "info", "warning", "error", "off"]
ReleaseLevel = Literal["alpha", "beta", "candidate", "final"]
FatalErrorCode = Literal["python-too-old", "bootstrap-failed"]
CallDirection = Literal["outgoing", "incoming", "both"]
SourceLanguage = Literal["python"]


# --- Payloads ($defs of the schema) -----------------------------------------------------------


class ClientInfo(TypedDict):
    name: str
    version: str


class _InitializeParamsRequired(TypedDict):
    protocolVersion: int
    client: ClientInfo
    logLevel: LogLevel
    workspaceTrusted: bool


class InitializeParams(_InitializeParamsRequired, total=False):
    locale: str
    # An absolute directory owned by Hearback; the engine keeps Jedi's cache in it.
    storageDirectory: str


class VersionInfo(TypedDict):
    major: int
    minor: int
    micro: int
    releaseLevel: ReleaseLevel
    serial: int


class PythonInfo(TypedDict):
    version: str
    versionInfo: VersionInfo
    implementation: str
    executable: str
    platform: str


class VendoredPackage(TypedDict):
    name: str
    version: str


class Capabilities(TypedDict):
    methods: list[str]


class InitializeResult(TypedDict):
    engineVersion: str
    protocolVersion: int
    schemaVersion: int
    python: PythonInfo
    vendored: list[VendoredPackage]
    capabilities: Capabilities
    pid: int
    sandboxed: bool


class PingResult(TypedDict):
    pong: Literal[True]


class SetLogLevelParams(TypedDict):
    level: LogLevel


# --- Params of the analysis requests ----------------------------------------------------------
# Their results (GraphDocument, ChangeSummary, IndexResult) are in hearback_engine.graph.


class TextPosition(TypedDict):
    line: int
    character: int


class _SourceFileRequired(TypedDict):
    file: str


class SourceFile(_SourceFileRequired, total=False):
    # The text of a dirty document, or None for a file deleted in the working tree; without it the
    # engine reads the file itself.
    text: str | None


class _BaseVersionRequired(TypedDict):
    revision: str
    # None when the file does not exist in the base version (an added file).
    text: str | None


class BaseVersion(_BaseVersionRequired, total=False):
    # The path in the base version, when it differs (a renamed file).
    file: str


class FileOverlay(TypedDict):
    file: str
    text: str


class FileBase(TypedDict):
    file: str
    base: BaseVersion


class RulesSource(TypedDict):
    path: str
    text: str


class AnalysisOptions(TypedDict, total=False):
    useJedi: bool
    maxNodes: int
    sideEffectRules: RulesSource


class WorkspaceRoot(TypedDict):
    root: str


class _WorkspaceFilesRequired(TypedDict):
    root: str
    files: list[str]


class WorkspaceFiles(_WorkspaceFilesRequired, total=False):
    overlays: list[FileOverlay]
    # Set when the request compares; required with bases or omittedBases.
    baseRevision: str
    bases: list[FileBase]
    # Changed files whose base the host did not send: no change status, changes-partial.
    omittedBases: list[str]


class _WorkspaceBatchRequired(TypedDict):
    root: str
    files: list[str]


class WorkspaceBatch(_WorkspaceBatchRequired, total=False):
    overlays: list[FileOverlay]


class _ClassAnatomyParamsRequired(TypedDict):
    source: SourceFile


class ClassAnatomyParams(_ClassAnatomyParamsRequired, total=False):
    position: TextPosition
    # The id of the symbol to focus on; it takes precedence over position.
    symbol: str
    base: BaseVersion
    workspace: WorkspaceFiles
    options: AnalysisOptions


class _CallGraphParamsRequired(TypedDict):
    source: SourceFile
    hops: int
    direction: CallDirection
    workspace: WorkspaceFiles


class CallGraphParams(_CallGraphParamsRequired, total=False):
    # The schema requires position or symbol; symbol takes precedence.
    position: TextPosition
    symbol: str
    base: BaseVersion
    options: AnalysisOptions


class _ControlFlowParamsRequired(TypedDict):
    source: SourceFile


class ControlFlowParams(_ControlFlowParamsRequired, total=False):
    # The schema requires position or symbol; symbol takes precedence.
    position: TextPosition
    symbol: str
    base: BaseVersion
    workspace: WorkspaceRoot
    options: AnalysisOptions


class _ModuleGraphParamsRequired(TypedDict):
    workspace: WorkspaceFiles


class ModuleGraphParams(_ModuleGraphParamsRequired, total=False):
    scopes: list[str]
    focusFile: str
    options: AnalysisOptions


class _IndexFilesParamsRequired(TypedDict):
    workspace: WorkspaceBatch


class IndexFilesParams(_IndexFilesParamsRequired, total=False):
    options: AnalysisOptions


class _DiffCompareParamsRequired(TypedDict):
    language: SourceLanguage
    source: SourceFile


class DiffCompareParams(_DiffCompareParamsRequired, total=False):
    base: BaseVersion
    workspace: WorkspaceRoot
    options: AnalysisOptions


# --- Errors -----------------------------------------------------------------------------------


class _EngineErrorDataRequired(TypedDict):
    kind: str


class EngineErrorData(_EngineErrorDataRequired, total=False):
    detail: str


class _FatalStartupErrorRequired(TypedDict):
    code: FatalErrorCode


class FatalStartupError(_FatalStartupErrorRequired, total=False):
    version: str
    required: str
    detail: str


# --- Constants (identical to src/engine/protocol.ts) ------------------------------------------


class Method:
    """Request and notification names (TS: ``Methods``).

    ADR 012 fixes their order: engine/initialize, engine/ping, engine/shutdown,
    python/classAnatomy, python/callGraph, python/controlFlow, python/moduleGraph,
    python/indexFiles and diff/compare, then the notifications engine/exit and
    engine/setLogLevel. Each analysis request is added together with its handler.
    """

    INITIALIZE = "engine/initialize"
    PING = "engine/ping"
    SHUTDOWN = "engine/shutdown"
    EXIT = "engine/exit"
    SET_LOG_LEVEL = "engine/setLogLevel"
    # Handled by the JSON-RPC layer itself, so it is not listed in Capabilities.methods.
    CANCEL_REQUEST = "$/cancelRequest"


class ErrorCode:
    """JSON-RPC 2.0 error codes used by the engine (TS: ``ErrorCodes``)."""

    PARSE_ERROR = -32700
    INVALID_REQUEST = -32600
    METHOD_NOT_FOUND = -32601
    INVALID_PARAMS = -32602
    INTERNAL_ERROR = -32603
    # Request arrived before engine/initialize (LSP ServerNotInitialized).
    NOT_INITIALIZED = -32002
    # Request was cancelled via $/cancelRequest (LSP RequestCancelled).
    REQUEST_CANCELLED = -32800


class ErrorKind:
    """Values of EngineErrorData.kind: the machine-readable reason behind an error code."""

    PARSE_ERROR = "parse-error"
    INVALID_REQUEST = "invalid-request"
    METHOD_NOT_FOUND = "method-not-found"
    INVALID_PARAMS = "invalid-params"
    PROTOCOL_MISMATCH = "protocol-mismatch"
    INTERNAL = "internal"
    NOT_INITIALIZED = "not-initialized"
    ALREADY_INITIALIZED = "already-initialized"
    SHUTTING_DOWN = "shutting-down"
    CANCELLED = "cancelled"


class ExitCode:
    """Exit codes of engine/run_engine.py (TS: ``EngineExitCodes``).

    3 and 4 come with a FATAL_PREFIX line on stderr. Any other non-zero code means the engine
    stopped without a preceding engine/shutdown (end of input, protocol error or crash).
    """

    OK = 0
    PYTHON_TOO_OLD = 3
    BOOTSTRAP_FAILED = 4


# Prefix of the single machine-readable stderr line written before a fatal startup exit.
FATAL_PREFIX = "HEARBACK_ENGINE_FATAL "
