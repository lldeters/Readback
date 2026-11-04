"""The engine's own code imports no network, process or native-code modules (spec 5.2).

Vendored libraries import some of these transitively; the sandbox covers them at runtime
(test_sandbox.py). This test covers hearback_engine/ and the bootstrap, like ruff's banned-api.
"""

from __future__ import annotations

import ast
from collections.abc import Collection, Iterator
from pathlib import Path

import pytest
import support

BANNED_MODULES = (
    "socket",
    "ssl",
    "http",
    "urllib.request",
    "ftplib",
    "smtplib",
    "subprocess",
    "multiprocessing",
    "concurrent.futures.ProcessPoolExecutor",
    "concurrent.futures.process",
    "_posixsubprocess",
    "ctypes",
)
# Process creation through os itself.
BANNED_OS_ATTRIBUTES = {"system", "popen", "startfile", "fork", "forkpty", "posix_spawn"}
BANNED_OS_PREFIXES = ("exec", "spawn")
# The sandbox wraps _posixsubprocess.fork_exec so that it raises an audit event on every Python
# version (ruff's banned-api has a noqa on the same import).
ALLOWED_IMPORTS = {"hearback_engine/sandbox.py": {"_posixsubprocess"}}

ENGINE_SOURCES = [
    *sorted((support.ENGINE_DIR / "hearback_engine").rglob("*.py")),
    support.BOOTSTRAP,
]


def imported_modules(tree: ast.AST) -> Iterator[tuple[int, str]]:
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                yield node.lineno, alias.name
        elif isinstance(node, ast.ImportFrom) and node.level == 0 and node.module:
            yield node.lineno, node.module
            for alias in node.names:  # from urllib import request
                yield node.lineno, f"{node.module}.{alias.name}"
        elif isinstance(node, ast.Call) and node.args and isinstance(node.args[0], ast.Constant):
            function = node.func
            name = getattr(function, "id", None) or getattr(function, "attr", None)
            if name in ("__import__", "import_module") and isinstance(node.args[0].value, str):
                yield node.lineno, node.args[0].value


def banned(module: str) -> bool:
    return any(module == name or module.startswith(f"{name}.") for name in BANNED_MODULES)


def process_calls(tree: ast.AST) -> Iterator[tuple[int, str]]:
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Attribute)
            and isinstance(node.value, ast.Name)
            and node.value.id == "os"
            and (node.attr in BANNED_OS_ATTRIBUTES or node.attr.startswith(BANNED_OS_PREFIXES))
        ):
            yield node.lineno, f"os.{node.attr}"


def violations(source: str, allowed: Collection[str] = ()) -> list[str]:
    """Banned imports and os calls; ``allowed`` lists modules that may be imported anyway."""
    tree = ast.parse(source)
    found = [
        f"{line}: import {module}"
        for line, module in imported_modules(tree)
        if banned(module) and module not in allowed
    ]
    found += [f"{line}: {call}" for line, call in process_calls(tree)]
    return found


def relative_name(path: Path) -> str:
    return path.relative_to(support.ENGINE_DIR).as_posix()


@pytest.mark.parametrize("path", ENGINE_SOURCES, ids=lambda path: path.name)
def test_engine_code_avoids_network_and_processes(path: Path) -> None:
    allowed = ALLOWED_IMPORTS.get(relative_name(path), set())
    assert violations(path.read_text(encoding="utf-8"), allowed) == []


def test_every_engine_module_is_checked() -> None:
    names = {relative_name(path) for path in ENGINE_SOURCES}
    assert {"run_engine.py", "hearback_engine/server.py", "hearback_engine/rpc.py"} <= names
    assert set(ALLOWED_IMPORTS) <= names


def test_the_allowed_imports_are_needed() -> None:
    """An exception that nothing uses any more is removed, not kept as a loophole."""
    for name, modules in ALLOWED_IMPORTS.items():
        found = violations((support.ENGINE_DIR / name).read_text(encoding="utf-8"))
        assert {entry.partition(": import ")[2] for entry in found} == modules, found


@pytest.mark.parametrize(
    "source",
    [
        "import socket",
        "import http.client",
        "import urllib.request as r",
        "from urllib import request",
        "from subprocess import run",
        "import multiprocessing.pool",
        "from concurrent.futures import ProcessPoolExecutor",
        "import concurrent.futures.process",
        "from concurrent.futures.process import _process_worker",
        "import _posixsubprocess",
        "import ctypes.util",
        "__import__('ssl')",
        "importlib.import_module('socket')",
        "os.system('x')",
        "os.execv(a, b)",
        "os.spawnl(1, 'x')",
        "os.posix_spawn('x', [], {})",
    ],
)
def test_the_check_finds_violations(source: str) -> None:
    assert violations(source)


@pytest.mark.parametrize(
    "source",
    [
        "import urllib.parse",
        "import socketlike",
        "from os import path",
        "os.getpid()",
        "from concurrent.futures import ThreadPoolExecutor",
    ],
)
def test_the_check_allows_harmless_code(source: str) -> None:
    assert violations(source) == []


def test_allowed_imports_are_exact() -> None:
    assert violations("import _posixsubprocess", {"_posixsubprocess"}) == []
    assert violations("import subprocess\nimport _posixsubprocess", {"_posixsubprocess"}) == [
        "1: import subprocess"
    ]
