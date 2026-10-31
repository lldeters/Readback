"""The Python mirrors of the JSON Schemas in shared/ (the contract) stay in sync with them.

1. The schemas are valid draft 2020-12 schemas; the examples and real engine outputs validate.
2. Every TypedDict and Literal alias in readback_engine.protocol and readback_engine.graph matches
   its $def: required and optional keys, property types, and enumeration values.
"""

from __future__ import annotations

import types
import typing
from typing import Any, Literal, get_args, get_origin, get_type_hints, is_typeddict

import pytest
import support
from jsonschema import Draft202012Validator
from support import EngineHarness, notification

from readback_engine import ENGINE_VERSION, SCHEMA_VERSION, graph, protocol

JsonObject = dict[str, Any]

# Literal aliases for inline enums (not $defs of their own), and where the schema has them.
INLINE_ENUMS = {
    protocol.ReleaseLevel: ("VersionInfo", "releaseLevel"),
    protocol.FatalErrorCode: ("FatalStartupError", "code"),
}
SCALARS: dict[str, type] = {"string": str, "integer": int, "number": float, "boolean": bool}


def public_typeddicts(module: types.ModuleType) -> dict[str, Any]:
    return {
        name: value
        for name, value in vars(module).items()
        if is_typeddict(value) and not name.startswith("_")
    }


def literal_aliases(module: types.ModuleType) -> dict[str, Any]:
    return {name: value for name, value in vars(module).items() if get_origin(value) is Literal}


def object_definitions(schema: JsonObject) -> dict[str, JsonObject]:
    definitions = {
        name: definition
        for name, definition in schema["$defs"].items()
        if definition.get("type") == "object" and "properties" in definition
    }
    if "properties" in schema:  # the graph schema's root is GraphDocument itself
        definitions[schema["title"]] = schema
    return definitions


def enum_definitions(schema: JsonObject) -> dict[str, JsonObject]:
    return {
        name: definition for name, definition in schema["$defs"].items() if "enum" in definition
    }


class Comparison:
    """Compares Python annotations with schema fragments of one schema."""

    def __init__(self, schema: JsonObject, module: types.ModuleType) -> None:
        self.defs: dict[str, JsonObject] = schema["$defs"]
        self.module = module
        self.problems: list[str] = []

    def check(self, annotation: Any, node: JsonObject, where: str) -> None:
        if "$ref" in node:
            self._reference(annotation, node["$ref"].rsplit("/", 1)[-1], where)
        elif "const" in node:
            self._literal(annotation, [node["const"]], where)
        elif "enum" in node:
            self._literal(annotation, node["enum"], where)
        elif node.get("type") == "array":
            if get_origin(annotation) is not list:
                self.problems.append(f"{where}: expected list[...], got {annotation}")
            else:
                self.check(get_args(annotation)[0], node["items"], f"{where}[]")
        elif node.get("type") == "object":
            self._mapping(annotation, node, where)
        elif isinstance(node.get("type"), list):
            self._union(annotation, node["type"], where)
        elif SCALARS.get(node.get("type", "")) is not annotation:
            self.problems.append(f"{where}: {node.get('type')} is not {annotation}")

    def _reference(self, annotation: Any, name: str, where: str) -> None:
        target = self.defs[name]
        if "enum" in target or (target.get("type") == "object" and "properties" in target):
            expected = getattr(self.module, name, None)
            if annotation is not expected:
                self.problems.append(f"{where}: expected {name}, got {annotation}")
        else:
            self.check(annotation, target, where)

    def _literal(self, annotation: Any, values: list[object], where: str) -> None:
        if get_origin(annotation) is not Literal or set(get_args(annotation)) != set(values):
            self.problems.append(f"{where}: {annotation} is not Literal{values}")

    def _mapping(self, annotation: Any, node: JsonObject, where: str) -> None:
        if get_origin(annotation) is not dict or get_args(annotation)[0] is not str:
            self.problems.append(f"{where}: expected dict[str, ...], got {annotation}")
            return
        values = node.get("additionalProperties", True)
        if values is True:
            if get_args(annotation)[1] is not Any:
                self.problems.append(f"{where}: free-form objects map to dict[str, Any]")
        else:
            self.check(get_args(annotation)[1], values, f"{where}{{}}")

    def _union(self, annotation: Any, names: list[str], where: str) -> None:
        # X | Y is types.UnionType; Python 3.14 made typing.Union the same type.
        is_union = get_origin(annotation) in (types.UnionType, typing.Union)
        members = set(get_args(annotation)) if is_union else set()
        expected = {SCALARS[name] for name in names}
        # JSON numbers include integers, so int may appear next to float.
        allowed = expected | ({int} if float in expected else set())
        if not expected <= members <= allowed:
            self.problems.append(f"{where}: {annotation} does not match {names}")


@pytest.mark.parametrize(
    ("schema_path", "module"),
    [(support.PROTOCOL_SCHEMA, protocol), (support.GRAPH_SCHEMA, graph)],
    ids=["protocol", "graph"],
)
class TestMirror:
    def test_every_object_definition_has_a_typeddict(
        self, schema_path: Any, module: types.ModuleType
    ) -> None:
        schema = support.load_json(schema_path)
        assert set(public_typeddicts(module)) == set(object_definitions(schema))

    def test_required_and_optional_keys(self, schema_path: Any, module: types.ModuleType) -> None:
        schema = support.load_json(schema_path)
        for name, definition in object_definitions(schema).items():
            typed = getattr(module, name)
            required = set(definition.get("required", []))
            assert typed.__required_keys__ == required, name
            assert typed.__optional_keys__ == set(definition["properties"]) - required, name
            assert definition.get("additionalProperties") is False, name

    def test_property_types(self, schema_path: Any, module: types.ModuleType) -> None:
        schema = support.load_json(schema_path)
        comparison = Comparison(schema, module)
        for name, definition in object_definitions(schema).items():
            hints = get_type_hints(getattr(module, name))
            for key, node in definition["properties"].items():
                comparison.check(hints[key], node, f"{name}.{key}")
        assert comparison.problems == []

    def test_enumerations(self, schema_path: Any, module: types.ModuleType) -> None:
        schema = support.load_json(schema_path)
        enums = enum_definitions(schema)
        aliases = literal_aliases(module)
        for name, definition in enums.items():
            assert name in aliases, f"no Literal alias for $defs/{name}"
            assert list(get_args(aliases[name])) == definition["enum"], name
        for name, alias in aliases.items():
            assert name in enums or alias in INLINE_ENUMS, f"{name} has no schema counterpart"


def test_inline_enumerations(protocol_schema: JsonObject) -> None:
    for alias, (definition, key) in INLINE_ENUMS.items():
        expected = protocol_schema["$defs"][definition]["properties"][key]["enum"]
        assert list(get_args(alias)) == expected


def test_free_form_props(graph_schema: JsonObject) -> None:
    assert graph_schema["$defs"]["Props"]["additionalProperties"] is True
    assert graph.Props == dict[str, Any]


def test_schema_versions_agree(graph_schema: JsonObject) -> None:
    assert graph_schema["properties"]["schemaVersion"]["const"] == SCHEMA_VERSION
    assert get_args(get_type_hints(graph.GraphDocument)["schemaVersion"]) == (SCHEMA_VERSION,)


# --- the schemas, the examples and real outputs ---


def test_schemas_are_valid_draft_2020_12(
    protocol_schema: JsonObject, graph_schema: JsonObject
) -> None:
    for schema in (protocol_schema, graph_schema):
        assert schema["$schema"] == "https://json-schema.org/draft/2020-12/schema"
        Draft202012Validator.check_schema(schema)


def test_examples_validate(protocol_schema: JsonObject, graph_schema: JsonObject) -> None:
    support.assert_valid(
        graph_schema,
        None,
        support.load_json(support.SHARED_DIR / "examples/graph-class-anatomy.json"),
    )
    support.assert_valid(
        protocol_schema,
        "InitializeResult",
        support.load_json(support.SHARED_DIR / "examples/initialize-result.json"),
    )


def test_real_engine_outputs_validate(harness: EngineHarness, protocol_schema: JsonObject) -> None:
    def fail(params: object, context: object) -> object:
        raise ValueError("broken handler")

    harness.engine.methods.add_request("test/fail", fail)
    engine = harness.start()
    errors = [
        engine.call("engine/ping", id=1),
        engine.call("engine/initialize", support.initialize_params(protocolVersion=9), id=0),
    ]
    result = engine.initialize()
    support.assert_valid(protocol_schema, "InitializeResult", result)
    assert result["engineVersion"] == ENGINE_VERSION
    support.assert_valid(protocol_schema, "PingResult", engine.call("engine/ping", id=2)["result"])
    errors.append(engine.call("engine/initialize", support.initialize_params(), id=3))
    errors.append(engine.call("engine/nope", id=4))
    errors.append(engine.call("engine/ping", {"x": 1}, id=5))
    errors.append(engine.call("test/fail", id=8))
    engine.send_raw(support.encode_frame(b"{"))
    errors.append(engine.receive())
    engine.send({"jsonrpc": "2.0"})
    errors.append(engine.receive())
    engine.call("engine/shutdown", id=6)
    errors.append(engine.call("engine/ping", id=7))
    engine.send(notification("engine/exit"))
    assert engine.wait_exit() == 0
    kinds = set()
    for response in errors:
        support.assert_valid(protocol_schema, "EngineErrorData", response["error"]["data"])
        kinds.add(response["error"]["data"]["kind"])
    assert kinds == {
        "not-initialized",
        "protocol-mismatch",
        "internal",
        "already-initialized",
        "method-not-found",
        "invalid-params",
        "parse-error",
        "invalid-request",
        "shutting-down",
    }


def test_engine_params_examples_validate(protocol_schema: JsonObject) -> None:
    support.assert_valid(protocol_schema, "InitializeParams", support.initialize_params())
    support.assert_valid(protocol_schema, "SetLogLevelParams", {"level": "trace"})


def test_graph_constructors_produce_valid_documents(graph_schema: JsonObject) -> None:
    for view in get_args(graph.ViewKind):
        support.assert_valid(graph_schema, None, graph.empty_document(view))
    document = graph.empty_document("callGraph", duration_ms=3.5)
    span = graph.text_range("/w/a.py", graph.position(0, 0), graph.position(2, 4))
    document["nodes"].append(
        {"id": "py:a.f", "kind": "function", "label": "f", "range": span, "change": "added"}
    )
    document["nodes"].append(
        graph.unresolved_node(
            "unresolved:py:a.f#1", "getattr(x, n)()", "dynamic call", parent="py:a.f"
        )
    )
    document["edges"].append(
        {
            "id": "e1",
            "kind": "calls",
            "source": "py:a.f",
            "target": "unresolved:py:a.f#1",
            "confidence": "unresolved",
            "evidence": [span],
        }
    )
    document["diagnostics"].append(
        {"severity": "hint", "code": "self-unused", "message": "m", "args": {"n": 1, "ok": True}}
    )
    support.assert_valid(graph_schema, None, document)
    # And the schema still rejects an unresolved node without a reason.
    del document["nodes"][1]["reason"]
    assert not support.validator(graph_schema).is_valid(document)


@pytest.mark.parametrize(
    ("annotation", "node", "ok"),
    [
        (str, {"type": "string"}, True),
        (int, {"type": "string"}, False),
        (list[str], {"type": "array", "items": {"type": "string"}}, True),
        (list[int], {"type": "array", "items": {"type": "string"}}, False),
        (str, {"type": "array", "items": {"type": "string"}}, False),
        (Literal["a", "b"], {"enum": ["b", "a"]}, True),
        (Literal["a"], {"enum": ["a", "b"]}, False),
        (Literal[True], {"const": True}, True),
        (bool, {"const": True}, False),
        (protocol.LogLevel, {"$ref": "#/$defs/LogLevel"}, True),
        (str, {"$ref": "#/$defs/LogLevel"}, False),
        (protocol.ClientInfo, {"$ref": "#/$defs/ClientInfo"}, True),
        (dict[str, Any], {"$ref": "#/$defs/ClientInfo"}, False),
        (dict[str, Any], {"type": "object", "additionalProperties": True}, True),
        (dict[str, int], {"type": "object", "additionalProperties": True}, False),
        (list[str], {"type": "object", "additionalProperties": True}, False),
        (str | int | float, {"type": ["string", "number"]}, True),
        (str | int, {"type": ["string", "boolean"]}, False),
        (str, {"type": ["string", "boolean"]}, False),
    ],
)
def test_the_comparison_detects_mismatches(
    protocol_schema: JsonObject, annotation: Any, node: JsonObject, ok: bool
) -> None:
    comparison = Comparison(protocol_schema, protocol)
    comparison.check(annotation, node, "x")
    assert (comparison.problems == []) is ok, comparison.problems
