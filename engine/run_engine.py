"""Bootstrap of the Readback analysis engine.

The extension starts it as ``<python> -I -S -X utf8 <extension>/engine/run_engine.py`` with
the engine folder as working directory. Under -I neither the script's folder nor the working
directory is on sys.path, so this file puts engine/ and engine/vendor/ there itself.

This file must stay parseable by Python 2.7 and 3.6 (ASCII only; no f-strings, annotations,
walrus or keyword-only parameters; type comments instead), so that an interpreter that is too
old reports itself with one machine-readable stderr line instead of a SyntaxError. The format of
that line is $defs/FatalStartupError in shared/engine-protocol.schema.json.
"""

import importlib
import json
import os
import sys

MYPY = False
if MYPY:  # typing does not exist on Python 2.7; the names are used in type comments only
    from typing import Sequence, TextIO  # noqa: F401

# Equal to readback_engine.MIN_PYTHON and the values in readback_engine.protocol (the package
# itself cannot be imported before the version check); engine/tests/test_bootstrap.py checks it.
MIN_PYTHON = (3, 10)
FATAL_PREFIX = "READBACK_ENGINE_FATAL "
EXIT_PYTHON_TOO_OLD = 3
EXIT_BOOTSTRAP_FAILED = 4
SERVER_MODULE = "readback_engine.server"


def report_fatal(payload, stream=None):
    # type: (dict[str, str], TextIO | None) -> None
    target = stream or sys.stderr
    target.write(FATAL_PREFIX + json.dumps(payload) + "\n")
    target.flush()


def check_python(version_info=None, stream=None):
    # type: (Sequence[object] | None, TextIO | None) -> int | None
    """Return EXIT_PYTHON_TOO_OLD after reporting, or None if the interpreter is new enough."""
    version = tuple(sys.version_info if version_info is None else version_info)
    if version[:2] >= MIN_PYTHON:
        return None
    report_fatal(
        {
            "code": "python-too-old",
            "version": "%s.%s.%s" % version[:3],
            "required": "%d.%d" % MIN_PYTHON,
        },
        stream,
    )
    return EXIT_PYTHON_TOO_OLD


def engine_paths(script_path=None):
    # type: (str | None) -> list[str]
    """engine/ (this file's folder) and engine/vendor/, as absolute paths."""
    engine_dir = os.path.dirname(os.path.abspath(script_path or __file__))
    return [engine_dir, os.path.join(engine_dir, "vendor")]


def prepend_paths(paths):
    # type: (list[str]) -> None
    """Put ``paths`` at the front of sys.path, in order, without duplicates."""
    for path in reversed(paths):
        while path in sys.path:
            sys.path.remove(path)
        sys.path.insert(0, path)


def start(paths, stream=None, module_name=SERVER_MODULE):
    # type: (list[str], TextIO | None, str) -> int
    """Import the server and run it; a failure before it runs becomes a bootstrap-failed line."""
    try:
        prepend_paths(paths)
        server = importlib.import_module(module_name)
        run = server.main
    except Exception as exc:  # noqa: BLE001 - reported to the extension instead of a traceback
        report_fatal({"code": "bootstrap-failed", "detail": describe(exc)}, stream)
        return EXIT_BOOTSTRAP_FAILED
    return int(run())


def describe(exc):
    # type: (BaseException) -> str
    return "%s: %s" % (type(exc).__name__, exc)


def main():
    # type: () -> int
    code = check_python()
    if code is not None:
        return code
    return start(engine_paths())


if __name__ == "__main__":
    sys.exit(main())
