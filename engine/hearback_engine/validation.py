"""Checks of incoming params against shared/engine-protocol.schema.json.

The schema does not ship with the engine and jsonschema is not vendored, so the rules are written
out here; engine/tests/test_validation.py runs them side by side with the schema. Each check
returns a fresh copy that holds only the keys the schema knows.
"""

from collections.abc import Callable
from typing import Final, TypeVar, cast, get_args

from . import PROTOCOL_VERSION
from .protocol import (
    AnalysisOptions,
    BaseVersion,
    CallDirection,
    CallGraphParams,
    ClassAnatomyParams,
    ClientInfo,
    ControlFlowParams,
    DiffCompareParams,
    ErrorCode,
    ErrorKind,
    FileBase,
    FileOverlay,
    IndexFilesParams,
    InitializeParams,
    LogLevel,
    ModuleGraphParams,
    RulesSource,
    SourceFile,
    SourceLanguage,
    TextPosition,
    WorkspaceBatch,
    WorkspaceFiles,
    WorkspaceRoot,
)
from .rpc import RpcError

T = TypeVar("T")
Choice = TypeVar("Choice", bound=str)

LOG_LEVELS: Final = cast("tuple[LogLevel, ...]", get_args(LogLevel))
CALL_DIRECTIONS: Final = cast("tuple[CallDirection, ...]", get_args(CallDirection))
SOURCE_LANGUAGES: Final = cast("tuple[SourceLanguage, ...]", get_args(SourceLanguage))

# Limits of the schema.
MAX_WORKSPACE_FILES: Final = 5000
MAX_BATCH_FILES: Final = 500
MIN_MAX_NODES: Final = 50
MAX_MAX_NODES: Final = 5000
MIN_HOPS: Final = 1
MAX_HOPS: Final = 10

_INITIALIZE_REQUIRED: Final = ("protocolVersion", "client", "logLevel", "workspaceTrusted")
_INITIALIZE_OPTIONAL: Final = ("locale", "storageDirectory")
_ANALYSIS_OPTIONAL: Final = ("base", "workspace", "options")


def invalid_params(detail: str) -> RpcError:
    return RpcError(
        ErrorCode.INVALID_PARAMS, ErrorKind.INVALID_PARAMS, f"Invalid params: {detail}.", detail
    )


# --- engine/* ---------------------------------------------------------------------------------


def initialize_params(params: object) -> InitializeParams:
    if not isinstance(params, dict):
        raise invalid_params("engine/initialize expects an object")
    # Checked first: a client speaking another protocol version may also send other params.
    version = _as_integer(params.get("protocolVersion"))
    if version is not None and version >= 1 and version != PROTOCOL_VERSION:
        raise RpcError(
            ErrorCode.INVALID_PARAMS,
            ErrorKind.PROTOCOL_MISMATCH,
            f"The client speaks protocol version {version}, the engine version {PROTOCOL_VERSION}.",
            f"client {version}, engine {PROTOCOL_VERSION}",
        )
    _check_keys(params, "params", _INITIALIZE_REQUIRED, _INITIALIZE_OPTIONAL)
    result: InitializeParams = {
        "protocolVersion": _integer(params["protocolVersion"], "params.protocolVersion"),
        "client": _client_info(params["client"]),
        "logLevel": log_level(params["logLevel"], "params.logLevel"),
        "workspaceTrusted": _boolean(params["workspaceTrusted"], "params.workspaceTrusted"),
    }
    if "locale" in params:
        result["locale"] = _string(params["locale"], "params.locale", allow_empty=True)
    if "storageDirectory" in params:
        result["storageDirectory"] = _string(params["storageDirectory"], "params.storageDirectory")
    return result


def set_log_level_params(params: object) -> LogLevel:
    if not isinstance(params, dict):
        raise invalid_params("engine/setLogLevel expects an object")
    _check_keys(params, "params", ("level",), ())
    return log_level(params["level"], "params.level")


def no_params(params: object, method: str) -> None:
    """Accept the shapes clients send for a method without params.

    vscode-jsonrpc omits params, but sends [null] when a caller passes undefined explicitly.
    """
    if params not in (None, {}, [], [None]):
        raise invalid_params(f"{method} takes no params")


def log_level(value: object, where: str) -> LogLevel:
    return _choice(value, where, LOG_LEVELS)


# --- Analysis requests ------------------------------------------------------------------------


def class_anatomy_params(params: object) -> ClassAnatomyParams:
    request = _params(params, "python/classAnatomy", ("source",), ("position", *_ANALYSIS_OPTIONAL))
    result: ClassAnatomyParams = {"source": source_file(request["source"], "params.source")}
    if "position" in request:
        result["position"] = text_position(request["position"], "params.position")
    if "base" in request:
        result["base"] = base_version(request["base"], "params.base")
    if "workspace" in request:
        result["workspace"] = workspace_root(request["workspace"], "params.workspace")
    if "options" in request:
        result["options"] = analysis_options(request["options"], "params.options")
    return result


def call_graph_params(params: object) -> CallGraphParams:
    request = _params(
        params,
        "python/callGraph",
        ("source", "position", "hops", "direction", "workspace"),
        ("base", "options"),
    )
    result: CallGraphParams = {
        "source": source_file(request["source"], "params.source"),
        "position": text_position(request["position"], "params.position"),
        "hops": _integer(request["hops"], "params.hops", minimum=MIN_HOPS, maximum=MAX_HOPS),
        "direction": _choice(request["direction"], "params.direction", CALL_DIRECTIONS),
        "workspace": workspace_files(request["workspace"], "params.workspace"),
    }
    if "base" in request:
        result["base"] = base_version(request["base"], "params.base")
    if "options" in request:
        result["options"] = analysis_options(request["options"], "params.options")
    return result


def control_flow_params(params: object) -> ControlFlowParams:
    request = _params(params, "python/controlFlow", ("source", "position"), _ANALYSIS_OPTIONAL)
    result: ControlFlowParams = {
        "source": source_file(request["source"], "params.source"),
        "position": text_position(request["position"], "params.position"),
    }
    if "base" in request:
        result["base"] = base_version(request["base"], "params.base")
    if "workspace" in request:
        result["workspace"] = workspace_root(request["workspace"], "params.workspace")
    if "options" in request:
        result["options"] = analysis_options(request["options"], "params.options")
    return result


def module_graph_params(params: object) -> ModuleGraphParams:
    request = _params(
        params, "python/moduleGraph", ("workspace",), ("scopes", "focusFile", "options")
    )
    result: ModuleGraphParams = {
        "workspace": workspace_files(request["workspace"], "params.workspace")
    }
    if "scopes" in request:
        result["scopes"] = _array(
            request["scopes"], "params.scopes", _string, max_items=MAX_WORKSPACE_FILES
        )
    if "focusFile" in request:
        result["focusFile"] = _string(request["focusFile"], "params.focusFile")
    if "options" in request:
        result["options"] = analysis_options(request["options"], "params.options")
    return result


def index_files_params(params: object) -> IndexFilesParams:
    request = _params(params, "python/indexFiles", ("workspace",), ("options",))
    result: IndexFilesParams = {
        "workspace": workspace_batch(request["workspace"], "params.workspace")
    }
    if "options" in request:
        result["options"] = analysis_options(request["options"], "params.options")
    return result


def diff_compare_params(params: object) -> DiffCompareParams:
    request = _params(params, "diff/compare", ("language", "source"), _ANALYSIS_OPTIONAL)
    result: DiffCompareParams = {
        "language": _choice(request["language"], "params.language", SOURCE_LANGUAGES),
        "source": source_file(request["source"], "params.source"),
    }
    if "base" in request:
        result["base"] = base_version(request["base"], "params.base")
    if "workspace" in request:
        result["workspace"] = workspace_root(request["workspace"], "params.workspace")
    if "options" in request:
        result["options"] = analysis_options(request["options"], "params.options")
    return result


# --- Parts of the analysis params ($defs) ----------------------------------------------------


def text_position(value: object, where: str) -> TextPosition:
    item = _object(value, where, ("line", "character"), ())
    return {
        "line": _integer(item["line"], f"{where}.line", minimum=0),
        "character": _integer(item["character"], f"{where}.character", minimum=0),
    }


def source_file(value: object, where: str) -> SourceFile:
    item = _object(value, where, ("file",), ("text",))
    result: SourceFile = {"file": _string(item["file"], f"{where}.file")}
    if "text" in item:
        result["text"] = _string(item["text"], f"{where}.text", allow_empty=True)
    return result


def base_version(value: object, where: str) -> BaseVersion:
    item = _object(value, where, ("revision", "text"), ("file",))
    text = item["text"]
    result: BaseVersion = {
        "revision": _string(item["revision"], f"{where}.revision"),
        "text": None if text is None else _string(text, f"{where}.text", allow_empty=True),
    }
    if "file" in item:
        result["file"] = _string(item["file"], f"{where}.file")
    return result


def file_overlay(value: object, where: str) -> FileOverlay:
    item = _object(value, where, ("file", "text"), ())
    return {
        "file": _string(item["file"], f"{where}.file"),
        "text": _string(item["text"], f"{where}.text", allow_empty=True),
    }


def file_base(value: object, where: str) -> FileBase:
    item = _object(value, where, ("file", "base"), ())
    return {
        "file": _string(item["file"], f"{where}.file"),
        "base": base_version(item["base"], f"{where}.base"),
    }


def rules_source(value: object, where: str) -> RulesSource:
    item = _object(value, where, ("path", "text"), ())
    return {
        "path": _string(item["path"], f"{where}.path"),
        "text": _string(item["text"], f"{where}.text", allow_empty=True),
    }


def analysis_options(value: object, where: str) -> AnalysisOptions:
    item = _object(value, where, (), ("useJedi", "maxNodes", "sideEffectRules"))
    result: AnalysisOptions = {}
    if "useJedi" in item:
        result["useJedi"] = _boolean(item["useJedi"], f"{where}.useJedi")
    if "maxNodes" in item:
        result["maxNodes"] = _integer(
            item["maxNodes"], f"{where}.maxNodes", minimum=MIN_MAX_NODES, maximum=MAX_MAX_NODES
        )
    if "sideEffectRules" in item:
        result["sideEffectRules"] = rules_source(
            item["sideEffectRules"], f"{where}.sideEffectRules"
        )
    return result


def workspace_root(value: object, where: str) -> WorkspaceRoot:
    item = _object(value, where, ("root",), ())
    return {"root": _string(item["root"], f"{where}.root")}


def workspace_files(value: object, where: str) -> WorkspaceFiles:
    item = _object(value, where, ("root", "files"), ("overlays", "bases"))
    result: WorkspaceFiles = {
        "root": _string(item["root"], f"{where}.root"),
        "files": _array(item["files"], f"{where}.files", _string, max_items=MAX_WORKSPACE_FILES),
    }
    if "overlays" in item:
        result["overlays"] = _array(
            item["overlays"], f"{where}.overlays", file_overlay, max_items=MAX_WORKSPACE_FILES
        )
    if "bases" in item:
        result["bases"] = _array(
            item["bases"], f"{where}.bases", file_base, max_items=MAX_WORKSPACE_FILES
        )
    return result


def workspace_batch(value: object, where: str) -> WorkspaceBatch:
    item = _object(value, where, ("root", "files"), ("overlays",))
    result: WorkspaceBatch = {
        "root": _string(item["root"], f"{where}.root"),
        "files": _array(item["files"], f"{where}.files", _string, max_items=MAX_BATCH_FILES),
    }
    if "overlays" in item:
        result["overlays"] = _array(
            item["overlays"], f"{where}.overlays", file_overlay, max_items=MAX_BATCH_FILES
        )
    return result


# --- Helpers ----------------------------------------------------------------------------------


def _params(
    params: object, method: str, required: tuple[str, ...], optional: tuple[str, ...]
) -> dict[str, object]:
    if not isinstance(params, dict):
        raise invalid_params(f"{method} expects an object")
    _check_keys(params, "params", required, optional)
    return cast("dict[str, object]", params)


def _object(
    value: object, where: str, required: tuple[str, ...], optional: tuple[str, ...]
) -> dict[str, object]:
    if not isinstance(value, dict):
        raise invalid_params(f"{where} must be an object")
    _check_keys(value, where, required, optional)
    return cast("dict[str, object]", value)


def _check_keys(
    value: dict[object, object], where: str, required: tuple[str, ...], optional: tuple[str, ...]
) -> None:
    for key in required:
        if key not in value:
            raise invalid_params(f"{where}.{key} is required")
    unknown = sorted(str(key) for key in value if key not in required and key not in optional)
    if unknown:
        raise invalid_params(f"{where} has an unknown property {unknown[0]!r}")


def _array(
    value: object, where: str, item: Callable[[object, str], T], *, max_items: int
) -> list[T]:
    if not isinstance(value, list):
        raise invalid_params(f"{where} must be an array")
    if len(value) > max_items:
        raise invalid_params(f"{where} must have at most {max_items} items")
    return [item(entry, f"{where}[{index}]") for index, entry in enumerate(value)]


def _choice(value: object, where: str, choices: tuple[Choice, ...]) -> Choice:
    for choice in choices:
        if value == choice:
            return choice
    raise invalid_params(f"{where} must be one of {', '.join(choices)}")


def _client_info(value: object) -> ClientInfo:
    if not isinstance(value, dict):
        raise invalid_params("params.client must be an object")
    _check_keys(value, "params.client", ("name", "version"), ())
    return {
        "name": _string(value["name"], "params.client.name"),
        "version": _string(value["version"], "params.client.version"),
    }


def _as_integer(value: object) -> int | None:
    """JSON Schema integers: ints and integral floats such as 1.0, but not booleans."""
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float) and value.is_integer():
        return int(value)
    return None


def _integer(value: object, where: str, *, minimum: int = 1, maximum: int | None = None) -> int:
    number = _as_integer(value)
    if number is None or number < minimum or (maximum is not None and number > maximum):
        bounds = f">= {minimum}" if maximum is None else f"from {minimum} to {maximum}"
        raise invalid_params(f"{where} must be an integer {bounds}")
    return number


def _boolean(value: object, where: str) -> bool:
    if not isinstance(value, bool):
        raise invalid_params(f"{where} must be a boolean")
    return value


def _string(value: object, where: str, *, allow_empty: bool = False) -> str:
    if not isinstance(value, str) or (not value and not allow_empty):
        raise invalid_params(f"{where} must be a {'string' if allow_empty else 'non-empty string'}")
    return value
