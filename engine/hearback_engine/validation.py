"""Checks of incoming params against shared/engine-protocol.schema.json.

The schema does not ship with the engine and jsonschema is not vendored, so the rules are written
out here; engine/tests/test_validation.py runs them side by side with the schema.
"""

from typing import Final, cast, get_args

from . import PROTOCOL_VERSION
from .protocol import ClientInfo, ErrorCode, ErrorKind, InitializeParams, LogLevel
from .rpc import RpcError

LOG_LEVELS: Final = cast("tuple[LogLevel, ...]", get_args(LogLevel))

_INITIALIZE_REQUIRED: Final = ("protocolVersion", "client", "logLevel", "workspaceTrusted")
_INITIALIZE_OPTIONAL: Final = ("locale",)


def invalid_params(detail: str) -> RpcError:
    return RpcError(
        ErrorCode.INVALID_PARAMS, ErrorKind.INVALID_PARAMS, f"Invalid params: {detail}.", detail
    )


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
    for level in LOG_LEVELS:
        if value == level:
            return level
    raise invalid_params(f"{where} must be one of {', '.join(LOG_LEVELS)}")


def _check_keys(
    value: dict[object, object], where: str, required: tuple[str, ...], optional: tuple[str, ...]
) -> None:
    for key in required:
        if key not in value:
            raise invalid_params(f"{where}.{key} is required")
    unknown = sorted(str(key) for key in value if key not in required and key not in optional)
    if unknown:
        raise invalid_params(f"{where} has an unknown property {unknown[0]!r}")


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


def _integer(value: object, where: str, *, minimum: int = 1) -> int:
    number = _as_integer(value)
    if number is None or number < minimum:
        raise invalid_params(f"{where} must be an integer >= {minimum}")
    return number


def _boolean(value: object, where: str) -> bool:
    if not isinstance(value, bool):
        raise invalid_params(f"{where} must be a boolean")
    return value


def _string(value: object, where: str, *, allow_empty: bool = False) -> str:
    if not isinstance(value, str) or (not value and not allow_empty):
        raise invalid_params(f"{where} must be a {'string' if allow_empty else 'non-empty string'}")
    return value
