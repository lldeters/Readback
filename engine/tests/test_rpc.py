"""JSON-RPC dispatch: error codes, malformed messages, cancellation, exactly one response each.

Test-only methods are registered on the engine instance under test (harness.engine.methods);
the production method table never contains them.
"""

from __future__ import annotations

import io
import logging
import threading
from typing import Any

import pytest
import support
from support import EngineHarness, encode_frame, notification, request

from readback_engine import rpc
from readback_engine.protocol import ErrorCode, ErrorKind

TIMEOUT = 10.0


def assert_error(response: dict[str, Any], code: int, kind: str, id: object = None) -> None:
    assert response.get("id") == id, response
    assert response["error"]["code"] == code, response
    assert response["error"]["data"]["kind"] == kind, response
    assert isinstance(response["error"]["message"], str)


class Gate:
    """A test handler that blocks until released, so tests control what is queued behind it."""

    def __init__(self) -> None:
        self.started = threading.Event()
        self.release = threading.Event()

    def __call__(self, params: object, context: rpc.RequestContext) -> object:
        self.started.set()
        assert self.release.wait(TIMEOUT)
        return "released"


# --- malformed input ---


@pytest.mark.parametrize(
    "body",
    [b"{not json", b"\xff\xfe{}", b'{"jsonrpc": "2.0", "id": 1, "x": NaN}', b"", b"[" * 100_000],
)
def test_unparsable_messages_get_a_parse_error(engine: EngineHarness, body: bytes) -> None:
    engine.send_raw(encode_frame(body))
    assert_error(engine.receive(), ErrorCode.PARSE_ERROR, ErrorKind.PARSE_ERROR)
    # The stream stays in sync: the next request is answered normally.
    assert "result" in engine.call("engine/initialize", support.initialize_params())


@pytest.mark.parametrize(
    ("message", "echo_id"),
    [
        ([], None),
        ([support.request("engine/ping")], None),
        (42, None),
        ("engine/ping", None),
        (None, None),
        ({"id": 7, "method": "engine/ping"}, 7),
        ({"jsonrpc": "1.0", "id": "a", "method": "engine/ping"}, "a"),
        ({"jsonrpc": "2.0", "id": 8}, 8),
        ({"jsonrpc": "2.0", "id": 9, "method": 5}, 9),
        ({"jsonrpc": "2.0", "id": 10, "method": "engine/ping", "params": 3}, 10),
        ({"jsonrpc": "2.0", "method": "engine/exit", "params": "x"}, None),
        ({"jsonrpc": "2.0", "id": None, "method": "engine/ping"}, None),
        ({"jsonrpc": "2.0", "id": 1.5, "method": "engine/ping"}, None),
        ({"jsonrpc": "2.0", "id": True, "method": "engine/ping"}, None),
        ({"jsonrpc": "2.0", "id": {"n": 1}, "method": "engine/ping"}, None),
    ],
)
def test_invalid_messages_get_invalid_request(
    engine: EngineHarness, message: object, echo_id: object
) -> None:
    engine.send(message)  # type: ignore[arg-type]
    assert_error(engine.receive(), ErrorCode.INVALID_REQUEST, ErrorKind.INVALID_REQUEST, echo_id)


def test_responses_from_the_client_are_ignored(
    initialized: EngineHarness, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.WARNING)
    initialized.send({"jsonrpc": "2.0", "id": 99, "result": {}})
    assert initialized.call("engine/ping", id=2)["result"] == {"pong": True}
    assert "Ignored a response (id 99)" in caplog.text


def test_null_params_mean_no_params(initialized: EngineHarness) -> None:
    assert initialized.call("engine/ping", None, id=3)["result"] == {"pong": True}


def test_unknown_request_gets_method_not_found(initialized: EngineHarness) -> None:
    response = initialized.call("engine/doesNotExist", {}, id=4)
    assert_error(response, ErrorCode.METHOD_NOT_FOUND, ErrorKind.METHOD_NOT_FOUND, 4)
    assert response["error"]["message"] == "Unknown method engine/doesNotExist."


def test_unknown_notifications_are_ignored(
    initialized: EngineHarness, caplog: pytest.LogCaptureFixture
) -> None:
    caplog.set_level(logging.DEBUG)
    initialized.send(notification("engine/whatever", {"a": 1}), notification("$/setTrace"))
    assert initialized.call("engine/ping", id=5)["result"] == {"pong": True}
    assert "Ignored unknown notification engine/whatever." in caplog.text


# --- handler failures ---


def test_handler_exceptions_become_internal_errors(
    harness: EngineHarness, caplog: pytest.LogCaptureFixture
) -> None:
    def broken(params: object, context: rpc.RequestContext) -> object:
        raise KeyError("boom")

    harness.engine.methods.add_request("test/broken", broken)
    harness.start().initialize()
    with caplog.at_level(logging.ERROR):
        response = harness.call("test/broken", id=6)
    assert_error(response, ErrorCode.INTERNAL_ERROR, ErrorKind.INTERNAL, 6)
    assert response["error"]["data"]["detail"] == "'boom'"
    assert "Traceback" not in str(response)
    # The traceback goes to the log (stderr) instead.
    assert any(record.exc_info for record in caplog.records)


@pytest.mark.parametrize("result", [object(), float("nan"), {"set": {1, 2}}])
def test_unserializable_results_become_internal_errors(
    harness: EngineHarness, result: object
) -> None:
    harness.engine.methods.add_request("test/result", lambda params, context: result)
    harness.start().initialize()
    response = harness.call("test/result", id=7)
    assert_error(response, ErrorCode.INTERNAL_ERROR, ErrorKind.INTERNAL, 7)
    assert "cannot be sent as JSON" in response["error"]["data"]["detail"]


def test_rpc_errors_from_handlers_are_sent_as_is(harness: EngineHarness) -> None:
    def refuse(params: object, context: rpc.RequestContext) -> object:
        raise rpc.RpcError(ErrorCode.INVALID_PARAMS, "custom-kind", "No.", "because")

    harness.engine.methods.add_request("test/refuse", refuse)
    harness.start().initialize()
    response = harness.call("test/refuse", id=8)
    assert response["error"] == {
        "code": ErrorCode.INVALID_PARAMS,
        "message": "No.",
        "data": {"kind": "custom-kind", "detail": "because"},
    }


def test_failing_notification_handlers_do_not_stop_the_engine(
    harness: EngineHarness, caplog: pytest.LogCaptureFixture
) -> None:
    def broken(params: object) -> None:
        raise RuntimeError("bad notification")

    harness.engine.methods.add_notification("test/broken", broken)
    harness.start().initialize()
    with caplog.at_level(logging.ERROR):
        harness.send(notification("test/broken"))
        assert harness.call("engine/ping", id=9)["result"] == {"pong": True}
    assert "Notification test/broken failed." in caplog.text


def test_duplicate_method_registration_is_refused() -> None:
    table = rpc.MethodTable()
    table.add_request("a", lambda params, context: None)
    with pytest.raises(ValueError, match="already registered"):
        table.add_notification("a", lambda params: None)


# --- cancellation ---


def test_cancelling_a_queued_request_answers_it_without_running(harness: EngineHarness) -> None:
    gate = Gate()
    calls: list[object] = []
    harness.engine.methods.add_request("test/gate", gate)
    harness.engine.methods.add_request("test/record", lambda params, context: calls.append(params))
    harness.start().initialize()

    harness.send(request("test/gate", id=10))
    assert gate.started.wait(TIMEOUT)
    harness.send(
        request("test/record", ["queued"], id=11),
        notification("$/cancelRequest", {"id": 11}),
        request("test/record", ["after"], id=12),
    )
    # The reader thread answers a malformed message itself, in order: once that answer is here,
    # the cancellation before it has been applied, while the gate still holds the queue.
    harness.send_raw(encode_frame(b"{sync"))
    assert_error(harness.receive(), ErrorCode.PARSE_ERROR, ErrorKind.PARSE_ERROR)
    gate.release.set()

    responses = {response["id"]: response for response in (harness.receive() for _ in range(3))}
    assert responses[10]["result"] == "released"
    assert_error(responses[11], ErrorCode.REQUEST_CANCELLED, ErrorKind.CANCELLED, 11)
    assert responses[12]["result"] is None
    assert calls == [["after"]]


def test_cancelling_a_running_cooperative_handler(harness: EngineHarness) -> None:
    started = threading.Event()
    checks: list[bool] = []

    def spin(params: object, context: rpc.RequestContext) -> object:
        started.set()
        while not context.wait_cancelled(0.01):
            checks.append(context.cancelled)
        context.check_cancelled()
        return "not reached"

    harness.engine.methods.add_request("test/spin", spin)
    harness.start().initialize()
    harness.send(request("test/spin", id="spin"))
    assert started.wait(TIMEOUT)
    harness.send(notification("$/cancelRequest", {"id": "spin"}))
    assert_error(harness.receive(), ErrorCode.REQUEST_CANCELLED, ErrorKind.CANCELLED, "spin")
    assert not any(checks)
    assert harness.call("engine/ping", id=13)["result"] == {"pong": True}


@pytest.mark.parametrize("params", [{"id": 12345}, {"id": None}, {"x": 1}, [1], None])
def test_cancel_for_unknown_or_invalid_ids_is_ignored(
    initialized: EngineHarness, params: object
) -> None:
    initialized.send(notification("$/cancelRequest", params))
    assert initialized.call("engine/ping", id=14)["result"] == {"pong": True}
    assert initialized.no_more_messages()


def test_end_of_input_cancels_the_running_request(harness: EngineHarness) -> None:
    started = threading.Event()

    def wait(params: object, context: rpc.RequestContext) -> object:
        started.set()
        assert context.wait_cancelled(TIMEOUT)
        context.check_cancelled()
        return None

    harness.engine.methods.add_request("test/wait", wait)
    harness.start().initialize()
    harness.send(request("test/wait", id=15), request("engine/ping", id=16))
    assert started.wait(TIMEOUT)
    harness.close_input()
    first, second = harness.receive(), harness.receive()
    assert_error(first, ErrorCode.REQUEST_CANCELLED, ErrorKind.CANCELLED, 15)
    # Queued behind it at end of input: answered as cancelled without running.
    assert_error(second, ErrorCode.REQUEST_CANCELLED, ErrorKind.CANCELLED, 16)
    assert harness.wait_exit() == 1


def test_every_request_gets_exactly_one_response(harness: EngineHarness) -> None:
    gate = Gate()
    harness.engine.methods.add_request("test/gate", gate)
    harness.engine.methods.add_request("test/echo", lambda params, context: params)
    harness.start().initialize()
    harness.send(request("test/gate", id=0))
    assert gate.started.wait(TIMEOUT)
    messages = []
    for n in range(1, 60):
        method = ("test/echo", "engine/ping", "engine/unknown")[n % 3]
        params: object = [n] if method == "test/echo" else None
        messages.append(request(method, params, id=n))
        if n % 4 == 0:
            messages.append(notification("$/cancelRequest", {"id": n}))
    harness.send(*messages)
    gate.release.set()
    ids = [harness.receive()["id"] for _ in range(60)]
    assert sorted(ids) == list(range(60))
    assert harness.no_more_messages()


def test_duplicate_ids_are_answered_twice(
    harness: EngineHarness, caplog: pytest.LogCaptureFixture
) -> None:
    gate = Gate()
    harness.engine.methods.add_request("test/gate", gate)
    harness.start().initialize()
    caplog.set_level(logging.WARNING)
    harness.send(request("test/gate", id=20))
    assert gate.started.wait(TIMEOUT)
    harness.send(request("engine/ping", id=21), request("engine/ping", id=21))
    gate.release.set()
    assert [harness.receive()["id"] for _ in range(3)] == [20, 21, 21]
    assert "Request id 21 is already in use" in caplog.text


def test_cancel_token_and_context() -> None:
    token = rpc.CancelToken()
    context = rpc.RequestContext(1, "test/x", token)
    assert not context.cancelled
    assert not context.wait_cancelled(0)
    context.check_cancelled()
    token.cancel()
    assert context.cancelled
    assert context.wait_cancelled(0)
    with pytest.raises(rpc.RequestCancelledError, match=r"test/x \(id 1\) was cancelled"):
        context.check_cancelled()


# --- the connection without an engine ---


class Recorder:
    """A minimal dispatcher: answers every request with its method name."""

    def __init__(self) -> None:
        self.notifications: list[str] = []

    def handle_request(self, method: str, params: object, context: rpc.RequestContext) -> object:
        return method

    def handle_notification(self, method: str, params: object) -> None:
        self.notifications.append(method)


class BrokenPipe:
    def write(self, data: bytes | memoryview, /) -> int:
        raise BrokenPipeError(32, "Broken pipe")

    def flush(self) -> None:
        pass


def test_closed_output_stops_the_connection(caplog: pytest.LogCaptureFixture) -> None:
    data = encode_frame(request("a", id=1)) + encode_frame(request("b", id=2))
    connection = rpc.Connection(io.BytesIO(data), BrokenPipe(), Recorder())
    with caplog.at_level(logging.ERROR):
        assert connection.serve() == "output-closed"
    assert caplog.text.count("The protocol output is closed") == 1


def test_closed_output_while_rejecting_a_message_stops_the_reader() -> None:
    connection = rpc.Connection(io.BytesIO(encode_frame(b"{bad")), BrokenPipe(), Recorder())
    assert connection.serve() == "output-closed"


def test_reader_failures_end_the_connection(caplog: pytest.LogCaptureFixture) -> None:
    class Failing:
        def __init__(self, error: Exception) -> None:
            self._error = error

        def readline(self, size: int, /) -> bytes:
            raise self._error

        def read(self, size: int, /) -> bytes:
            raise self._error

    sink = io.BytesIO()
    with caplog.at_level(logging.ERROR):
        assert rpc.Connection(Failing(OSError("gone")), sink, Recorder()).serve() == "end-of-input"
        assert rpc.Connection(Failing(RuntimeError("bug")), sink, Recorder()).serve() == (
            "protocol-error"
        )
    assert "Reading the protocol input failed: gone" in caplog.text
    assert "The message reader failed." in caplog.text


def test_framing_errors_end_the_connection(caplog: pytest.LogCaptureFixture) -> None:
    data = encode_frame(request("a", id=1)) + b"Content-Length: nope\r\n\r\n"
    sink = io.BytesIO()
    with caplog.at_level(logging.ERROR):
        assert rpc.Connection(io.BytesIO(data), sink, Recorder()).serve() == "protocol-error"
    # Request 1 ran or was cancelled by the stop, depending on timing, but it got its answer.
    assert [message["id"] for message in support.split_frames(sink.getvalue())] == [1]
    assert "Protocol error: invalid Content-Length" in caplog.text


def test_exit_notification_stops_reading() -> None:
    recorder = Recorder()
    data = b"".join(
        encode_frame(message)
        for message in (
            request("a", id=1),
            notification("bye"),
            request("never", id=2),
        )
    )
    sink = io.BytesIO()
    connection = rpc.Connection(io.BytesIO(data), sink, recorder, exit_notification="bye")
    assert connection.serve() == "exit"
    assert not connection.reader_alive
    assert recorder.notifications == ["bye"]
    assert support.split_frames(sink.getvalue()) == [{"jsonrpc": "2.0", "id": 1, "result": "a"}]


def test_trace_logging_shows_the_messages(caplog: pytest.LogCaptureFixture) -> None:
    caplog.set_level(1)
    big = "x" * 2000
    # Ends with the exit notification, so that no end of input cancels the request.
    data = encode_frame(request("a", [big], id=1)) + encode_frame(notification("bye"))
    connection = rpc.Connection(io.BytesIO(data), io.BytesIO(), Recorder(), exit_notification="bye")
    assert connection.serve() == "exit"
    traces = [record.getMessage() for record in caplog.records if record.levelno == 5]
    incoming = [trace for trace in traces if trace.startswith("<- ")]
    outgoing = [trace for trace in traces if trace.startswith("-> ")]
    assert incoming[0].startswith('<- {"jsonrpc"') and incoming[0].endswith(" bytes)")
    assert outgoing == ['-> {"jsonrpc":"2.0","id":1,"result":"a"}']
