# Changelog

All notable changes to Hearback are documented in this file. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Versions 0.x are published as
pre-releases.

## [Unreleased]

Phase 0 (foundation). Nothing has been released yet.

### Added

- Extension `lldeters.hearback` ("Hearback – Understand AI-Written Code") for VS Code 1.105 or
  newer and compatible editors. It activates only through its commands, runs on the workspace side
  in remote sessions and supports untrusted workspaces in a limited mode.
- Analysis engine for CPython 3.10 or newer: one sandboxed process per window, started on first
  use, speaking JSON-RPC 2.0 over stdio with the `engine/initialize` handshake. Before it loads its
  server, an audit hook blocks process creation (`multiprocessing` included), network access and
  `ctypes`. The engine restarts automatically with backoff after a crash or when it stops
  responding, and shuts down in an orderly way.
- Interpreter discovery: `hearback.engine.pythonPath`, then the active environment of the Python
  extension if it is installed, then `python3` or `python` on `PATH` (`py -3` on Windows). Every
  candidate is checked for CPython 3.10 or newer, and problems come with the actions Select
  Interpreter…, Manage Workspace Trust and Show Log.
- Restricted Mode: the interpreter setting from workspace settings is ignored, and interpreters
  inside the workspace are never started.
- One-time confirmations per workspace and path, also in trusted workspaces and in editors without
  Workspace Trust: for an interpreter path from workspace settings, and for an interpreter that the
  Python extension selected inside the workspace, such as a committed `.venv`. Hearback asks before
  anything runs and only when you started the engine through a command. Without a confirmation it
  moves on to the next source, and Show Engine Status says why.
- Commands Hearback: Show Engine Status, Select Python Interpreter, Restart Engine, Show Log and
  Open Graph View. Show Engine Status reports the interpreter and where it came from, the versions,
  the sandbox and trust state and every rejected candidate with the reason, and says so when the
  engine does not respond. Select Python Interpreter lists the interpreters it found, accepts a
  typed or browsed path, saves the choice in the user settings and offers to ignore a value from
  workspace settings that would override it.
- Settings `hearback.engine.pythonPath` and `hearback.engine.timeoutMs`.
- Graph view with an empty React Flow canvas, VS Code theme support including high contrast, a
  strict Content Security Policy and a check of the layout worker.
- Graph schema and engine protocol schema (JSON Schema 2020-12) with generated TypeScript types
  and checked Python types.
- English user interface with a complete German translation.
- Vendored engine dependencies (sqlglot 30.27.0, jedi 0.20.1, parso 0.8.7), pinned by hash.
- License gate and generated `THIRD_PARTY_NOTICES.md` for all bundled and vendored packages.
- Continuous integration on Linux, Windows and macOS: lint, unit tests, engine tests on Python
  3.10 and 3.15, integration tests on VS Code 1.105.1 and stable, Restricted Mode tests, and
  packaging with a completeness check of the VSIX and a run of the packaged engine.
- Documentation: README, architecture overview, architecture decision records 001 to 011,
  security policy and agent guidelines (`CLAUDE.md`).

### Changed

- The working title Readback was replaced by Hearback because that name is already taken in the
  Visual Studio Marketplace ([ADR 010](docs/adr/010-product-name.md)).
- An interpreter that the Python extension selects inside the workspace no longer runs without a
  prompt in trusted workspaces; it needs the one-time confirmation described above
  ([ADR 011](docs/adr/011-workspace-interpreter-confirmation.md)).

[Unreleased]: https://github.com/lldeters/Readback/commits/main
