"""The Python mirrors of the JSON Schemas in shared/ (the contract) stay in sync with them.

1. The schemas are valid draft 2020-12 schemas; the examples and real engine outputs validate.
2. Every TypedDict and Literal alias in hearback_engine.protocol and hearback_engine.graph matches
   its $def: required and optional keys, property types, and enumeration values.
3. The typed props: NodePropsByKind and EdgePropsByKind name a props def for every kind, the
   schema binds each kind to exactly that def, and the NodeProps and EdgeProps unions list them.
"""

from __future__ import annotations

import types
import typing
from typing import Any, Literal, get_args, get_origin, get_type_hints, is_typeddict

import pytest
import support
from jsonschema import Draft202012Validator
from support import EngineHarness, notification

from hearback_engine import ENGINE_VERSION, SCHEMA_VERSION, graph, protocol

JsonObject = dict[str, Any]

# Literal aliases for inline enums (not $defs of their own), and where the schema has them.
INLINE_ENUMS = {
    protocol.ReleaseLevel: ("VersionInfo", "releaseLevel"),
    protocol.FatalErrorCode: ("FatalStartupError", "code"),
}
SCALARS: dict[str, type] = {
    "string": str,
    "integer": int,
    "number": float,
    "boolean": bool,
    "null": type(None),
}
# The results besides the GraphDocument root, each with its own schemaVersion.
RESULTS = ("ChangeSummary", "IndexResult")
PROPS_MAPPINGS = (
    ("Node", "NodePropsByKind", "NodeProps"),
    ("Edge", "EdgePropsByKind", "EdgeProps"),
)


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


def ref_name(node: JsonObject) -> str:
    reference: str = node["$ref"]
    assert reference.startswith("#/$defs/"), reference
    return reference.removeprefix("#/$defs/")


def is_union(annotation: Any) -> bool:
    # X | Y is types.UnionType; Python 3.14 made typing.Union the same type.
    return get_origin(annotation) in (types.UnionType, typing.Union)


class Comparison:
    """Compares Python annotations with schema fragments of one schema."""

    def __init__(self, schema: JsonObject, module: types.ModuleType) -> None:
        self.defs: dict[str, JsonObject] = schema["$defs"]
        self.module = module
        self.problems: list[str] = []

    def check(self, annotation: Any, node: JsonObject, where: str) -> None:
        if "$ref" in node:
            self._reference(annotation, ref_name(node), where)
        elif "const" in node:
            self._literal(annotation, [node["const"]], where)
        elif "enum" in node:
            self._literal(annotation, node["enum"], where)
        elif "anyOf" in node:
            self._any_of(annotation, node["anyOf"], where)
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
        elif "anyOf" in target:
            # A union def maps to an alias of the same name.
            if annotation != getattr(self.module, name, None):
                self.problems.append(f"{where}: expected the alias {name}, got {annotation}")
            self._any_of(annotation, target["anyOf"], where)
        else:
            self.check(annotation, target, where)

    def _literal(self, annotation: Any, values: list[object], where: str) -> None:
        if get_origin(annotation) is not Literal or set(get_args(annotation)) != set(values):
            self.problems.append(f"{where}: {annotation} is not Literal{values}")

    def _any_of(self, annotation: Any, alternatives: list[JsonObject], where: str) -> None:
        members = set(get_args(annotation)) if is_union(annotation) else {annotation}
        expected = {
            getattr(self.module, ref_name(alternative), None) for alternative in alternatives
        }
        if members != expected:
            self.problems.append(f"{where}: {annotation} is not the union of {alternatives}")

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
        members = set(get_args(annotation)) if is_union(annotation) else set()
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


def test_schema_versions_agree(graph_schema: JsonObject) -> None:
    assert graph_schema["properties"]["schemaVersion"]["const"] == SCHEMA_VERSION == 2
    assert get_args(get_type_hints(graph.GraphDocument)["schemaVersion"]) == (SCHEMA_VERSION,)
    for name in RESULTS:
        assert graph_schema["$defs"][name]["properties"]["schemaVersion"]["const"] == SCHEMA_VERSION
        hints = get_type_hints(getattr(graph, name))
        assert get_args(hints["schemaVersion"]) == (SCHEMA_VERSION,), name


# --- typed props ---


@pytest.mark.parametrize(("owner", "mapping", "union"), PROPS_MAPPINGS)
def test_props_by_kind_name_a_def_for_every_kind(
    graph_schema: JsonObject, owner: str, mapping: str, union: str
) -> None:
    defs = graph_schema["$defs"]
    kinds = defs[defs[owner]["properties"]["kind"]["$ref"].rsplit("/", 1)[-1]]["enum"]
    assert list(defs[mapping]["properties"]) == kinds
    assert defs[mapping]["required"] == kinds
    assert list(get_type_hints(getattr(graph, mapping))) == kinds
    for kind, node in defs[mapping]["properties"].items():
        target = defs[ref_name(node)]
        assert target["type"] == "object", kind
        assert target["additionalProperties"] is False, kind


@pytest.mark.parametrize(("owner", "mapping", "union"), PROPS_MAPPINGS)
def test_the_schema_binds_each_kind_to_its_props_def(
    graph_schema: JsonObject, owner: str, mapping: str, union: str
) -> None:
    defs = graph_schema["$defs"]
    rules = defs[owner]["dependentSchemas"]["kind"]["allOf"]
    bound: dict[str, str] = {}
    for rule in rules:
        assert set(rule) == {"if", "then"}
        assert set(rule["if"]) == {"properties"}
        assert set(rule["if"]["properties"]) == {"kind"}
        for kind in rule["if"]["properties"]["kind"]["enum"]:
            assert kind not in bound, f"{kind} is bound twice"
            bound[kind] = ref_name(rule["then"]["properties"]["props"])
    expected = {kind: ref_name(node) for kind, node in defs[mapping]["properties"].items()}
    assert bound == expected
    assert defs[owner]["properties"]["props"] == {"$ref": f"#/$defs/{union}"}


@pytest.mark.parametrize(("owner", "mapping", "union"), PROPS_MAPPINGS)
def test_the_props_unions_list_each_props_def_once(
    graph_schema: JsonObject, owner: str, mapping: str, union: str
) -> None:
    defs = graph_schema["$defs"]
    members = [ref_name(alternative) for alternative in defs[union]["anyOf"]]
    assert len(members) == len(set(members))
    assert set(members) == {ref_name(node) for node in defs[mapping]["properties"].values()}
    assert set(get_args(getattr(graph, union))) == {getattr(graph, name) for name in members}


def test_props_are_rejected_unless_they_match_the_def_of_their_kind(
    graph_schema: JsonObject,
) -> None:
    def valid(kind: str, props: JsonObject, **extra: object) -> bool:
        node = {"id": "py:m.x", "kind": kind, "label": "x", "props": props, **extra}
        document = {**graph.empty_document("classAnatomy"), "nodes": [node]}
        return bool(support.validator(graph_schema).is_valid(document))

    assert valid("method", {"signature": "(self)", "async": False})
    assert not valid("method", {"complexity": 2})  # a key of no props def
    assert not valid("method", {"bases": []})  # a ClassProps key, not a FunctionProps key
    assert valid("class", {"bases": []})
    assert not valid("table", {"bases": []})  # NoProps
    assert valid("table", {})
    assert valid("unresolved", {"reasonCode": "dynamic-call"}, reason="dynamic call")
    assert not valid("unresolved", {}, reason="dynamic call")  # no reasonCode
    assert not valid("unresolved", {"reasonCode": "maybe"}, reason="dynamic call")


# --- the schemas, the examples and real outputs ---


def test_schemas_are_valid_draft_2020_12(
    protocol_schema: JsonObject, graph_schema: JsonObject
) -> None:
    for schema in (protocol_schema, graph_schema):
        assert schema["$schema"] == "https://json-schema.org/draft/2020-12/schema"
        Draft202012Validator.check_schema(schema)


def test_examples_validate(protocol_schema: JsonObject, graph_schema: JsonObject) -> None:
    examples = [
        (graph_schema, None, "graph-class-anatomy.json"),
        (graph_schema, "ChangeSummary", "change-summary.json"),
        (protocol_schema, "InitializeResult", "initialize-result.json"),
    ]
    for schema, definition, name in examples:
        support.assert_valid(schema, definition, support.load_json(support.EXAMPLES_DIR / name))
    assert sorted(path.name for path in support.EXAMPLES_DIR.glob("*.json")) == sorted(
        name for _, _, name in examples
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
    support.assert_valid(
        protocol_schema, "InitializeParams", support.initialize_params(storageDirectory="/s/e")
    )
    support.assert_valid(protocol_schema, "SetLogLevelParams", {"level": "trace"})
    for name, example in support.PARAMS_EXAMPLES.items():
        support.assert_valid(protocol_schema, name, example)


def test_graph_constructors_produce_valid_documents(graph_schema: JsonObject) -> None:
    for view in get_args(graph.ViewKind):
        support.assert_valid(graph_schema, None, graph.empty_document(view))
    document = graph.empty_document("callGraph", duration_ms=3.5)
    document["focus"] = "py:a.f"
    span = graph.text_range("/w/a.py", graph.position(0, 0), graph.position(2, 4))
    name = graph.text_range("/w/a.py", graph.position(0, 4), graph.position(0, 5))
    document["nodes"].append(
        {
            "id": "py:a.f",
            "kind": "function",
            "label": "f",
            "range": span,
            "selectionRange": name,
            "change": "added",
        }
    )
    ghost = graph.text_range(
        "/w/a.py", graph.position(4, 0), graph.position(5, 8), revision="3f2c1d9e"
    )
    document["nodes"].append(
        {"id": "py:a.g", "kind": "function", "label": "g", "range": ghost, "change": "deleted"}
    )
    document["nodes"].append(
        graph.unresolved_node(
            "unresolved:py:a.f/getattr(x, n)()",
            "getattr(x, n)()",
            "dynamic call via getattr",
            {"reasonCode": "dynamic-call", "expression": "getattr(x, n)()", "args": {"n": 1}},
            parent="py:a.f",
        )
    )
    document["edges"].append(
        {
            "id": "e:calls:py:a.f->unresolved:py:a.f/getattr(x, n)()",
            "kind": "calls",
            "source": "py:a.f",
            "target": "unresolved:py:a.f/getattr(x, n)()",
            "confidence": "unresolved",
            "evidence": [span],
        }
    )
    document["diagnostics"].append(
        {"severity": "hint", "code": "self-unused", "message": "m", "args": {"n": 1, "ok": True}}
    )
    document["meta"] = graph.meta(duration_ms=3.5, base_revision="3f2c1d9e")
    support.assert_valid(graph_schema, None, document)
    # And the schema still rejects an unresolved node without a reason or a reason code.
    unresolved = document["nodes"][2]
    del unresolved["reason"]
    assert not support.validator(graph_schema).is_valid(document)
    unresolved["reason"] = "dynamic call via getattr"
    del unresolved["props"]
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
        (str | None, {"type": ["string", "null"]}, True),
        (str, {"type": ["string", "null"]}, False),
        (
            protocol.ClientInfo | protocol.LogLevel,
            {"anyOf": [{"$ref": "#/$defs/ClientInfo"}, {"$ref": "#/$defs/LogLevel"}]},
            True,
        ),
        (protocol.ClientInfo, {"anyOf": [{"$ref": "#/$defs/ClientInfo"}]}, True),
        (
            protocol.ClientInfo,
            {"anyOf": [{"$ref": "#/$defs/ClientInfo"}, {"$ref": "#/$defs/LogLevel"}]},
            False,
        ),
    ],
)
def test_the_comparison_detects_mismatches(
    protocol_schema: JsonObject, annotation: Any, node: JsonObject, ok: bool
) -> None:
    comparison = Comparison(protocol_schema, protocol)
    comparison.check(annotation, node, "x")
    assert (comparison.problems == []) is ok, comparison.problems


def test_union_defs_need_an_alias_of_their_name(graph_schema: JsonObject) -> None:
    comparison = Comparison(graph_schema, graph)
    union = graph.CallEdgeProps | graph.FlowEdgeProps
    comparison.check(union, {"$ref": "#/$defs/EdgeProps"}, "x")
    assert len(comparison.problems) == 2  # not the alias, and not the union of its members
