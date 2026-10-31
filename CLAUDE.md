# CLAUDE.md

Guidance for AI coding agents working on this repository. Keep it current when commands,
conventions or phases change.

## Project

Readback is a VS Code and Open VSX extension (Cursor, Windsurf, Kiro, VSCodium) that helps
developers understand AI-written Python and SQL through deterministic static-analysis
visualizations; an optional comprehension mode follows in later phases.

- Extension ID `lldeters.readback-code` (package name `readback-code`, publisher `lldeters`),
  display name "Readback – Understand AI-Written Code", command category `Readback`, settings
  prefix `readback.`, per-repository work folder `.readback/`.
- Three parts: the extension host (TypeScript, `src/`), a sandboxed Python analysis engine
  (`engine/`, CPython 3.10 or newer, JSON-RPC 2.0 over stdio) and a React webview (`webview/`).
  The contracts are the JSON Schemas in `shared/`.
- Current state: Phase 0 (foundation). Phase 1 brings the Python visualizations (release 0.1.0,
  pre-release), Phase 2 SQL and dbt, Phase 3 the comprehension ledger and checks, Phase 4 the
  commit gate and agent hooks, Phase 5 LLM-assisted checks.
- Read [`docs/architecture.md`](docs/architecture.md) for the design and
  [`docs/adr/`](docs/adr/README.md) for the decisions behind it.

## Working rules

These come from section 0 of the product specification and apply to every change:

1. Work strictly in phases. Before each phase, present a plan (affected files, decisions, risks,
   open questions) and wait for the owner's approval.
2. At the end of each phase: all tests green, `CHANGELOG.md` updated, a short "how to try it"
   guide, then stop.
3. Check APIs against current documentation instead of memory, especially the VS Code extension
   API, `@vscode/python-extension`, sqlglot (pinned, it changes often), Jedi, elkjs,
   `@xyflow/react`, the agents' hook formats, vsce and ovsx.
4. Record architecture decisions as short ADRs in `docs/adr/`. Never deviate from the
   specification silently; propose a better way with reasons and wait for the owner's OK.
5. Prefer maintained libraries to custom code, and only permissive licenses
   ([ADR 009](docs/adr/009-license-policy.md)).
6. Make small, focused commits following Conventional Commits. Never commit secrets.
7. Ask instead of guessing when the specification is unclear or contradictory.
8. Never publish to a marketplace (Visual Studio Marketplace, Open VSX) on your own, and never write
   to the user's Git or AI agent configuration without the user's confirmation.
9. Answer the owner in German. Write code, comments, UI base strings and documentation in English,
   and keep the German localization complete.

## Commands

Node 24 (`.nvmrc`) and npm. Install with `npm ci`; never add, remove or upgrade dependencies
without approval.

| Command                    | Purpose                                                                                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm run build`            | Type check, then development bundles in `dist/` (linked source maps) and metafiles in `out/meta/`.                                               |
| `npm run build:prod`       | Deletes `dist/`, then minified bundles without source maps, as packaged.                                                                         |
| `npm run watch`            | Incremental rebuilds; the F5 pre-launch task.                                                                                                    |
| `npm run typecheck`        | `tsc -p` for `src`, `webview`, `webview/worker`, `test` and `test/repo`.                                                                         |
| `npm run lint`             | ESLint, then `prettier --check .`.                                                                                                               |
| `npm run format`           | `prettier --write .`.                                                                                                                            |
| `npm test`                 | Unit tests, then integration tests.                                                                                                              |
| `npm run test:unit`        | Vitest projects `extension`, `webview` and `repo`; one project: `npx vitest run --project repo`.                                                 |
| `npm run test:coverage`    | Unit tests with V8 coverage in `coverage/`.                                                                                                      |
| `npm run test:integration` | Bundles the tests into `out/test` and runs them in VS Code (`VSCODE_TEST_VERSION`, default `stable`; CI uses `1.105.1` too).                     |
| `npm run test:untrusted`   | Restricted Mode tests through `scripts/test-untrusted.mjs` (Linux and macOS; `xvfb-run -a` on headless Linux).                                   |
| `npm run test:engine`      | `pytest` for the engine through `scripts/python.mjs` (`READBACK_PYTHON` selects the interpreter).                                                |
| `npm run vendor`           | Downloads and unpacks the pinned engine dependencies into `engine/vendor/`.                                                                      |
| `npm run vendor:check`     | Verifies `engine/vendor/` against the pins.                                                                                                      |
| `npm run schema:generate`  | Regenerates `src/shared/generated/*.ts` from `shared/*.json`.                                                                                    |
| `npm run schema:check`     | Fails if the generated types are out of date.                                                                                                    |
| `npm run l10n:export`      | Extracts runtime strings into `l10n/bundle.l10n.json`.                                                                                           |
| `npm run notices`          | License gate, then writes `THIRD_PARTY_NOTICES.md` (run `npm run build:prod` first).                                                             |
| `npm run notices:check`    | License gate, and fails if `THIRD_PARTY_NOTICES.md` is out of date.                                                                              |
| `npm run package`          | `vsce package --pre-release --no-dependencies`; `vscode:prepublish` removes engine bytecode, then `vendor:check`, `build:prod`, `notices:check`. |

Engine tooling, from `engine/` with the development requirements installed in a virtual
environment (`python -m pip install -r requirements-dev.txt`, for example in `engine/.venv`):

```sh
ruff check .
ruff format --check .
mypy
python -m pytest --cov --cov-report=term-missing
```

Debugging:

- F5 **Run Extension** starts an Extension Development Host with the watch build; **Run Extension
  (other extensions disabled)** runs without the Python extension, which exercises the PATH
  fallback.
- Readback: Show Log opens the log. Change its level with Developer: Set Log Level… → Readback, or
  start with `code --log lldeters.readback-code:trace`. The engine receives the level too.
- Readback: Show Engine Status shows the interpreter, its source, the versions, the sandbox state
  and every candidate that was rejected, with the reason.
- Hidden `readback._test.*` commands return engine and panel state; the integration tests use them.

## Conventions

- **Commits:** Conventional Commits (`feat:`, `fix:`, `docs:`, `test:`, `build:`, `ci:`,
  `refactor:`, `chore:`), small and focused.
- **Dependencies:** exact versions only (no `^` or `~`), `package-lock.json` committed. A new
  runtime dependency must pass the license gate; regenerate the notices afterwards.
- **TypeScript:** strict. Keep logic in modules that do not import `vscode` so that Vitest can test
  it; keep the editor adapters thin. Tests sit next to the code (`*.test.ts`) or in
  `webview/test/` and `test/repo/`.
- **Localization:** host code uses `vscode.l10n.t('<literal English>')`, webview code uses
  `l10n.t('<literal English>')` from `@vscode/l10n`, with placeholders `{0}`, `{1}` or `{name}`.
  Strings must be literals (no template literals, no variables) so that `npm run l10n:export` can
  extract them. After adding a string, run the export and add the German translation to
  `l10n/bundle.l10n.de.json`. Manifest strings go into `package.nls.json` and
  `package.nls.de.json` as `%key%` with keys made of letters, digits, `_` and `.`.
- **Schema first:** change `shared/graph-schema.json` or `shared/engine-protocol.schema.json` first,
  run `npm run schema:generate`, then update the engine's `TypedDict`s, the conformance tests and
  `shared/examples/`. Incompatible changes bump `schemaVersion` or `PROTOCOL_VERSION` on both sides
  (`test/repo/versions.test.ts` checks them).
- **Versions:** `package.json`, `ENGINE_VERSION` in `engine/readback_engine/__init__.py` and
  `engine/pyproject.toml` carry the same version.
- **Vendoring updates:** change the pin and its SHA-256 in `engine/requirements-vendor.txt` (pure
  wheels only), run `npm run vendor`, rerun the engine's fixture snapshot tests, regenerate the
  notices and commit `THIRD_PARTY_NOTICES.md`. Never commit `engine/vendor/`.
- **Engine code:** standard library plus the vendored packages only. Never start processes, open
  sockets or use `ctypes` (ruff's `banned-api` rule and the audit hook enforce it), and never write
  to stdout, which carries the protocol. Log through stderr.
- **Webview:** render identifiers from analyzed code as text only (ESLint rejects
  `dangerouslySetInnerHTML` and `innerHTML`), no inline scripts or styles, and any new resource
  type needs a deliberate CSP change in `src/views/webviewHtml.ts`.
- **Quiet by default:** no engine start on activation and no popups the user did not trigger.

## Pitfalls

- **TypeScript 6, not 7.** TypeScript 7 has no JavaScript API, which typescript-eslint needs. Keep
  `typescript` at 6.0.3.
- **Import vscode-jsonrpc from `vscode-jsonrpc/node`.** The bare `vscode-jsonrpc` import breaks at
  runtime in version 10.
- **Webview workers only from blob URLs.** Fetch the worker script, create a Blob URL and start a
  classic worker. The worker must never call `import()`, `importScripts()` or `fetch()`: since
  VS Code 1.118 such requests hang (microsoft/vscode#315494).
- **`@vscode/test-electron` always passes `--disable-workspace-trust`.** Integration tests always
  run trusted; Restricted Mode is covered by `npm run test:untrusted` only.
- **`--locale de` needs the German language pack.** Without it extension strings stay English;
  install "German Language Pack for Visual Studio Code" in the development host to check German.
  `test/repo/l10n.test.ts` checks that every string is translated.
- **`@types/vscode` must equal the `engines.vscode` minimum** (1.105.0); vsce refuses newer types,
  and APIs newer than 1.105 must be feature-detected.
- **CommonJS extension bundle.** Cursor 2.1 to 2.3 cannot load ESM extensions, so `package.json`
  has no `"type": "module"`; ESM tool configurations use `.mjs` or `.mts`.
- **The engine starts with `-I -S`.** Neither the script directory nor site-packages are on
  `sys.path` (the bootstrap adds `engine/` and `engine/vendor/`), and `PYTHONUTF8` is ignored, hence
  `-X utf8`.
- **Audit hooks cannot be removed.** Never call `sandbox.install()` in the pytest process: it would
  refuse every later subprocess. Tests install it in a subprocess, and the bootstrap tests pass
  stand-in modules to `run_engine.start()`.
- **Hidden commands do not activate the extension.** `readback._test.*` commands are not contributed,
  so tests must activate the extension first (the root-level hook in
  `test/integration/activation.test.ts` does it for the integration suites).
- **Mocha loads the integration test files in no fixed order.** Never rely on one suite running
  before another; use root-level hooks for global setup.
- **vsce includes a file as soon as any `!` pattern in `.vscodeignore` matches it.** Exclusions after
  an allow pattern have no effect; `scripts/clean.mjs` removes source maps and bytecode before
  packaging, and CI rejects a VSIX that contains them.
- **Integration tests do not run in the cloud sandbox:** the VS Code download host
  (`vscode.download.prss.microsoft.com`) is blocked there. Rely on CI for them.
