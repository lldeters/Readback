"""The audit-hook sandbox. Audit hooks cannot be removed, so the real one runs in subprocesses."""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

import pytest
import support

from readback_engine import sandbox

FORK_EXEC_REFUSED = f"Readback engine sandbox: {sandbox.FORK_EXEC_EVENT} is not allowed"

# Runs inside the sandboxed subprocess; prints one JSON report on stdout.
PROBE = r"""
import json, os, sys
engine, vendor = sys.argv[1], sys.argv[2]
sys.path[0:0] = [engine, vendor]
from readback_engine import sandbox
report = {"installed": sandbox.install()}

def attempt(name, action):
    try:
        action()
    except Exception as error:
        # Libraries may wrap the sandbox's PermissionError: on Windows, importing ctypes loads
        # kernel32 and ctypes turns the refusal into AttributeError('kernel32').
        cause = error
        while cause is not None and not isinstance(cause, PermissionError):
            cause = cause.__cause__ or cause.__context__
        if cause is not None:
            report[name] = "blocked: " + str(cause)
        else:
            report[name] = "failed differently: %r" % (error,)
    else:
        report[name] = "allowed"

import socket, subprocess
attempt("popen", lambda: subprocess.Popen([sys.executable, "-c", "pass"]))
attempt("os.system", lambda: os.system("exit 0"))
def fork():
    if os.fork() == 0:  # only reached if the sandbox failed: never run the rest twice
        os._exit(0)
if hasattr(os, "fork"):
    attempt("fork", fork)
def connect():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.connect(("127.0.0.1", 9))
attempt("socket.connect", connect)
attempt("getaddrinfo", lambda: socket.getaddrinfo("localhost", 80))
def load_native():
    import ctypes  # POSIX: dlopens the interpreter; Windows: loads kernel32 (both audited)
    ctypes.CDLL("kernel32" if os.name == "nt" else None)
attempt("ctypes", load_native)

# multiprocessing outside subprocess.Popen: on POSIX through _posixsubprocess.fork_exec, which
# raises no audit event of its own before Python 3.14, on Windows through _winapi.CreateProcess.
import multiprocessing
from concurrent.futures import ProcessPoolExecutor
spawn = multiprocessing.get_context("spawn")
attempt("spawn", lambda: spawn.Process(target=os.getpid).start())
def process_pool():
    with ProcessPoolExecutor(max_workers=1, mp_context=spawn) as pool:
        pool.submit(os.getpid).result(timeout=30)
attempt("process pool", process_pool)
if os.name == "posix":  # a named semaphore starts the resource tracker; Windows has none
    attempt("resource tracker", spawn.Lock)
if "forkserver" in multiprocessing.get_all_start_methods():
    # Its resource tracker starts before socket.bind would refuse the fork server's socket.
    forkserver = multiprocessing.get_context("forkserver")
    attempt("forkserver", lambda: forkserver.Process(target=os.getpid).start())

def vendored():
    import sqlglot, parso, jedi
    assert sqlglot.parse_one("SELECT a FROM t", read="spark").sql() == "SELECT a FROM t"
    assert parso.parse("def f(x):\n    return x\n").get_code() == "def f(x):\n    return x\n"
    jedi.settings.cache_directory = sys.argv[3]
    script = jedi.Script("import json\njson.dum", environment=jedi.InterpreterEnvironment())
    assert [c.name for c in script.complete()] == ["dump", "dumps"]
    report["versions"] = [sqlglot.__version__, parso.__version__, jedi.__version__]
attempt("vendored", vendored)

def read_files():
    with open(os.path.join(engine, "readback_engine", "__init__.py"), encoding="utf-8") as f:
        assert "ENGINE_VERSION" in f.read()
    os.listdir(vendor)
attempt("files", read_files)
print(json.dumps(report))
"""


@pytest.fixture(scope="module")
def report(tmp_path_factory: pytest.TempPathFactory) -> dict[str, Any]:
    if not (support.VENDOR_DIR / "VENDOR.json").is_file():
        pytest.fail("engine/vendor/ is missing; run: python scripts/vendor_engine.py")
    cache = tmp_path_factory.mktemp("jedi-cache")
    result = subprocess.run(
        [
            *support.isolated_python(PROBE),
            str(support.ENGINE_DIR),
            str(support.VENDOR_DIR),
            str(cache),
        ],
        capture_output=True,
        text=True,
        timeout=120,
        env=support.sanitized_env(),
        check=False,
    )
    assert result.returncode == 0, result.stderr
    outcome: dict[str, Any] = json.loads(result.stdout)
    return outcome


def test_the_hook_is_verified_active(report: dict[str, Any]) -> None:
    assert report["installed"] is True


MULTIPROCESSING_ATTEMPTS = ["spawn", "process pool", "resource tracker", "forkserver"]
DANGEROUS_ATTEMPTS = [
    "popen",
    "os.system",
    "fork",
    "socket.connect",
    "getaddrinfo",
    "ctypes",
    *MULTIPROCESSING_ATTEMPTS,
]


@pytest.mark.parametrize("attempt", DANGEROUS_ATTEMPTS)
def test_dangerous_operations_are_blocked(report: dict[str, Any], attempt: str) -> None:
    if attempt not in report:
        pytest.skip(f"{attempt} does not exist on this platform")
    assert report[attempt].startswith("blocked: Readback engine sandbox: "), report[attempt]


@pytest.mark.skipif(sys.platform == "win32", reason="Windows has no _posixsubprocess")
@pytest.mark.parametrize("attempt", MULTIPROCESSING_ATTEMPTS)
def test_multiprocessing_is_stopped_at_fork_exec(report: dict[str, Any], attempt: str) -> None:
    """Before any process starts: for forkserver this also means before its resource tracker."""
    if attempt not in report:
        pytest.skip(f"{attempt} does not exist on this platform")
    assert report[attempt] == f"blocked: {FORK_EXEC_REFUSED}", report[attempt]


def test_vendored_packages_and_files_still_work(report: dict[str, Any], vendored: Path) -> None:
    assert report["vendored"] == "allowed"
    assert report["files"] == "allowed"
    locked = {
        package["name"]: package["version"]
        for package in support.load_json(vendored / "VENDOR.json")["packages"]
    }
    assert report["versions"] == [locked["sqlglot"], locked["parso"], locked["jedi"]]


# install() twice under an earlier hook that counts (and with "veto" refuses) new hooks.
INSTALL_TWICE = r"""
import json, sys
sys.path[0:0] = [sys.argv[1]]
added = []
def earlier_hook(event, args):
    if event == "sys.addaudithook":
        added.append(event)
        if sys.argv[2] == "veto":
            raise RuntimeError("no more hooks")  # sys.addaudithook() then skips the new hook
sys.addaudithook(earlier_hook)
from readback_engine import sandbox
print(json.dumps([sandbox.install(), sandbox.install(), len(added)]))
"""


@pytest.mark.parametrize(("mode", "installed"), [("allow", True), ("veto", False)])
def test_a_second_install_adds_no_hook_and_reports_the_same_state(
    mode: str, installed: bool
) -> None:
    result = subprocess.run(
        [*support.isolated_python(INSTALL_TWICE), str(support.ENGINE_DIR), mode],
        capture_output=True,
        text=True,
        timeout=60,
        env=support.sanitized_env(),
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout) == [installed, installed, 1]


# --- the hook itself, without installing it ---


@pytest.mark.parametrize("event", sorted(sandbox.BLOCKED_EVENTS))
def test_hook_refuses_blocked_events(event: str, caplog: pytest.LogCaptureFixture) -> None:
    hook = sandbox.SandboxHook()
    with pytest.raises(PermissionError, match=re.escape(f"sandbox: {event} is not allowed")):
        hook(event, ("x" * 500,))
    assert f"Sandbox blocked {event} ('xxx" in caplog.text
    assert len(caplog.records[-1].getMessage()) < 200


def test_the_log_never_shows_the_environment(caplog: pytest.LogCaptureFixture) -> None:
    hook = sandbox.SandboxHook()
    with pytest.raises(PermissionError):
        hook("subprocess.Popen", ("/usr/bin/git", ["git"], None, {"API_KEY": "secret"}))
    with pytest.raises(PermissionError):
        hook("subprocess.Popen", (None, ["python3", "--token=x"], "/w", {"API_KEY": "secret"}))
    with pytest.raises(PermissionError):
        hook("os.exec", ())
    with pytest.raises(PermissionError):
        hook(sandbox.FORK_EXEC_EVENT, ([b"/usr/bin/git"], ["git"], [b"API_KEY=secret"]))
    messages = [record.getMessage() for record in caplog.records]
    assert messages == [
        "Sandbox blocked subprocess.Popen ('/usr/bin/git').",
        "Sandbox blocked subprocess.Popen ('python3').",
        "Sandbox blocked os.exec (no arguments).",
        "Sandbox blocked _posixsubprocess.fork_exec ([b'/usr/bin/git']).",
    ]


@pytest.mark.parametrize(
    "event", ["open", "import", "compile", "exec", "os.listdir", "socket.__new__", "os.chdir"]
)
def test_hook_allows_everything_else(event: str) -> None:
    hook = sandbox.SandboxHook()
    hook(event, ())
    assert hook.active is False


def test_probe_event_marks_the_hook_active() -> None:
    hook = sandbox.SandboxHook()
    hook(sandbox.PROBE_EVENT, ())
    assert hook.active is True


# --- the fork_exec wrapper, with sys.audit replaced instead of a real hook ---

# fork_exec(args, executable_list, close_fds, pass_fds, cwd, env, ...), shortened.
FORK_EXEC_ARGUMENTS = (["git", "status"], [b"/usr/bin/git"], True, (), None, [b"API_KEY=x"], -1)


def test_fork_exec_raises_the_native_event_before_it_runs(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[tuple[object, ...]] = []
    monkeypatch.setattr(sys, "audit", lambda *event: calls.append(event))

    def original(*args: object) -> int:
        calls.append(("fork_exec", *args))
        return 4242

    assert sandbox.audited_fork_exec(original)(*FORK_EXEC_ARGUMENTS) == 4242
    # The arguments of the event that Python 3.14 and later raise: executable_list, args, env.
    assert calls == [
        (sandbox.FORK_EXEC_EVENT, [b"/usr/bin/git"], ["git", "status"], [b"API_KEY=x"]),
        ("fork_exec", *FORK_EXEC_ARGUMENTS),
    ]


def test_a_refused_fork_exec_never_runs(monkeypatch: pytest.MonkeyPatch) -> None:
    hook = sandbox.SandboxHook()
    monkeypatch.setattr(sys, "audit", lambda event, *args: hook(event, args))

    def original(*args: object) -> int:
        pytest.fail("fork_exec ran although the hook refused it")

    with pytest.raises(PermissionError, match=re.escape(FORK_EXEC_REFUSED)):
        sandbox.audited_fork_exec(original)(*FORK_EXEC_ARGUMENTS)


def test_event_groups() -> None:
    assert {"subprocess.Popen", "os.posix_spawn", "_winapi.CreateProcess"} <= sandbox.PROCESS_EVENTS
    assert sandbox.FORK_EXEC_EVENT == "_posixsubprocess.fork_exec"
    assert sandbox.FORK_EXEC_EVENT in sandbox.PROCESS_EVENTS
    assert {"socket.connect", "urllib.Request", "webbrowser.open"} <= sandbox.NETWORK_EVENTS
    assert {"ctypes.dlopen"} == sandbox.NATIVE_CODE_EVENTS
