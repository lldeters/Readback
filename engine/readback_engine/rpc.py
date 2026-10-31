"""JSON-RPC 2.0 over a byte stream with Content-Length framing, compatible with vscode-jsonrpc.

Threading model: a reader thread parses the incoming frames. It answers malformed messages
itself and applies ``$/cancelRequest`` at once to the CancelToken of the addressed request, no
matter whether that request is still queued or already running. Everything else goes into a
queue that ``Connection.serve()`` works off on the calling thread (the main thread), one message
at a time, so handlers never run concurrently. Every request gets exactly one response.
"""

from __future__ import annotations

import json
import logging
import queue
import threading
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Final, Literal, Protocol, TypeGuard

from .logs import TRACE
from .protocol import EngineErrorData, ErrorCode, ErrorKind, Method

log = logging.getLogger("readback.rpc")

# One message never gets near this; a larger length means garbage or a runaway client.
MAX_CONTENT_LENGTH: Final = 64 * 1024 * 1024
MAX_HEADER_LINE: Final = 8 * 1024
MAX_HEADER_COUNT: Final = 32
# Content-Length values with more digits cannot be valid and would only cost int() time.
_MAX_LENGTH_DIGITS: Final = 20
# The reader normally ends on its own (end of input, exit); this only bounds the wait if not.
READER_JOIN_TIMEOUT: Final = 1.0
_PREVIEW_CHARS: Final = 1000

RequestId = int | str
StopReason = Literal["exit", "end-of-input", "protocol-error", "output-closed"]


# --- Framing ----------------------------------------------------------------------------------


class FramingError(Exception):
    """The input violates Content-Length framing; the stream cannot be resynchronized."""


class ByteReader(Protocol):
    def readline(self, size: int, /) -> bytes: ...

    def read(self, size: int, /) -> bytes: ...


class ByteWriter(Protocol):
    def write(self, data: bytes | memoryview, /) -> int | None: ...

    def flush(self) -> None: ...


def read_message(stream: ByteReader) -> bytes | None:
    """Read one message body; None at a clean end of input (between two messages)."""
    length = _read_headers(stream)
    if length is None:
        return None
    return _read_exactly(stream, length)


def _read_headers(stream: ByteReader) -> int | None:
    length: int | None = None
    # Up to MAX_HEADER_COUNT header lines plus the empty line that ends the header block.
    for index in range(MAX_HEADER_COUNT + 1):
        line = stream.readline(MAX_HEADER_LINE + 1)
        if not line and index == 0:
            return None
        if not line.endswith(b"\n"):
            if len(line) > MAX_HEADER_LINE:
                msg = f"a header line is longer than {MAX_HEADER_LINE} bytes"
                raise FramingError(msg)
            msg = "the input ended inside the message headers"
            raise FramingError(msg)
        # vscode-jsonrpc ends lines with CRLF; a bare LF is accepted too (handy for manual tests).
        line = line.rstrip(b"\r\n")
        if not line:
            if length is None:
                msg = "a message has no Content-Length header"
                raise FramingError(msg)
            return length
        name, colon, value = line.partition(b":")
        if not colon:
            msg = f"malformed header line {line[:80]!r}"
            raise FramingError(msg)
        # Other headers (Content-Type) are optional and carry nothing the engine needs.
        if name.strip().lower() == b"content-length":
            length = _parse_length(value.strip(), length)
    msg = f"a message has more than {MAX_HEADER_COUNT} header lines"
    raise FramingError(msg)


def _parse_length(value: bytes, previous: int | None) -> int:
    if not value.isdigit() or len(value) > _MAX_LENGTH_DIGITS:
        msg = f"invalid Content-Length {value[:40]!r}"
        raise FramingError(msg)
    length = int(value)
    if length > MAX_CONTENT_LENGTH:
        msg = f"a message of {length} bytes exceeds the limit of {MAX_CONTENT_LENGTH} bytes"
        raise FramingError(msg)
    if previous is not None and previous != length:
        msg = f"conflicting Content-Length headers ({previous} and {length})"
        raise FramingError(msg)
    return length


def _read_exactly(stream: ByteReader, size: int) -> bytes:
    chunks: list[bytes] = []
    remaining = size
    while remaining > 0:
        chunk = stream.read(remaining)
        if not chunk:
            msg = f"the input ended after {size - remaining} of {size} message bytes"
            raise FramingError(msg)
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


def encode_message(message: Mapping[str, object]) -> bytes:
    """Compact UTF-8 JSON; raises TypeError or ValueError for values JSON cannot represent."""
    try:
        text = json.dumps(message, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
        return text.encode("utf-8")
    except UnicodeEncodeError:
        # Lone surrogates (undecodable file names under surrogateescape) have no UTF-8 form;
        # \u escapes keep them representable.
        text = json.dumps(message, ensure_ascii=True, separators=(",", ":"), allow_nan=False)
        return text.encode("ascii")


def frame(body: bytes) -> bytes:
    """Prefix a body with its header; Content-Length counts bytes, not characters."""
    return b"Content-Length: %d\r\n\r\n" % len(body) + body


class MessageWriter:
    """Writes framed messages. The lock keeps frames from the reader and serving threads whole."""

    def __init__(self, stream: ByteWriter) -> None:
        self._stream = stream
        self._lock = threading.Lock()

    def write(self, body: bytes) -> None:
        data = memoryview(frame(body))
        with self._lock:
            # An unbuffered (raw) stream may accept only part of a large frame per call.
            while data:
                written = self._stream.write(data)
                if not written:
                    msg = "the protocol output accepted no data"
                    raise OSError(msg)
                data = data[written:]
            self._stream.flush()


# --- Requests, cancellation and errors --------------------------------------------------------


class RequestCancelledError(Exception):
    """Raised by RequestContext.check_cancelled(); answered with REQUEST_CANCELLED."""


class CancelToken:
    """Set from the reader thread by $/cancelRequest, read by the handler on the serving thread."""

    __slots__ = ("_event",)

    def __init__(self) -> None:
        self._event = threading.Event()

    def cancel(self) -> None:
        self._event.set()

    @property
    def cancelled(self) -> bool:
        return self._event.is_set()

    def wait(self, timeout: float | None) -> bool:
        """Block until cancelled or until the timeout passes; True if cancelled."""
        return self._event.wait(timeout)


class RequestContext:
    """What a request handler gets besides its params: the request's identity and cancellation.

    Cancellation is cooperative: long-running handlers call check_cancelled() regularly. The
    extension kills the engine if a request ignores cancellation for too long.
    """

    __slots__ = ("_token", "id", "method")

    def __init__(self, request_id: RequestId, method: str, token: CancelToken) -> None:
        self.id = request_id
        self.method = method
        self._token = token

    @property
    def cancelled(self) -> bool:
        return self._token.cancelled

    def check_cancelled(self) -> None:
        if self._token.cancelled:
            msg = f"{self.method} (id {self.id!r}) was cancelled"
            raise RequestCancelledError(msg)

    def wait_cancelled(self, timeout: float) -> bool:
        """Sleep up to ``timeout`` seconds, waking early on cancellation; True if cancelled."""
        return self._token.wait(timeout)


class RpcError(Exception):
    """An error response. Handlers raise it; the connection sends it with EngineErrorData."""

    def __init__(self, code: int, kind: str, message: str, detail: str | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.kind = kind
        self.message = message
        self.detail = detail

    def to_json(self) -> dict[str, object]:
        data: EngineErrorData = {"kind": self.kind}
        if self.detail is not None:
            data["detail"] = self.detail
        return {"code": self.code, "message": self.message, "data": data}


def invalid_request(message: str) -> RpcError:
    return RpcError(ErrorCode.INVALID_REQUEST, ErrorKind.INVALID_REQUEST, message)


RequestHandler = Callable[[object, RequestContext], object]
NotificationHandler = Callable[[object], None]


class MethodTable:
    """Handlers by method name. Its names are what engine/initialize reports as capabilities."""

    def __init__(self) -> None:
        self._requests: dict[str, RequestHandler] = {}
        self._notifications: dict[str, NotificationHandler] = {}

    def add_request(self, method: str, handler: RequestHandler) -> None:
        self._ensure_new(method)
        self._requests[method] = handler

    def add_notification(self, method: str, handler: NotificationHandler) -> None:
        self._ensure_new(method)
        self._notifications[method] = handler

    def request(self, method: str) -> RequestHandler | None:
        return self._requests.get(method)

    def notification(self, method: str) -> NotificationHandler | None:
        return self._notifications.get(method)

    def names(self) -> list[str]:
        return [*self._requests, *self._notifications]

    def _ensure_new(self, method: str) -> None:
        if method in self._requests or method in self._notifications:
            msg = f"{method} is already registered"
            raise ValueError(msg)


class Dispatcher(Protocol):
    """Protocol semantics on top of the transport (implemented by server.Engine)."""

    def handle_request(self, method: str, params: object, context: RequestContext) -> object: ...

    def handle_notification(self, method: str, params: object) -> None: ...


# --- Connection -------------------------------------------------------------------------------


@dataclass(frozen=True, slots=True)
class _Request:
    id: RequestId
    method: str
    params: object
    token: CancelToken


@dataclass(frozen=True, slots=True)
class _Notification:
    method: str
    params: object


@dataclass(frozen=True, slots=True)
class _Stop:
    reason: StopReason


_Item = _Request | _Notification | _Stop


class _InvalidMessageError(Exception):
    def __init__(self, error: RpcError, request_id: RequestId | None = None) -> None:
        super().__init__(error.message)
        self.error = error
        self.request_id = request_id


class Connection:
    """Reads, dispatches and answers messages until exit, end of input or a fatal error."""

    def __init__(
        self,
        reader: ByteReader,
        writer: ByteWriter,
        dispatcher: Dispatcher,
        *,
        exit_notification: str | None = None,
    ) -> None:
        self._input = reader
        self._writer = MessageWriter(writer)
        self._dispatcher = dispatcher
        # The reader stops after this notification, so no thread is left blocked in a read.
        self._exit_notification = exit_notification
        self._inbox: queue.SimpleQueue[_Item] = queue.SimpleQueue()
        self._pending: dict[RequestId, list[CancelToken]] = {}
        self._pending_lock = threading.Lock()
        self._output_closed = threading.Event()
        self._stop: StopReason | None = None
        self._reader = threading.Thread(target=self._read_loop, name="rpc-reader", daemon=True)

    @property
    def reader_alive(self) -> bool:
        return self._reader.is_alive()

    def serve(self) -> StopReason:
        """Process messages on the calling thread. Call it once."""
        self._reader.start()
        while self._stop is None:
            item = self._inbox.get()
            if isinstance(item, _Stop):
                self._stop = item.reason
            elif isinstance(item, _Request):
                self._run_request(item)
            else:
                self._run_notification(item)
        self._reader.join(READER_JOIN_TIMEOUT)
        return self._stop

    # --- serving thread ---

    def _run_request(self, request: _Request) -> None:
        started = time.perf_counter()
        log.debug("<- %s (id %r)", request.method, request.id)
        try:
            if request.token.cancelled:
                log.debug("%s (id %r) was cancelled before it started.", request.method, request.id)
                response = _error_response(request.id, _cancelled(request.method))
            else:
                response = self._call(request)
            if not self._send(response, request):
                self._stop = "output-closed"
        finally:
            self._forget(request)
        log.debug(
            "-> id %r: %s in %.1f ms",
            request.id,
            "error" if "error" in response else "result",
            (time.perf_counter() - started) * 1000,
        )

    def _call(self, request: _Request) -> dict[str, object]:
        context = RequestContext(request.id, request.method, request.token)
        try:
            result = self._dispatcher.handle_request(request.method, request.params, context)
        except RequestCancelledError:
            return _error_response(request.id, _cancelled(request.method))
        except RpcError as error:
            return _error_response(request.id, error)
        except Exception as exc:
            # The traceback goes to stderr only; the client gets the message.
            log.exception("%s (id %r) failed.", request.method, request.id)
            failure = RpcError(
                ErrorCode.INTERNAL_ERROR,
                ErrorKind.INTERNAL,
                f"Internal error in {request.method}.",
                str(exc) or type(exc).__name__,
            )
            return _error_response(request.id, failure)
        return {"jsonrpc": "2.0", "id": request.id, "result": result}

    def _send(self, response: dict[str, object], request: _Request) -> bool:
        try:
            body = encode_message(response)
        except (TypeError, ValueError) as exc:
            log.exception("The result of %s (id %r) is not valid JSON.", request.method, request.id)
            error = RpcError(
                ErrorCode.INTERNAL_ERROR,
                ErrorKind.INTERNAL,
                f"Internal error in {request.method}.",
                f"the result cannot be sent as JSON: {exc}",
            )
            body = encode_message(_error_response(request.id, error))
        return self._write(body)

    def _run_notification(self, notification: _Notification) -> None:
        log.debug("<- %s (notification)", notification.method)
        try:
            self._dispatcher.handle_notification(notification.method, notification.params)
        except RpcError as error:
            detail = f" ({error.detail})" if error.detail else ""
            log.warning("Ignored %s: %s%s", notification.method, error.message, detail)
        except Exception:
            log.exception("Notification %s failed.", notification.method)
        if notification.method == self._exit_notification:
            self._stop = "exit"

    # --- reader thread ---

    def _read_loop(self) -> None:
        reason = self._read_until_stop()
        if reason != "exit":
            # No answer can be read any more: let a running handler stop early, and answer the
            # queued requests without running them.
            self._cancel_all()
        self._inbox.put(_Stop(reason))

    def _read_until_stop(self) -> StopReason:
        try:
            while True:
                body = read_message(self._input)
                if body is None:
                    log.debug("End of input.")
                    return "end-of-input"
                stop = self._accept(body)
                if stop is not None:
                    return stop
        except FramingError as exc:
            log.error("Protocol error: %s. Stopping: the input cannot be resynchronized.", exc)
            return "protocol-error"
        except OSError as exc:
            log.error("Reading the protocol input failed: %s", exc)
            return "end-of-input"
        except Exception:
            log.exception("The message reader failed.")
            return "protocol-error"

    def _accept(self, body: bytes) -> StopReason | None:
        if log.isEnabledFor(TRACE):
            log.log(TRACE, "<- %s", _preview(body))
        try:
            item = _classify(_decode(body))
        except _InvalidMessageError as invalid:
            detail = f" ({invalid.error.detail})" if invalid.error.detail else ""
            log.warning("Rejected a message: %s%s", invalid.error.message, detail)
            response = _error_response(invalid.request_id, invalid.error)
            return None if self._write(encode_message(response)) else "output-closed"
        if item is None:
            return None
        if isinstance(item, _Notification) and item.method == Method.CANCEL_REQUEST:
            self._cancel(item.params)
            return None
        if isinstance(item, _Request):
            self._track(item)
        self._inbox.put(item)
        if isinstance(item, _Notification) and item.method == self._exit_notification:
            return "exit"
        return None

    # --- shared ---

    def _write(self, body: bytes) -> bool:
        if self._output_closed.is_set():
            return False
        if log.isEnabledFor(TRACE):
            log.log(TRACE, "-> %s", _preview(body))
        try:
            self._writer.write(body)
        except OSError as exc:
            if not self._output_closed.is_set():
                self._output_closed.set()
                log.error("The protocol output is closed (%s); the engine stops.", exc)
                self._cancel_all()
            return False
        return True

    def _track(self, request: _Request) -> None:
        with self._pending_lock:
            tokens = self._pending.setdefault(request.id, [])
            if tokens:
                log.warning("Request id %r is already in use by a pending request.", request.id)
            tokens.append(request.token)

    def _forget(self, request: _Request) -> None:
        with self._pending_lock:
            tokens = self._pending.get(request.id, [])
            if request.token in tokens:
                tokens.remove(request.token)
            if not tokens:
                self._pending.pop(request.id, None)

    def _cancel(self, params: object) -> None:
        request_id = params.get("id") if isinstance(params, dict) else None
        if not _is_request_id(request_id):
            log.debug("Ignored %s with invalid params %r.", Method.CANCEL_REQUEST, params)
            return
        with self._pending_lock:
            tokens = list(self._pending.get(request_id, []))
        if not tokens:
            log.debug("Cancel for id %r, which is not pending (already answered?).", request_id)
            return
        log.debug("Cancelling id %r.", request_id)
        for token in tokens:
            token.cancel()

    def _cancel_all(self) -> None:
        with self._pending_lock:
            tokens = [token for group in self._pending.values() for token in group]
        for token in tokens:
            token.cancel()


# --- Message parsing --------------------------------------------------------------------------


def _decode(body: bytes) -> object:
    try:
        return json.loads(body.decode("utf-8"), parse_constant=_reject_constant)
    except (ValueError, RecursionError) as exc:
        error = RpcError(
            ErrorCode.PARSE_ERROR,
            ErrorKind.PARSE_ERROR,
            "Parse error: the message is not valid UTF-8 JSON.",
            str(exc),
        )
        raise _InvalidMessageError(error) from exc


def _reject_constant(name: str) -> object:
    # Python's json accepts NaN and Infinity, JSON does not.
    msg = f"{name} is not valid JSON"
    raise ValueError(msg)


def _classify(message: object) -> _Request | _Notification | None:
    """Turn a decoded message into a queue item; None for messages that need no processing."""
    if isinstance(message, list):
        raise _InvalidMessageError(invalid_request("Batch requests are not supported."))
    if not isinstance(message, dict):
        raise _InvalidMessageError(invalid_request("A message must be a JSON object."))
    request_id = message.get("id")
    echo_id = request_id if _is_request_id(request_id) else None
    if message.get("jsonrpc") != "2.0":
        raise _InvalidMessageError(invalid_request('"jsonrpc" must be "2.0".'), echo_id)
    if "method" not in message:
        if "id" in message and ("result" in message or "error" in message):
            log.warning("Ignored a response (id %r): the engine sends no requests.", request_id)
            return None
        raise _InvalidMessageError(invalid_request('A request needs a "method".'), echo_id)
    method = message["method"]
    if not isinstance(method, str):
        raise _InvalidMessageError(invalid_request('"method" must be a string.'), echo_id)
    params = message.get("params")
    # null is not JSON-RPC 2.0, but other implementations send it for "no params".
    if params is not None and not isinstance(params, dict | list):
        error = invalid_request('"params" must be an object or an array.')
        raise _InvalidMessageError(error, echo_id)
    if "id" not in message:
        return _Notification(method, params)
    if echo_id is None:
        raise _InvalidMessageError(invalid_request('"id" must be a string or an integer.'))
    return _Request(echo_id, method, params, CancelToken())


def _is_request_id(value: object) -> TypeGuard[RequestId]:
    return isinstance(value, str) or (isinstance(value, int) and not isinstance(value, bool))


def _error_response(request_id: RequestId | None, error: RpcError) -> dict[str, object]:
    return {"jsonrpc": "2.0", "id": request_id, "error": error.to_json()}


def _cancelled(method: str) -> RpcError:
    return RpcError(ErrorCode.REQUEST_CANCELLED, ErrorKind.CANCELLED, f"{method} was cancelled.")


def _preview(body: bytes) -> str:
    text = body.decode("utf-8", "replace")
    if len(text) <= _PREVIEW_CHARS:
        return text
    return f"{text[:_PREVIEW_CHARS]}... ({len(body)} bytes)"
