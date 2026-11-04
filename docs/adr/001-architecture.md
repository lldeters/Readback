# ADR 001: Extension host, Python analysis engine and React webview

- Status: Accepted
- Date: 2026-10-31

## Context

Hearback helps developers understand AI-written Python and SQL through deterministic
visualizations (spec sections 1 and 2). It must run in VS Code and in the editors that use Open VSX
(Cursor, Windsurf, Kiro, VSCodium) without a hard dependency on Pylance, Copilot or a particular
agent. The analysis must work offline and must never execute user code, and the extension must stay
quiet: no engine start on activation and no unprompted popups.

The best tools for the analysis are Python libraries: CPython's own `ast` and `symtable`, sqlglot
for SQL dialects and column lineage, and Jedi for type-aware call resolution. The views need an
interactive graph UI inside the editor, which in VS Code means a webview.

## Decision

Hearback consists of three parts that talk through versioned contracts:

- **Extension host** (TypeScript, `src/`): commands, settings, interpreter discovery, the engine
  lifecycle and the webview panels; later the change tracker (Phase 1), the comprehension ledger
  (Phase 3), Git and agent hooks (Phase 4) and LLM providers (Phase 5).
- **Analysis engine** (CPython 3.10 or newer, `engine/`): one long-lived process per window,
  started on first use, speaking JSON-RPC 2.0 over stdio ([ADR 005](005-engine-protocol.md)). It
  only parses code, inside a sandbox ([ADR 003](003-engine-sandbox.md)), with vendored
  dependencies ([ADR 007](007-vendoring.md)).
- **Webview** (React and `@xyflow/react`, `webview/`): renders graphs; the layout runs in a Web
  Worker ([ADR 008](008-webview.md)).

The contracts are `shared/graph-schema.json` for analysis results
([ADR 006](006-graph-schema.md)), `shared/engine-protocol.schema.json` for engine payloads and
`src/shared/webviewProtocol.ts` for messages between host and webview.

The extension declares `extensionKind: ["workspace"]` so that it runs where the code lives in
SSH, WSL and container sessions, activates only through its commands (implicit activation events)
and declares no `extensionDependencies`. Everything that can be derived without an LLM is derived
without one; each edge carries a confidence, and targets that cannot be resolved become explicit
placeholder nodes.

Phase 0 builds the skeleton: the engine handshake, interpreter discovery with error dialogs, the
log output channel, the Show Engine Status command, the graph schema with types on both sides, an
empty webview with theme support and a strict CSP, CI and this documentation.

## Consequences

- The analysis uses the libraries that understand Python and SQL best, in their own language.
  Results do not depend on the user's installed packages, because the engine runs isolated with
  vendored dependencies.
- Each part can be tested on its own: the TypeScript core without `vscode`, the engine connection
  against a fake engine, both sides of each contract against its schema.
- Users need a Python 3.10 or newer interpreter; Hearback does not ship one. Clear messages and
  Hearback: Select Python Interpreter cover the cases where none is found.
- There are two runtimes to build, test and package, on three operating systems.
- The first request pays the engine's start-up time; one long-lived process per window keeps
  later requests fast and allows caching.

## Alternatives considered

- **Analysis in TypeScript** (tree-sitter grammars, a JavaScript SQL parser): no equivalent of
  sqlglot's dialect coverage and lineage, and Python's scoping rules would have to be
  reimplemented. The spec prefers maintained libraries over custom code.
- **Python compiled to WebAssembly (Pyodide) inside the extension:** a download of tens of
  megabytes and a slower start, for no gain in safety over the sandboxed engine.
- **Language Server Protocol:** Hearback's requests return graphs, not diagnostics or completions.
  LSP's document synchronization and capability negotiation would add machinery without benefit
  (spec section 5.2).
- **One process per request:** no caching across requests and the start-up cost on every request.
- **A web extension for vscode.dev:** impossible, because the engine needs a local Python (spec
  section 4).
