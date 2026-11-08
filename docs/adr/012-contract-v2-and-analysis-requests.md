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
- `if`/`then`, `dependentSchemas` and `dependentRequired` are ignored, but an `anyOf` next to
  `properties` renames the interface like `allOf` does.

Ajv's strict mode, which `test/repo/schema.test.ts` uses, rejects a `required` inside an `anyOf`
alternative unless that alternative declares the property itself (`strictRequired`).

The engine handles one request at a time (ADR 005), and a deadline starts when the host calls
`request()`. A long workspace-wide request could therefore make queued requests time out and get a
healthy engine killed.

## Decision

**Versions.** `schemaVersion` 2 and `PROTOCOL_VERSION` 2, on both sides (`PROTOCOL_VERSION` and
`SCHEMA_VERSION` in `src/engine/protocol.ts` and `engine/hearback_engine/__init__.py`, `Literal[2]`
in the TypedDicts), bumped once for all of Phase 1. Later Phase 1 additions stay within v2,
because nothing ships before 0.1.0. `test/repo/versions.test.ts` pins both at 2, and the host's
handshake refuses an engine that reports another protocol or schema version (`protocolMismatch`).

**Where the contract lives.** Results are defined only in `graph-schema.json`: the root
`GraphDocument` and the `$defs` `ChangeSummary` and `IndexResult`, each with `schemaVersion` 2.
Params are defined only in `engine-protocol.schema.json`. Neither schema references the other, so
the generator stays unchanged; `TextPosition` repeats `Position` for that reason. Descriptions go
on a def or its parent, never next to a `$ref`, and arrays have no `minItems`. A rule that the
generator must not see, such as "position or symbol", sits in `dependentSchemas` under a required
property, and each `anyOf` alternative declares its property again (`true`) for `strictRequired`.

**Graph schema v2:**

- `GraphDocument.focus`: the id of the node the request focused on, one of `nodes`.
- `Node.parent`, `Edge.source`, `Edge.target`, `focus` and `Diagnostic.nodeId` name nodes of the
  same result. `parent` is set whenever the result contains the container.
- `Range.revision`: the positions refer to that Git revision's text. Ghost nodes and deleted
  evidence carry it; such ranges never take part in cursor sync.
- `Node.range` starts at the first decorator and covers the whole definition; `Node.selectionRange`
  covers its name and is the navigation target.
- `Node.changeDetail` (`ChangeDetail`): `formattingOnly`, `docstringOnly`, `importsReorderedOnly`,
  `membersReorderedOnly`, `changedDescendants` (a count) and `renamedFrom`.
- `ChangeStatus`: a node is modified if and only if the position-free AST of its own part differs.
  Edges are matched by id; an edge of both versions is modified when its confidence, its props or
  the number of its evidence ranges differ.
- `Diagnostic.code` is the enum `DiagnosticCode` (17 codes, from `syntax-error` to
  `git-unavailable`), with typed args (below). `Diagnostic.file` names the file of a diagnostic
  about a whole file, such as `file-too-large` in `IndexResult.diagnostics`.
- `UnresolvedReasonCode` (12 codes, `type-resolution-skipped`, `undefined-name`,
  `module-not-found` and `computed-class` among them). An unresolved node requires `reason`, the
  English fallback, and `props.reasonCode`.
- `ChangeSummary` (`file`, `module`, `baseRevision`, `symbols`, `hunks`, `diagnostics`, `meta`),
  `Hunk` and `LineSpan` (zero-based `start`, `count`), and `IndexResult` (`root`, `files`,
  `parsed`, `reused`, `diagnostics`, `meta`).
- `Meta.truncated` means that the engine reached its safety cap: 10 × `hearback.graph.maxNodes`, at
  most 10,000 nodes. The webview collapses graphs above `maxNodes` itself. `Meta.baseRevision` is
  set whenever the request compared, also when nothing changed.

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
- Props are required where their def has required keys: attribute (`scope`), external (`group`,
  `package`) and unresolved nodes (`reasonCode`).
- External targets: calls and imports collapse into one node per top-level package (`py:<package>`,
  `py:os` for `os.path`), whose `ExternalProps.names` lists the dotted names behind its edges, so
  the views can show it collapsed and expand it (spec 6.1.5). An exception class outside the
  workspace gets a node of its own (`py:<symbol>`, `ExternalProps.symbol`).
- Exceptions: `python/callGraph` draws `raises` and `catches` edges from a function to the
  exception class: its class node in the workspace, an external exception node, or an unresolved
  node (`computed-class`, `undefined-name`). `FunctionProps.raises` (without the raises that a
  handler surely catches, `ExceptionEdgeProps.handled`) and `catches` carry the same facts in every
  view, and `ExceptionInfo.target` is the class's symbol id. The class anatomy draws no `raises` or
  `catches` edges, because cards draw only edges within the class hierarchy (D05).
- `ClassProps.mro` names workspace classes by node id, classes outside the workspace by symbol id
  (`py:builtins.object`) and unresolved bases by the id of their unresolved node, which the
  `inherits` edge targets. Classes outside the workspace and unresolved bases enter C3 with
  `object` as their only base, and the side panel marks both (P1-062).
- `StateCell.change` shows what changed in the state matrix; a cell that only the base fills comes
  back deleted, with the base's access. `SideEffect.description` is the matching rule's text, the
  fallback for rules from `hearback.sideEffects.rulesFile`. `CallEdgeProps.languageServer`
  (`confirmed`, `notReported`, `resolved`) records how the language-server comparison judged an
  edge the engine found; edges only the language server reports have `resolvedBy`
  `languageServer`.
- `engine/tests/test_schema_conformance.py` checks that the mappings cover every kind, that the
  bindings and the unions name exactly the mapped defs, that a binding requires props or args
  exactly where the def has required keys, and that the TypedDicts match.

**Typed args.** `DiagnosticArgsByCode` and `UnresolvedArgsByCode` map every `DiagnosticCode` and
`UnresolvedReasonCode` to a closed args def, for example `newer-syntax` to `NewerSyntaxArgs`
(`feature`, `requiredVersion`, `runningVersion`), `file-unreadable` to `FileUnreadableArgs`
(`reason`, an `UnreadableReason`), `git-unavailable` to `GitUnavailableArgs` (`reason`, a
`GitUnavailableReason`) and `dynamic-call` to `DynamicCallArgs` (`function`), with `NoArgs` for
codes without args. `Diagnostic` and `UnresolvedProps` bind `args` to that def exactly as props are
bound, through `dependentSchemas` on `code` and `reasonCode`, and require `args` where the def has
required keys. The unions `DiagnosticArgs` and `UnresolvedArgs` type the fields, and the
localization tables of host and webview can type their templates by the mappings, so a renamed
argument fails validation and the typecheck instead of showing a raw placeholder.

**Protocol v2.** `InitializeParams.storageDirectory` is an absolute directory owned by Hearback
(the extension's global storage, `engine/`), where the engine keeps Jedi's cache. The params defs
are `TextPosition`, `SourceFile` (`text` is null for a file deleted in the working tree),
`BaseVersion` (`text` is null for a file the base lacks), `FileOverlay`, `FileBase`, `RulesSource`,
`AnalysisOptions` (`useJedi`, `maxNodes` 50–5,000, `sideEffectRules`), `WorkspaceRoot`,
`WorkspaceFiles` (at most 5,000 files) and `WorkspaceBatch` (at most 500), and the six request
params:

| Request               | Params               | Result                               |
| --------------------- | -------------------- | ------------------------------------ |
| `python/classAnatomy` | `ClassAnatomyParams` | `GraphDocument`, state matrix inside |
| `python/callGraph`    | `CallGraphParams`    | `GraphDocument`                      |
| `python/controlFlow`  | `ControlFlowParams`  | `GraphDocument`                      |
| `python/moduleGraph`  | `ModuleGraphParams`  | `GraphDocument`                      |
| `python/indexFiles`   | `IndexFilesParams`   | `IndexResult`                        |
| `diff/compare`        | `DiffCompareParams`  | `ChangeSummary`                      |

- Requests are stateless. The host sends the file list and the text of dirty documents; the engine
  reads every other file itself with its safe reader. `python/classAnatomy`, which reads base
  classes in other files, takes `WorkspaceFiles` like `python/callGraph`; `python/controlFlow` and
  `diff/compare` need only the `WorkspaceRoot`. For the source file, `source.text` and `base` take
  precedence over its entries in `workspace.overlays` and `workspace.bases`.
- `python/classAnatomy`, `python/callGraph` and `python/controlFlow` take an optional `symbol` id
  that wins over `position`; the latter two need one of them. The engine looks the id up in the
  working text, then in the base, so a ghost symbol (P1-095) gets the same views, with deleted nodes
  and revision ranges.
- Comparison: `base` compares the source file, and `WorkspaceFiles.baseRevision` the folder: a file
  with a `FileBase` gets its status from it, a file in `omittedBases` (changed, but its base was
  left out, for example beyond the host's 16 MB limit) gets none and the result carries
  `changes-partial`, and every other file is unchanged. `dependentRequired` ties `bases` and
  `omittedBases` to `baseRevision`. A `FileBase` whose file is not in `files`, or a `SourceFile`
  with null text and a base, is a deleted file whose nodes come back as ghosts.
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

**Python side.** A TypedDict for every def; the functional syntax where a key is a keyword or
contains a dash (`NodePropsByKind`, `DiagnosticArgsByCode`, `UnresolvedArgsByCode`, and
`FunctionProps` because of `async`). Hand-written validators in
`engine/hearback_engine/validation.py` check every params def, the rules in `dependentSchemas` and
`dependentRequired` included. `test_validation.py` runs them side by side with the schema on a
complete example of each def and on every single mutation of it.

**Refinements of the approved plan**, reported to the owner:

- The plan names most props fields; this record fixes their types. Examples: `components` as lists
  of member ids, `matrix` as rows, columns and non-empty cells, `assignments` with the assigning
  method and range, `accessors` with kind, signature and range, and `cycle` as index and kind.
- The plan gives no fields for `ModuleProps`, `PackageProps` and `FlowNodeProps`. They take what
  the work packages describe: `packageInit`, `namespace` (PEP 420), and the exceptional exit,
  merged statements, unreachable code, early exits and removed base lines.
- `ExceptionEdgeProps.handled` marks a raise that a handler of the same function surely catches.
- Added: the binding of each kind to its props def through `dependentSchemas`, the unions
  `NodeProps` and `EdgeProps`, `NoProps`, the enum defs, and the requirement of `props.reasonCode`
  for unresolved nodes. `FileBase` holds a `BaseVersion`.
- `shared/examples/graph-class-anatomy.json` gets the three corrections of the plan: the unresolved
  call starts at `call_by_name`, the self-unused diagnostic sits on `_log_retry`, and the class
  range spans 5:0–39:36. It also moves to the module name `retrying_client`, the planned id
  formats (`py:<module>.<qualname>`, `unresolved:<source>/<expression>`,
  `e:<kind>:<source>-><target>`) and typed props. The new `change-summary.json` shows a
  docstring-only edit, an added and a deleted method, and a formatting-only edit. The fixture
  package regenerates both examples from the engine snapshots.

**Refinements after the review of WP01**, made before any later package builds on this record and
reported to the owner:

- `python/classAnatomy` takes `WorkspaceFiles` instead of the plan's `WorkspaceRoot`, because D04
  has the host send the file list and the dirty documents, and class anatomy reads base classes in
  other files (context cards, P1-055).
- `python/callGraph` and `python/controlFlow` take `position` or `symbol`, where the plan requires
  a position: a deleted function has none in the working text, and D23 opens Control Flow for
  functions.
- `SourceFile.text` may be null, so that single-file requests can show a deleted file (P1-049).
- `WorkspaceFiles.baseRevision` and `omittedBases`, because `bases` alone cannot say that a request
  compares when no file changed, nor which changed files lost their base (P1-035, WP12).
- Exceptions get nodes, the plan's one external node per top-level package gets `names` to expand
  into (P1-083, WP22), and the MRO names unresolved bases; P1-149 and P1-150 need the first, which
  `ExternalProps` could not express.
- Typed args per code replace the free-form `MessageArgs` (P1-036), with `Diagnostic.file`, four
  more reason codes, `StateCell.change`, `SideEffect.description` and
  `CallEdgeProps.languageServer` (P1-046, D24, P1-071), and props required for attribute and
  external nodes.
- Not added now: localized texts for `LanguageServerCheck`, the new reason codes and the args. They
  come with the tables that use them (WP12, WP20, WP24), because `npm run l10n:export` extracts
  only strings that code uses.

## Consequences

- Engine, host and webview share one closed contract. An undocumented props key fails schema
  validation in the engine's snapshot tests, and reading one fails the webview's typecheck.
- Adding a props key, a diagnostic code, a reason code or an argument is a schema change: edit the
  schema, regenerate the types, update the TypedDicts and the localization tables of webview and
  host.
- The SQL and dbt kinds accept no props until Phase 2 defines them.
- A v2 host refuses a v1 engine and the reverse, and an engine with another graph schema version;
  the mismatch message names both versions.
- The bindings repeat the mappings of `NodePropsByKind`, `EdgePropsByKind`, `DiagnosticArgsByCode`
  and `UnresolvedArgsByCode` inside the schema; the conformance tests keep both in step.
- Every Changes tree item, ghosts included, can open its view by id, without a position.

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
- **Child external nodes per submodule or called function, collapsed into their package:** precise
  edges after expanding, but more nodes; `names` keeps the one node per package that D05 and WP09
  describe.
- **Exception edges in the class anatomy as well:** cards draw only edges within the class
  hierarchy (D05), so the class anatomy keeps the facts in `FunctionProps`.
- **`position` or `symbol` as an `anyOf` next to `properties`:** renames the generated interface,
  as `allOf` does. **No Control Flow for ghost functions:** P1-095 asks for the matching view of
  every ghost symbol.
- **A capped `overlays` list on `WorkspaceRoot` for class anatomy:** dirty documents, but no file
  list (D04) and no change status for context cards.
- **Free-form args whose names the enum descriptions list:** nothing would fail when a name changes.
