"""The stderr log format that src/engine/stderrLog.ts parses."""

from __future__ import annotations

import io
import logging
import sys
import warnings

import pytest
import support

from hearback_engine import logs


def record(level: int, message: str, *, exc: bool = False) -> logging.LogRecord:
    exc_info = None
    if exc:
        try:
            raise ValueError("bad value")
        except ValueError:
            exc_info = sys.exc_info()
    return logging.LogRecord("hearback.test", level, __file__, 1, message, None, exc_info)


def format_record(level: int, message: str, *, exc: bool = False) -> str:
    return logs.LineFormatter().format(record(level, message, exc=exc))


@pytest.mark.parametrize(
    ("level", "label"),
    [
        (1, "trace"),
        (logs.TRACE, "trace"),
        (logging.DEBUG, "debug"),
        (15, "debug"),
        (logging.INFO, "info"),
        (logging.WARNING, "warning"),
        (logging.ERROR, "error"),
        (logging.CRITICAL, "error"),
    ],
)
def test_level_labels(level: int, label: str) -> None:
    assert logs.level_label(level) == label
    assert format_record(level, "hello") == f"[{label}] hello"


def test_multi_line_messages_get_continuation_lines() -> None:
    text = format_record(logging.WARNING, "first\nsecond\r\nthird\rfourth\n\nsixth")
    assert text.split("\n") == [
        "[warning] first",
        "    second",
        "    third",
        "    fourth",
        "    ",
        "    sixth",
    ]


def test_empty_message() -> None:
    assert format_record(logging.INFO, "") == "[info] "


def test_tracebacks_are_continuation_lines() -> None:
    lines = format_record(logging.ERROR, "it failed", exc=True).split("\n")
    assert lines[0] == "[error] it failed"
    assert lines[1] == "    Traceback (most recent call last):"
    assert lines[-1] == "    ValueError: bad value"
    assert all(line.startswith("    ") for line in lines[1:])


def test_stack_info_is_included() -> None:
    entry = record(logging.INFO, "where")
    entry.stack_info = "Stack (most recent call last):\n  File x"
    assert logs.LineFormatter().format(entry).split("\n") == [
        "[info] where",
        "    Stack (most recent call last):",
        "      File x",
    ]


def test_install_routes_all_logging_and_warnings() -> None:
    stream = io.StringIO()
    logs.install(stream, "debug")
    logging.getLogger("hearback.test").debug("from the engine")
    logging.getLogger("sqlglot").warning("from a library")
    logging.getLogger("hearback.test").log(logs.TRACE, "hidden at debug")
    with warnings.catch_warnings():
        warnings.simplefilter("always")
        warnings.warn("deprecated thing", DeprecationWarning, stacklevel=1)
    records = support.assert_log_lines(stream.getvalue())
    assert records[:2] == ["[debug] from the engine", "[warning] from a library"]
    assert (
        records[2].startswith("[warning] ") and "DeprecationWarning: deprecated thing" in records[2]
    )
    assert len(records) == 3


def test_levels_filter_records() -> None:
    stream = io.StringIO()
    logs.install(stream)
    logger = logging.getLogger("hearback.test")
    logger.debug("not at info")
    logger.info("at info")
    logs.set_level("trace")
    logger.log(logs.TRACE, "at trace")
    logs.set_level("off")
    logger.critical("silenced")
    logs.set_level("error")
    logger.warning("not at error")
    logger.error("at error")
    assert stream.getvalue().splitlines() == [
        "[info] at info",
        "[trace] at trace",
        "[error] at error",
    ]


def test_every_protocol_level_has_a_logging_level() -> None:
    assert list(logs.LEVELS) == ["trace", "debug", "info", "warning", "error", "off"]
    assert logs.LEVELS["off"] > logging.CRITICAL
    assert logging.getLevelName(logs.TRACE) == "TRACE"
