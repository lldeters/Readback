# Readback architecture

This document describes how Readback is built at the end of Phase 0 ("foundation"). The product
specification defines scope and phases; the decisions behind this design, with the alternatives
that were considered, are recorded in [`docs/adr/`](adr/README.md).

Readback is a VS Code extension with three parts: the extension host (TypeScript), a long-lived
Python analysis engine that only parses code, and a React webview that draws graphs. They talk
through two contracts that live in `shared/`: the graph schema and the engine protocol schema.

## Overview

```text
VS Code, Cursor, Windsurf, Kiro, VSCodium (engines.vscode ^1.105.0)
│
├── Extension host: TypeScript, dist/extension.js                         src/
│   ├── Commands: Show Engine Status, Select Python Interpreter,
│   │   Restart Engine, Show Log, Open Graph View                         src/engine/, src/views/
│   ├── EngineService: lazy start, restart with backoff, status           src/engine/engineService.ts
│   ├── Interpreter resolution and Restricted Mode policy                 src/engine/interpreter/
│   ├── EngineConnection ⇄ JSON-RPC 2.0 over stdio ⇄ analysis engine      src/engine/engineConnection.ts
│   ├── Graph panel: HTML, Content Security Policy, messages              src/views/
│   ├── Output channel "Readback" (log levels)
│   └── Later: ChangeTracker (Phase 1), ledger and strictness (Phase 3),
│       Git and agent hooks (Phase 4), LLM providers (Phase 5)
│
├── Analysis engine: CPython ≥ 3.10, one process per window               engine/
│   ├── run_engine.py: version check, sys.path, sandbox, then the server
│   ├── readback_engine/: JSON-RPC server and handshake; from Phase 1
│   │   python_analysis/ (ast, symtable, optional Jedi) and
│   │   sql_analysis/ (sqlglot, dbt adapter)
│   └── vendor/: sqlglot, jedi, parso (generated, not committed)
│
├── Webview: React 19, @xyflow/react 12, dist/webview/main.js + main.css  webview/src/
│   └── Layout worker, started from a blob: URL (ELK from Phase 1)        webview/worker/
│
└── Contracts                                                             shared/, src/shared/
    ├── graph-schema.json: GraphDocument (JSON Schema 2020-12)
    ├── engine-protocol.schema.json: engine payloads
    └── webviewProtocol.ts: host ⇄ webview messages
```

## Components

| Component                 | Location                                                          | Responsibility                                                                                                                                          |
| ------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Entry point               | `src/extension.ts`                                                | Creates the "Readback" log output channel and registers the commands. Starts nothing else; `deactivate()` stops the engine.                             |
| Engine commands           | `src/engine/commands.ts`, `selectInterpreter.ts`, `messages.ts`   | Status report, interpreter picker, restart, log; error notifications with the actions that fix them.                                                    |
| EngineService             | `src/engine/engineService.ts`, `restartPolicy.ts`                 | Owns the window's engine: lazy start, automatic restart with backoff, crash-loop stop, restart on interpreter changes, status snapshot.                 |
| EngineConnection          | `src/engine/engineConnection.ts`, `stderrLog.ts`                  | One engine process: spawn, JSON-RPC connection, handshake, requests with timeouts, stderr parsing, orderly shutdown.                                    |
| Interpreter resolution    | `src/engine/interpreter/`                                         | Sources (setting, Python extension, PATH), PATH search, probe, Restricted Mode path rules. The core is free of `vscode` imports so it is unit-testable. |
| Graph panel               | `src/views/graphPanel.ts`, `graphPanelState.ts`, `webviewHtml.ts` | Creates the webview panel, renders the HTML with CSP and boot data, validates and records webview messages.                                             |
| Webview app               | `webview/src/`                                                    | React app with an empty React Flow canvas, theme mapping, CSP and error reporting, layout worker check.                                                 |
| Layout worker             | `webview/worker/layout.worker.ts`                                 | Phase 0 answers a ping; from Phase 1 it runs the graph layout off the UI thread.                                                                        |
| Engine bootstrap          | `engine/run_engine.py`                                            | Stays parseable by old Pythons, checks the version, sets `sys.path`, installs the sandbox, then imports and starts the server.                          |
| Engine package            | `engine/readback_engine/`                                         | JSON-RPC server (`engine/*` methods); the Python and SQL analyses from Phase 1. Version constants in `__init__.py`.                                     |
| Contracts                 | `shared/`, `src/engine/protocol.ts`, `src/shared/`                | JSON Schemas (source of truth), generated TypeScript types, protocol constants, the webview message contract.                                           |
| Build and release scripts | `esbuild.mjs`, `scripts/`                                         | Bundling, schema type generation, vendoring, license gate and notices, the Restricted Mode test launcher.                                               |

## Process model

- **Activation.** `activationEvents` is empty: since VS Code 1.74 each contributed command
  activates the extension implicitly. Activation only registers commands and creates the log
  channel. It does not resolve an interpreter, start the engine or activate the Python extension
  (spec sections 2.6 and 8).
- **One engine per window.** The extension owns one `EngineService`. Settings are read for the
  first workspace folder; in a multi-root workspace one engine serves all folders.
- **Lazy start.** The first request that needs the engine (in Phase 0: Readback: Show Engine
  Status, which pings it) resolves the interpreter and starts the process. Concurrent callers share
  that start. The `engine/initialize` handshake must finish within 20 seconds.
- **Request timeouts.** Each request has a deadline of `readback.engine.timeoutMs` (default
  30,000 ms). At the deadline the client sends `$/cancelRequest`. If the engine has still not
  answered two seconds later, the client kills it. A hung engine counts as a crash (see below), so
  it restarts with backoff. Cancellation inside the engine is cooperative, so the kill is the
  backstop for a single long call.
- **Crashes.** An unexpected exit (or a kill after a hang) restarts the engine after 1 s, doubling
  with every further crash up to 30 s. More than five crashes within three minutes count as a crash loop: automatic restarts
  stop until the user runs Readback: Restart Engine.
- **Interpreter changes.** Changes to `readback.engine.pythonPath`, granting Workspace Trust,
  installing or removing the Python extension and a new active environment in the Python extension
  are debounced for one second. A running engine then stops, and the next use starts it with a new
  resolution.
- **Shutdown** (deactivation, restart, interpreter change): `engine/shutdown` request (the client
  waits up to one second for the answer), `engine/exit` notification, end of stdin; the process is
  killed if it is still alive two seconds later. The engine also exits on its own at end of stdin,
  so it cannot outlive a crashed extension host.
- **Logging.** The output channel "Readback" is a log channel. Its level (Developer: Set Log
  Level…) is sent to the engine in `engine/initialize` and on every change via
  `engine/setLogLevel`.

## Interpreter discovery and Restricted Mode

The resolution order follows spec section 5.2 ([ADR 004](adr/004-interpreter-discovery.md)):

1. **`readback.engine.pythonPath`.** `~` and `${userHome}` are expanded. `${workspaceFolder}` and
   relative paths are only accepted in trusted workspaces; a bare name such as `python3.12` is
   looked up on PATH. If the setting is set but unusable, resolution stops with an error instead of
   silently falling back to another interpreter.
2. **The Python extension's active environment** (`ms-python.python`, read through
   `@vscode/python-extension`). Used only if the extension is installed, with a 10-second timeout
   for its API and 5 seconds for resolving the environment. There are no `extensionDependencies`,
   so Readback works without the Python extension.
3. **PATH.** Windows: `py -3`, `python`, `python3`; elsewhere: `python3`, `python`. Readback
   searches PATH itself (absolute directories only) instead of letting `spawn()` do it, because
   on Windows a bare command name is first looked up in the current directory. It skips the
   Microsoft Store redirector and the macOS `/usr/bin/python3` stub when no developer tools are
   installed.

Every candidate is probed with `<python> -I -S -c <probe>` from `<extensionPath>/engine`, without a
shell and with the sanitized environment described below. The probe reports `sys.executable`, the
version, the implementation and the platform. The first CPython 3.10 or newer wins, and the engine
is started with its `sys.executable`, never through `py` or a shim. Probe results are cached per
file version (modification time and size).

**Restricted Mode** (an untrusted workspace):

- `readback.engine.pythonPath` from workspace and folder settings is ignored. The manifest lists the
  setting in `capabilities.untrustedWorkspaces.restrictedConfigurations`, so VS Code drops workspace
  values and `inspect()` does not report them.
- The Python extension is not consulted (it is disabled in Restricted Mode anyway).
- Any candidate whose path or real path lies inside a workspace folder is rejected before anything
  is spawned, including a user-level setting that points into the workspace. PATH entries inside
  workspace folders are skipped. Paths compare case-insensitively on Windows and macOS.
- The engine still runs with an interpreter from outside the workspace: parsing is safe.
- Granting trust triggers a new resolution.

**Workspace setting confirmation** (approved addition): a `readback.engine.pythonPath` value from
workspace or folder settings is only used after a one-time confirmation per (workspace, path), even
in trusted workspaces. The answer is stored in `globalState`. A declined value is ignored for the
rest of the session (the user-level value applies) and asked about again in a later session.
Automatic restarts never show the prompt. The confirmation covers this setting only: in trusted
workspaces (always, in editors without Workspace Trust) the Python extension's active environment
is used as that extension chose it, which a repository can influence with a committed `.venv` or
`python.defaultInterpreterPath` ([ADR 004](adr/004-interpreter-discovery.md), known limit). The
reasons for the confirmation:

- Cursor ships with Workspace Trust disabled, so every folder counts as trusted and
  `restrictedConfigurations` never removes a malicious repository's setting there.
- A `.venv/bin/python` symlink to a trusted system Python still reads the workspace's `pyvenv.cfg`,
  whose `home` key can point the standard library at attacker files, so attacker code runs at
  startup even under `-I -S`. That is why paths are checked before any spawn, including the probe.
- On Windows, `spawn()` with a bare name searches the current directory before PATH.

Readback: Select Python Interpreter lists the usable interpreters it found with their versions,
shows rejected ones with the reason under "Not usable" (they cannot be picked), and offers "Enter
interpreter path…", "Browse…" and "Use automatic detection". It writes the choice to the user
settings, never to the workspace. Because workspace and folder values take precedence, it first
asks whether to ignore such a value in this workspace (remembered in `globalState`) or to open the
workspace settings. Failure messages name the settings scope a bad value came from.

## Engine protocol

[ADR 005](adr/005-engine-protocol.md) records the decision; the payloads are defined in
[`shared/engine-protocol.schema.json`](../shared/engine-protocol.schema.json) and the names and
codes in [`src/engine/protocol.ts`](../src/engine/protocol.ts).

**Transport.** JSON-RPC 2.0 over the engine's stdin and stdout with LSP-style framing:
`Content-Length: <n>\r\n\r\n` followed by `<n>` bytes of UTF-8 JSON, without a `Content-Type`
header. The extension uses vscode-jsonrpc 10.0.0 (imported from `vscode-jsonrpc/node`); the engine
has a small implementation on the standard library. The engine processes requests one at a time in
order, and every request gets exactly one response.

**Methods** (protocol version 1):

| Method               | Kind                     | Params                                                                                    | Result                                                                                                                                                                                    |
| -------------------- | ------------------------ | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `engine/initialize`  | request, must come first | `InitializeParams`: `protocolVersion`, `client`, `logLevel`, `workspaceTrusted`, `locale` | `InitializeResult`: `engineVersion`, `protocolVersion`, `schemaVersion`, `python` (version, implementation, executable, platform), `vendored`, `capabilities.methods`, `pid`, `sandboxed` |
| `engine/ping`        | request                  | none                                                                                      | `{ "pong": true }`                                                                                                                                                                        |
| `engine/shutdown`    | request                  | none                                                                                      | `null`                                                                                                                                                                                    |
| `engine/exit`        | notification             | none                                                                                      | none; the process exits                                                                                                                                                                   |
| `engine/setLogLevel` | notification             | `{ "level": "trace" \| "debug" \| "info" \| "warning" \| "error" \| "off" }`              | none                                                                                                                                                                                      |
| `$/cancelRequest`    | notification             | `{ "id": <request id> }`                                                                  | none; the cancelled request answers with -32800                                                                                                                                           |

The client sends its `PROTOCOL_VERSION` in `engine/initialize` and refuses to talk to an engine
that reports another one. The analysis requests (`python/classAnatomy`, `sql/lineage`, …) arrive
from Phase 1 and return a `GraphDocument`.

**Errors.** Error responses use the standard JSON-RPC codes plus two LSP codes. Their `data` member
is an `EngineErrorData` object with a machine-readable `kind` and an optional `detail`.

| Code   | Meaning                                                                                            |
| ------ | -------------------------------------------------------------------------------------------------- |
| -32700 | Parse error: the message is not valid JSON.                                                        |
| -32600 | Invalid request: valid JSON, but not a JSON-RPC request.                                           |
| -32601 | Method not found.                                                                                  |
| -32602 | Invalid params: the params do not match the schema.                                                |
| -32603 | Internal error: an unexpected exception in the engine (the traceback goes to stderr only).         |
| -32002 | Server not initialized: a request arrived before `engine/initialize` (LSP `ServerNotInitialized`). |
| -32800 | Request cancelled: by `$/cancelRequest` or at the deadline (LSP `RequestCancelled`).               |

**stderr.** Stdout carries only protocol messages. The engine writes its log to stderr, one record
per line in the form `[<level>] <message>`, where the level is `trace`, `debug`, `info`, `warning`
or `error`. Continuation lines, such as the lines of a traceback, start with four spaces and belong
to the record above them. The extension shows other lines (for example interpreter errors before
logging is set up) as raw output and cuts lines longer than 16 KiB.

**Fatal startup errors.** If the engine cannot start, `run_engine.py` writes one machine-readable
line `READBACK_ENGINE_FATAL <json>` to stderr, where the JSON is a `FatalStartupError`
(`code`: `python-too-old` or `bootstrap-failed`, plus `version`, `required` and `detail`), and exits
with code 3 (`python-too-old`) or 4 (`bootstrap-failed`). Exit code 0 is a normal exit. The
extension turns these into an error message with the action Select Interpreter….

## Engine sandbox

The engine runs as

```text
<python> -I -S -X utf8 <extensionPath>/engine/run_engine.py
```

with the working directory `<extensionPath>/engine`, no shell, a hidden window on Windows, and an
environment without `PYTHON*`, `VIRTUAL_ENV`, `CONDA_PREFIX` (and the other conda activation
variables) and `__PYVENV_LAUNCHER__`. `PYTHON_MANAGER_AUTOMATIC_INSTALL=0` keeps the Windows Python
install manager from downloading a runtime as a side effect. [ADR 003](adr/003-engine-sandbox.md)
explains each measure:

- `-I` (isolated mode) ignores `PYTHON*` variables and the user site directory and puts neither the
  script directory nor the working directory on `sys.path`; the bootstrap adds `engine/` and
  `engine/vendor/` from its own location.
- `-S` skips the `site` module: no site-packages, no `.pth` files, no `sitecustomize`. Nothing from
  the user's Python environment runs, and results do not depend on what is installed.
- `-X utf8` enables UTF-8 mode, the only UTF-8 switch that works under `-I` before Python 3.15.
- The engine keeps a private duplicate of the original stdout for the protocol and points file
  descriptor 1 at stderr, so a stray `print()` in a library cannot corrupt the framing.
- An audit hook (`sys.addaudithook`) refuses to create processes, open sockets or load native code
  through `ctypes`. The bootstrap installs it right after the version check and the `sys.path`
  setup and before it imports the server, so the module-level code of the server and of everything
  it imports already runs under it. The server claims stdout first and then asks the sandbox
  again, which adds no second hook and returns the state verified by a probe event;
  `InitializeResult.sandboxed` reports that state.
- `multiprocessing` (and with it `ProcessPoolExecutor`) starts spawn children, the fork server and
  its resource tracker through `_posixsubprocess.fork_exec` instead of `subprocess.Popen`, and only
  Python 3.14 and later raise an audit event there. On POSIX the sandbox therefore wraps that
  function, so that every call raises the `_posixsubprocess.fork_exec` event first, on every
  version.

Spec section 5.2 says the engine "imports no network modules". The approved interpretation: the
engine never opens sockets and never starts processes. The vendored libraries import `socket` or
`subprocess` transitively without using them (sqlglot through `importlib.metadata` and `email`;
jedi and parso through `subprocess`), so the rule is enforced on behavior, not on imports, in three
ways: the audit hook at runtime, a ruff `banned-api` lint for the engine's own code
(`engine/pyproject.toml`: `socket`, `ssl`, `http`, `urllib.request`, `ftplib`, `smtplib`,
`subprocess`, `multiprocessing`, `concurrent.futures.ProcessPoolExecutor`,
`concurrent.futures.process`, `_posixsubprocess`, `ctypes`, `os.system`, `os.popen`,
`os.startfile`) and a test.

The audit hook is defense in depth, not a security boundary: native code can bypass it. The
guarantee that matters is that the engine only parses (with `ast` and sqlglot) and never imports or
executes user code. From Phase 1, Jedi runs in-process with `jedi.InterpreterEnvironment()`, which
needs no subprocess.

## Graph model

[`shared/graph-schema.json`](../shared/graph-schema.json) (JSON Schema 2020-12) is the single
source of truth for analysis results ([ADR 006](adr/006-graph-schema.md)).

- **`GraphDocument`**: `schemaVersion` (currently 1, bumped on every incompatible change), `view`
  (for example `classAnatomy`), `nodes`, `edges`, `diagnostics` and `meta` (engine version,
  duration, base revision, SQL dialect, truncation).
- **Nodes** have a stable `id` (for example `py:shop.orders.OrderService.place_order` or
  `sql:col:raw.orders.amount_cents`), a `kind`, a `label`, an optional `parent`, `range`, `props`,
  `change` (`added`, `modified`, `deleted`, `unchanged`) and `attribution` (`ai`, `human`,
  `unknown`; filled from Phase 4).
- **Edges** have an `id`, a `kind` (`calls`, `reads`, `writes`, `mutates`, `inherits`, …),
  `source` and `target` node ids, a `confidence` and `evidence` (the code ranges that prove them).
- **Positions** are zero-based lines and characters, with `character` counted in UTF-16 code units
  like LSP and VS Code. `Range.file` is the absolute path the extension passed to the engine. The
  engine converts from `ast` (UTF-8 byte offsets) and sqlglot (code points), so click-to-source
  stays correct on lines with non-ASCII characters.
- **Confidence** is `certain` (proven by static analysis), `inferred` (plausible: heuristics,
  f-string SQL, type inference) or `unresolved` (target unknown). The UI draws them as solid, dashed
  and dotted lines.
- **Unresolved placeholders.** A target that cannot be resolved becomes a node of kind `unresolved`
  with a required `reason` (enforced by the schema); edges are never silently dropped.
- **Diagnostics** carry a stable `code` and `args`; the UI localizes by code and falls back to the
  English `message`.

TypeScript types are generated with `npm run schema:generate` (`scripts/gen-schema-types.mjs`,
json-schema-to-typescript) into `src/shared/generated/`; CI fails when they are out of date. The
engine uses hand-written standard-library `TypedDict`s that conformance tests check against the
schema. The examples in `shared/examples/` are validated by both test suites.

## Webview

The graph view is one webview panel per window (`readback.graph`, command Readback: Open Graph
View), opened beside the active editor ([ADR 008](adr/008-webview.md)).

- **Options:** scripts enabled; forms and command URIs disabled; `retainContextWhenHidden` off (the
  page is cheap to rebuild and announces itself with `ready` after every reload);
  `localResourceRoots` is `dist/webview` only, never the workspace.
- **HTML** (`src/views/webviewHtml.ts`): no inline script or style. The page has the CSP `<meta>`,
  a stylesheet link to `main.css`, the boot data as HTML-escaped JSON in the `data-boot` attribute
  of `<meta id="readback-boot">` (view, locale, l10n bundle, worker URI), the root element and one
  script tag carrying the nonce.
- **Content Security Policy**, exactly:
  `default-src 'none'; script-src 'nonce-<NONCE>'; style-src <cspSource>; connect-src <cspSource>; worker-src blob:; base-uri 'none'; form-action 'none';`
  with a fresh 128-bit nonce for every render. There is no `'unsafe-inline'` or `'unsafe-eval'`:
  React 19 and React Flow work without them, and the CSS is loaded as a file. `base-uri` and
  `form-action` are listed because they do not fall back to `default-src`.
- **Worker:** webviews can only start workers from `blob:` or `data:` URLs. The page fetches
  `dist/webview/layout.worker.js` (allowed by `connect-src`), creates a Blob URL and starts a
  classic worker from it. The worker never loads anything itself (no `import()`, `importScripts()`
  or `fetch()`): VS Code does not support that, and since 1.118 such requests hang
  (microsoft/vscode#315494). In Phase 0 the worker answers a ping and the page reports
  `workerReady` with the round-trip time; the ELK layout arrives in Phase 1.
- **Messages** (`src/shared/webviewProtocol.ts`): host to webview `setGraph`; webview to host
  `ready`, `workerReady`, `workerError`, `cspViolation` and `error`. Both sides validate messages
  with type guards. The page forwards every `securitypolicyviolation` event, so the integration
  test can assert that there are none.
- **Theme:** `theme.css` maps VS Code's `--vscode-*` variables onto the page and onto React Flow's
  `--xy-*` variables, each with a fallback, because VS Code defines a variable only if the theme has
  that color. High contrast themes (`vscode-high-contrast`, `vscode-high-contrast-light`) get
  thicker strokes and contrast borders, `vscode-reduce-motion` turns animations off, and the change
  status is never shown by color alone (symbols and line styles as well).
- **Text only:** identifiers from analyzed code are rendered as text; ESLint rejects
  `dangerouslySetInnerHTML`, `innerHTML` and similar APIs in webview code.

## Localization

English is the base language and German is complete (spec sections 0 and 8).

- **Manifest strings:** `package.nls.json` and `package.nls.de.json`, referenced as `%key%` in
  `package.json`. Keys use only letters, digits, `_` and `.` (vsce replaces nothing else).
- **Runtime strings:** `vscode.l10n.t('<literal English>')` in host code and
  `l10n.t('<literal English>')` from `@vscode/l10n` in webview code, with placeholders `{0}`, `{1}`
  or `{name}`. The strings must be literals: `npm run l10n:export` extracts them into
  `l10n/bundle.l10n.json`, which is generated and never edited. The German translations live in
  `l10n/bundle.l10n.de.json`.
- **Webview:** the host passes `vscode.l10n.bundle` in the boot data, and the webview configures
  `@vscode/l10n` with it before the first render. It never fetches translations.
- **Checks:** `test/repo/l10n.test.ts` requires the same keys and placeholders in English and
  German; CI re-exports the bundle and fails on a difference.
- VS Code only loads `bundle.l10n.<language>.json` and shows German only with the German language
  pack installed; `--locale de` alone has no effect on extension strings.

## Build, packaging and vendoring

- **Bundles** (`esbuild.mjs`): `src/extension.ts` → `dist/extension.js` (CommonJS, `node22`);
  `webview/src/main.tsx` → `dist/webview/main.js` and `main.css` (IIFE, `chrome138`);
  `webview/worker/layout.worker.ts` → `dist/webview/layout.worker.js` (IIFE, `chrome138`). Node 22
  and Chromium 138 are the oldest runtimes for `engines.vscode` ^1.105.0 (Electron 37), and
  CommonJS is used because Cursor 2.1 to 2.3 could not load ESM extensions. Development builds have
  linked source maps; `--production` minifies and drops them. Every build writes its esbuild
  metafile to `out/meta/<bundle>.json`. `--watch` serves the F5 launch configuration and `--tests`
  also bundles the integration tests into `out/test`.
- **Vendoring** ([ADR 007](adr/007-vendoring.md)): `npm run vendor` runs `scripts/vendor_engine.py`.
  It downloads the hash-pinned pure-Python wheels listed in `engine/requirements-vendor.txt`
  (sqlglot 30.27.0, jedi 0.20.1, parso 0.8.7) into `.cache/vendor-wheels`, unpacks them into
  `engine/vendor/` (not committed), removes `jedi/third_party/typeshed/stubs` and
  `jedi/third_party/django-stubs`, keeps every license file and writes
  `engine/vendor/VENDOR.json`. `npm run vendor:check` verifies the folder. Nothing is installed
  with pip at runtime.
- **Notices and license gate** ([ADR 009](adr/009-license-policy.md)): `npm run notices`
  (`scripts/notices.mjs`) collects every npm package that contributes code to a bundle (from the
  metafiles, including transitive dependencies) and every vendored Python package (from
  `VENDOR.json`). It checks each declared SPDX license against the allowlist and writes
  `THIRD_PARTY_NOTICES.md` with the full license texts. `npm run notices:check` fails when a
  license is not allowed, a license text is missing or the committed file is out of date.
- **Packaging:** `npm run package` runs `vsce package --pre-release --no-dependencies`; the bundles
  contain all JavaScript, so `node_modules` is not shipped. vsce first runs `vscode:prepublish`:
  `scripts/clean.mjs pycache`, `vendor:check`, `build:prod` (which deletes `dist/` first),
  `notices:check`. `.vscodeignore` is an allowlist (the manifest and its translations, the German
  runtime bundle, the bundles, `engine/run_engine.py`, the `.py` files of `engine/readback_engine/`,
  `engine/vendor/`, README, CHANGELOG, LICENSE and the notices). vsce includes a file as soon as any
  `!` pattern matches, so exclusions after an allow pattern have no effect; the clean steps make sure
  no source maps or Python bytecode exist when packaging, and CI rejects a VSIX that contains them.
- **Bytecode cache:** CPython writes `__pycache__` next to the engine files when the engine first
  runs. If the extension folder is read-only (detected by creating a temporary folder in it, because
  `fs.access()` reports every directory as writable on Windows), the engine runs with
  `-X pycache_prefix=<globalStorage>/pycache/<version>` instead.

## Testing

| Layer           | Tool                                                                     | Location                                                                                           | Command                    |
| --------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- | -------------------------- |
| Extension host  | Vitest (node); `vscode` aliased to `test/stubs/vscode.ts`                | `src/**/*.test.ts`                                                                                 | `npm run test:unit`        |
| Webview         | Vitest (jsdom) and Testing Library; polyfills in `webview/test/setup.ts` | `webview/**/*.test.{ts,tsx}`                                                                       | `npm run test:unit`        |
| Repository      | Vitest (node)                                                            | `test/repo/`: manifest rules, l10n parity, version sync, schemas and generated types, license gate | `npm run test:unit`        |
| Engine          | pytest with coverage (at least 85 %), ruff, mypy (strict)                | `engine/tests/`                                                                                    | `npm run test:engine`      |
| Integration     | `@vscode/test-cli`, `@vscode/test-electron`, Mocha (TDD)                 | `test/integration/` with the workspace `test/fixtures/workspace`                                   | `npm run test:integration` |
| Restricted Mode | `scripts/test-untrusted.mjs`                                             | `test/untrusted/`                                                                                  | `npm run test:untrusted`   |

- **Unit tests** keep logic out of modules that import `vscode`, so most code runs under Vitest
  with a small stub; the engine connection is tested against a fake engine
  (`test/fixtures/fakeEngine.cjs`).
- **Integration tests** run inside a downloaded VS Code with `--disable-extensions`. The Python
  extension is therefore absent and the PATH fallback is exercised, as the Phase 0 acceptance
  criteria require. Hidden `readback._test.*` commands expose engine and panel state to the tests.
  The graph view test waits for `ready`, `workerReady` and zero CSP violations.
- **Restricted Mode launcher:** `@vscode/test-electron` always passes `--disable-workspace-trust`,
  so every workspace it opens is trusted. `scripts/test-untrusted.mjs` downloads VS Code through
  test-electron but starts it itself with Workspace Trust enabled and a fresh profile. It opens a
  temporary workspace whose settings point `readback.engine.pythonPath` at a fake
  `.venv/bin/python` that leaves a marker file when executed. The tests check that the setting is
  ignored, that the Python extension is skipped, that the engine runs sandboxed with an outside
  interpreter, and that the marker never appears. It runs on Linux and macOS only.
- **CI** ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)) runs on every push and pull
  request:

  | Job         | Runs on                                          | What                                                                                                                                 |
  | ----------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
  | lint        | Ubuntu                                           | ESLint, Prettier, type check, schema types, l10n bundle freshness                                                                    |
  | unit        | Ubuntu, Windows, macOS                           | Vitest; coverage report on Ubuntu                                                                                                    |
  | engine      | Ubuntu, Windows, macOS × Python 3.10, 3.15       | vendoring and its check, ruff, ruff format, mypy, pytest with coverage                                                               |
  | integration | Ubuntu, Windows, macOS × VS Code 1.105.1, stable | build and integration tests (Linux under `xvfb-run`)                                                                                 |
  | untrusted   | Ubuntu, VS Code stable                           | the Restricted Mode launcher under `xvfb-run`                                                                                        |
  | package     | Ubuntu                                           | `vsce package` (with the license gate); fails on tests, fixtures, source maps or more than 2,000 files in the VSIX; uploads the VSIX |

- **Manual checks:** German strings with the German language pack, and the editors that
  test-electron cannot drive (Cursor, Windsurf, Kiro, VSCodium) before each release.

## Known limits of the development sandbox

The cloud sandbox used for development cannot run everything CI runs:

- Integration and Restricted Mode tests need to download VS Code. `update.code.visualstudio.com`
  redirects to `vscode.download.prss.microsoft.com`, which the sandbox blocks, so these tests run in
  CI or on a local machine only.
- Installing extensions in tests (the German language pack, `ms-python.python`) needs the
  Marketplace CDN hosts `*.gallery.vsassets.io` and `*.gallerycdn.vsassets.io`, which are blocked as
  well.
- There is no Chromium in the sandbox, so webview code runs only under jsdom there. The blob worker
  and the CSP are verified by the integration test in CI.
