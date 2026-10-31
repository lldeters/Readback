"""The engine's own code imports no network, process or native-code modules (spec 5.2).

Vendored libraries import some of these transitively; the sandbox covers them at runtime
(test_sandbox.py). This test covers readback_engine/ and the bootstrap, like ruff's banned-api.
"""

from __future__ import annotations

import ast
from collections.abc import Iterator
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
    "ctypes",
)
# Process creation through os itself.
BANNED_OS_ATTRIBUTES = {"system", "popen", "startfile", "fork", "forkpty", "posix_spawn"}
BANNED_OS_PREFIXES = ("exec", "spawn")

ENGINE_SOURCES = [
    *sorted((support.ENGINE_DIR / "readback_engine").rglob("*.py")),
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


def violations(source: str) -> list[str]:
    tree = ast.parse(source)
    found = [
        f"{line}: import {module}" for line, module in imported_modules(tree) if banned(module)
    ]
    found += [f"{line}: {call}" for line, call in process_calls(tree)]
    return found


@pytest.mark.parametrize("path", ENGINE_SOURCES, ids=lambda path: path.name)
def test_engine_code_avoids_network_and_processes(path: Path) -> None:
    assert violations(path.read_text(encoding="utf-8")) == []


def test_every_engine_module_is_checked() -> None:
    names = {path.relative_to(support.ENGINE_DIR).as_posix() for path in ENGINE_SOURCES}
    assert {"run_engine.py", "readback_engine/server.py", "readback_engine/rpc.py"} <= names


@pytest.mark.parametrize(
    "source",
    [
        "import socket",
        "import http.client",
        "import urllib.request as r",
        "from urllib import request",
        "from subprocess import run",
        "import multiprocessing.pool",
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
    "source", ["import urllib.parse", "import socketlike", "from os import path", "os.getpid()"]
)
def test_the_check_allows_harmless_code(source: str) -> None:
    assert violations(source) == []
