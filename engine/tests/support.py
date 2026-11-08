"""Helpers shared by the engine tests (tests/ is on pytest's pythonpath).

Framing helpers here are written independently of hearback_engine.rpc, so that the tests do not
check the engine's framing against itself.
"""

from __future__ import annotations

import json
import os
import queue
import re
import sys
import threading
from pathlib import Path
from typing import Any, Final, cast

from jsonschema import Draft202012Validator

from hearback_engine import PROTOCOL_VERSION
from hearback_engine.server import Engine

ENGINE_DIR: Final = Path(__file__).resolve().parent.parent
REPO_ROOT: Final = ENGINE_DIR.parent
VENDOR_DIR: Final = ENGINE_DIR / "vendor"
BOOTSTRAP: Final = ENGINE_DIR / "run_engine.py"
SHARED_DIR: Final = REPO_ROOT / "shared"
PROTOCOL_SCHEMA: Final = SHARED_DIR / "engine-protocol.schema.json"
GRAPH_SCHEMA: Final = SHARED_DIR / "graph-schema.json"
EXAMPLES_DIR: Final = SHARED_DIR / "examples"

# The record format of src/engine/stderrLog.ts, plus its continuation lines.
LOG_RECORD: Final = re.compile(r"^\[(trace|debug|info|warning|error)\] (.*)$")
CONTINUATION: Final = "    "

JsonObject = dict[str, Any]
_MISSING: Final = object()


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def validator(schema: JsonObject, definition: str | None = None) -> Draft202012Validator:
    """A validator for the whole schema, or for one of its $defs."""
    if definition is None:
        return Draft202012Validator(schema)
    return Draft202012Validator(
        {"$schema": schema["$schema"], "$defs": schema["$defs"], "$ref": f"#/$defs/{definition}"}
    )


def assert_valid(schema: JsonObject, definition: str | None, instance: object) -> None:
    errors = sorted(validator(schema, definition).iter_errors(instance), key=str)
    assert not errors, "\n".join(f"{list(e.absolute_path)}: {e.message}" for e in errors)


# --- Framing ----------------------------------------------------------------------------------


def encode_frame(message: object) -> bytes:
    body = message if isinstance(message, bytes) else json.dumps(message).encode("utf-8")
    return b"Content-Length: " + str(len(body)).encode("ascii") + b"\r\n\r\n" + body


def split_frames(data: bytes) -> list[JsonObject]:
    """Parse a complete byte stream that must consist of frames only (nothing else)."""
    messages: list[JsonObject] = []
    rest = data
    while rest:
        match = re.match(rb"Content-Length: (\d+)\r\n\r\n", rest)
        assert match, f"not a frame header: {rest[:80]!r}"
        start = match.end()
        end = start + int(match.group(1))
        assert len(rest) >= end, "truncated frame"
        messages.append(json.loads(rest[start:end].decode("utf-8")))
        rest = rest[end:]
    return messages


def read_frame(stream: Any) -> JsonObject | None:
    """Read one frame from a blocking binary stream; None at end of stream."""
    header = b""
    while not header.endswith(b"\r\n\r\n"):
        byte = stream.read(1)
        if not byte:
            assert not header, f"stream ended inside a header: {header!r}"
            return None
        header += byte
    match = re.fullmatch(rb"Content-Length: (\d+)\r\n\r\n", header)
    assert match, f"unexpected header {header!r}"
    length = int(match.group(1))
    body = b""
    while len(body) < length:
        chunk = stream.read(length - len(body))
        assert chunk, "stream ended inside a body"
        body += chunk
    return cast("JsonObject", json.loads(body.decode("utf-8")))


def request(method: str, params: object = _MISSING, *, id: int | str = 1) -> JsonObject:
    message: JsonObject = {"jsonrpc": "2.0", "id": id, "method": method}
    if params is not _MISSING:
        message["params"] = params
    return message


def notification(method: str, params: object = _MISSING) -> JsonObject:
    message: JsonObject = {"jsonrpc": "2.0", "method": method}
    if params is not _MISSING:
        message["params"] = params
    return message


def initialize_params(**overrides: object) -> JsonObject:
    params: JsonObject = {
        "protocolVersion": PROTOCOL_VERSION,
        "client": {"name": "pytest", "version": "1.0"},
        "logLevel": "info",
        "workspaceTrusted": True,
        "locale": "en",
    }
    params.update(overrides)
    return params


# --- Params of the analysis requests ----------------------------------------------------------

_REVISION: Final = "3f2c1d9e8b7a6f5e4d3c2b1a0f9e8d7c6b5a4f3e"
_POSITION: Final = {"line": 17, "character": 8}
_SYMBOL: Final = "py:retrying_client.RetryingClient.get"
_SOURCE: Final = {"file": "/w/retrying_client.py", "text": "class A:\n    pass\n"}
_BASE: Final = {"revision": _REVISION, "file": "/w/old_client.py", "text": "class A:\n    x = 1\n"}
_OVERLAY: Final = {"file": "/w/b.py", "text": "import a\n"}
_FILE_BASE: Final = {"file": "/w/b.py", "base": {"revision": _REVISION, "text": None}}
_RULES: Final = {"path": "/w/hearback-rules.json", "text": '{"version": 1, "rules": []}'}
_OPTIONS: Final = {"useJedi": False, "maxNodes": 300, "sideEffectRules": _RULES}
_ROOT: Final = {"root": "/w"}
_FILES: Final = {
    "root": "/w",
    "files": ["/w/a.py", "/w/b.py"],
    "overlays": [_OVERLAY],
    "baseRevision": _REVISION,
    "bases": [_FILE_BASE],
    "omittedBases": ["/w/a.py"],
}
_BATCH: Final = {"root": "/w", "files": ["/w/a.py", "/w/b.py"], "overlays": [_OVERLAY]}

# One valid instance, with every optional key, of each params def of the analysis requests.
PARAMS_EXAMPLES: Final[dict[str, JsonObject]] = {
    "TextPosition": _POSITION,
    "SourceFile": _SOURCE,
    "BaseVersion": _BASE,
    "FileOverlay": _OVERLAY,
    "FileBase": _FILE_BASE,
    "RulesSource": _RULES,
    "AnalysisOptions": _OPTIONS,
    "WorkspaceRoot": _ROOT,
    "WorkspaceFiles": _FILES,
    "WorkspaceBatch": _BATCH,
    "ClassAnatomyParams": {
        "source": _SOURCE,
        "position": _POSITION,
        "symbol": _SYMBOL,
        "base": _BASE,
        "workspace": _FILES,
        "options": _OPTIONS,
    },
    "CallGraphParams": {
        "source": _SOURCE,
        "position": _POSITION,
        "symbol": _SYMBOL,
        "hops": 2,
        "direction": "both",
        "workspace": _FILES,
        "base": _BASE,
        "options": _OPTIONS,
    },
    "ControlFlowParams": {
        "source": _SOURCE,
        "position": _POSITION,
        "symbol": _SYMBOL,
        "base": _BASE,
        "workspace": _ROOT,
        "options": _OPTIONS,
    },
    "ModuleGraphParams": {
        "workspace": _FILES,
        "scopes": ["/w/shop"],
        "focusFile": "/w/a.py",
        "options": _OPTIONS,
    },
    "IndexFilesParams": {"workspace": _BATCH, "options": _OPTIONS},
    "DiffCompareParams": {
        "language": "python",
        "source": _SOURCE,
        "base": _BASE,
        "workspace": _ROOT,
        "options": _OPTIONS,
    },
}


# --- Processes --------------------------------------------------------------------------------

_DROPPED_VARIABLES: Final = {
    "VIRTUAL_ENV",
    "CONDA_PREFIX",
    "CONDA_DEFAULT_ENV",
    "CONDA_SHLVL",
    "__PYVENV_LAUNCHER__",
}


def sanitized_env() -> dict[str, str]:
    """The environment the extension gives the engine (src/engine/interpreter/policy.ts)."""
    return {
        key: value
        for key, value in os.environ.items()
        if not key.upper().startswith("PYTHON") and key.upper() not in _DROPPED_VARIABLES
    }


def engine_command(script: Path = BOOTSTRAP) -> list[str]:
    return [sys.executable, "-I", "-S", "-X", "utf8", str(script)]


def isolated_python(code: str) -> list[str]:
    """Run ``code`` like the engine runs: isolated, without site, in UTF-8 mode."""
    return [sys.executable, "-I", "-S", "-X", "utf8", "-c", code]


def assert_log_lines(stderr: str) -> list[str]:
    """Every stderr line is a log record or a continuation line; returns the records."""
    records: list[str] = []
    for line in stderr.splitlines():
        if line.startswith(CONTINUATION) and records:
            continue
        assert LOG_RECORD.match(line), f"not a log line: {line!r}"
        records.append(line)
    return records


# --- In-process engine ------------------------------------------------------------------------


class EngineHarness:
    """An in-process Engine on OS pipes, served from a background thread like main() would.

    Tests can register their own handlers on ``harness.engine.methods`` before start().
    """

    def __init__(self, *, vendor_dir: Path = VENDOR_DIR) -> None:
        in_read, in_write = os.pipe()
        out_read, out_write = os.pipe()
        self._engine_in = os.fdopen(in_read, "rb")
        self._engine_out = os.fdopen(out_write, "wb", buffering=0)
        self._to_engine = os.fdopen(in_write, "wb", buffering=0)
        self._from_engine = os.fdopen(out_read, "rb")
        self.engine = Engine(
            self._engine_in, self._engine_out, sandboxed=False, vendor_dir=vendor_dir
        )
        self._received: queue.Queue[JsonObject | None] = queue.Queue()
        self._collector = threading.Thread(target=self._collect, name="test-collector", daemon=True)
        self._server = threading.Thread(target=self._serve, name="test-engine", daemon=True)
        self._exit_code: int | None = None
        self._input_closed = False

    def start(self) -> EngineHarness:
        self._collector.start()
        self._server.start()
        return self

    def _serve(self) -> None:
        self._exit_code = self.engine.serve()

    def _collect(self) -> None:
        while True:
            message = read_frame(self._from_engine)
            self._received.put(message)
            if message is None:
                return

    # --- talking to the engine ---

    def send_raw(self, data: bytes) -> None:
        self._to_engine.write(data)

    def send(self, *messages: JsonObject) -> None:
        self.send_raw(b"".join(encode_frame(message) for message in messages))

    def receive(self, timeout: float = 10.0) -> JsonObject:
        try:
            message = self._received.get(timeout=timeout)
        except queue.Empty:
            msg = f"no message from the engine within {timeout} s"
            raise AssertionError(msg) from None
        assert message is not None, "the engine closed its output"
        return message

    def call(self, method: str, params: object = _MISSING, *, id: int | str = 1) -> JsonObject:
        self.send(request(method, params, id=id))
        response = self.receive()
        assert response.get("id") == id, response
        return response

    def initialize(self, **overrides: object) -> JsonObject:
        response = self.call("engine/initialize", initialize_params(**overrides), id="init")
        assert "result" in response, response
        return cast("JsonObject", response["result"])

    def close_input(self) -> None:
        if not self._input_closed:
            self._input_closed = True
            self._to_engine.close()

    def wait_exit(self, timeout: float = 10.0) -> int:
        self._server.join(timeout)
        assert not self._server.is_alive(), "the engine did not stop"
        assert self._exit_code is not None
        return self._exit_code

    def no_more_messages(self, timeout: float = 0.2) -> bool:
        """True if the engine sends nothing within ``timeout`` (or only closes its output)."""
        try:
            return self._received.get(timeout=timeout) is None
        except queue.Empty:
            return True

    def close(self) -> None:
        self.close_input()
        self._server.join(10)
        # The engine never closes its own output; closing it here ends the collector.
        self._engine_out.close()
        self._collector.join(10)
        self._engine_in.close()
        self._from_engine.close()
