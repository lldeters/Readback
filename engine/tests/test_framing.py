"""Content-Length framing: rpc.read_message, encode_message, frame and MessageWriter."""

from __future__ import annotations

import io
import json
import threading
from typing import Any

import pytest
import support

from hearback_engine import rpc


class TrickleRaw(io.RawIOBase):
    """A raw stream that hands out at most ``chunk`` bytes per read, like a slow pipe."""

    def __init__(self, data: bytes, chunk: int) -> None:
        self._data = data
        self._chunk = chunk

    def readable(self) -> bool:
        return True

    def readinto(self, buffer: Any, /) -> int:
        size = min(len(buffer), self._chunk, len(self._data))
        buffer[:size] = self._data[:size]
        self._data = self._data[size:]
        return size


class ShortReads:
    """read() returns fewer bytes than asked, which BufferedReader never does on a pipe."""

    def __init__(self, data: bytes, chunk: int) -> None:
        self._stream = io.BytesIO(data)
        self._chunk = chunk

    def readline(self, size: int, /) -> bytes:
        return self._stream.readline(size)

    def read(self, size: int, /) -> bytes:
        return self._stream.read(min(size, self._chunk))


class RecordingWriter:
    def __init__(self, max_write: int | None = None) -> None:
        self.data = bytearray()
        self.flushes = 0
        self._max_write = max_write

    def write(self, data: bytes | memoryview, /) -> int:
        accepted = bytes(data[: self._max_write] if self._max_write else data)
        self.data += accepted
        return len(accepted)

    def flush(self) -> None:
        self.flushes += 1


def frames(*bodies: bytes) -> bytes:
    return b"".join(rpc.frame(body) for body in bodies)


def read_all(stream: rpc.ByteReader) -> list[bytes]:
    bodies = []
    while (body := rpc.read_message(stream)) is not None:
        bodies.append(body)
    return bodies


# --- encoding ---


def test_content_length_counts_utf8_bytes() -> None:
    body = rpc.encode_message({"text": "Größe 😀"})
    assert len(body) > len(body.decode("utf-8"))
    assert rpc.frame(body) == b"Content-Length: %d\r\n\r\n" % len(body) + body


def test_encoding_is_compact_utf8() -> None:
    assert rpc.encode_message({"a": "ü", "b": [1, None]}) == '{"a":"ü","b":[1,null]}'.encode()


def test_lone_surrogates_fall_back_to_escapes() -> None:
    # What os.fsdecode() makes of an undecodable byte in a file name.
    body = rpc.encode_message({"path": "/data/\udcff", "name": "ü"})
    assert body == b'{"path":"/data/\\udcff","name":"\\u00fc"}'
    assert json.loads(body) == {"path": "/data/\udcff", "name": "ü"}


@pytest.mark.parametrize("value", [float("nan"), float("inf"), object()])
def test_values_json_cannot_represent_raise(value: object) -> None:
    with pytest.raises((TypeError, ValueError)):
        rpc.encode_message({"value": value})


# --- reading ---


@pytest.mark.parametrize("chunk", [1, 2, 7, 4096])
def test_partial_reads_reassemble_messages(chunk: int) -> None:
    bodies = [rpc.encode_message({"n": n, "text": "Grüße 😀" * n}) for n in range(5)]
    stream = io.BufferedReader(TrickleRaw(frames(*bodies), chunk), buffer_size=chunk + 1)
    assert read_all(stream) == bodies


def test_short_body_reads_are_completed() -> None:
    body = rpc.encode_message({"text": "x" * 10_000})
    assert read_all(ShortReads(rpc.frame(body), chunk=3)) == [body]


def test_multi_megabyte_payload() -> None:
    body = rpc.encode_message({"text": "Größe ✓ 😀 " * 400_000})
    assert len(body) > 6 * 1024 * 1024
    assert read_all(io.BytesIO(rpc.frame(body) * 2)) == [body, body]


def test_empty_input_is_a_clean_end() -> None:
    assert rpc.read_message(io.BytesIO(b"")) is None


@pytest.mark.parametrize(
    "header",
    [
        b"content-length: 2\r\n\r\n",
        b"CONTENT-LENGTH:2\r\n\r\n",
        b"Content-Length: 0002\r\n\r\n",
        b"Content-Type: application/vscode-jsonrpc; charset=utf-8\r\nContent-Length: 2\r\n\r\n",
        b"Content-Length: 2\r\nContent-Length: 2\r\n\r\n",
        b"Content-Length: 2\n\n",
    ],
)
def test_accepted_header_variants(header: bytes) -> None:
    assert read_all(io.BytesIO(header + b"{}")) == [b"{}"]


@pytest.mark.parametrize(
    ("data", "message"),
    [
        (b"Content-Type: text/plain\r\n\r\n{}", "no Content-Length"),
        (b"\r\n{}", "no Content-Length"),
        (b"Content-Length: abc\r\n\r\n{}", "invalid Content-Length"),
        (b"Content-Length: -1\r\n\r\n{}", "invalid Content-Length"),
        (b"Content-Length: +2\r\n\r\n{}", "invalid Content-Length"),
        (b"Content-Length: 1_0\r\n\r\n{}", "invalid Content-Length"),
        (b"Content-Length: \r\n\r\n{}", "invalid Content-Length"),
        (b"Content-Length: " + b"9" * 5000 + b"\r\n\r\n", "invalid Content-Length"),
        (b"Content-Length: 2\r\nContent-Length: 3\r\n\r\n{}", "conflicting"),
        (b"Content-Length 2\r\n\r\n{}", "malformed header"),
        (b"X-Long: " + b"a" * 9000 + b"\r\n", "longer than"),
        (b"X-A: b\r\n" * 40, "more than 32 header lines"),
        (b"Content-Length: %d\r\n\r\n" % (rpc.MAX_CONTENT_LENGTH + 1), "exceeds the limit"),
        (b"Content-Length: 5\r\n", "inside the message headers"),
        (b"Content-Len", "inside the message headers"),
        (b"Content-Length: 5\r\n\r\nab", "after 2 of 5"),
    ],
)
def test_bad_framing_is_fatal(data: bytes, message: str) -> None:
    with pytest.raises(rpc.FramingError, match=message):
        rpc.read_message(io.BytesIO(data))


def test_oversized_message_is_rejected_before_its_body_is_read() -> None:
    stream = io.BytesIO(b"Content-Length: 99999999999\r\n\r\n" + b"x" * 100)
    with pytest.raises(rpc.FramingError):
        rpc.read_message(stream)
    # Rejected as soon as the header line is parsed.
    assert stream.read() == b"\r\n" + b"x" * 100


# --- writing ---


def test_writer_frames_and_flushes_each_message() -> None:
    sink = RecordingWriter()
    writer = rpc.MessageWriter(sink)
    writer.write(b'{"a":1}')
    writer.write(b"[]")
    assert bytes(sink.data) == b'Content-Length: 7\r\n\r\n{"a":1}Content-Length: 2\r\n\r\n[]'
    assert sink.flushes == 2


def test_writer_completes_partial_writes() -> None:
    sink = RecordingWriter(max_write=3)
    rpc.MessageWriter(sink).write('{"text":"Grüße"}'.encode())
    assert support.split_frames(bytes(sink.data)) == [{"text": "Grüße"}]


def test_writer_fails_when_the_stream_accepts_nothing() -> None:
    class Stuck(RecordingWriter):
        def write(self, data: bytes | memoryview, /) -> int:
            return 0

    with pytest.raises(OSError, match="accepted no data"):
        rpc.MessageWriter(Stuck()).write(b"{}")


def test_concurrent_writes_keep_frames_whole() -> None:
    sink = RecordingWriter(max_write=5)
    writer = rpc.MessageWriter(sink)

    def write_many(thread: int) -> None:
        for n in range(50):
            writer.write(rpc.encode_message({"thread": thread, "n": n, "pad": "ä" * n}))

    threads = [threading.Thread(target=write_many, args=(index,)) for index in range(4)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    messages = support.split_frames(bytes(sink.data))
    assert len(messages) == 200
    for index in range(4):
        assert [m["n"] for m in messages if m["thread"] == index] == list(range(50))
