"""engine/run_engine.py: version check, sys.path setup, the sandbox before the server, and
machine-readable startup failures."""

from __future__ import annotations

import ast
import importlib
import io
import json
import re
import shutil
import subprocess
import sys
from collections.abc import Iterator
from pathlib import Path
from typing import Any

import pytest
import support

import hearback_engine
import run_engine
from hearback_engine import protocol


def fatal_payload(text: str) -> dict[str, Any]:
    """The JSON of the single FATAL line in ``text``."""
    assert text.endswith("\n") and text.count("\n") == 1, repr(text)
    assert text.startswith(protocol.FATAL_PREFIX)
    payload: dict[str, Any] = json.loads(text[len(protocol.FATAL_PREFIX) :])
    return payload


def test_constants_match_the_engine() -> None:
    assert run_engine.MIN_PYTHON == hearback_engine.MIN_PYTHON
    assert run_engine.FATAL_PREFIX == protocol.FATAL_PREFIX
    assert run_engine.EXIT_PYTHON_TOO_OLD == protocol.ExitCode.PYTHON_TOO_OLD
    assert run_engine.EXIT_BOOTSTRAP_FAILED == protocol.ExitCode.BOOTSTRAP_FAILED


@pytest.mark.parametrize(
    ("version_info", "version"),
    [((3, 9, 6, "final", 0), "3.9.6"), ((2, 7, 18, "final", 0), "2.7.18"), ((3, 6, 15), "3.6.15")],
)
def test_too_old_python_is_reported(
    protocol_schema: dict[str, Any], version_info: tuple[object, ...], version: str
) -> None:
    stream = io.StringIO()
    assert run_engine.check_python(version_info, stream) == 3
    payload = fatal_payload(stream.getvalue())
    assert payload == {"code": "python-too-old", "version": version, "required": "3.10"}
    support.assert_valid(protocol_schema, "FatalStartupError", payload)


@pytest.mark.parametrize("version_info", [(3, 10, 0), (3, 15, 2), (4, 0, 0), sys.version_info])
def test_supported_python_passes(version_info: tuple[object, ...]) -> None:
    stream = io.StringIO()
    assert run_engine.check_python(version_info, stream) is None
    assert stream.getvalue() == ""


def test_engine_paths_come_from_the_script_location(tmp_path: Path) -> None:
    script = tmp_path / "engine" / "run_engine.py"
    assert run_engine.engine_paths(str(script)) == [
        str(tmp_path / "engine"),
        str(tmp_path / "engine" / "vendor"),
    ]
    assert run_engine.engine_paths() == [str(support.ENGINE_DIR), str(support.VENDOR_DIR)]


def test_prepend_paths_puts_them_first_without_duplicates(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(sys, "path", ["/stdlib", "/b", "/a", "/stdlib/lib-dynload"])
    run_engine.prepend_paths(["/a", "/b"])
    assert sys.path == ["/a", "/b", "/stdlib", "/stdlib/lib-dynload"]


# Stand-ins that start() imports from a test folder instead of hearback_engine. The real sandbox
# must never be installed in the pytest process: audit hooks cannot be removed, and it would
# refuse every later subprocess.
FAKE_SANDBOX = "EVENTS = []\n\ndef install():\n    EVENTS.append('install')\n    return True\n"
FAKE_SERVER = """\
import hb_fake_sandbox
hb_fake_sandbox.EVENTS.append('import server')

def main():
    hb_fake_sandbox.EVENTS.append('main')
    return 7
"""


@pytest.fixture
def modules(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Iterator[Path]:
    """A folder with the stand-in modules; start() puts it first on sys.path."""
    monkeypatch.setattr(sys, "path", list(sys.path))
    (tmp_path / "hb_fake_sandbox.py").write_text(FAKE_SANDBOX, encoding="utf-8")
    (tmp_path / "hb_fake_server.py").write_text(FAKE_SERVER, encoding="utf-8")
    yield tmp_path
    for name in [name for name in sys.modules if name.startswith("hb_")]:
        del sys.modules[name]


def test_start_installs_the_sandbox_before_it_imports_the_server(modules: Path) -> None:
    stream = io.StringIO()
    assert run_engine.start([str(modules)], stream, "hb_fake_server", "hb_fake_sandbox") == 7
    assert sys.modules["hb_fake_sandbox"].EVENTS == ["install", "import server", "main"]
    assert stream.getvalue() == ""


@pytest.mark.parametrize(
    ("source", "detail"),
    [
        (None, "ModuleNotFoundError: No module named 'hb_missing_server'"),
        ("raise RuntimeError('boom')\n", "RuntimeError: boom"),
        ("x = 1\n", "AttributeError: module 'hb_missing_server' has no attribute 'main'"),
    ],
)
def test_failures_before_the_server_runs_are_reported(
    modules: Path, protocol_schema: dict[str, Any], source: str | None, detail: str
) -> None:
    if source is not None:
        (modules / "hb_missing_server.py").write_text(source, encoding="utf-8")
    stream = io.StringIO()
    assert run_engine.start([str(modules)], stream, "hb_missing_server", "hb_fake_sandbox") == 4
    payload = fatal_payload(stream.getvalue())
    assert payload == {"code": "bootstrap-failed", "detail": detail}
    support.assert_valid(protocol_schema, "FatalStartupError", payload)
    assert sys.path[0] == str(modules)


@pytest.mark.parametrize(
    ("source", "detail"),
    [
        (None, "ModuleNotFoundError: No module named 'hb_missing_sandbox'"),
        ("def install():\n    raise RuntimeError('no hook')\n", "RuntimeError: no hook"),
        ("x = 1\n", "AttributeError: module 'hb_missing_sandbox' has no attribute 'install'"),
    ],
)
def test_without_a_sandbox_the_server_is_not_even_imported(
    modules: Path, source: str | None, detail: str
) -> None:
    if source is not None:
        (modules / "hb_missing_sandbox.py").write_text(source, encoding="utf-8")
    stream = io.StringIO()
    assert run_engine.start([str(modules)], stream, "hb_fake_server", "hb_missing_sandbox") == 4
    assert fatal_payload(stream.getvalue()) == {"code": "bootstrap-failed", "detail": detail}
    assert "hb_fake_server" not in sys.modules


def test_the_server_is_imported_under_the_real_sandbox(
    tmp_path: Path, protocol_schema: dict[str, Any]
) -> None:
    """Module-level code of the server already runs under the audit hook (in a subprocess,
    because the hook cannot be removed again)."""
    (tmp_path / "hb_eager_server.py").write_text(
        "import os\nos.system('exit 0')\n\n\ndef main():\n    return 0\n", encoding="utf-8"
    )
    code = (
        "import sys; sys.path[0:0] = [sys.argv[1]]; import run_engine;"
        "sys.exit(run_engine.start([sys.argv[2], *run_engine.engine_paths()], None,"
        " 'hb_eager_server'))"
    )
    result = subprocess.run(
        [*support.isolated_python(code), str(support.ENGINE_DIR), str(tmp_path)],
        cwd=tmp_path,
        env=support.sanitized_env(),
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    assert result.returncode == 4, result.stderr
    # Before logging is set up, the sandbox's warning goes to stderr as a plain line (the
    # command is bytes on POSIX and str on Windows).
    warning, fatal = result.stderr.splitlines()
    assert re.fullmatch(r"Sandbox blocked os\.system \(b?'exit 0'\)\.", warning), warning
    payload = fatal_payload(fatal + "\n")
    assert payload == {
        "code": "bootstrap-failed",
        "detail": "PermissionError: Hearback engine sandbox: os.system is not allowed",
    }
    support.assert_valid(protocol_schema, "FatalStartupError", payload)


def test_main_runs_the_version_check_first(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[list[str]] = []

    def start(paths: list[str]) -> int:
        calls.append(paths)
        return 0

    monkeypatch.setattr(run_engine, "start", start)
    monkeypatch.setattr(run_engine, "check_python", lambda: 3)
    assert run_engine.main() == 3
    assert calls == []
    monkeypatch.setattr(run_engine, "check_python", lambda: None)
    assert run_engine.main() == 0
    assert calls == [run_engine.engine_paths()]


def test_broken_layout_in_a_real_process(tmp_path: Path, protocol_schema: dict[str, Any]) -> None:
    """run_engine.py without hearback_engine next to it, started like the extension does."""
    script = tmp_path / "run_engine.py"
    shutil.copy(support.BOOTSTRAP, script)
    result = subprocess.run(
        support.engine_command(script),
        cwd=tmp_path,
        env=support.sanitized_env(),
        input=b"",
        capture_output=True,
        timeout=30,
        check=False,
    )
    assert result.returncode == 4
    assert result.stdout == b""
    payload = fatal_payload(result.stderr.decode("utf-8"))
    assert payload == {
        "code": "bootstrap-failed",
        "detail": "ModuleNotFoundError: No module named 'hearback_engine'",
    }
    support.assert_valid(protocol_schema, "FatalStartupError", payload)


# --- Python 2.7 and 3.6 must be able to parse the bootstrap ---

SOURCE = support.BOOTSTRAP.read_text(encoding="utf-8")


def test_bootstrap_is_ascii() -> None:
    # Python 2 rejects non-ASCII source without a coding declaration.
    assert SOURCE.isascii()


def python3_only_syntax(source: str) -> list[str]:
    """Constructs that Python 2.7 cannot parse (or parses differently), with their lines."""
    tree = ast.parse(source)
    call_arguments = {
        id(argument)
        for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        for argument in node.args
    }
    forbidden: tuple[type[ast.AST], ...] = (
        ast.JoinedStr,
        ast.NamedExpr,
        ast.AnnAssign,
        ast.Await,
        ast.AsyncFunctionDef,
        ast.AsyncFor,
        ast.AsyncWith,
        ast.Nonlocal,
        ast.YieldFrom,
        ast.MatMult,
        ast.Match,
    )
    problems = []
    for node in ast.walk(tree):
        line = getattr(node, "lineno", "?")
        if isinstance(node, forbidden):
            problems.append(f"{line}: {type(node).__name__}")
        elif isinstance(node, ast.FunctionDef):
            arguments = node.args
            if arguments.kwonlyargs or arguments.posonlyargs or node.returns:
                problems.append(f"{line}: keyword-only, positional-only or return annotation")
            if any(argument.annotation for argument in arguments.args):
                problems.append(f"{line}: parameter annotation")
        elif isinstance(node, ast.Raise) and node.cause is not None:
            problems.append(f"{line}: raise ... from")
        elif isinstance(node, ast.Starred) and id(node) not in call_arguments:
            problems.append(f"{line}: starred assignment or display")
        elif isinstance(node, ast.Dict) and None in node.keys:
            problems.append(f"{line}: dict unpacking")
        elif isinstance(node, ast.Call) and isinstance(node.func, ast.Name):
            if node.func.id in {"print", "exec"}:
                problems.append(f"{line}: {node.func.id} is a statement in Python 2")
        elif isinstance(node, ast.Constant) and node.value is Ellipsis:
            problems.append(f"{line}: Ellipsis literal")
    return problems


def test_bootstrap_uses_no_syntax_newer_than_python_2_7() -> None:
    assert python3_only_syntax(SOURCE) == []


@pytest.mark.parametrize(
    "snippet",
    [
        "x = f'{y}'",
        "def f(a: int): pass",
        "def f() -> int: pass",
        "def f(*, a): pass",
        "if (x := 1): pass",
        "a, *b = c",
        "d = {**e}",
        "raise X from Y",
        "print('x', file=y)",
        "x = ...",
    ],
)
def test_the_syntax_check_finds_python_3_constructs(snippet: str) -> None:
    assert python3_only_syntax(snippet)


def test_the_syntax_check_allows_python_2_7_constructs() -> None:
    assert python3_only_syntax("f(*args, **kwargs)\nx = {1: 2}\ny = {a for a in b}\n") == []


def test_bootstrap_parses_with_the_python_3_6_grammar(vendored: Path) -> None:
    parso = importlib.import_module("parso")
    grammar = parso.load_grammar(version="3.6")
    errors = list(grammar.iter_errors(grammar.parse(SOURCE)))
    assert not errors, [(error.start_pos, error.message) for error in errors]
