"""The hand-written params checks agree with shared/engine-protocol.schema.json."""

from __future__ import annotations

from typing import Any

import pytest
import support

from readback_engine import rpc, validation
from readback_engine.protocol import ErrorKind

CLIENT = {"name": "vscode", "version": "1.105.1"}
BASE: dict[str, Any] = {
    "protocolVersion": 1,
    "client": CLIENT,
    "logLevel": "info",
    "workspaceTrusted": False,
}

INITIALIZE_CASES: list[object] = [
    BASE,
    {**BASE, "locale": "de"},
    {**BASE, "locale": ""},
    {**BASE, "logLevel": "off"},
    {**BASE, "workspaceTrusted": True},
    {key: value for key, value in BASE.items() if key != "logLevel"},
    {key: value for key, value in BASE.items() if key != "workspaceTrusted"},
    {**BASE, "extra": 1},
    {**BASE, "client": {"name": "vscode"}},
    {**BASE, "client": {**CLIENT, "build": "x"}},
    {**BASE, "client": {"name": "", "version": "1"}},
    {**BASE, "client": {"name": "a", "version": ""}},
    {**BASE, "client": "vscode"},
    {**BASE, "logLevel": "INFO"},
    {**BASE, "logLevel": 3},
    {**BASE, "workspaceTrusted": 1},
    {**BASE, "protocolVersion": 0},
    {**BASE, "protocolVersion": 1.0},
    {**BASE, "protocolVersion": "1"},
    {**BASE, "protocolVersion": True},
    {**BASE, "locale": None},
    [],
    None,
    "params",
]


def accepted(check: Any, params: object) -> bool:
    try:
        check(params)
    except rpc.RpcError as error:
        assert error.kind == ErrorKind.INVALID_PARAMS
        return False
    return True


@pytest.mark.parametrize("params", INITIALIZE_CASES)
def test_initialize_params_agree_with_the_schema(
    protocol_schema: dict[str, Any], params: object
) -> None:
    schema_ok = support.validator(protocol_schema, "InitializeParams").is_valid(params)
    assert accepted(validation.initialize_params, params) is schema_ok


@pytest.mark.parametrize(
    "params",
    [{"level": "debug"}, {"level": "off"}, {"level": "x"}, {}, {"level": "info", "x": 1}, 5],
)
def test_set_log_level_params_agree_with_the_schema(
    protocol_schema: dict[str, Any], params: object
) -> None:
    schema_ok = support.validator(protocol_schema, "SetLogLevelParams").is_valid(params)
    assert accepted(validation.set_log_level_params, params) is schema_ok


def test_a_newer_protocol_version_is_a_mismatch_not_invalid_params() -> None:
    with pytest.raises(rpc.RpcError) as caught:
        validation.initialize_params({**BASE, "protocolVersion": 2, "newField": []})
    assert caught.value.kind == ErrorKind.PROTOCOL_MISMATCH


def test_initialize_params_are_copied_without_unknown_shapes() -> None:
    params = validation.initialize_params({**BASE, "locale": "en"})
    assert params == {**BASE, "locale": "en"}
    assert params["client"] is not CLIENT


def test_log_levels_mirror_the_literal() -> None:
    assert validation.LOG_LEVELS == ("trace", "debug", "info", "warning", "error", "off")


def test_integral_floats_count_as_integers() -> None:
    assert validation.initialize_params({**BASE, "protocolVersion": 1.0})["protocolVersion"] == 1
    with pytest.raises(rpc.RpcError) as caught:
        validation.initialize_params({**BASE, "protocolVersion": 2.0})
    assert caught.value.kind == ErrorKind.PROTOCOL_MISMATCH
