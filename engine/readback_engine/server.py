"""The engine process: claims stdio, checks the sandbox, and serves the engine/* methods.

Lifecycle (protocol version 1, LSP-like): engine/initialize must be the first request;
engine/shutdown makes every later request fail; the engine/exit notification or the end of input
ends the process with code 0 after a shutdown and 1 otherwise.
"""

from __future__ import annotations

import io
import json
import logging
import os
import sys
from pathlib import Path
from typing import TYPE_CHECKING, Final, NoReturn

from . import ENGINE_VERSION, PROTOCOL_VERSION, SCHEMA_VERSION, logs, rpc, runtime_info, sandbox
from . import validation as check
from .protocol import (
    FATAL_PREFIX,
    ClientInfo,
    ErrorCode,
    ErrorKind,
    ExitCode,
    FatalStartupError,
    InitializeResult,
    Method,
    PingResult,
)

if sys.platform == "win32":
    import msvcrt

if TYPE_CHECKING:
    from .rpc import ByteReader, ByteWriter, RequestContext

log = logging.getLogger("readback.engine")

# Exit without a preceding engine/shutdown, after a protocol error, or after a crash.
EXIT_UNCLEAN: Final = 1


class Engine:
    """Lifecycle state and the engine/* handlers of one engine process."""

    def __init__(
        self,
        protocol_in: ByteReader,
        protocol_out: ByteWriter,
        *,
        sandboxed: bool,
        vendor_dir: Path = runtime_info.VENDOR_DIR,
    ) -> None:
        self.methods = rpc.MethodTable()
        self.methods.add_request(Method.INITIALIZE, self._initialize)
        self.methods.add_request(Method.PING, self._ping)
        self.methods.add_request(Method.SHUTDOWN, self._shutdown)
        self.methods.add_notification(Method.EXIT, self._exit)
        self.methods.add_notification(Method.SET_LOG_LEVEL, self._set_log_level)
        self._connection = rpc.Connection(
            protocol_in, protocol_out, self, exit_notification=Method.EXIT
        )
        self._sandboxed = sandboxed
        self._vendor_dir = vendor_dir
        self._initialized = False
        self._shutdown_requested = False
        # Kept from engine/initialize for the analyses of later phases.
        self.client: ClientInfo | None = None
        self.workspace_trusted = False
        self.locale: str | None = None

    @property
    def reader_alive(self) -> bool:
        return self._connection.reader_alive

    def serve(self) -> int:
        """Serve until exit or end of input; returns the process exit code."""
        reason = self._connection.serve()
        clean = self._shutdown_requested and reason != "protocol-error"
        log.info("Engine stopped: %s%s.", reason, "" if clean else " (unclean)")
        return ExitCode.OK if clean else EXIT_UNCLEAN

    # --- rpc.Dispatcher ---

    def handle_request(self, method: str, params: object, context: RequestContext) -> object:
        if self._shutdown_requested:
            raise rpc.RpcError(
                ErrorCode.INVALID_REQUEST,
                ErrorKind.SHUTTING_DOWN,
                f"{method} was rejected: the engine is shutting down.",
            )
        if method == Method.INITIALIZE and self._initialized:
            raise rpc.RpcError(
                ErrorCode.INVALID_REQUEST,
                ErrorKind.ALREADY_INITIALIZED,
                "The engine is already initialized.",
            )
        if method != Method.INITIALIZE and not self._initialized:
            raise rpc.RpcError(
                ErrorCode.NOT_INITIALIZED,
                ErrorKind.NOT_INITIALIZED,
                f"{method} was rejected: engine/initialize must be the first request.",
            )
        handler = self.methods.request(method)
        if handler is None:
            raise rpc.RpcError(
                ErrorCode.METHOD_NOT_FOUND,
                ErrorKind.METHOD_NOT_FOUND,
                f"Unknown method {method}.",
            )
        return handler(params, context)

    def handle_notification(self, method: str, params: object) -> None:
        # Like LSP: notifications before initialize are dropped, except exit.
        if not self._initialized and method != Method.EXIT:
            log.debug("Dropped %s: it arrived before engine/initialize.", method)
            return
        handler = self.methods.notification(method)
        if handler is None:
            log.debug("Ignored unknown notification %s.", method)
            return
        handler(params)

    # --- handlers ---

    def _initialize(self, params: object, context: RequestContext) -> InitializeResult:
        request = check.initialize_params(params)
        logs.set_level(request["logLevel"])
        self._initialized = True
        self.client = request["client"]
        self.workspace_trusted = request["workspaceTrusted"]
        self.locale = request.get("locale")
        log.info(
            "Initialized by %s %s (%s workspace).",
            self.client["name"],
            self.client["version"],
            "trusted" if self.workspace_trusted else "restricted",
        )
        return {
            "engineVersion": ENGINE_VERSION,
            "protocolVersion": PROTOCOL_VERSION,
            "schemaVersion": SCHEMA_VERSION,
            "python": runtime_info.python_info(),
            "vendored": runtime_info.vendored_packages(self._vendor_dir),
            "capabilities": {"methods": self.methods.names()},
            "pid": os.getpid(),
            "sandboxed": self._sandboxed,
        }

    def _ping(self, params: object, context: RequestContext) -> PingResult:
        check.no_params(params, Method.PING)
        return {"pong": True}

    def _shutdown(self, params: object, context: RequestContext) -> None:
        check.no_params(params, Method.SHUTDOWN)
        self._shutdown_requested = True
        log.info("Shutdown requested.")

    def _exit(self, params: object) -> None:
        log.debug("Exit requested%s.", "" if self._shutdown_requested else " without shutdown")

    def _set_log_level(self, params: object) -> None:
        level = check.set_log_level_params(params)
        logs.set_level(level)
        log.debug("Log level set to %s.", level)


def claim_stdio() -> tuple[ByteReader, ByteWriter]:
    """Reserve fds 0 and 1 for the protocol and send everything else that writes to stdout to
    stderr, where it cannot corrupt the frames (print() in a library, C code writing to fd 1)."""
    sys.stdout.flush()
    protocol_in = sys.stdin.buffer
    out_fd = os.dup(1)
    if sys.platform == "win32":
        # Text mode would turn \n into \r\n inside the frames and break Content-Length.
        msvcrt.setmode(0, os.O_BINARY)
        msvcrt.setmode(out_fd, os.O_BINARY)
    protocol_out = os.fdopen(out_fd, "wb", buffering=0)
    os.dup2(2, 1)
    sys.stdout = sys.stderr
    # input() and friends now see an empty stream instead of eating protocol bytes.
    sys.stdin = io.StringIO()
    return protocol_in, protocol_out


def main() -> int:
    """Entry point used by engine/run_engine.py; returns the process exit code."""
    try:
        protocol_in, protocol_out = claim_stdio()
        # run_engine.py installed the sandbox before it imported this module; install() then
        # only returns the verified state (and installs it if main() was started another way).
        sandboxed = sandbox.install()
        logs.install(sys.stderr)
        engine = Engine(protocol_in, protocol_out, sandboxed=sandboxed)
    except Exception as exc:  # noqa: BLE001 - reported to the extension instead of a traceback
        report_fatal(f"{type(exc).__name__}: {exc}")
        return ExitCode.BOOTSTRAP_FAILED
    _log_startup(sandboxed=sandboxed)
    try:
        code = engine.serve()
    except Exception:
        log.exception("The engine crashed.")
        code = EXIT_UNCLEAN
    except KeyboardInterrupt:
        log.info("Interrupted.")
        code = EXIT_UNCLEAN
    if engine.reader_alive:
        # A thread still blocked in sys.stdin.buffer would abort the interpreter's shutdown
        # ("could not acquire lock ... _enter_buffered_busy"), so skip the shutdown.
        exit_now(code)
    return code


def report_fatal(detail: str) -> None:
    """The machine-readable startup failure line that src/engine/stderrLog.ts recognizes."""
    payload: FatalStartupError = {"code": "bootstrap-failed", "detail": detail}
    sys.stderr.write(FATAL_PREFIX + json.dumps(payload) + "\n")
    sys.stderr.flush()


def exit_now(code: int) -> NoReturn:
    for handler in logging.getLogger().handlers:
        handler.flush()
    sys.stderr.flush()
    os._exit(code)


def _log_startup(*, sandboxed: bool) -> None:
    info = runtime_info.python_info()
    log.info(
        "Readback engine %s (protocol %d) on %s %s, pid %d.",
        ENGINE_VERSION,
        PROTOCOL_VERSION,
        info["implementation"],
        info["version"],
        os.getpid(),
    )
    log.debug(
        "Interpreter %s, flags: isolated=%d no_site=%d utf8_mode=%d.",
        info["executable"],
        sys.flags.isolated,
        sys.flags.no_site,
        sys.flags.utf8_mode,
    )
    if not sandboxed:
        log.error("The sandbox is not active: another audit hook refused to add it.")
