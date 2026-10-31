"""readback_engine.protocol mirrors the constants of src/engine/protocol.ts exactly."""

from __future__ import annotations

import io
import re

import pytest
import support

import readback_engine
from readback_engine import protocol
from readback_engine.server import Engine

TS_SOURCE = (support.REPO_ROOT / "src" / "engine" / "protocol.ts").read_text(encoding="utf-8")


def _value(literal: str) -> str | int:
    return literal[1:-1] if literal.startswith("'") else int(literal)


def ts_object(name: str) -> dict[str, str | int]:
    match = re.search(rf"export const {name} = \{{(.*?)\}} as const;", TS_SOURCE, re.DOTALL)
    assert match, f"{name} not found in src/engine/protocol.ts"
    body = re.sub(r"/\*.*?\*/|//[^\n]*", "", match.group(1), flags=re.DOTALL)
    return {key: _value(value) for key, value in re.findall(r"(\w+):\s*('[^']*'|-?\d+)", body)}


def ts_constant(name: str) -> str | int:
    match = re.search(rf"export const {name} = ('[^']*'|-?\d+);", TS_SOURCE)
    assert match, f"{name} not found in src/engine/protocol.ts"
    return _value(match.group(1))


def upper_snake(name: str) -> str:
    return re.sub(r"(?<!^)(?=[A-Z])", "_", name).upper()


def python_constants(namespace: type) -> dict[str, object]:
    return {name: value for name, value in vars(namespace).items() if name.isupper()}


@pytest.mark.parametrize(
    ("ts_name", "namespace", "python_only"),
    [
        ("Methods", protocol.Method, {"CANCEL_REQUEST"}),
        ("ErrorCodes", protocol.ErrorCode, set()),
        ("EngineExitCodes", protocol.ExitCode, set()),
    ],
)
def test_constant_groups_match(ts_name: str, namespace: type, python_only: set[str]) -> None:
    expected = {upper_snake(key): value for key, value in ts_object(ts_name).items()}
    actual = python_constants(namespace)
    assert {key: actual[key] for key in actual.keys() - python_only} == expected


def test_scalar_constants_match() -> None:
    assert ts_constant("PROTOCOL_VERSION") == readback_engine.PROTOCOL_VERSION
    assert ts_constant("FATAL_PREFIX") == protocol.FATAL_PREFIX
    minimum = ts_object("MIN_PYTHON")
    assert (minimum["major"], minimum["minor"]) == readback_engine.MIN_PYTHON


def test_engine_handles_exactly_the_typescript_methods() -> None:
    engine = Engine(io.BytesIO(), io.BytesIO(), sandboxed=False)
    assert engine.methods.names() == list(ts_object("Methods").values())


def test_the_parser_reads_the_typescript_shapes() -> None:
    assert upper_snake("setLogLevel") == "SET_LOG_LEVEL"
    assert upper_snake("ok") == "OK"
    assert ts_object("ErrorCodes")["requestCancelled"] == -32800
