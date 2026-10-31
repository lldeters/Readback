"""scripts/vendor_engine.py on synthetic wheels in tmp_path (no network)."""

from __future__ import annotations

import hashlib
import json
import re
import subprocess
import sys
import zipfile
from pathlib import Path
from typing import Any

import pytest
import vendor_engine
from vendor_engine import LockEntry, VendorError, Wheel


def build_wheel(
    folder: Path,
    name: str,
    version: str,
    files: dict[str, bytes],
    *,
    tag: str = "py3-none-any",
    purelib: str = "true",
    metadata: str | None = None,
    license_files: bool = True,
) -> Path:
    """A wheel with dist-info; ``files`` maps archive paths to contents."""
    dist_info = f"{name}-{version}.dist-info"
    members = dict(files)
    members[f"{dist_info}/METADATA"] = (
        metadata
        or f"Metadata-Version: 2.4\nName: {name}\nVersion: {version}\nLicense: MIT\n\nBody\n"
    ).encode()
    members[f"{dist_info}/WHEEL"] = f"Wheel-Version: 1.0\nRoot-Is-Purelib: {purelib}\n".encode()
    members[f"{dist_info}/RECORD"] = b""
    if license_files:
        members[f"{dist_info}/licenses/LICENSE"] = b"MIT License\n"
    path = folder / f"{name}-{version}-{tag}.whl"
    folder.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, "w") as archive:
        for member, content in members.items():
            archive.writestr(member, content)
    return path


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def lock_for(*wheels: Path, comment: str = "") -> str:
    lines = [comment]
    for wheel in wheels:
        name, version = wheel.name.split("-")[:2]
        lines.append(f"{name}=={version} \\\n    --hash=sha256:{sha256(wheel)}")
    return "\n".join(lines) + "\n"


class Project:
    """A lock file, a wheel cache and a vendor folder in tmp_path."""

    def __init__(self, root: Path) -> None:
        self.root = root
        self.wheels = root / "cache" / "wheels"
        self.vendor_dir = root / "engine" / "vendor"
        self.lock = root / "engine" / "requirements-vendor.txt"
        self.lock.parent.mkdir(parents=True)

    def add_default_wheels(self) -> list[Path]:
        jedi_like = build_wheel(
            self.wheels,
            "jedi",
            "1.0",
            {
                "jedi/__init__.py": b"VERSION = 1\n",
                "jedi/third_party/typeshed/LICENSE": b"Apache-2.0\n",
                "jedi/third_party/typeshed/stdlib/os.pyi": b"",
                "jedi/third_party/typeshed/stubs/requests/__init__.pyi": b"",
                "jedi/third_party/django-stubs/LICENSE.txt": b"MIT\n",
                "jedi/third_party/django-stubs/django-stubs/__init__.pyi": b"",
                "jedi/__pycache__/x.cpython-310.pyc": b"\x00",
                "jedi/licenses.py": b"# a module, not a license\n",
            },
            tag="py2.py3-none-any",
        )
        other = build_wheel(
            self.wheels,
            "Other_Pkg",
            "2.0.1",
            {"other_pkg/__init__.py": b"", "other_pkg/data/table.json": b"{}"},
            metadata=(
                "Name: Other_Pkg\nVersion: 2.0.1\nLicense-Expression: BSD-3-Clause\nLicense: X\n"
            ),
        )
        self.lock.write_text(lock_for(jedi_like, other, comment="# vendored"), encoding="utf-8")
        return [jedi_like, other]

    def vendor(self) -> list[vendor_engine.PackageRecord]:
        return vendor_engine.vendor(self.lock, self.vendor_dir, self.wheels, download=False)

    def manifest(self) -> dict[str, Any]:
        manifest: dict[str, Any] = json.loads((self.vendor_dir / "VENDOR.json").read_text("utf-8"))
        return manifest

    def files(self) -> set[str]:
        return {
            path.relative_to(self.vendor_dir).as_posix()
            for path in self.vendor_dir.rglob("*")
            if path.is_file()
        }


@pytest.fixture
def project(tmp_path: Path) -> Project:
    return Project(tmp_path)


# --- vendoring ---


def test_vendor_unpacks_prunes_and_writes_the_manifest(project: Project) -> None:
    jedi_like, other = project.add_default_wheels()
    project.vendor()
    assert project.files() == {
        "VENDOR.json",
        "jedi/__init__.py",
        "jedi/licenses.py",
        "jedi/third_party/typeshed/LICENSE",
        "jedi/third_party/typeshed/stdlib/os.pyi",
        # License files survive the prune patterns.
        "jedi/third_party/django-stubs/LICENSE.txt",
        "jedi-1.0.dist-info/METADATA",
        "jedi-1.0.dist-info/WHEEL",
        "jedi-1.0.dist-info/RECORD",
        "jedi-1.0.dist-info/licenses/LICENSE",
        "other_pkg/__init__.py",
        "other_pkg/data/table.json",
        "Other_Pkg-2.0.1.dist-info/METADATA",
        "Other_Pkg-2.0.1.dist-info/WHEEL",
        "Other_Pkg-2.0.1.dist-info/RECORD",
        "Other_Pkg-2.0.1.dist-info/licenses/LICENSE",
    }
    assert project.manifest() == {
        "formatVersion": 1,
        "generatedBy": "scripts/vendor_engine.py",
        "lockFile": "requirements-vendor.txt",
        "packages": [
            {
                "name": "jedi",
                "version": "1.0",
                "wheel": jedi_like.name,
                "sha256": sha256(jedi_like),
                "license": "MIT",
                "licenseFiles": [
                    "jedi-1.0.dist-info/licenses/LICENSE",
                    "jedi/third_party/django-stubs/LICENSE.txt",
                    "jedi/third_party/typeshed/LICENSE",
                ],
                "prunedPatterns": [
                    "jedi/third_party/typeshed/stubs/**",
                    "jedi/third_party/django-stubs/**",
                    "**/__pycache__/**",
                ],
                "fileCount": 9,
            },
            {
                "name": "Other_Pkg",
                "version": "2.0.1",
                "wheel": other.name,
                "sha256": sha256(other),
                "license": "BSD-3-Clause",
                "licenseFiles": ["Other_Pkg-2.0.1.dist-info/licenses/LICENSE"],
                "prunedPatterns": [],
                "fileCount": 6,
            },
        ],
    }
    assert vendor_engine.check(project.lock, project.vendor_dir) == []


def test_vendoring_is_deterministic_and_replaces_old_content(project: Project) -> None:
    project.add_default_wheels()
    project.vendor()
    first = (project.vendor_dir / "VENDOR.json").read_bytes()
    (project.vendor_dir / "stale.py").write_text("old", encoding="utf-8")
    project.vendor()
    assert (project.vendor_dir / "VENDOR.json").read_bytes() == first
    assert not (project.vendor_dir / "stale.py").exists()
    assert b"\r\n" not in first
    # Staging folders are cleaned up.
    assert [path.name for path in project.wheels.parent.iterdir()] == ["wheels"]


def test_failed_vendoring_keeps_the_previous_vendor_folder(project: Project) -> None:
    project.add_default_wheels()
    project.vendor()
    build_wheel(project.wheels, "evil", "1.0", {"evil/_speedups.so": b"\x7fELF"})
    project.lock.write_text(lock_for(*sorted(project.wheels.glob("*.whl"))), encoding="utf-8")
    with pytest.raises(VendorError, match="native code"):
        project.vendor()
    assert "jedi/__init__.py" in project.files()
    assert [path.name for path in project.wheels.parent.iterdir()] == ["wheels"]


@pytest.mark.parametrize(
    ("kwargs", "files", "message"),
    [
        ({"tag": "cp312-cp312-manylinux_2_17_x86_64"}, {}, "not a pure-Python wheel"),
        ({"purelib": "false"}, {}, "Root-Is-Purelib"),
        ({}, {"demo-1.0.data/scripts/run": b""}, ".data directory"),
        ({}, {"../escape.py": b""}, "unsafe path"),
        ({}, {"/absolute.py": b""}, "unsafe path"),
        pytest.param(
            {},
            {"demo\\windows.py": b""},
            "unsafe path",
            marks=pytest.mark.skipif(
                sys.platform == "win32", reason="zipfile itself maps \\ to / on Windows"
            ),
        ),
        ({}, {"C:/drive.py": b""}, "unsafe path"),
        ({}, {"demo/./dot.py": b""}, "unsafe path"),
        ({}, {"demo/native.pyd": b""}, "native code"),
        ({}, {"demo/libx.so.1": b""}, "native code"),
        ({}, {"demo/tool.EXE": b""}, "native code"),
        ({"metadata": "Name: other\nVersion: 1.0\n"}, {}, "METADATA names other 1.0"),
        ({"license_files": False}, {}, "ships no license file"),
    ],
)
def test_unsafe_or_impure_wheels_are_rejected(
    project: Project, kwargs: dict[str, Any], files: dict[str, bytes], message: str
) -> None:
    wheel = build_wheel(project.wheels, "demo", "1.0", {"demo/__init__.py": b"", **files}, **kwargs)
    project.lock.write_text(lock_for(wheel), encoding="utf-8")
    with pytest.raises(VendorError, match=message):
        project.vendor()


def test_symlinks_and_duplicates_are_rejected(project: Project) -> None:
    wheel = build_wheel(project.wheels, "demo", "1.0", {"demo/__init__.py": b""})
    with zipfile.ZipFile(wheel, "a") as archive:
        link = zipfile.ZipInfo("demo/link")
        link.external_attr = 0o120777 << 16
        archive.writestr(link, "/etc/passwd")
    project.lock.write_text(lock_for(wheel), encoding="utf-8")
    with pytest.raises(VendorError, match="symbolic link"):
        project.vendor()

    duplicated = build_wheel(project.root / "dup", "demo", "1.0", {"demo/__init__.py": b""})
    with zipfile.ZipFile(duplicated, "a") as archive, pytest.warns(UserWarning, match="Duplicate"):
        archive.writestr("demo/__init__.py", b"again")
    entry = LockEntry("demo", "1.0", frozenset({sha256(duplicated)}))
    with pytest.raises(VendorError, match="duplicate entries"):
        vendor_engine.validate_wheel(Wheel(entry, duplicated, sha256(duplicated)))


def test_files_provided_by_two_wheels_are_rejected(project: Project) -> None:
    first = build_wheel(project.wheels, "aaa", "1.0", {"shared/x.py": b"1"})
    second = build_wheel(project.wheels, "bbb", "1.0", {"shared/x.py": b"2"})
    project.lock.write_text(lock_for(first, second), encoding="utf-8")
    with pytest.raises(VendorError, match=re.escape("shared/x.py is in both")):
        project.vendor()


def test_broken_archives_are_rejected(project: Project) -> None:
    project.wheels.mkdir(parents=True)
    broken = project.wheels / "demo-1.0-py3-none-any.whl"
    broken.write_bytes(b"not a zip")
    project.lock.write_text(lock_for(broken), encoding="utf-8")
    with pytest.raises(VendorError, match="not a valid wheel"):
        project.vendor()


def test_hash_mismatch_and_missing_wheels(project: Project) -> None:
    wheel = build_wheel(project.wheels, "demo", "1.0", {"demo/__init__.py": b""})
    project.lock.write_text(f"demo==1.0 --hash=sha256:{'0' * 64}\n", encoding="utf-8")
    with pytest.raises(VendorError, match=re.escape("hash mismatch for demo==1.0")):
        project.vendor()
    project.lock.write_text(f"demo==2.0 --hash=sha256:{sha256(wheel)}\n", encoding="utf-8")
    with pytest.raises(VendorError, match=re.escape("no wheel for demo==2.0")):
        project.vendor()


def test_validate_wheel_checks_the_hash_again(tmp_path: Path) -> None:
    wheel = build_wheel(tmp_path, "demo", "1.0", {"demo/__init__.py": b""})
    entry = LockEntry("demo", "1.0", frozenset({"0" * 64}))
    with pytest.raises(VendorError, match="is not in the lock"):
        vendor_engine.validate_wheel(Wheel(entry, wheel, sha256(wheel)))


def test_downloads_with_pip_when_the_cache_lacks_a_wheel(
    project: Project, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    source = tmp_path / "index"
    wheel = build_wheel(source, "demo", "1.0", {"demo/__init__.py": b""})
    project.lock.write_text(lock_for(wheel), encoding="utf-8")
    commands: list[list[str]] = []

    def fake_pip(command: list[str], check: bool) -> subprocess.CompletedProcess[bytes]:
        commands.append(command)
        target = Path(command[command.index("-d") + 1])
        (target / wheel.name).write_bytes(wheel.read_bytes())
        return subprocess.CompletedProcess(command, 0)

    monkeypatch.setattr("vendor_engine.subprocess.run", fake_pip)
    vendor_engine.vendor(project.lock, project.vendor_dir, project.wheels)
    assert commands == [
        [
            sys.executable,
            "-m",
            "pip",
            "download",
            "--only-binary=:all:",
            "--no-deps",
            "--require-hashes",
            "-r",
            str(project.lock),
            "-d",
            str(project.wheels),
            "--disable-pip-version-check",
        ]
    ]
    # The cache now has the wheel: the next run needs no pip.
    vendor_engine.vendor(project.lock, project.vendor_dir, project.wheels)
    assert len(commands) == 1


def test_failing_pip_is_reported(project: Project, monkeypatch: pytest.MonkeyPatch) -> None:
    project.lock.write_text(f"demo==1.0 --hash=sha256:{'a' * 64}\n", encoding="utf-8")
    monkeypatch.setattr(
        "vendor_engine.subprocess.run",
        lambda command, check: subprocess.CompletedProcess(command, 2),
    )
    with pytest.raises(VendorError, match="pip download failed with exit code 2"):
        vendor_engine.vendor(project.lock, project.vendor_dir, project.wheels)


def test_offline_mode_does_not_download(project: Project) -> None:
    project.lock.write_text(f"demo==1.0 --hash=sha256:{'a' * 64}\n", encoding="utf-8")
    project.wheels.mkdir(parents=True)
    (project.wheels / "not-a-wheel.whl").write_bytes(b"")
    with pytest.raises(VendorError, match=re.escape("no wheel for demo==1.0")):
        project.vendor()


# --- check ---


def test_check_reports_every_difference(project: Project) -> None:
    project.add_default_wheels()
    project.vendor()
    manifest = project.manifest()
    jedi_entry, other_entry = manifest["packages"]
    jedi_entry["version"] = "0.9"
    other_entry["sha256"] = "f" * 64
    manifest["packages"].append({"name": "intruder", "version": "1", "licenseFiles": ["x"]})
    (project.vendor_dir / "VENDOR.json").write_text(json.dumps(manifest), encoding="utf-8")
    (project.vendor_dir / "jedi" / "third_party" / "typeshed" / "LICENSE").unlink()
    assert vendor_engine.check(project.lock, project.vendor_dir) == [
        "Other_Pkg: the vendored wheel's sha256 is not in the lock",
        "intruder is vendored but not locked",
        "jedi: license file jedi/third_party/typeshed/LICENSE is missing",
        "jedi: vendored 0.9, locked 1.0",
    ]


def test_check_without_a_vendor_folder(project: Project) -> None:
    project.add_default_wheels()
    assert vendor_engine.check(project.lock, project.vendor_dir) == [
        f"{project.vendor_dir / 'VENDOR.json'} is missing"
    ]


@pytest.mark.parametrize(
    ("manifest", "problem"),
    [
        ("{", "is unreadable"),
        ('{"packages": 1}', "has no valid 'packages' list"),
        ("[]", "has no valid 'packages' list"),
        (
            '{"packages": [{"name": "demo", "version": "1.0", "sha256": "", "licenseFiles": []}]}',
            "demo: no license files are listed",
        ),
        (
            '{"packages": [{"name": "demo", "version": "1.0", "licenseFiles": ["../x", "/y"]}]}',
            "demo: invalid license file path '../x'",
        ),
    ],
)
def test_check_rejects_broken_manifests(project: Project, manifest: str, problem: str) -> None:
    project.lock.write_text(f"demo==1.0 --hash=sha256:{'a' * 64}\n", encoding="utf-8")
    project.vendor_dir.mkdir(parents=True)
    (project.vendor_dir / "VENDOR.json").write_text(manifest, encoding="utf-8")
    problems = vendor_engine.check(project.lock, project.vendor_dir)
    assert any(problem in text for text in problems), problems


def test_check_locked_but_not_vendored(project: Project) -> None:
    project.add_default_wheels()
    project.vendor()
    with project.lock.open("a", encoding="utf-8") as lock:
        lock.write(f"extra==1.0 --hash=sha256:{'b' * 64}\n")
    assert vendor_engine.check(project.lock, project.vendor_dir) == [
        "extra is locked but not vendored"
    ]


# --- lock file parsing ---


def test_parse_lock_handles_comments_continuations_and_several_hashes() -> None:
    text = (
        "# header comment\n"
        "\n"
        "Some.Package==1.2.3 \\\n"
        f"    --hash=sha256:{'a' * 64} \\\n"
        f"    --hash=sha256:{'b' * 64}  # trailing comment\n"
        f"other==4 --hash=sha256:{'c' * 64}\n"
    )
    assert vendor_engine.parse_lock(text) == [
        LockEntry("other", "4", frozenset({"c" * 64})),
        LockEntry("Some.Package", "1.2.3", frozenset({"a" * 64, "b" * 64})),
    ]


@pytest.mark.parametrize(
    ("text", "message"),
    [
        ("", "locks no packages"),
        ("# only comments\n", "locks no packages"),
        ("demo>=1.0 --hash=sha256:" + "a" * 64, "expected 'name==version"),
        ("demo==1.0", "has no --hash"),
        ("demo==1.0 --hash=md5:abc", "unsupported option"),
        ("demo==1.0 --index-url=x --hash=sha256:" + "a" * 64, "unsupported option"),
        (f"a==1 --hash=sha256:{'a' * 64}\nA==2 --hash=sha256:{'b' * 64}", "locked twice"),
        (f"demo==1.0 \\\n--hash=sha256:{'a' * 64} \\", None),
    ],
)
def test_parse_lock_errors(text: str, message: str | None) -> None:
    if message is None:
        assert vendor_engine.parse_lock(text)[0].name == "demo"
        return
    with pytest.raises(VendorError, match=message):
        vendor_engine.parse_lock(text)


def test_the_repository_lock_parses() -> None:
    lock = vendor_engine.LOCK_FILE.read_text(encoding="utf-8")
    assert [entry.key for entry in vendor_engine.parse_lock(lock)] == ["jedi", "parso", "sqlglot"]


# --- small helpers ---


@pytest.mark.parametrize(
    ("name", "expected"),
    [
        ("jedi-0.20.1.dist-info/LICENSE.txt", True),
        ("jedi-0.20.1.dist-info/AUTHORS.txt", True),
        ("sqlglot-30.27.0.dist-info/licenses/LICENSE", True),
        ("x-1.dist-info/licenses/vendored/NOTICE.md", True),
        ("jedi/third_party/typeshed/LICENSE", True),
        ("pkg/COPYING", True),
        ("pkg/licence-mit", True),
        ("pkg/licenses.py", False),
        ("pkg/license.pyi", False),
        ("pkg/README.md", False),
        ("pkg/licenses/data.txt", False),
    ],
)
def test_license_files(name: str, expected: bool) -> None:
    assert vendor_engine.is_license_file(name) is expected


@pytest.mark.parametrize(
    ("headers", "expected"),
    [
        ("License-Expression: MIT\nLicense: Apache\n", "MIT"),
        ("License: BSD\n", "BSD"),
        (
            "License: UNKNOWN\nClassifier: License :: OSI Approved :: MIT License\n"
            "Classifier: Topic :: X\n",
            "MIT License",
        ),
        (
            "Classifier: License :: OSI Approved :: Apache Software License\n",
            "Apache Software License",
        ),
        ("Name: x\n", "UNKNOWN"),
    ],
)
def test_license_of(headers: str, expected: str) -> None:
    assert vendor_engine.license_of(vendor_engine.parse_headers(headers)) == expected


def test_parse_headers_stops_at_the_body_and_skips_folded_lines() -> None:
    headers = vendor_engine.parse_headers(
        "Name: a\nLicense: line one\n        line two\nClassifier: x\nClassifier: y\n\nName: body\n"
    )
    assert headers == {"Name": ["a"], "License": ["line one"], "Classifier": ["x", "y"]}


@pytest.mark.parametrize("filename", ["demo.zip", "demo-1.0.whl", "a-b-c-d-e-f-g.whl"])
def test_invalid_wheel_names(filename: str) -> None:
    with pytest.raises(VendorError):
        vendor_engine.wheel_tags(filename)


def test_wheel_tags_with_build_tag() -> None:
    assert vendor_engine.wheel_tags("demo-1.0-1-py3-none-any.whl") == (
        "demo",
        "1.0",
        "py3",
        "none",
        "any",
    )


# --- command line ---


def test_main_vendors_and_checks(project: Project, capsys: pytest.CaptureFixture[str]) -> None:
    project.add_default_wheels()
    paths = [
        "--lock",
        str(project.lock),
        "--vendor-dir",
        str(project.vendor_dir),
        "--wheel-dir",
        str(project.wheels),
    ]
    assert vendor_engine.main([*paths, "--offline"]) == 0
    output = capsys.readouterr().out
    assert "Vendored jedi 1.0, Other_Pkg 2.0.1 into " in output
    assert "16 files" in output
    assert vendor_engine.main(["--check", *paths[:4]]) == 0
    assert "matches" in capsys.readouterr().out

    (project.vendor_dir / "VENDOR.json").unlink()
    assert vendor_engine.main(["--check", *paths[:4]]) == 1
    error = capsys.readouterr().err
    assert "VENDOR.json is missing" in error
    assert "Run: python scripts/vendor_engine.py" in error


def test_main_reports_errors_without_a_traceback(
    project: Project, capsys: pytest.CaptureFixture[str]
) -> None:
    project.lock.write_text("broken\n", encoding="utf-8")
    assert vendor_engine.main(["--lock", str(project.lock), "--offline"]) == 1
    assert capsys.readouterr().err.startswith("error: requirements-vendor.txt:1: expected")


def test_the_script_runs_standalone() -> None:
    result = subprocess.run(
        [sys.executable, "-I", str(Path(vendor_engine.__file__)), "--help"],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0
    assert "--check" in result.stdout
