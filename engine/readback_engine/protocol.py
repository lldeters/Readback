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
    """Request and notification names (TS: ``Methods``)."""

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
FATAL_PREFIX = "READBACK_ENGINE_FATAL "
