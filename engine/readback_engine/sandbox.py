"""Audit-hook sandbox: the engine never starts processes, uses the network or loads native code.

Spec 5.2 says the engine only parses. The vendored libraries import socket and subprocess
transitively (sqlglot via importlib.metadata, parso via platform) without using them, so instead
of banning imports the engine refuses the operations at runtime. Together with the ruff
banned-api lint and the import test for the engine's own code this is the approved reading of
"the engine imports no network modules": it never opens sockets and never starts processes.

The hook is defense in depth against libraries that try such operations (jedi spawns an
interpreter unless it is configured not to), not a boundary against hostile code in the engine
process. Audit hooks cannot be removed, so tests install it in subprocesses only.
"""

import logging
import sys
from typing import Final

log = logging.getLogger("readback.sandbox")

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
    """
    hook = SandboxHook()
    sys.addaudithook(hook)
    sys.audit(PROBE_EVENT)
    return hook.active


def _subject(event: str, args: tuple[object, ...]) -> str:
    """The program, command or address for the log, and nothing else: subprocess.Popen's
    arguments include the environment, which may hold secrets."""
    if not args:
        return "no arguments"
    subject = args[0]
    if event == "subprocess.Popen" and subject is None and len(args) > 1:
        argv = args[1]  # (executable, args, cwd, env); executable is None unless given
        subject = argv[0] if isinstance(argv, list | tuple) and argv else argv
    text = repr(subject)
    return text if len(text) <= _MAX_ARGUMENT_REPR else f"{text[:_MAX_ARGUMENT_REPR]}..."
