"""The real engine process, started exactly like the extension starts it.

``python -I -S -X utf8 engine/run_engine.py`` with engine/ as working directory and a sanitized
environment; the tests talk to it over real pipes.
"""

from __future__ import annotations

import json
import subprocess
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import IO, Any

import pytest
import support
from support import encode_frame, notification, request

from hearback_engine import ENGINE_VERSION

TIMEOUT = 30.0
# Spec 8: engine cold start (spawn to initialize response) under two seconds.
COLD_START_LIMIT = 2.0


def spawn(script: Path = support.BOOTSTRAP) -> subprocess.Popen[bytes]:
    return subprocess.Popen(
        support.engine_command(script),
        cwd=support.ENGINE_DIR,
        env=support.sanitized_env(),
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )


def run_session(*messages: dict[str, Any]) -> tuple[int, bytes, str]:
    """Send all messages, close stdin and collect everything the engine wrote."""
    process = spawn()
    data = b"".join(encode_frame(message) for message in messages)
    stdout, stderr = process.communicate(data, timeout=TIMEOUT)
    return process.returncode, stdout, stderr.decode("utf-8")


@contextmanager
def interactive() -> Iterator[subprocess.Popen[bytes]]:
    """An engine that stays up while the test talks to it; killed if the test hangs."""
    process = spawn()
    watchdog = threading.Timer(TIMEOUT, process.kill)
    watchdog.start()
    stderr: list[bytes] = []
    drain = threading.Thread(target=lambda: stderr.append(_read_all(process.stderr)))
    drain.start()
    try:
        yield process
    finally:
        watchdog.cancel()
        if process.poll() is None:
            process.kill()
        process.wait(TIMEOUT)
        drain.join(TIMEOUT)
        for stream in (process.stdin, process.stdout, process.stderr):
            if stream is not None:
                stream.close()


def _read_all(stream: IO[bytes] | None) -> bytes:
    return stream.read() if stream is not None else b""


def send(process: subprocess.Popen[bytes], *messages: dict[str, Any]) -> None:
    assert process.stdin is not None
    process.stdin.write(b"".join(encode_frame(message) for message in messages))
    process.stdin.flush()


def receive(process: subprocess.Popen[bytes]) -> dict[str, Any]:
    message = support.read_frame(process.stdout)
    assert message is not None, "the engine closed stdout"
    return message


def test_full_session_over_pipes(protocol_schema: dict[str, Any], vendored: Path) -> None:
    code, stdout, stderr = run_session(
        request("engine/initialize", support.initialize_params(logLevel="debug"), id=1),
        request("engine/ping", id=2),
        request("engine/unknown", id=3),
        request("engine/shutdown", id=4),
        notification("engine/exit"),
    )
    assert code == 0, stderr
    # stdout carries protocol frames and nothing else ...
    responses = support.split_frames(stdout)
    assert [response["id"] for response in responses] == [1, 2, 3, 4]
    result = responses[0]["result"]
    support.assert_valid(protocol_schema, "InitializeResult", result)
    assert result["engineVersion"] == ENGINE_VERSION
    assert result["sandboxed"] is True
    assert result["vendored"] == [
        {"name": package["name"], "version": package["version"]}
        for package in support.load_json(vendored / "VENDOR.json")["packages"]
    ]
    assert responses[1]["result"] == {"pong": True}
    assert responses[2]["error"]["code"] == -32601
    support.assert_valid(protocol_schema, "EngineErrorData", responses[2]["error"]["data"])
    assert responses[3]["result"] is None
    # ... and stderr only log records.
    records = support.assert_log_lines(stderr)
    assert any(line.startswith("[info] Initialized by pytest 1.0") for line in records)
    assert any(line.startswith("[debug] <- engine/ping") for line in records)


def test_interpreter_facts(vendored: Path) -> None:
    _code, stdout, _stderr = run_session(
        request("engine/initialize", support.initialize_params(), id=1),
        request("engine/shutdown", id=2),
        notification("engine/exit"),
    )
    python = support.split_frames(stdout)[0]["result"]["python"]
    probe = subprocess.run(
        support.isolated_python(
            "import json, platform, sys; print(json.dumps([platform.python_version(),"
            " sys.executable, sys.implementation.name, sys.platform]))"
        ),
        capture_output=True,
        check=True,
        env=support.sanitized_env(),
    )
    version, executable, implementation, platform = json.loads(probe.stdout)
    assert python["version"] == version
    assert python["executable"] == executable
    assert python["implementation"] == implementation
    assert python["platform"] == platform


@pytest.mark.parametrize(("shutdown", "expected"), [(True, 0), (False, 1)])
def test_end_of_input_exits(shutdown: bool, expected: int) -> None:
    with interactive() as process:
        send(process, request("engine/initialize", support.initialize_params(), id=1))
        assert "result" in receive(process)
        if shutdown:
            send(process, request("engine/shutdown", id=2))
            assert receive(process)["result"] is None
        assert process.stdin is not None
        process.stdin.close()
        assert process.wait(TIMEOUT) == expected
        assert support.read_frame(process.stdout) is None


def test_exit_without_shutdown_exits_with_1() -> None:
    code, _stdout, stderr = run_session(notification("engine/exit"))
    assert code == 1, stderr


def test_garbage_input_is_a_protocol_error() -> None:
    process = spawn()
    stdout, stderr = process.communicate(b"this is not a frame\r\n\r\n", timeout=TIMEOUT)
    assert process.returncode == 1
    assert stdout == b""
    assert "[error] Protocol error: malformed header line" in stderr.decode("utf-8")


def test_cold_start() -> None:
    """Spawn to initialize response; the extension waits for exactly this before first use."""
    started = time.perf_counter()
    with interactive() as process:
        send(process, request("engine/initialize", support.initialize_params(), id=1))
        response = receive(process)
        elapsed = time.perf_counter() - started
        assert "result" in response
        send(process, request("engine/shutdown", id=2), notification("engine/exit"))
        assert receive(process)["id"] == 2
        assert process.wait(TIMEOUT) == 0
    assert elapsed < COLD_START_LIMIT, f"cold start took {elapsed:.3f} s"


def test_cancellation_over_pipes() -> None:
    """A request that is cancelled while still queued is answered with RequestCancelled."""
    with interactive() as process:
        send(
            process,
            request("engine/initialize", support.initialize_params(), id=1),
            request("engine/ping", id=2),
            notification("$/cancelRequest", {"id": 2}),
            request("engine/ping", id=3),
        )
        responses = {message["id"]: message for message in (receive(process) for _ in range(3))}
        assert "result" in responses[1]
        # Ping 2 is either done before the cancel arrives or cancelled; both are one answer.
        assert responses[2].get("result") == {"pong": True} or (
            responses[2]["error"]["code"] == -32800
        )
        assert responses[3]["result"] == {"pong": True}
        send(process, request("engine/shutdown", id=4), notification("engine/exit"))
        assert receive(process)["id"] == 4
        assert process.wait(TIMEOUT) == 0


def test_startup_does_not_import_the_analysis_libraries(vendored: Path) -> None:
    """Phase 0 keeps sqlglot, jedi and parso out of the startup path (cold start target)."""
    code = (
        "import sys; sys.path[0:0] = [sys.argv[1], sys.argv[2]];"
        "import hearback_engine.server as s, io;"
        "s.Engine(io.BytesIO(), io.BytesIO(), sandboxed=False);"
        "print(sorted(m for m in sys.modules if m.split('.')[0] in ('sqlglot', 'jedi', 'parso')))"
    )
    result = subprocess.run(
        [*support.isolated_python(code), str(support.ENGINE_DIR), str(vendored)],
        capture_output=True,
        check=True,
        text=True,
        env=support.sanitized_env(),
    )
    assert result.stdout.strip() == "[]"
