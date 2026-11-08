"""Engine lifecycle: initialize, ping, shutdown, exit, setLogLevel, and main()."""

from __future__ import annotations

import io
import json
import logging
import os
import sys
from pathlib import Path
from typing import Any

import pytest
import support
from support import EngineHarness, encode_frame, notification, request

from hearback_engine import ENGINE_VERSION, logs, runtime_info, sandbox, server
from hearback_engine.protocol import FATAL_PREFIX, ErrorCode, ErrorKind

ENGINE_METHODS = [
    "engine/initialize",
    "engine/ping",
    "engine/shutdown",
    "engine/exit",
    "engine/setLogLevel",
]


def assert_error(response: dict[str, Any], code: int, kind: str) -> None:
    assert response["error"]["code"] == code, response
    assert response["error"]["data"]["kind"] == kind, response


# --- initialize ---


def test_initialize_reports_the_engine(engine: EngineHarness) -> None:
    result = engine.initialize()
    assert result == {
        "engineVersion": ENGINE_VERSION,
        "protocolVersion": 1,
        "schemaVersion": 2,
        "python": runtime_info.python_info(),
        "vendored": runtime_info.vendored_packages(support.VENDOR_DIR),
        "capabilities": {"methods": ENGINE_METHODS},
        "pid": os.getpid(),
        "sandboxed": False,
    }


def test_initialize_keeps_the_client_settings(engine: EngineHarness) -> None:
    engine.initialize(workspaceTrusted=False, locale="de", logLevel="debug")
    assert engine.engine.client == {"name": "pytest", "version": "1.0"}
    assert engine.engine.workspace_trusted is False
    assert engine.engine.locale == "de"
    assert logging.getLogger().level == logging.DEBUG


@pytest.mark.parametrize("method", ["engine/ping", "engine/shutdown", "engine/unknown"])
def test_requests_before_initialize_are_rejected(engine: EngineHarness, method: str) -> None:
    response = engine.call(method, id=1)
    assert_error(response, ErrorCode.NOT_INITIALIZED, ErrorKind.NOT_INITIALIZED)
    # The engine still accepts initialize afterwards.
    engine.initialize()


def test_notifications_before_initialize_are_dropped(engine: EngineHarness) -> None:
    logging.getLogger().setLevel(logging.WARNING)
    engine.send(notification("engine/setLogLevel", {"level": "trace"}))
    # Answered after the notification was handled (one queue, in order).
    assert_error(engine.call("engine/ping", id=1), ErrorCode.NOT_INITIALIZED, "not-initialized")
    assert logging.getLogger().level == logging.WARNING
    engine.initialize(logLevel="error")
    assert logging.getLogger().level == logging.ERROR


def test_second_initialize_is_rejected(initialized: EngineHarness) -> None:
    response = initialized.call("engine/initialize", support.initialize_params(), id=2)
    assert_error(response, ErrorCode.INVALID_REQUEST, ErrorKind.ALREADY_INITIALIZED)


def test_protocol_mismatch(engine: EngineHarness) -> None:
    params = support.initialize_params(protocolVersion=2, futureField=True)
    response = engine.call("engine/initialize", params, id=3)
    assert_error(response, ErrorCode.INVALID_PARAMS, ErrorKind.PROTOCOL_MISMATCH)
    assert response["error"]["data"]["detail"] == "client 2, engine 1"
    # Not initialized: a correct initialize still works.
    engine.initialize()


@pytest.mark.parametrize(
    ("params", "detail"),
    [
        (None, "engine/initialize expects an object"),
        ([1], "engine/initialize expects an object"),
        (support.initialize_params(client=None), "params.client must be an object"),
        ({"protocolVersion": 1}, "params.client is required"),
        (support.initialize_params(extra=1), "params has an unknown property 'extra'"),
        (support.initialize_params(client={"name": ""}), "params.client.version is required"),
        (
            support.initialize_params(client={"name": "", "version": "1"}),
            "params.client.name must be a non-empty string",
        ),
        (
            support.initialize_params(client={"name": "a", "version": "1", "x": 0}),
            "params.client has an unknown property 'x'",
        ),
        (support.initialize_params(logLevel="verbose"), "params.logLevel must be one of"),
        (support.initialize_params(workspaceTrusted="yes"), "params.workspaceTrusted must be"),
        (support.initialize_params(protocolVersion=True), "params.protocolVersion must be"),
        (support.initialize_params(protocolVersion="1"), "params.protocolVersion must be"),
        (support.initialize_params(locale=5), "params.locale must be a string"),
    ],
)
def test_invalid_initialize_params(engine: EngineHarness, params: object, detail: str) -> None:
    response = engine.call("engine/initialize", params, id=4)
    assert_error(response, ErrorCode.INVALID_PARAMS, ErrorKind.INVALID_PARAMS)
    assert response["error"]["data"]["detail"].startswith(detail)
    assert response["error"]["message"].startswith("Invalid params: ")


# --- ping and shutdown ---


@pytest.mark.parametrize("params", [{}, [], [None], None])
def test_ping_accepts_empty_params(initialized: EngineHarness, params: object) -> None:
    assert initialized.call("engine/ping", params, id=5)["result"] == {"pong": True}


@pytest.mark.parametrize("method", ["engine/ping", "engine/shutdown"])
def test_methods_without_params_reject_params(initialized: EngineHarness, method: str) -> None:
    response = initialized.call(method, {"unexpected": 1}, id=6)
    assert_error(response, ErrorCode.INVALID_PARAMS, ErrorKind.INVALID_PARAMS)


@pytest.mark.parametrize(
    ("method", "params"),
    [
        ("engine/ping", None),
        ("engine/shutdown", None),
        ("engine/initialize", support.initialize_params()),
        ("engine/unknown", None),
    ],
)
def test_requests_after_shutdown_are_rejected(
    initialized: EngineHarness, method: str, params: object
) -> None:
    assert initialized.call("engine/shutdown", id="down") == {
        "jsonrpc": "2.0",
        "id": "down",
        "result": None,
    }
    response = initialized.call(method, params, id=7)
    assert_error(response, ErrorCode.INVALID_REQUEST, ErrorKind.SHUTTING_DOWN)


# --- exit codes ---


def test_exit_after_shutdown_exits_with_0(initialized: EngineHarness) -> None:
    initialized.call("engine/shutdown", id=8)
    initialized.send(notification("engine/exit"))
    assert initialized.wait_exit() == 0
    assert not initialized.engine.reader_alive


def test_exit_without_shutdown_exits_with_1(initialized: EngineHarness) -> None:
    initialized.send(notification("engine/exit"))
    assert initialized.wait_exit() == 1


def test_exit_before_initialize_is_processed(engine: EngineHarness) -> None:
    engine.send(notification("engine/exit"))
    assert engine.wait_exit() == 1


def test_messages_after_exit_are_not_read(initialized: EngineHarness) -> None:
    initialized.send(notification("engine/exit"), request("engine/ping", id=9))
    assert initialized.wait_exit() == 1
    assert initialized.no_more_messages()


@pytest.mark.parametrize(("shutdown", "code"), [(True, 0), (False, 1)])
def test_end_of_input_exits(initialized: EngineHarness, shutdown: bool, code: int) -> None:
    if shutdown:
        initialized.call("engine/shutdown", id=10)
    initialized.close_input()
    assert initialized.wait_exit() == code


def test_framing_error_exits_with_1_even_after_shutdown(initialized: EngineHarness) -> None:
    initialized.call("engine/shutdown", id=11)
    initialized.send_raw(b"Content-Length: 12abc\r\n\r\n")
    assert initialized.wait_exit() == 1


# --- log level ---


def test_set_log_level(initialized: EngineHarness) -> None:
    for level in ("trace", "debug", "warning", "error", "off", "info"):
        initialized.send(notification("engine/setLogLevel", {"level": level}))
        initialized.call("engine/ping", id=12)
        assert logging.getLogger().level == logs.LEVELS[level]


@pytest.mark.parametrize("params", [{"level": "loud"}, {}, {"level": "info", "x": 1}, None])
def test_invalid_set_log_level_is_ignored(
    initialized: EngineHarness, caplog: pytest.LogCaptureFixture, params: object
) -> None:
    caplog.set_level(logging.WARNING)
    initialized.send(notification("engine/setLogLevel", params))
    assert initialized.call("engine/ping", id=13)["result"] == {"pong": True}
    assert logging.getLogger().level == logging.WARNING
    assert "Ignored engine/setLogLevel: Invalid params" in caplog.text


# --- main() ---


class FakeProcess:
    """Replaces what main() takes from the real process: stdio, sandbox and stderr."""

    def __init__(self, monkeypatch: pytest.MonkeyPatch, data: bytes) -> None:
        self.protocol_in = io.BytesIO(data)
        self.protocol_out = io.BytesIO()
        self.stderr = io.StringIO()
        monkeypatch.setattr(server, "claim_stdio", lambda: (self.protocol_in, self.protocol_out))
        monkeypatch.setattr(sandbox, "install", lambda: True)
        monkeypatch.setattr(sys, "stderr", self.stderr)


def session(*messages: dict[str, Any]) -> bytes:
    return b"".join(encode_frame(message) for message in messages)


def test_main_serves_a_session(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakeProcess(
        monkeypatch,
        session(
            request("engine/initialize", support.initialize_params(), id=1),
            request("engine/ping", id=2),
            request("engine/shutdown", id=3),
            notification("engine/exit"),
        ),
    )
    assert server.main() == 0
    responses = support.split_frames(fake.protocol_out.getvalue())
    assert [response["id"] for response in responses] == [1, 2, 3]
    assert responses[0]["result"]["sandboxed"] is True
    records = support.assert_log_lines(fake.stderr.getvalue())
    assert records[0].startswith(f"[info] Hearback engine {ENGINE_VERSION} (protocol 1) on ")


def test_main_reports_setup_failures_as_bootstrap_failed(monkeypatch: pytest.MonkeyPatch) -> None:
    stderr = io.StringIO()
    monkeypatch.setattr(sys, "stderr", stderr)

    def no_stdin() -> None:
        raise AttributeError("'NoneType' object has no attribute 'buffer'")

    monkeypatch.setattr(server, "claim_stdio", no_stdin)
    assert server.main() == 4
    line = stderr.getvalue()
    assert line.startswith(FATAL_PREFIX) and line.endswith("\n") and line.count("\n") == 1
    assert json.loads(line[len(FATAL_PREFIX) :]) == {
        "code": "bootstrap-failed",
        "detail": "AttributeError: 'NoneType' object has no attribute 'buffer'",
    }


def test_main_logs_an_inactive_sandbox(monkeypatch: pytest.MonkeyPatch) -> None:
    fake = FakeProcess(monkeypatch, b"")
    monkeypatch.setattr(sandbox, "install", lambda: False)
    assert server.main() == 1
    assert "[error] The sandbox is not active" in fake.stderr.getvalue()


@pytest.mark.parametrize("error", [RuntimeError("bug"), KeyboardInterrupt()])
def test_main_survives_a_crashing_engine(
    monkeypatch: pytest.MonkeyPatch, error: BaseException
) -> None:
    fake = FakeProcess(monkeypatch, b"")

    def crash(self: server.Engine) -> int:
        raise error

    monkeypatch.setattr(server.Engine, "serve", crash)
    assert server.main() == 1
    assert fake.stderr.getvalue().count("\n") >= 2


def test_main_skips_interpreter_shutdown_while_the_reader_blocks(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    FakeProcess(monkeypatch, b"")
    exits: list[int] = []
    monkeypatch.setattr(server.Engine, "reader_alive", property(lambda self: True))

    def fake_exit(code: int) -> None:
        exits.append(code)

    monkeypatch.setattr(os, "_exit", fake_exit)
    assert server.main() == 1
    assert exits == [1]


def test_engine_reads_vendored_packages_from_its_folder(tmp_path: Path) -> None:
    dist_info = tmp_path / "demo-1.2.dist-info"
    dist_info.mkdir()
    (dist_info / "METADATA").write_text("Name: demo\nVersion: 1.2\n", encoding="utf-8")
    harness = EngineHarness(vendor_dir=tmp_path).start()
    try:
        assert harness.initialize()["vendored"] == [{"name": "demo", "version": "1.2"}]
    finally:
        harness.close()
