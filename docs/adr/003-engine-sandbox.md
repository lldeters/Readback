# ADR 003: Engine process isolation and sandbox

- Status: Accepted
- Date: 2026-10-31

## Context

The engine runs a Python interpreter that Hearback found on the user's machine, next to code that
may come from an untrusted repository. The spec requires that the engine only parses, imports no
network modules and never runs user code (sections 4, 5.2 and 8), and that nothing is installed
with pip at runtime. Experiments on Python 3.10 to 3.15 found:

- `-I` (isolated mode) ignores `PYTHON*` variables and the user site directory and keeps both the
  script directory and the working directory off `sys.path`. It does not imply `-S`: with `-I`
  alone, `.pth` files in site-packages still run.
- `-S` skips the `site` module, so site-packages, `.pth` files and `sitecustomize` neither load nor
  run.
- Under `-I`, `PYTHONUTF8` and `PYTHONIOENCODING` are ignored; `-X utf8` still works. UTF-8 mode
  becomes the default only in Python 3.15 (PEP 686). On Windows the text-mode `sys.stdout` turns
  `\n` into `\r\n`.
- A stray `print()` on stdout corrupts the JSON-RPC framing.
- Jedi's default environment starts a Python subprocess; `jedi.InterpreterEnvironment()` does not.
  sqlglot loads third-party dialect plugins through entry points for unknown dialect names.
- The vendored libraries import network and process modules transitively without using them:
  sqlglot imports `importlib.metadata`, which imports `email` and, on Python 3.10 to 3.12,
  `socket`; jedi and parso import `subprocess`. A rule against importing such modules cannot hold.
- `multiprocessing` (and with it `ProcessPoolExecutor`) starts spawn children, the fork server and
  its resource tracker through `_posixsubprocess.fork_exec`, not through `subprocess.Popen`. Only
  Python 3.14 and later raise an audit event (`_posixsubprocess.fork_exec`) there.

## Decision

- The extension starts the engine as `<python> -I -S -X utf8 <extensionPath>/engine/run_engine.py`
  with the working directory `<extensionPath>/engine`, no shell, a hidden window on Windows and an
  environment without `PYTHON*`, `VIRTUAL_ENV`, `CONDA_PREFIX` (and the other conda activation
  variables) and `__PYVENV_LAUNCHER__`.
- `run_engine.py` stays parseable by old Python versions so it can report a version that is too
  old. It checks the version (exit code 3 with a `HEARBACK_ENGINE_FATAL` line on stderr), puts
  `engine/` and `engine/vendor/` on `sys.path`, installs the audit hook and only then imports and
  starts the server, so the module-level code of the server and of everything it imports already
  runs under the hook. Any other startup failure, an error while installing the hook included,
  exits with code 4 and the same kind of line.
- The server claims stdout for the protocol: it keeps a private duplicate of file descriptor 1 for
  JSON-RPC and points descriptor 1 at stderr, so stray output ends up in the log.
- An audit hook (`sys.addaudithook`) blocks process creation (`subprocess.Popen`, `os.system`,
  `os.exec*`, `os.spawn*`, `os.posix_spawn`, `os.fork`, `os.forkpty`, `os.startfile`, `pty.spawn`,
  `_winapi.CreateProcess`, `_posixsubprocess.fork_exec`), sockets (`socket.connect`, `socket.bind`,
  `socket.getaddrinfo`, …) and `ctypes`. On POSIX the sandbox also wraps
  `_posixsubprocess.fork_exec` so that every call raises the `_posixsubprocess.fork_exec` event
  first, on every Python version. A probe event confirms that the hook runs. The server asks the
  sandbox again, which adds no second hook and returns the verified state; `engine/initialize`
  reports it as `sandboxed`.
- The engine exits at end of stdin, so it cannot outlive the extension host.
- **Approved interpretation of "imports no network modules" (spec 5.2):** the engine never opens
  sockets and never starts processes. This is enforced three ways: by the audit hook at runtime, by
  ruff's `banned-api` rule for the engine's own code (`engine/pyproject.toml`) and by a test.
- From Phase 1, Jedi runs in-process with `jedi.InterpreterEnvironment()`, and SQL dialect names are
  checked against sqlglot's built-in dialects before any lookup.

## Consequences

- Start-up and results do not depend on the user's Python environment, and nothing from it runs.
- Output from libraries cannot break the protocol; a library that tries to start a process or open
  a connection fails loudly instead.
- The audit hook is defense in depth, not a security boundary: native code can bypass it. The real
  guarantee is that the engine parses and never imports or executes user code.
- The engine can never use subprocesses or process pools (`multiprocessing`, `ProcessPoolExecutor`),
  so Jedi features that need another interpreter are out, and parallel work has to use threads.
- Under `-S`, Jedi does not see the project's site-packages. Phase 1 may pass virtual environment
  paths explicitly, computed without running `.pth` files and only in trusted workspaces.

## Alternatives considered

- **Running the interpreter with its normal start-up:** results would depend on installed packages,
  and `.pth` files and `sitecustomize` from the user's environment would run.
- **A private virtual environment with packages installed at runtime:** needs network access and
  time on first use; the spec forbids pip at runtime.
- **Operating-system sandboxes** (seccomp, `sandbox-exec`, AppContainer): different on every
  platform and not available in every editor's extension host.
- **Taking "imports no network modules" literally:** impossible with sqlglot, jedi and parso
  without patching vendored code, which would break the hash-verified vendoring
  ([ADR 007](007-vendoring.md)).
