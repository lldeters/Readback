# Readback

**Readback correct.**

Readback is an extension for VS Code and the editors that use Open VSX. It helps you understand
code that AI agents wrote. Deterministic, interactive visualizations of Python and SQL show what
the code does and what changed since a base such as the last commit. An optional comprehension
mode builds on them later: it marks changes you have not yet understood and lets you unlock them
with short checks, as strictly as you choose.

The name comes from aviation. Pilots read safety-critical instructions back to air traffic control,
which listens and corrects any misunderstanding. Readback does the same for AI-written code: the
AI delivers the code, you read it back through visualizations and checks, and the extension checks
your understanding against static analysis.

## Status

Readback is in **Phase 0 (foundation)** and has not been released. Nothing is published on the
Visual Studio Marketplace or Open VSX yet.

Phase 0 provides the base that the visualizations build on:

- the analysis engine with its handshake, interpreter discovery with clear error messages and the
  command Readback: Show Engine Status;
- an empty graph view with theme support and a strict Content Security Policy;
- the graph schema that the engine, the extension and the webview share.

The first visualizations (class anatomy, call graph, control flow, module graph, each with the
changes since a Git base) follow in Phase 1 as the pre-release 0.1.0.

## Privacy

- The analysis runs locally and offline, by parsing your code. Readback never executes it.
- Readback collects no telemetry and has no accounts or backend.
- LLM features arrive in a later phase. They will send code only after you explicitly agree, with a
  preview of what is sent.

## Requirements

- VS Code 1.105 or newer, or a compatible editor such as Cursor, Windsurf, Kiro or VSCodium.
- CPython 3.10 or newer, found on `PATH` (`python3` or `python`; `py -3` on Windows), selected as
  the active environment in the Python extension, or set in `readback.engine.pythonPath`. The Python
  extension is optional. Readback runs the interpreter in isolated mode with its own bundled
  packages, so nothing needs to be installed into it.

## Commands

| Command                             | What it does                                                                                                                                                                                          |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Readback: Show Engine Status        | Starts the engine if needed and shows the interpreter and where it came from, the Python, engine and bundled package versions, the sandbox and trust state and every interpreter that was considered. |
| Readback: Select Python Interpreter | Lists the interpreters Readback found, lets you browse for another one or return to automatic detection, and saves the choice in your user settings.                                                  |
| Readback: Restart Engine            | Restarts the engine, also after automatic restarts were paused.                                                                                                                                       |
| Readback: Show Log                  | Opens the "Readback" output channel.                                                                                                                                                                  |
| Readback: Open Graph View           | Opens the graph view (still empty in Phase 0).                                                                                                                                                        |

## Settings

| Setting                      | Default | Description                                                                                                                                                                                                  |
| ---------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `readback.engine.pythonPath` | empty   | Python interpreter (3.10 or newer) for the analysis engine. When empty, Readback uses the Python extension's active environment, then `PATH`. A value from workspace settings needs a one-time confirmation. |
| `readback.engine.timeoutMs`  | `30000` | Timeout in milliseconds for a single engine request (1,000 to 600,000).                                                                                                                                      |

In an untrusted workspace (Restricted Mode), Readback keeps working but ignores
`readback.engine.pythonPath` from workspace settings, does not consult the Python extension and
never runs an interpreter that lies inside the workspace.

## Development

You need Node.js 24 (see `.nvmrc`), CPython 3.10 or newer and Git.

```sh
npm ci
npm run vendor   # downloads the pinned engine dependencies into engine/vendor/
```

Open the folder in VS Code and press F5 to start **Run Extension**: the pre-launch task builds the
bundles in watch mode and opens an Extension Development Host. **Run Extension (other extensions
disabled)** starts it without the Python extension, which exercises the `PATH` fallback.

```sh
npm test             # unit, webview and repository tests, then integration tests in VS Code
npm run test:unit    # Vitest only
npm run lint         # ESLint and Prettier
npm run typecheck
```

The engine has its own tooling. In a virtual environment, for example `engine/.venv`:

```sh
cd engine
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements-dev.txt   # Windows: .venv\Scripts\python
.venv/bin/python -m pytest
.venv/bin/ruff check . && .venv/bin/ruff format --check . && .venv/bin/mypy
```

[`CLAUDE.md`](CLAUDE.md) lists every command and the project's conventions;
[`docs/architecture.md`](docs/architecture.md) explains the design, and
[`docs/adr/`](docs/adr/README.md) records the decisions behind it.

## Repository layout

```text
src/                 extension host (TypeScript)
  engine/            engine lifecycle, connection, interpreter discovery, commands
  views/             webview panels
  shared/            contracts shared with the webview, generated schema types
webview/             React app (src/), layout worker (worker/), component tests (test/)
engine/              Python analysis engine
  run_engine.py      bootstrap started by the extension
  readback_engine/   engine package
  tests/             engine tests
  vendor/            vendored dependencies (generated by npm run vendor)
shared/              JSON Schemas for the graph and the engine protocol, with examples
scripts/             build, schema, vendoring, license notice and test launcher scripts
test/                integration, Restricted Mode and repository tests, fixtures, vscode stub
docs/                architecture overview and decision records
.github/workflows/   continuous integration
```

## License

Readback is released under the [MIT License](LICENSE). The third-party software it ships and their
licenses are listed in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md). To report a security
problem, see [`SECURITY.md`](SECURITY.md).
