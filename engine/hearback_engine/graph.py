"""Graph model shared with the extension and the webview.

Python mirror of shared/graph-schema.json, the single source of truth (spec 5.3). The analyses
build GraphDocuments, ChangeSummaries and IndexResults from these TypedDicts;
engine/tests/test_schema_conformance.py checks keys, types and enumerations against the schema.

Optional keys use a required base class plus a ``total=False`` subclass, because
``typing.NotRequired`` needs Python 3.11 and the engine supports 3.10.

Positions follow LSP semantics: zero-based lines, and ``character`` counts UTF-16 code units.
CPython's ast reports UTF-8 byte offsets and sqlglot reports code-point offsets, so both have to
be converted before they reach a Position.

Props are typed per kind: NodePropsByKind and EdgePropsByKind name the props def of every node
and edge kind, and the schema rejects props that do not match the def of their kind. The args of
diagnostics and unresolved reasons are typed per code in the same way (DiagnosticArgsByCode,
UnresolvedArgsByCode), because the localized texts of host and webview interpolate them.
"""

from typing import Literal, TypedDict

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
# A fact the analysis found (a side effect, an exception) is never unresolved.
FactConfidence = Literal["certain", "inferred"]
ChangeStatus = Literal["added", "modified", "deleted", "unchanged"]
Attribution = Literal["ai", "human", "unknown"]
Severity = Literal["error", "warning", "information", "hint"]

# Localized by the webview (webview/src/l10n) and the host (src/views/diagnosticText.ts).
DiagnosticCode = Literal[
    "syntax-error",
    "newer-syntax",
    "base-syntax-error",
    "self-unused",
    "attribute-outside-init",
    "mro-conflict",
    "duplicate-definition",
    "import-cycle",
    "rules-file-invalid",
    "graph-truncated",
    "file-too-large",
    "file-unreadable",
    "symbol-not-found",
    "jedi-unavailable",
    "jedi-budget-exceeded",
    "changes-partial",
    "git-unavailable",
]

UnresolvedReasonCode = Literal[
    "dynamic-call",
    "subscript-call",
    "local-value",
    "unknown-receiver-type",
    "type-resolution-off",
    "type-resolution-skipped",
    "external-base",
    "never-assigned",
    "undefined-name",
    "computed-import",
    "module-not-found",
    "computed-class",
]

StateAccess = Literal["R", "W", "RW"]
ParameterKind = Literal[
    "positionalOnly", "positionalOrKeyword", "varPositional", "keywordOnly", "varKeyword"
]
Visibility = Literal["public", "private", "dunder"]
MethodKind = Literal["instance", "class", "static"]
MethodGroup = Literal["public", "private", "dunder", "static", "class", "abstract"]
SideEffectCategory = Literal[
    "output",
    "logging",
    "file",
    "network",
    "subprocess",
    "database",
    "write",
    "environment",
    "global-state",
    "argument-mutation",
]
AttributeScope = Literal["class", "instance"]
AccessorKind = Literal["get", "set", "delete"]
ExternalGroup = Literal["stdlib", "thirdParty"]
ResolvedBy = Literal["jedi", "languageServer"]
LanguageServerCheck = Literal["confirmed", "notReported", "resolved"]
MutationKind = Literal["subscript", "attribute", "delete", "method"]
FlowBranch = Literal[
    "true",
    "false",
    "loopNext",
    "loopDone",
    "loopElse",
    "case",
    "noMatch",
    "exception",
    "finallyThen",
    "back",
]
ImportFlag = Literal["typeOnly", "deferred", "conditional", "lazy", "star", "dynamic"]
CycleKind = Literal["hard", "soft"]
UnreadableReason = Literal["notRegular", "notFound", "accessDenied", "decodeFailed", "readFailed"]
GitUnavailableReason = Literal[
    "untrusted", "extensionDisabled", "gitDisabled", "gitMissing", "noRepository", "notOpened"
]

# --- Positions --------------------------------------------------------------------------------


class Position(TypedDict):
    line: int
    character: int


class _RangeRequired(TypedDict):
    file: str
    start: Position
    end: Position


class Range(_RangeRequired, total=False):
    # Set when the positions refer to that Git revision's text (ghosts, deleted evidence).
    revision: str


# --- Args of diagnostics and unresolved reasons -------------------------------------------------


class NoArgs(TypedDict):
    """Codes without args."""


class DetailArgs(TypedDict):
    # The failing component's own English message.
    detail: str


class NewerSyntaxArgs(TypedDict):
    feature: str
    requiredVersion: str
    runningVersion: str


class SelfUnusedArgs(TypedDict):
    method: str


class AttributeOutsideInitArgs(TypedDict):
    attribute: str
    method: str


class MroConflictArgs(TypedDict):
    className: str


class DuplicateDefinitionArgs(TypedDict):
    name: str


class ImportCycleArgs(TypedDict):
    modules: str
    count: int
    kind: CycleKind


class _RulesFileInvalidArgsRequired(TypedDict):
    path: str
    # Never the file's contents.
    detail: str


class RulesFileInvalidArgs(_RulesFileInvalidArgsRequired, total=False):
    rule: int


class GraphTruncatedArgs(TypedDict):
    limit: int


class FileTooLargeArgs(TypedDict):
    size: int
    limit: int


class FileUnreadableArgs(TypedDict):
    reason: UnreadableReason


class SymbolNotFoundArgs(TypedDict, total=False):
    symbol: str


class JediBudgetExceededArgs(TypedDict):
    budgetMs: int
    skipped: int


class ChangesPartialArgs(TypedDict):
    files: int


class GitUnavailableArgs(TypedDict):
    reason: GitUnavailableReason


class DynamicCallArgs(TypedDict):
    function: str


class LocalValueArgs(TypedDict):
    name: str


class ReceiverArgs(TypedDict):
    receiver: str
    method: str


class ExternalBaseArgs(TypedDict):
    base: str
    name: str


class NeverAssignedArgs(TypedDict):
    attribute: str


class _UndefinedNameArgsRequired(TypedDict):
    name: str


class UndefinedNameArgs(_UndefinedNameArgsRequired, total=False):
    module: str


class ModuleNotFoundArgs(TypedDict):
    module: str


# Codes contain dashes, hence the functional syntax.
DiagnosticArgsByCode = TypedDict(
    "DiagnosticArgsByCode",
    {
        "syntax-error": DetailArgs,
        "newer-syntax": NewerSyntaxArgs,
        "base-syntax-error": DetailArgs,
        "self-unused": SelfUnusedArgs,
        "attribute-outside-init": AttributeOutsideInitArgs,
        "mro-conflict": MroConflictArgs,
        "duplicate-definition": DuplicateDefinitionArgs,
        "import-cycle": ImportCycleArgs,
        "rules-file-invalid": RulesFileInvalidArgs,
        "graph-truncated": GraphTruncatedArgs,
        "file-too-large": FileTooLargeArgs,
        "file-unreadable": FileUnreadableArgs,
        "symbol-not-found": SymbolNotFoundArgs,
        "jedi-unavailable": DetailArgs,
        "jedi-budget-exceeded": JediBudgetExceededArgs,
        "changes-partial": ChangesPartialArgs,
        "git-unavailable": GitUnavailableArgs,
    },
)

# The args of any diagnostic ($defs/DiagnosticArgs); the code decides which one applies.
DiagnosticArgs = (
    DetailArgs
    | NewerSyntaxArgs
    | SelfUnusedArgs
    | AttributeOutsideInitArgs
    | MroConflictArgs
    | DuplicateDefinitionArgs
    | ImportCycleArgs
    | RulesFileInvalidArgs
    | GraphTruncatedArgs
    | FileTooLargeArgs
    | FileUnreadableArgs
    | SymbolNotFoundArgs
    | JediBudgetExceededArgs
    | ChangesPartialArgs
    | GitUnavailableArgs
)

UnresolvedArgsByCode = TypedDict(
    "UnresolvedArgsByCode",
    {
        "dynamic-call": DynamicCallArgs,
        "subscript-call": NoArgs,
        "local-value": LocalValueArgs,
        "unknown-receiver-type": ReceiverArgs,
        "type-resolution-off": ReceiverArgs,
        "type-resolution-skipped": ReceiverArgs,
        "external-base": ExternalBaseArgs,
        "never-assigned": NeverAssignedArgs,
        "undefined-name": UndefinedNameArgs,
        "computed-import": NoArgs,
        "module-not-found": ModuleNotFoundArgs,
        "computed-class": NoArgs,
    },
)

# The args of any unresolved reason ($defs/UnresolvedArgs); the reason code decides which applies.
UnresolvedArgs = (
    DynamicCallArgs
    | NoArgs
    | LocalValueArgs
    | ReceiverArgs
    | ExternalBaseArgs
    | NeverAssignedArgs
    | UndefinedNameArgs
    | ModuleNotFoundArgs
)

# --- Node props -------------------------------------------------------------------------------


class NoProps(TypedDict):
    """Kinds without props of their own in this schema version."""


class PackageProps(TypedDict, total=False):
    namespace: bool


class ModuleProps(TypedDict, total=False):
    packageInit: bool


class _StateCellRequired(TypedDict):
    row: str
    column: str
    access: StateAccess


class StateCell(_StateCellRequired, total=False):
    # When compared; a cell only the base version fills is deleted and keeps the base's access.
    change: ChangeStatus


class StateMatrix(TypedDict):
    rows: list[str]
    columns: list[str]
    cells: list[StateCell]


class ClassProps(TypedDict, total=False):
    bases: list[str]
    decorators: list[str]
    mro: list[str]
    mroError: str
    components: list[list[str]]
    context: bool
    matrix: StateMatrix


class _ParameterRequired(TypedDict):
    name: str
    kind: ParameterKind


class Parameter(_ParameterRequired, total=False):
    annotation: str
    default: str


class Metrics(TypedDict):
    complexity: int
    nesting: int
    lines: int
    sloc: int
    parameters: int


class _SideEffectRequired(TypedDict):
    category: SideEffectCategory
    rule: str
    # The matching rule's description: the fallback text, shown for rules from the rules file.
    description: str
    confidence: FactConfidence
    evidence: list[Range]


class SideEffect(_SideEffectRequired, total=False):
    detail: str


class _ExceptionInfoRequired(TypedDict):
    type: str
    confidence: FactConfidence


class ExceptionInfo(_ExceptionInfoRequired, total=False):
    target: str
    via: list[str]
    evidence: list[Range]


# "async" is a keyword, hence the functional syntax.
FunctionProps = TypedDict(
    "FunctionProps",
    {
        "signature": str,
        "parameters": list[Parameter],
        "async": bool,
        "decorators": list[str],
        "visibility": Visibility,
        "methodKind": MethodKind,
        "group": MethodGroup,
        "abstract": bool,
        "overloads": list[str],
        "selfUnused": bool,
        "metrics": Metrics,
        "sideEffects": list[SideEffect],
        "sideEffectsComplete": bool,
        "raises": list[ExceptionInfo],
        "catches": list[ExceptionInfo],
        "builtinCalls": list[str],
        "dynamicSelfAccess": bool,
    },
    total=False,
)


class _AttributeAssignmentRequired(TypedDict):
    range: Range


class AttributeAssignment(_AttributeAssignmentRequired, total=False):
    method: str


class _AttributePropsRequired(TypedDict):
    scope: AttributeScope


class AttributeProps(_AttributePropsRequired, total=False):
    annotation: str
    default: str
    assignments: list[AttributeAssignment]
    outsideInit: bool
    owner: str


class _PropertyAccessorRequired(TypedDict):
    kind: AccessorKind


class PropertyAccessor(_PropertyAccessorRequired, total=False):
    signature: str
    range: Range


class PropertyProps(TypedDict, total=False):
    accessors: list[PropertyAccessor]


class _ExternalPropsRequired(TypedDict):
    group: ExternalGroup
    package: str


class ExternalProps(_ExternalPropsRequired, total=False):
    # A package node (id py:<package>) for calls and imports: the dotted names behind its edges.
    names: list[str]
    # An exception node (id py:<symbol>) for raises and catches edges: the class's dotted name.
    symbol: str


class _UnresolvedPropsRequired(TypedDict):
    reasonCode: UnresolvedReasonCode


class UnresolvedProps(_UnresolvedPropsRequired, total=False):
    expression: str
    # Required by the schema where the def of reasonCode has required keys (UnresolvedArgsByCode).
    args: UnresolvedArgs


class FlowNodeProps(TypedDict, total=False):
    exceptional: bool
    statements: int
    unreachable: bool
    earlyExit: bool
    removedLines: int


# "class", "try", "with", "return", ... are keywords, hence the functional syntax.
NodePropsByKind = TypedDict(
    "NodePropsByKind",
    {
        "package": PackageProps,
        "module": ModuleProps,
        "class": ClassProps,
        "function": FunctionProps,
        "method": FunctionProps,
        "attribute": AttributeProps,
        "property": PropertyProps,
        "parameter": NoProps,
        "variable": NoProps,
        "statement": NoProps,
        "query": NoProps,
        "subquery": NoProps,
        "cte": NoProps,
        "table": NoProps,
        "view": NoProps,
        "column": NoProps,
        "model": NoProps,
        "source": NoProps,
        "seed": NoProps,
        "snapshot": NoProps,
        "entry": FlowNodeProps,
        "exit": FlowNodeProps,
        "block": FlowNodeProps,
        "condition": FlowNodeProps,
        "loop": FlowNodeProps,
        "try": FlowNodeProps,
        "handler": FlowNodeProps,
        "finally": FlowNodeProps,
        "with": FlowNodeProps,
        "match": FlowNodeProps,
        "case": FlowNodeProps,
        "return": FlowNodeProps,
        "raise": FlowNodeProps,
        "break": FlowNodeProps,
        "continue": FlowNodeProps,
        "external": ExternalProps,
        "unresolved": UnresolvedProps,
    },
)

# The props of any node kind ($defs/NodeProps); the kind decides which one applies.
NodeProps = (
    PackageProps
    | ModuleProps
    | ClassProps
    | FunctionProps
    | AttributeProps
    | PropertyProps
    | NoProps
    | FlowNodeProps
    | ExternalProps
    | UnresolvedProps
)

# --- Edge props -------------------------------------------------------------------------------


class CallEdgeProps(TypedDict, total=False):
    # Absent for resolution steps 1 and 2 (local scopes, self/cls/super(), workspace imports).
    resolvedBy: ResolvedBy
    # Set by the language-server comparison on edges the engine found.
    languageServer: LanguageServerCheck


class AccessEdgeProps(TypedDict, total=False):
    mutation: MutationKind
    method: str


class FlowEdgeProps(TypedDict, total=False):
    branch: FlowBranch
    text: str
    exceptional: bool
    back: bool


class ImportCycle(TypedDict):
    index: int
    kind: CycleKind


class ImportEdgeProps(TypedDict, total=False):
    flags: list[ImportFlag]
    cycle: ImportCycle


class ExceptionEdgeProps(TypedDict, total=False):
    via: list[str]
    handled: bool


class EdgePropsByKind(TypedDict):
    calls: CallEdgeProps
    reads: AccessEdgeProps
    writes: AccessEdgeProps
    mutates: AccessEdgeProps
    inherits: NoProps
    overrides: NoProps
    imports: ImportEdgeProps
    depends_on: NoProps
    lineage: NoProps
    joins: NoProps
    raises: ExceptionEdgeProps
    catches: ExceptionEdgeProps
    flow: FlowEdgeProps


# The props of any edge kind ($defs/EdgeProps); the kind decides which one applies.
EdgeProps = (
    CallEdgeProps | AccessEdgeProps | NoProps | ImportEdgeProps | ExceptionEdgeProps | FlowEdgeProps
)

# --- Document parts ---------------------------------------------------------------------------


class ChangeDetail(TypedDict, total=False):
    formattingOnly: bool
    docstringOnly: bool
    importsReorderedOnly: bool
    membersReorderedOnly: bool
    changedDescendants: int
    renamedFrom: str


class _NodeRequired(TypedDict):
    id: str
    kind: NodeKind
    label: str


class Node(_NodeRequired, total=False):
    parent: str
    # From the first decorator to the last statement; cursor sync uses it.
    range: Range
    # The name of a definition: the navigation target.
    selectionRange: Range
    props: NodeProps
    change: ChangeStatus
    changeDetail: ChangeDetail
    attribution: Attribution
    # Required by the schema when kind is "unresolved", like props.reasonCode; see unresolved_node().
    reason: str


class _EdgeRequired(TypedDict):
    id: str
    kind: EdgeKind
    source: str
    target: str
    confidence: Confidence


class Edge(_EdgeRequired, total=False):
    evidence: list[Range]
    props: EdgeProps
    change: ChangeStatus


class _DiagnosticRequired(TypedDict):
    severity: Severity
    code: DiagnosticCode
    message: str


class Diagnostic(_DiagnosticRequired, total=False):
    # Required by the schema where the def of the code has required keys (DiagnosticArgsByCode).
    args: DiagnosticArgs
    # The file of a diagnostic about a whole file, such as file-too-large; otherwise range.file.
    file: str
    range: Range
    nodeId: str


class _MetaRequired(TypedDict):
    engineVersion: str
    durationMs: float


class Meta(_MetaRequired, total=False):
    baseRevision: str
    dialect: str
    # The engine reached its safety cap (10 x maxNodes, at most 10,000) and cut the graph.
    truncated: bool


class _GraphDocumentRequired(TypedDict):
    schemaVersion: Literal[2]
    view: ViewKind
    nodes: list[Node]
    edges: list[Edge]
    diagnostics: list[Diagnostic]
    meta: Meta


class GraphDocument(_GraphDocumentRequired, total=False):
    focus: str


# --- Other results ----------------------------------------------------------------------------


class LineSpan(TypedDict):
    start: int
    count: int


class Hunk(TypedDict):
    base: LineSpan
    working: LineSpan


class _ChangeSummaryRequired(TypedDict):
    schemaVersion: Literal[2]
    file: str
    module: str
    symbols: list[Node]
    hunks: list[Hunk]
    diagnostics: list[Diagnostic]
    meta: Meta


class ChangeSummary(_ChangeSummaryRequired, total=False):
    baseRevision: str


class IndexResult(TypedDict):
    schemaVersion: Literal[2]
    root: str
    files: int
    parsed: int
    reused: int
    diagnostics: list[Diagnostic]
    meta: Meta


# --- Constructors -----------------------------------------------------------------------------


def position(line: int, character: int) -> Position:
    """A zero-based position; ``character`` must already be in UTF-16 code units."""
    if line < 0 or character < 0:
        msg = f"positions are zero-based, got line {line}, character {character}"
        raise ValueError(msg)
    return {"line": line, "character": character}


def text_range(file: str, start: Position, end: Position, *, revision: str | None = None) -> Range:
    """A range in ``file``, the path exactly as the extension passed it to the engine.

    ``revision`` marks positions in that Git revision's text instead of the working text, for
    deleted nodes (ghosts) and deleted evidence.
    """
    if not file:
        msg = "a range needs a file path"
        raise ValueError(msg)
    if (end["line"], end["character"]) < (start["line"], start["character"]):
        msg = f"range end {end} lies before its start {start}"
        raise ValueError(msg)
    result: Range = {"file": file, "start": start, "end": end}
    if revision is not None:
        if not revision:
            msg = "a range revision must not be empty"
            raise ValueError(msg)
        result["revision"] = revision
    return result


def unresolved_node(
    node_id: str, label: str, reason: str, props: UnresolvedProps, *, parent: str | None = None
) -> Node:
    """A placeholder for a target the analysis cannot resolve (spec 5.3: never drop the edge).

    ``reason`` is the English fallback text; the UI localizes ``props["reasonCode"]`` with
    ``props["args"]``.
    """
    if not reason:
        msg = "unresolved nodes must explain why (schema: reason is required)"
        raise ValueError(msg)
    node: Node = {
        "id": node_id,
        "kind": "unresolved",
        "label": label,
        "reason": reason,
        "props": props,
    }
    if parent is not None:
        node["parent"] = parent
    return node


def meta(*, duration_ms: float = 0.0, base_revision: str | None = None) -> Meta:
    """The meta block of every result: engine version, duration and the compared base.

    ``base_revision`` is set whenever the request compared, also when nothing changed.
    """
    result: Meta = {"engineVersion": ENGINE_VERSION, "durationMs": duration_ms}
    if base_revision is not None:
        if not base_revision:
            msg = "a base revision must not be empty"
            raise ValueError(msg)
        result["baseRevision"] = base_revision
    return result


def empty_document(view: ViewKind, *, duration_ms: float = 0.0) -> GraphDocument:
    """A document without nodes, e.g. for an empty file or as the start of an analysis."""
    return {
        "schemaVersion": 2,
        "view": view,
        "nodes": [],
        "edges": [],
        "diagnostics": [],
        "meta": meta(duration_ms=duration_ms),
    }
