# Changelog

All notable changes to Readback are documented in this file. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Versions 0.x are published as
pre-releases.

## [Unreleased]

Phase 0 (foundation). Nothing has been released yet.

### Added

- Extension `lldeters.readback-code` ("Readback – Understand AI-Written Code") for VS Code 1.105 or
  newer and compatible editors. It activates only through its commands, runs on the workspace side
  in remote sessions and supports untrusted workspaces in a limited mode.
- Analysis engine for CPython 3.10 or newer: one sandboxed process per window, started on first
  use, speaking JSON-RPC 2.0 over stdio with the `engine/initialize` handshake. It restarts
  automatically with backoff after a crash and shuts down in an orderly way.
- Interpreter discovery: `readback.engine.pythonPath`, then the active environment of the Python
  extension if it is installed, then `python3` or `python` on `PATH` (`py -3` on Windows). Every
  candidate is checked for CPython 3.10 or newer, and problems come with the actions Select
  Interpreter…, Manage Workspace Trust and Show Log.
- Restricted Mode: the interpreter setting from workspace settings is ignored, and interpreters
  inside the workspace are never started. An interpreter path from workspace settings needs a
  one-time confirmation in every workspace.
- Commands Readback: Show Engine Status, Select Python Interpreter, Restart Engine, Show Log and
  Open Graph View.
- Settings `readback.engine.pythonPath` and `readback.engine.timeoutMs`.
- Graph view with an empty React Flow canvas, VS Code theme support including high contrast, a
  strict Content Security Policy and a check of the layout worker.
- Graph schema and engine protocol schema (JSON Schema 2020-12) with generated TypeScript types
  and checked Python types.
- English user interface with a complete German translation.
- Vendored engine dependencies (sqlglot 30.27.0, jedi 0.20.1, parso 0.8.7), pinned by hash.
- License gate and generated `THIRD_PARTY_NOTICES.md` for all bundled and vendored packages.
- Continuous integration on Linux, Windows and macOS: lint, unit tests, engine tests on Python
  3.10 and 3.15, integration tests on VS Code 1.105.1 and stable, Restricted Mode tests and
  packaging.
- Documentation: README, architecture overview, architecture decision records 001 to 009,
  security policy and agent guidelines (`CLAUDE.md`).

[Unreleased]: https://github.com/lldeters/Readback/commits/main
