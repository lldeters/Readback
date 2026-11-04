# Security policy

## Supported versions

Hearback is in pre-release (0.x) and has not been published yet. Once it is, security fixes are
made for the latest 0.x pre-release only.

| Version                | Supported |
| ---------------------- | --------- |
| Latest 0.x pre-release | Yes       |
| Older 0.x versions     | No        |

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub's private vulnerability reporting: open the
repository's **Security** tab and choose **Report a vulnerability**
(<https://github.com/lldeters/Readback/security/advisories/new>). Do not open a public issue.

Include the Hearback version, the editor and its version, your operating system, steps to
reproduce or a proof of concept, and the impact you expect. You will receive an acknowledgement,
and the fix and its disclosure will be coordinated with you.

## Security model

- **Local analysis.** Hearback analyzes code on your machine by parsing it. It has no backend, no
  accounts and no telemetry, and the analysis needs no network access.
- **The engine never runs your code.** The Python engine only parses (with `ast` and sqlglot). It
  starts in isolated mode (`-I -S -X utf8`) with its own vendored dependencies, so nothing from
  your Python environment runs. Before it loads its server and the analysis libraries, it installs
  an audit hook that blocks process creation (`multiprocessing` included), network sockets and
  `ctypes` inside the engine. The hook is defense in depth, not a security boundary.
- **Interpreter selection.** Hearback runs only the interpreter it found through
  `hearback.engine.pythonPath`, the Python extension or `PATH`, after checking it with a minimal
  probe. Because some editors ship with Workspace Trust disabled, two kinds of interpreter need a
  one-time confirmation per workspace and path, also in trusted workspaces, before Hearback runs
  them at all: a `hearback.engine.pythonPath` from workspace settings, and an interpreter that the
  Python extension selected inside the workspace (a repository can steer that choice, for example
  with a committed `.venv`). Without the confirmation Hearback skips that interpreter and moves on
  to the next source; automatic restarts never ask. Interpreters outside the workspace and your own
  user setting run without a prompt. The Python extension itself may still run the interpreters it
  finds, so open untrusted code in Restricted Mode.
- **Restricted Mode.** In an untrusted workspace, Hearback ignores `hearback.engine.pythonPath` from
  workspace settings, does not consult the Python extension and never starts an interpreter that
  lies inside the workspace; static analysis keeps working.
- **Webview.** The graph view uses a strict Content Security Policy with a nonce, loads no external
  resources, runs no inline scripts and renders identifiers from your code as text only.
- **Later phases.** Git and agent hooks, prediction runs and LLM features will be unavailable in
  untrusted workspaces, and LLM features will send code only after explicit consent.

The comprehension mode planned for later phases (commit gate, limits for AI agents) is a tool for
self-commitment, not a security boundary: bypassing it, for example with `git commit --no-verify`,
is not a vulnerability.
