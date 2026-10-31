# ADR 004: Interpreter discovery and Restricted Mode

- Status: Accepted
- Date: 2026-10-31

## Context

Spec section 5.2 sets the order: the setting `readback.engine.pythonPath`, then the active
environment of the Python extension through `@vscode/python-extension` (if installed), then
`python3` or `py -3` on PATH, each checked for Python 3.10 or newer. In Restricted Mode,
`readback.engine.pythonPath` from workspace settings must be ignored (section 8).

Microsoft's
[Python tools extension template](https://github.com/microsoft/vscode-python-tools-extension-template)
also requires 3.10, but it forces the Python extension through `extensionDependencies`, starts
eagerly and has no PATH fallback. The `@vscode/python-extension` facade throws when the Python
extension is missing or disabled (also in Restricted Mode, where `ms-python.python` declares
`untrustedWorkspaces.supported: false`) and waits for its activation without a timeout.

Research and experiments found three ways in which a repository could make Readback run a program
of its choice:

1. **Cursor ships with Workspace Trust disabled** (reported by Oasis Security in September 2025,
   see [Help Net Security](https://www.helpnetsecurity.com/2025/09/11/cursor-ai-editor-vulnerability/)).
   With trust disabled every folder counts as trusted, so `restrictedConfigurations` never removes
   a malicious `.vscode/settings.json` value there.
2. **A workspace virtual environment runs attacker code even under `-I -S`.** A `.venv/bin/python`
   symlink to a trusted system Python still reads the workspace's `pyvenv.cfg`. Its `home` key can
   point the standard library at attacker files (for example `encodings/__init__.py`), which run at
   start-up. Checking only the real path of the binary is therefore not enough, and probing such an
   interpreter is already code execution.
3. **On Windows, `spawn()` with a bare command name searches the current directory before PATH**
   (libuv's [`search_path`](https://github.com/libuv/libuv/blob/v1.x/src/win/process.c)), so
   `spawn('python', …, { cwd: workspace })` would run `<workspace>/python.exe`.

Further pitfalls: the Microsoft Store's "App execution aliases" for `python.exe` only open the
Store, the macOS `/usr/bin/python3` stub opens an installation dialog when the developer tools are
missing, and the Windows Python install manager can download a runtime when asked for a version.

## Decision

- **Order:** `readback.engine.pythonPath` (scope `machine-overridable`, listed in
  `restrictedConfigurations`); then the Python extension's active environment through
  `@vscode/python-extension`, only if `ms-python.python` is installed, with timeouts (10 s for the
  API, 5 s for resolving the environment) and without `extensionDependencies`; then PATH (Windows:
  `py -3`, `python`, `python3`; elsewhere: `python3`, `python`).
- **Readback searches PATH itself:** absolute directories only, `.exe` files on Windows, Store
  aliases and the macOS stub skipped. Every candidate is probed with `-I -S -c <probe>` from
  `<extensionPath>/engine`, without a shell; it must be CPython 3.10 or newer. The engine is
  started with the probed `sys.executable`.
- **A configured setting that cannot be used stops the resolution** with an error naming the
  setting, instead of silently falling back to another interpreter.
- **Restricted Mode:** workspace values of `readback.engine.pythonPath` are ignored (VS Code drops
  them because of `restrictedConfigurations`), the Python extension is skipped, and any candidate
  whose invoked path or real path lies inside a workspace folder is rejected before anything is
  spawned. The engine still runs with an interpreter from outside the workspace.
- **Approved addition:** a `readback.engine.pythonPath` from workspace or folder settings is used
  only after a one-time confirmation per (workspace, path), stored in `globalState`, whether or not
  the workspace is trusted. This closes that setting's gap in editors without Workspace Trust.
- Readback: Select Python Interpreter writes the chosen path to the user settings, never to the
  workspace. Workspace and folder values take precedence over user settings, so when one is set the
  picker asks first: ignore it in this workspace (stored in `globalState`, no further questions) or
  open the workspace settings. Interpreters that failed the probe are listed but cannot be picked.
- The Python Environments extension (`@vscode/python-environments`) is not used in Phase 0.

## Consequences

- Readback works without the Python extension and in Restricted Mode. In an untrusted workspace a
  cloned repository cannot make it run a program from the repository at all, and a
  `readback.engine.pythonPath` in workspace settings never runs without the user's consent, in
  trusted workspaces and in editors without Workspace Trust too.
- **Known limit:** in a trusted workspace (and therefore always in editors that ship with Workspace
  Trust disabled, such as Cursor), Readback uses the Python extension's active environment as that
  extension chose it, without a prompt. A repository can steer that choice, for example with a
  committed `.venv` or `python.defaultInterpreterPath`, and the Python extension itself runs that
  interpreter too. Extending the confirmation to such interpreters inside the workspace would need
  the owner's decision.
- Readback: Show Engine Status can explain exactly which source was used and why the other
  candidates were rejected.
- Per-project interpreters cost one extra confirmation; after declining, the user-level value
  applies until the question comes up again in a later session.
- The PATH fallback can pick a different Python than the user's terminal; the status shows the
  source and path.
- The Python extension can take seconds to activate. After a timeout the session continues with the
  next source until the next resolution.

## Alternatives considered

- **Workspace Trust only, as the spec describes:** unsafe in editors that disable trust.
- **Scope `machine` for the setting:** repositories could never set it, but per-project
  interpreters would be lost.
- **`extensionDependencies` on `ms-python.python`:** forces an installation, disables Readback in
  Restricted Mode and contradicts "runs everywhere" (spec 2.5).
- **The Python Environments API:** needs VS Code 1.110 and the opt-in setting
  `python.useEnvironmentsExtension`; to be revisited later.
- **Letting `spawn()` search PATH:** runs executables from the working directory on Windows and
  can trigger the Store alias or the macOS installation dialog.
