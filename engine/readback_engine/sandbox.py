"""Audit-hook sandbox: the engine never starts processes, uses the network or loads native code.

Spec 5.2 says the engine only parses. The vendored libraries import socket and subprocess
transitively (sqlglot via importlib.metadata, parso via platform) without using them, so instead
of banning imports the engine refuses the operations at runtime. Together with the ruff
banned-api lint and the import test for the engine's own code this is the approved reading of
"the engine imports no network modules": it never opens sockets and never starts processes.

engine/run_engine.py installs the hook before it imports the server, so the module-level code of
the server and of everything it imports already runs under it. The hook is defense in depth
against libraries that try such operations (jedi spawns an interpreter unless it is configured
not to), not a boundary against hostile code in the engine process. Audit hooks cannot be
removed, so tests install it in subprocesses only.
"""

import functools
import logging
import sys
from collections.abc import Callable
from typing import Any, Final

if sys.platform != "win32":
    import _posixsubprocess  # noqa: TID251 - only the sandbox may use it: install() wraps it

log = logging.getLogger("readback.sandbox")

# _posixsubprocess.fork_exec raises it itself from Python 3.14 on; install() makes it raise the
# event on older versions too (see audited_fork_exec()).
FORK_EXEC_EVENT: Final = "_posixsubprocess.fork_exec"
PROCESS_EVENTS: Final = frozenset(
    {
        "subprocess.Popen",
        "os.system",
        "os.exec",
        "os.posix_spawn",
        "os.spawn",
        "os.fork",
        "os.forkpty",
        "os.startfile",
        "pty.spawn",
        "_winapi.CreateProcess",
        FORK_EXEC_EVENT,
    }
)
NETWORK_EVENTS: Final = frozenset(
    {
        "socket.connect",
        "socket.bind",
        "socket.getaddrinfo",
        "socket.gethostbyname",
        "socket.gethostbyaddr",
        "socket.sendto",
        "socket.sendmsg",
        "urllib.Request",
        "webbrowser.open",
    }
)
NATIVE_CODE_EVENTS: Final = frozenset({"ctypes.dlopen"})
BLOCKED_EVENTS: Final = PROCESS_EVENTS | NETWORK_EVENTS | NATIVE_CODE_EVENTS

# Raised once after installation to prove the hook is really active (see install()).
PROBE_EVENT: Final = "readback.sandbox.probe"
_MAX_ARGUMENT_REPR: Final = 120


class SandboxHook:
    """The audit hook. Raising from it aborts the audited operation in the caller."""

    def __init__(self) -> None:
        self.active = False

    def __call__(self, event: str, args: tuple[object, ...]) -> None:
        if event in BLOCKED_EVENTS:
            log.warning("Sandbox blocked %s (%s).", event, _subject(event, args))
            msg = f"Readback engine sandbox: {event} is not allowed"
            raise PermissionError(msg)
        if event == PROBE_EVENT:
            self.active = True


def install() -> bool:
    """Install the hook process-wide; True if it is verified to be active.

    sys.addaudithook() silently skips the new hook when an existing hook vetoes it, so a probe
    event checks that ours really runs. initialize reports the outcome as ``sandboxed``.
    engine/run_engine.py installs the hook before it imports the server; the call in
    server.main() then adds no second hook and returns the state verified the first time.
    """
    return _installed_hook().active


@functools.cache
def _installed_hook() -> SandboxHook:
    """The hook, added and verified on the first call only, so that the second install()
    neither adds a second hook nor wraps fork_exec twice."""
    hook = SandboxHook()
    sys.addaudithook(hook)
    sys.audit(PROBE_EVENT)
    if sys.platform != "win32":
        # Also if the probe failed: the wrapper only raises the event, the hooks decide.
        _posixsubprocess.fork_exec = audited_fork_exec(_posixsubprocess.fork_exec)
    return hook


def audited_fork_exec(original: Callable[..., int]) -> Callable[..., int]:
    """_posixsubprocess.fork_exec that raises FORK_EXEC_EVENT before every call.

    multiprocessing (and so ProcessPoolExecutor) starts spawn children, the fork server and the
    resource tracker through multiprocessing.util.spawnv_passfds, which calls fork_exec directly
    instead of going through subprocess.Popen. Python 3.10 to 3.13 raise no audit event on that
    path; 3.14 and later raise FORK_EXEC_EVENT in C. The wrapper raises it first, with the same
    arguments, so the hook decides and logs on every version. spawnv_passfds looks fork_exec up
    at each call. subprocess.Popen raises its own event before it calls fork_exec, so its
    behavior does not change.
    """

    def fork_exec(*args: Any) -> int:
        # fork_exec(args, executable_list, close_fds, pass_fds, cwd, env, ...); the native event
        # carries executable_list, args and env.
        sys.audit(FORK_EXEC_EVENT, args[1], args[0], args[5])
        return original(*args)

    return fork_exec


def _subject(event: str, args: tuple[object, ...]) -> str:
    """The program, command or address for the log, and nothing else: the arguments of
    subprocess.Popen and _posixsubprocess.fork_exec include the environment, which may hold
    secrets."""
    if not args:
        return "no arguments"
    subject = args[0]
    if event == "subprocess.Popen" and subject is None and len(args) > 1:
        argv = args[1]  # (executable, args, cwd, env); executable is None unless given
        subject = argv[0] if isinstance(argv, list | tuple) and argv else argv
    text = repr(subject)
    return text if len(text) <= _MAX_ARGUMENT_REPR else f"{text[:_MAX_ARGUMENT_REPR]}..."
