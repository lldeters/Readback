# ADR 012: Contract v2 and the analysis requests

- Status: Accepted
- Date: 2026-11-08

## Context

Phase 1 adds the Python analyses. Spec section 5.2 lists the core requests (their names may
change), section 5.3 makes `shared/graph-schema.json` the single source of truth, section 5.4 asks
for change status, ghost nodes and hunks, and the webview has to read typed props (P1-037) and
localize diagnostics by code (P1-036). The workspace-wide views cover up to 5,000 files per folder,
while `hearback.engine.timeoutMs` stays the single per-request timeout.

Version 1 of the contract ([ADR 005](005-engine-protocol.md), [ADR 006](006-graph-schema.md))
cannot grow compatibly: every object has `additionalProperties: false`, so a v1 reader rejects
every new field. Its `props` were a free-form bag, so nothing stopped the engine from sending, or
the webview from reading, an undocumented key.

Measured with json-schema-to-typescript 16.0.0, which `scripts/gen-schema-types.mjs` runs:

- A `$ref` from the protocol schema into the graph schema copies every graph type into
  `engineProtocol.ts`.
- An `allOf` next to `properties` turns the interface into an alias of a renamed copy
  (`type Node = Node1`).
- A `$ref` with any sibling keyword, even `description`, emits a duplicate type (`Range1`,
  `NodeProps1`).
- `minItems` emits tuple types such as `[string, ...string[]]`.
- `if`/`then` and `dependentSchemas` are ignored.

The engine handles one request at a time (ADR 005), and a deadline starts when the host calls
`request()`. A long workspace-wide request could therefore make queued requests time out and get a
healthy engine killed.

## Decision

**Versions.** `schemaVersion` 2 and `PROTOCOL_VERSION` 2, on both sides (`src/engine/protocol.ts`,
`engine/hearback_engine/__init__.py`, `Literal[2]` in the TypedDicts), bumped once for all of
Phase 1. Later Phase 1 additions stay within v2, because nothing ships before 0.1.0.
`test/repo/versions.test.ts` pins both at 2.

**Where the contract lives.** Results are defined only in `graph-schema.json`: the root
`GraphDocument` and the `$defs` `ChangeSummary` and `IndexResult`, each with `schemaVersion` 2.
Params are defined only in `engine-protocol.schema.json`. Neither schema references the other, so
the generator stays unchanged; `TextPosition` repeats `Position` for that reason. Descriptions go
on a def or its parent, never next to a `$ref`, and arrays have no `minItems`.

**Graph schema v2:**

- `GraphDocument.focus`: the id of the symbol the request focused on.
- `Range.revision`: the positions refer to that Git revision's text. Ghost nodes and deleted
  evidence carry it; such ranges never take part in cursor sync.
- `Node.range` starts at the first decorator and covers the whole definition; `Node.selectionRange`
  covers its name and is the navigation target.
- `Node.changeDetail` (`ChangeDetail`): `formattingOnly`, `docstringOnly`, `importsReorderedOnly`,
  `membersReorderedOnly`, `changedDescendants` (a count) and `renamedFrom`.
- `Diagnostic.code` is the enum `DiagnosticCode` (17 codes, from `syntax-error` to
  `git-unavailable`); `Diagnostic.args` and `UnresolvedProps.args` share `MessageArgs`.
- `UnresolvedReasonCode` (8 codes). An unresolved node requires `reason`, the English fallback,
  and `props.reasonCode`.
- `ChangeSummary` (`file`, `module`, `baseRevision`, `symbols`, `hunks`, `diagnostics`, `meta`),
  `Hunk` and `LineSpan` (zero-based `start`, `count`), and `IndexResult` (`root`, `files`,
  `parsed`, `reused`, `diagnostics`, `meta`).
- `Meta.truncated` means that the engine reached its safety cap: 10 × `hearback.graph.maxNodes`, at
  most 10,000 nodes. The webview collapses graphs above `maxNodes` itself.

**Typed props.** Every props def is closed (`additionalProperties: false`):

- Node props: `PackageProps`, `ModuleProps`, `ClassProps`, `FunctionProps` (functions and
  methods), `AttributeProps`, `PropertyProps`, `FlowNodeProps` (the 15 control-flow kinds),
  `ExternalProps`, `UnresolvedProps`.
- Edge props: `CallEdgeProps`, `AccessEdgeProps` (reads, writes and mutates), `ImportEdgeProps`,
  `ExceptionEdgeProps` (raises and catches), `FlowEdgeProps`.
- Shared parts: `SideEffect`, `Metrics`, `ExceptionInfo`, `Parameter`, `StateMatrix` and
  `StateCell`, `AttributeAssignment`, `PropertyAccessor`, `ImportCycle`, plus an enum def for
  every closed value set.
- `NoProps` for kinds without props of their own in this version: `parameter`, `variable`, the
  SQL and dbt kinds until Phase 2, and the edges `inherits`, `overrides`, `depends_on`, `lineage`
  and `joins`.
- `NodePropsByKind` and `EdgePropsByKind` map every `NodeKind` and `EdgeKind` value to its def.
  They are type-level mappings that are never sent: the webview's `propsOf(node)` returns
  `NodePropsByKind[node.kind]`.
- The schema binds each kind to exactly that def: `Node` and `Edge` carry
  `dependentSchemas.kind` with one `if`/`then` rule per def. The rule applies to every node and
  edge, because `kind` is required. A plain `allOf` would rename the generated interfaces.
- `Node.props` and `Edge.props` reference the unions `NodeProps` and `EdgeProps` (`anyOf` of the
  defs). In TypeScript, reading a key that not every member has fails to typecheck, which leaves
  `propsOf()` as the only way in.
- `engine/tests/test_schema_conformance.py` checks that the mappings cover every kind, that the
  bindings and the unions name exactly the mapped defs, and that the TypedDicts match.

**Protocol v2.** `InitializeParams.storageDirectory` is an absolute directory owned by Hearback
(the extension's global storage, `engine/`), where the engine keeps Jedi's cache. The params defs
are `TextPosition`, `SourceFile`, `BaseVersion` (`text` is null for a file the base lacks),
`FileOverlay`, `FileBase`, `RulesSource`, `AnalysisOptions` (`useJedi`, `maxNodes` 50–5,000,
`sideEffectRules`), `WorkspaceRoot`, `WorkspaceFiles` (at most 5,000 files) and `WorkspaceBatch`
(at most 500), and the six request params:

| Request               | Params               | Result                               |
| --------------------- | -------------------- | ------------------------------------ |
| `python/classAnatomy` | `ClassAnatomyParams` | `GraphDocument`, state matrix inside |
| `python/callGraph`    | `CallGraphParams`    | `GraphDocument`                      |
| `python/controlFlow`  | `ControlFlowParams`  | `GraphDocument`                      |
| `python/moduleGraph`  | `ModuleGraphParams`  | `GraphDocument`                      |
| `python/indexFiles`   | `IndexFilesParams`   | `IndexResult`                        |
| `diff/compare`        | `DiffCompareParams`  | `ChangeSummary`                      |

- Requests are stateless. The host sends the file list and the text of dirty documents; the engine
  reads every other file itself with its safe reader.
- `diff/compare` without a base returns the outline of the file, which covers the spec's
  `python/analyzeFile`.
- Analysis problems are diagnostics in the result, never JSON-RPC errors. Besides the lifecycle
  errors of [ADR 005](005-engine-protocol.md) (-32002 before `engine/initialize`, -32600 after
  `engine/shutdown`, and -32601 for a method the engine does not implement yet, which matters
  while Phase 1 adds the requests package by package), an analysis request fails only with invalid
  params (-32602), cancellation (-32800) or an internal error (-32603). The engine sends no
  notifications to the host in 0.1.0.

**Method order.** `Methods` in `src/engine/protocol.ts`, `Method` in
`engine/hearback_engine/protocol.py` and `MethodTable.names()` list `engine/initialize`,
`engine/ping`, `engine/shutdown`, `python/classAnatomy`, `python/callGraph`, `python/controlFlow`,
`python/moduleGraph`, `python/indexFiles` and `diff/compare`, then the notifications `engine/exit`
and `engine/setLogLevel`. The package that implements a request adds, in one commit, its `Methods`
entry on both sides, its handler, its entry in `test_server.ENGINE_METHODS`, its `RequestType` in
`src/engine/analysis/requests.ts` and its name in `shared/examples/initialize-result.json`, so
`test_protocol_sync.py` stays green after every commit.

**Scheduling and the workspace index.** A vscode-free host scheduler keeps at most one analysis
request in flight. It runs foreground work before background work, coalesces requests per key and
drops superseded ones before sending, and lets foreground work cancel in-flight background work.
It calls `EngineConnection.request` only at dispatch, so every deadline starts when the request is
sent. Workspace-wide work runs through `python/indexFiles` batches of at most 250 files or 4 MB,
which the schema bounds at 500 files. Each request fits `hearback.engine.timeoutMs`, foreground
requests interleave, and Retry resumes from the engine's cached summaries (`IndexResult.reused`).

**Python side.** A TypedDict for every def; the functional syntax where a key is a keyword
(`NodePropsByKind`, and `FunctionProps` because of `async`). Hand-written validators in
`engine/hearback_engine/validation.py` check every params def. `test_validation.py` runs them side
by side with the schema on a complete example of each def and on every single mutation of it.

**Refinements of the approved plan**, reported to the owner:

- The plan names most props fields; this record fixes their types. Examples: `components` as lists
  of member ids, `matrix` as rows, columns and non-empty cells, `assignments` with the assigning
  method and range, `accessors` with kind, signature and range, and `cycle` as index and kind.
- The plan gives no fields for `ModuleProps`, `PackageProps` and `FlowNodeProps`. They take what
  the work packages describe: `packageInit`, `namespace` (PEP 420), and the exceptional exit,
  merged statements, unreachable code, early exits and removed base lines.
- `ExceptionEdgeProps.handled` marks a raise that a handler of the same function surely catches.
- Added: the binding of each kind to its props def through `dependentSchemas`, the unions
  `NodeProps` and `EdgeProps`, `NoProps`, `MessageArgs`, the enum defs, and the requirement of
  `props.reasonCode` for unresolved nodes. `FileBase` holds a `BaseVersion`.
- `shared/examples/graph-class-anatomy.json` gets the three corrections of the plan: the unresolved
  call starts at `call_by_name`, the self-unused diagnostic sits on `_log_retry`, and the class
  range spans 5:0–39:36. It also moves to the module name `retrying_client`, the planned id
  formats (`py:<module>.<qualname>`, `unresolved:<source>/<expression>`,
  `e:<kind>:<source>-><target>`) and typed props. The new `change-summary.json` shows a
  docstring-only edit, an added and a deleted method, and a formatting-only edit. The fixture
  package regenerates both examples from the engine snapshots.

## Consequences

- Engine, host and webview share one closed contract. An undocumented props key fails schema
  validation in the engine's snapshot tests, and reading one fails the webview's typecheck.
- Adding a props key or a diagnostic code is a schema change: edit the schema, regenerate the
  types, update the TypedDicts and the localization tables of webview and host.
- The SQL and dbt kinds accept no props until Phase 2 defines them.
- A v2 host refuses a v1 engine and the reverse; the protocol mismatch message names both versions.
- The bindings repeat the mapping of `NodePropsByKind` and `EdgePropsByKind` inside the schema; the
  conformance tests keep both in step.

## Alternatives considered

- **A `$ref` from the protocol schema to the graph schema**, with post-processing of the generated
  types: copies every graph type into `engineProtocol.ts`.
- **Staying on v1 with optional fields:** `additionalProperties: false` makes v1 readers reject
  them anyway.
- **A free-form props bag checked by tests only:** the webview could still read undocumented keys.
- **One `Node` variant per kind with `oneOf`:** ADR 006 avoids exclusive alternatives, and every
  consumer would have to narrow 37 node types.
- **The bindings in an `allOf` next to `properties`, or as a chain of nested `if`/`then`/`else`:**
  the first renames the generated interfaces, the second nests ten levels deep.
- **A separate `python/analyzeFile`:** `diff/compare` without a base returns the same outline.
- **A stateful workspace sync:** the host would have to mirror the engine's file state.
- **One long request with `$/progress` notifications, or a higher timeout floor for workspace-wide
  requests:** both bypass `hearback.engine.timeoutMs` and block foreground requests.
