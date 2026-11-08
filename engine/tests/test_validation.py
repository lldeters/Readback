"""The hand-written params checks agree with shared/engine-protocol.schema.json.

For the analysis requests, every check runs on a complete valid example (support.PARAMS_EXAMPLES)
and on every single mutation of it: a key removed, an unknown key added, a value replaced by a
value of another type or outside a bound, recursively. The schema decides which are valid.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator
from typing import Any, Final

import pytest
import support

from hearback_engine import PROTOCOL_VERSION, rpc, validation
from hearback_engine.protocol import ErrorKind

JsonObject = dict[str, Any]
Check = Callable[[object], object]

CLIENT = {"name": "vscode", "version": "1.105.1"}
BASE: dict[str, Any] = {
    "protocolVersion": PROTOCOL_VERSION,
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
    {
        **BASE,
        "storageDirectory": "/home/u/.config/Code/User/globalStorage/lldeters.hearback/engine",
    },
    {**BASE, "storageDirectory": ""},
    {**BASE, "storageDirectory": None},
    {**BASE, "storageDirectory": 1},
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
    {**BASE, "protocolVersion": float(PROTOCOL_VERSION)},
    {**BASE, "protocolVersion": str(PROTOCOL_VERSION)},
    {**BASE, "protocolVersion": True},
    {**BASE, "locale": None},
    [],
    None,
    "params",
]

# The params defs of the analysis requests, each with its hand-written check.
CHECKS: Final[dict[str, Check]] = {
    "TextPosition": lambda value: validation.text_position(value, "params"),
    "SourceFile": lambda value: validation.source_file(value, "params"),
    "BaseVersion": lambda value: validation.base_version(value, "params"),
    "FileOverlay": lambda value: validation.file_overlay(value, "params"),
    "FileBase": lambda value: validation.file_base(value, "params"),
    "RulesSource": lambda value: validation.rules_source(value, "params"),
    "AnalysisOptions": lambda value: validation.analysis_options(value, "params"),
    "WorkspaceRoot": lambda value: validation.workspace_root(value, "params"),
    "WorkspaceFiles": lambda value: validation.workspace_files(value, "params"),
    "WorkspaceBatch": lambda value: validation.workspace_batch(value, "params"),
    "ClassAnatomyParams": validation.class_anatomy_params,
    "CallGraphParams": validation.call_graph_params,
    "ControlFlowParams": validation.control_flow_params,
    "ModuleGraphParams": validation.module_graph_params,
    "IndexFilesParams": validation.index_files_params,
    "DiffCompareParams": validation.diff_compare_params,
}
REQUEST_PARAMS: Final = (
    "ClassAnatomyParams",
    "CallGraphParams",
    "ControlFlowParams",
    "ModuleGraphParams",
    "IndexFilesParams",
    "DiffCompareParams",
)

# Replacement values: other JSON types, the bounds of the schema's integers, enum values.
SAMPLES: Final[tuple[object, ...]] = (
    None,
    True,
    False,
    -1,
    0,
    1,
    1.0,
    1.5,
    10,
    11,
    49,
    50,
    5000,
    5001,
    "",
    "x",
    "python",
    "both",
    [],
    ["x"],
    [1],
    {},
    {"x": 1},
)


def accepted(check: Check, params: object) -> bool:
    try:
        check(params)
    except rpc.RpcError as error:
        assert error.kind == ErrorKind.INVALID_PARAMS
        return False
    return True


def mutations(value: object) -> Iterator[object]:
    """Every value that differs from ``value`` in exactly one place."""
    if isinstance(value, dict):
        yield {**value, "unexpected": 1}
        for key, item in value.items():
            yield {name: entry for name, entry in value.items() if name != key}
            for replacement in (*SAMPLES, *mutations(item)):
                yield {**value, key: replacement}
    elif isinstance(value, list):
        yield [*value, *value]
        if value:
            for replacement in (*SAMPLES, *mutations(value[0])):
                yield [replacement, *value[1:]]


def disagreements(protocol_schema: JsonObject, name: str, cases: Iterator[object]) -> list[str]:
    schema = support.validator(protocol_schema, name)
    found = []
    for case in cases:
        if accepted(CHECKS[name], case) is not schema.is_valid(case):
            found.append(f"{name}: schema says {schema.is_valid(case)} for {case!r}")
    return found


def referenced_definitions(protocol_schema: JsonObject, names: tuple[str, ...]) -> set[str]:
    """The $defs that ``names`` use, transitively, themselves included."""
    seen: set[str] = set()
    todo = list(names)
    while todo:
        name = todo.pop()
        if name in seen:
            continue
        seen.add(name)

        def collect(node: object) -> None:
            if isinstance(node, dict):
                if "$ref" in node:
                    todo.append(node["$ref"].rsplit("/", 1)[-1])
                for item in node.values():
                    collect(item)
            elif isinstance(node, list):
                for item in node:
                    collect(item)

        collect(protocol_schema["$defs"][name])
    return seen


# --- engine/initialize and engine/setLogLevel ---


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
        validation.initialize_params({**BASE, "protocolVersion": PROTOCOL_VERSION + 1, "x": []})
    assert caught.value.kind == ErrorKind.PROTOCOL_MISMATCH


def test_an_older_protocol_version_is_a_mismatch() -> None:
    with pytest.raises(rpc.RpcError) as caught:
        validation.initialize_params({**BASE, "protocolVersion": 1})
    assert caught.value.kind == ErrorKind.PROTOCOL_MISMATCH
    assert caught.value.detail == f"client 1, engine {PROTOCOL_VERSION}"


def test_initialize_params_are_copied_without_unknown_shapes() -> None:
    params = validation.initialize_params({**BASE, "locale": "en", "storageDirectory": "/s"})
    assert params == {**BASE, "locale": "en", "storageDirectory": "/s"}
    assert params["client"] is not CLIENT


def test_log_levels_mirror_the_literal() -> None:
    assert validation.LOG_LEVELS == ("trace", "debug", "info", "warning", "error", "off")


def test_integral_floats_count_as_integers() -> None:
    version = float(PROTOCOL_VERSION)
    assert (
        validation.initialize_params({**BASE, "protocolVersion": version})["protocolVersion"] == 2
    )
    with pytest.raises(rpc.RpcError) as caught:
        validation.initialize_params({**BASE, "protocolVersion": version + 1})
    assert caught.value.kind == ErrorKind.PROTOCOL_MISMATCH


# --- the analysis requests ---


def test_every_params_def_of_the_analysis_requests_has_a_check(
    protocol_schema: JsonObject,
) -> None:
    used = referenced_definitions(protocol_schema, REQUEST_PARAMS)
    objects = {name for name in used if protocol_schema["$defs"][name].get("type") == "object"}
    assert objects == set(CHECKS) == set(support.PARAMS_EXAMPLES)


@pytest.mark.parametrize("name", list(CHECKS))
def test_the_examples_are_accepted_and_copied(name: str) -> None:
    example = support.PARAMS_EXAMPLES[name]
    copy = CHECKS[name](example)
    assert copy == example
    assert copy is not example


@pytest.mark.parametrize("name", list(CHECKS))
def test_every_mutation_agrees_with_the_schema(protocol_schema: JsonObject, name: str) -> None:
    cases = mutations(support.PARAMS_EXAMPLES[name])
    assert disagreements(protocol_schema, name, cases) == []


@pytest.mark.parametrize("name", list(CHECKS))
def test_values_that_are_no_objects_are_rejected(protocol_schema: JsonObject, name: str) -> None:
    assert disagreements(protocol_schema, name, iter([*SAMPLES, [{}], "params"])) == []
    not_objects: list[object] = [None, [], "params", 1]
    for sample in not_objects:
        assert not accepted(CHECKS[name], sample)


def test_minimal_params_are_accepted(protocol_schema: JsonObject) -> None:
    source = {"file": "/w/a.py"}
    position = {"line": 0, "character": 0}
    cases: dict[str, JsonObject] = {
        "ClassAnatomyParams": {"source": source},
        "CallGraphParams": {
            "source": source,
            "position": position,
            "hops": 1,
            "direction": "outgoing",
            "workspace": {"root": "/w", "files": []},
        },
        "ControlFlowParams": {"source": source, "position": position},
        "ModuleGraphParams": {"workspace": {"root": "/w", "files": []}},
        "IndexFilesParams": {"workspace": {"root": "/w", "files": []}},
        "DiffCompareParams": {"language": "python", "source": source},
        "BaseVersion": {"revision": "abc", "text": None},
        "AnalysisOptions": {},
    }
    for name, params in cases.items():
        assert support.validator(protocol_schema, name).is_valid(params), name
        assert CHECKS[name](params) == params, name


@pytest.mark.parametrize(
    ("name", "key", "limit"),
    [
        ("WorkspaceFiles", "files", validation.MAX_WORKSPACE_FILES),
        ("WorkspaceFiles", "overlays", validation.MAX_WORKSPACE_FILES),
        ("WorkspaceFiles", "bases", validation.MAX_WORKSPACE_FILES),
        ("WorkspaceBatch", "files", validation.MAX_BATCH_FILES),
        ("WorkspaceBatch", "overlays", validation.MAX_BATCH_FILES),
    ],
)
def test_list_limits_agree_with_the_schema(
    protocol_schema: JsonObject, name: str, key: str, limit: int
) -> None:
    example = support.PARAMS_EXAMPLES[name]
    item = example[key][0]
    cases = [{**example, key: [item] * limit}, {**example, key: [item] * (limit + 1)}]
    assert disagreements(protocol_schema, name, iter(cases)) == []
    assert accepted(CHECKS[name], cases[0])
    assert not accepted(CHECKS[name], cases[1])


def test_scopes_have_the_workspace_limit(protocol_schema: JsonObject) -> None:
    example = support.PARAMS_EXAMPLES["ModuleGraphParams"]
    limit = validation.MAX_WORKSPACE_FILES
    cases = [{**example, "scopes": ["/w"] * limit}, {**example, "scopes": ["/w"] * (limit + 1)}]
    assert disagreements(protocol_schema, "ModuleGraphParams", iter(cases)) == []
    assert not accepted(CHECKS["ModuleGraphParams"], cases[1])


@pytest.mark.parametrize(
    ("params", "detail"),
    [
        (None, "python/callGraph expects an object"),
        ({}, "params.source is required"),
        (
            {**support.PARAMS_EXAMPLES["CallGraphParams"], "hops": 11},
            "params.hops must be an integer from 1 to 10",
        ),
        (
            {**support.PARAMS_EXAMPLES["CallGraphParams"], "direction": "up"},
            "params.direction must be one of outgoing, incoming, both",
        ),
        (
            {
                **support.PARAMS_EXAMPLES["CallGraphParams"],
                "workspace": {"root": "/w", "files": ["/w/a.py", ""]},
            },
            "params.workspace.files[1] must be a non-empty string",
        ),
        (
            {
                **support.PARAMS_EXAMPLES["CallGraphParams"],
                "options": {"sideEffectRules": {"path": "/r.json"}},
            },
            "params.options.sideEffectRules.text is required",
        ),
        (
            {
                **support.PARAMS_EXAMPLES["CallGraphParams"],
                "base": {"revision": "abc", "text": 3},
            },
            "params.base.text must be a string",
        ),
    ],
)
def test_errors_name_the_offending_param(params: object, detail: str) -> None:
    with pytest.raises(rpc.RpcError) as caught:
        validation.call_graph_params(params)
    assert caught.value.code == -32602
    assert caught.value.detail == detail
