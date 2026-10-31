"""Engine logging: one record per stderr line, parsed by src/engine/stderrLog.ts.

Format: ``[<level>] <message>`` with level in trace|debug|info|warning|error. Continuation lines
of multi-line messages (tracebacks, warnings) start with four spaces, so the extension can attach
them to the record before. stdout is reserved for the protocol and never carries logs.
"""

import logging
from typing import Final, TextIO

from .protocol import LogLevel

TRACE: Final = 5
# Above CRITICAL, so that "off" silences every record, errors included.
OFF: Final = logging.CRITICAL + 10
DEFAULT_LEVEL: Final[LogLevel] = "info"

LEVELS: Final[dict[LogLevel, int]] = {
    "trace": TRACE,
    "debug": logging.DEBUG,
    "info": logging.INFO,
    "warning": logging.WARNING,
    "error": logging.ERROR,
    "off": OFF,
}

CONTINUATION: Final = "    "

logging.addLevelName(TRACE, "TRACE")


def level_label(levelno: int) -> str:
    """The protocol name of a logging level; CRITICAL and custom levels map to the next lower."""
    if levelno >= logging.ERROR:
        return "error"
    if levelno >= logging.WARNING:
        return "warning"
    if levelno >= logging.INFO:
        return "info"
    if levelno >= logging.DEBUG:
        return "debug"
    return "trace"


class LineFormatter(logging.Formatter):
    """Formats a record as one ``[level] message`` line plus indented continuation lines."""

    def format(self, record: logging.LogRecord) -> str:
        text = record.getMessage()
        if record.exc_info:
            text = f"{text}\n{self.formatException(record.exc_info)}"
        if record.stack_info:
            text = f"{text}\n{self.formatStack(record.stack_info)}"
        # splitlines() also breaks at \r and other separators, so no record can fake a new line.
        first, *rest = text.splitlines() or [""]
        lines = [f"[{level_label(record.levelno)}] {first}"]
        lines.extend(CONTINUATION + line for line in rest)
        return "\n".join(lines)


def install(stream: TextIO, level: LogLevel = DEFAULT_LEVEL) -> logging.Handler:
    """Route all logging (the engine's, vendored libraries' and warnings) to ``stream``."""
    handler = logging.StreamHandler(stream)
    handler.setFormatter(LineFormatter())
    logging.getLogger().addHandler(handler)
    set_level(level)
    logging.captureWarnings(True)
    return handler


def set_level(level: LogLevel) -> None:
    logging.getLogger().setLevel(LEVELS[level])
