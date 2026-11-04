"""Graph model shared with the extension and the webview.

Python mirror of shared/graph-schema.json, the single source of truth (spec 5.3). The analyses of
later phases build GraphDocuments from these TypedDicts; engine/tests/test_schema_conformance.py
checks keys and enumerations against the schema.

Positions follow LSP semantics: zero-based lines, and ``character`` counts UTF-16 code units.
CPython's ast reports UTF-8 byte offsets and sqlglot reports code-point offsets, so both have to
be converted before they reach a Position.
"""

from typing import Any, Literal, TypedDict

from . import ENGINE_VERSION

# --- Enumerations -----------------------------------------------------------------------------

ViewKind = Literal[
    "classAnatomy",
    "stateMatrix",
    "callGraph",
    "controlFlow",
    "moduleGraph",
    "queryAnatomy",
    "columnLineage",
    "tableLineage",
    "dbtModelGraph",
    "tableAccess",
]

NodeKind = Literal[
    # Python structure
    "package",
    "module",
    "class",
    "function",
    "method",
    "attribute",
    "property",
    "parameter",
    "variable",
    # SQL and dbt objects
    "statement",
    "query",
    "subquery",
    "cte",
    "table",
    "view",
    "column",
    "model",
    "source",
    "seed",
    "snapshot",
    # Control-flow elements
    "entry",
    "exit",
    "block",
    "condition",
    "loop",
    "try",
    "handler",
    "finally",
    "with",
    "match",
    "case",
    "return",
    "raise",
    "break",
    "continue",
    # Placeholders for targets outside the analysed code or that cannot be resolved
    "external",
    "unresolved",
]

EdgeKind = Literal[
    "calls",
    "reads",
    "writes",
    "mutates",
    "inherits",
    "overrides",
    "imports",
    "depends_on",
    "lineage",
    "joins",
    "raises",
    "catches",
    "flow",
]

Confidence = Literal["certain", "inferred", "unresolved"]
ChangeStatus = Literal["added", "modified", "deleted", "unchanged"]
Attribution = Literal["ai", "human", "unknown"]
Severity = Literal["error", "warning", "information", "hint"]

# --- Document parts ($defs of the schema) -----------------------------------------------------


class Position(TypedDict):
    line: int
    character: int


class Range(TypedDict):
    file: str
    start: Position
    end: Position


# View-specific facts (decorators, complexity, side effects, lineage expressions, ...).
Props = dict[str, Any]

# Values a diagnostic message can interpolate; the schema allows string, number and boolean.
DiagnosticArg = str | int | float | bool


class _NodeRequired(TypedDict):
    id: str
    kind: NodeKind
    label: str


class Node(_NodeRequired, total=False):
    parent: str
    range: Range
    props: Props
    change: ChangeStatus
    attribution: Attribution
    # Required by the schema when kind is "unresolved"; see unresolved_node().
    reason: str


class _EdgeRequired(TypedDict):
    id: str
    kind: EdgeKind
    source: str
    target: str
    confidence: Confidence


class Edge(_EdgeRequired, total=False):
    evidence: list[Range]
    props: Props
    change: ChangeStatus


class _DiagnosticRequired(TypedDict):
    severity: Severity
    code: str
    message: str


class Diagnostic(_DiagnosticRequired, total=False):
    args: dict[str, DiagnosticArg]
    range: Range
    nodeId: str


class _MetaRequired(TypedDict):
    engineVersion: str
    durationMs: float


class Meta(_MetaRequired, total=False):
    baseRevision: str
    dialect: str
    truncated: bool


class GraphDocument(TypedDict):
    schemaVersion: Literal[1]
    view: ViewKind
    nodes: list[Node]
    edges: list[Edge]
    diagnostics: list[Diagnostic]
    meta: Meta


# --- Constructors -----------------------------------------------------------------------------


def position(line: int, character: int) -> Position:
    """A zero-based position; ``character`` must already be in UTF-16 code units."""
    if line < 0 or character < 0:
        msg = f"positions are zero-based, got line {line}, character {character}"
        raise ValueError(msg)
    return {"line": line, "character": character}


def text_range(file: str, start: Position, end: Position) -> Range:
    """A range in ``file``, the path exactly as the extension passed it to the engine."""
    if not file:
        msg = "a range needs a file path"
        raise ValueError(msg)
    if (end["line"], end["character"]) < (start["line"], start["character"]):
        msg = f"range end {end} lies before its start {start}"
        raise ValueError(msg)
    return {"file": file, "start": start, "end": end}


def unresolved_node(node_id: str, label: str, reason: str, *, parent: str | None = None) -> Node:
    """A placeholder for a target the analysis cannot resolve (spec 5.3: never drop the edge)."""
    if not reason:
        msg = "unresolved nodes must explain why (schema: reason is required)"
        raise ValueError(msg)
    node: Node = {"id": node_id, "kind": "unresolved", "label": label, "reason": reason}
    if parent is not None:
        node["parent"] = parent
    return node


def empty_document(view: ViewKind, *, duration_ms: float = 0.0) -> GraphDocument:
    """A document without nodes, e.g. for an empty file or as the start of an analysis."""
    return {
        "schemaVersion": 1,
        "view": view,
        "nodes": [],
        "edges": [],
        "diagnostics": [],
        "meta": {"engineVersion": ENGINE_VERSION, "durationMs": duration_ms},
    }
