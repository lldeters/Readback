"""Vendor the analysis engine's runtime dependencies into engine/vendor/ (spec 5.2).

    python scripts/vendor_engine.py          download the locked wheels and unpack them
    python scripts/vendor_engine.py --check  verify engine/vendor/ against the lock, offline

Only pure-Python wheels pinned by sha256 in engine/requirements-vendor.txt are accepted. They are
validated, unpacked in a fixed order, pruned of files the engine does not need, and swapped into
engine/vendor/ in one step, together with engine/vendor/VENDOR.json, which records name, version,
wheel, hash, license and license files of every package (scripts/notices.mjs reads it). Nothing is
installed with pip at runtime. Stdlib only; runs on any Python >= 3.10 that has pip.
"""

# The engine's lint rules apply here too, except that this build script prints and runs pip.
# ruff: noqa: T201

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess  # noqa: TID251 - runs pip at build time; the engine itself never does
import sys
import tempfile
import zipfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Final

REPO_ROOT: Final = Path(__file__).resolve().parent.parent
LOCK_FILE: Final = REPO_ROOT / "engine" / "requirements-vendor.txt"
VENDOR_DIR: Final = REPO_ROOT / "engine" / "vendor"
WHEEL_CACHE: Final = REPO_ROOT / ".cache" / "vendor-wheels"
MANIFEST_NAME: Final = "VENDOR.json"
MANIFEST_FORMAT: Final = 1

# Not needed at runtime: jedi's third-party stubs (about 9 MiB in 4,300 files) and django-stubs.
# jedi keeps its typeshed stdlib stubs, so stdlib inference still works.
PRUNE_PATTERNS: Final = (
    "jedi/third_party/typeshed/stubs/**",
    "jedi/third_party/django-stubs/**",
    "**/__pycache__/**",
)
# The declared metadata license understates what these wheels ship, so the manifest (and with
# it THIRD_PARTY_NOTICES.md) carries the full SPDX expression; the license texts are kept anyway.
LICENSE_OVERRIDES: Final = {
    # jedi bundles typeshed's stdlib stubs, which are Apache-2.0 (parts MIT).
    "jedi": "MIT AND Apache-2.0",
    # parso/pgen2/*, parso/tokenize.py and parso/token.py come from CPython (PSF-2.0).
    "parso": "MIT AND PSF-2.0",
}
# License files survive every prune pattern (approved decision: keep every license file).
LICENSE_STEMS: Final = ("LICENSE", "LICENCE", "COPYING", "NOTICE", "AUTHORS")
NATIVE_SUFFIXES: Final = (".so", ".pyd", ".dll", ".dylib", ".exe")
# Unix file type bits as zip stores them in the high 16 bits of external_attr.
_FILE_TYPE_MASK: Final = 0o170000
_SYMLINK: Final = 0o120000

_REQUIREMENT: Final = re.compile(r"(?P<name>[A-Za-z0-9][A-Za-z0-9._-]*)==(?P<version>[^\s;]+)")
_HASH_OPTION: Final = re.compile(r"--hash=sha256:(?P<digest>[0-9a-f]{64})")
_COMMENT: Final = re.compile(r"(^|\s)#.*$")


class VendorError(Exception):
    """A problem the developer has to fix; printed without a traceback."""


@dataclass(frozen=True)
class LockEntry:
    name: str
    version: str
    hashes: frozenset[str]

    @property
    def key(self) -> str:
        return canonical_name(self.name)


@dataclass(frozen=True)
class Wheel:
    entry: LockEntry
    path: Path
    sha256: str


@dataclass(frozen=True)
class PackageRecord:
    """One entry of VENDOR.json (field names are read by scripts/notices.mjs)."""

    name: str
    version: str
    wheel: str
    sha256: str
    license: str
    license_files: tuple[str, ...]
    pruned_patterns: tuple[str, ...]
    file_count: int

    def to_json(self) -> dict[str, object]:
        return {
            "name": self.name,
            "version": self.version,
            "wheel": self.wheel,
            "sha256": self.sha256,
            "license": self.license,
            "licenseFiles": list(self.license_files),
            "prunedPatterns": list(self.pruned_patterns),
            "fileCount": self.file_count,
        }


# --- Lock file --------------------------------------------------------------------------------


def canonical_name(name: str) -> str:
    """PEP 503 normalization: Jedi, jedi and JEDI name the same project."""
    return re.sub(r"[-_.]+", "-", name).lower()


def parse_lock(text: str, source: str = "lock file") -> list[LockEntry]:
    """Parse ``name==version --hash=sha256:...`` lines (pip's hash-checking mode format)."""
    entries: dict[str, LockEntry] = {}
    for number, line in _logical_lines(text):
        tokens = line.split()
        requirement = _REQUIREMENT.fullmatch(tokens[0])
        if requirement is None:
            msg = f"{source}:{number}: expected 'name==version --hash=sha256:...', got {line!r}"
            raise VendorError(msg)
        hashes: set[str] = set()
        for option in tokens[1:]:
            match = _HASH_OPTION.fullmatch(option)
            if match is None:
                msg = f"{source}:{number}: unsupported option {option!r} (only --hash=sha256:...)"
                raise VendorError(msg)
            hashes.add(match["digest"])
        if not hashes:
            msg = f"{source}:{number}: {tokens[0]} has no --hash=sha256:... pin"
            raise VendorError(msg)
        entry = LockEntry(requirement["name"], requirement["version"], frozenset(hashes))
        if entry.key in entries:
            msg = f"{source}:{number}: {entry.name} is locked twice"
            raise VendorError(msg)
        entries[entry.key] = entry
    if not entries:
        msg = f"{source} locks no packages"
        raise VendorError(msg)
    return sorted(entries.values(), key=lambda entry: entry.key)


def _logical_lines(text: str) -> list[tuple[int, str]]:
    """Lines without comments, with backslash continuations joined; numbered by first line."""
    result: list[tuple[int, str]] = []
    pending: list[str] = []
    start = 0
    for number, raw in enumerate(text.splitlines(), start=1):
        line = _COMMENT.sub("", raw).rstrip()
        if not pending:
            start = number
        if line.endswith("\\"):
            pending.append(line[:-1])
            continue
        pending.append(line)
        joined = " ".join(part.strip() for part in pending).strip()
        pending = []
        if joined:
            result.append((start, joined))
    if pending and " ".join(pending).strip():
        result.append((start, " ".join(part.strip() for part in pending).strip()))
    return result


# --- Wheels -----------------------------------------------------------------------------------


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def wheel_tags(filename: str) -> tuple[str, str, str, str, str]:
    """(distribution, version, python tag, abi tag, platform tag) of a wheel file name."""
    if not filename.endswith(".whl"):
        msg = f"{filename} is not a wheel"
        raise VendorError(msg)
    parts = filename[: -len(".whl")].split("-")
    if len(parts) not in (5, 6):  # an optional build tag sits between version and python tag
        msg = f"{filename} is not a valid wheel file name"
        raise VendorError(msg)
    return parts[0], parts[1], parts[-3], parts[-2], parts[-1]


def find_wheels(entries: list[LockEntry], wheel_dir: Path) -> list[Wheel]:
    """The wheel of every lock entry in ``wheel_dir``, matched by name, version and hash."""
    available: list[tuple[Path, str, str]] = []
    for path in sorted(wheel_dir.glob("*.whl")):
        try:
            distribution, version, *_tags = wheel_tags(path.name)
        except VendorError:
            continue  # not a wheel of ours; pip never writes such names
        available.append((path, canonical_name(distribution), version))
    wheels: list[Wheel] = []
    for entry in entries:
        candidates = [
            path for path, key, version in available if (key, version) == (entry.key, entry.version)
        ]
        if not candidates:
            msg = f"no wheel for {entry.name}=={entry.version} in {wheel_dir}"
            raise VendorError(msg)
        digests = {path: sha256_of(path) for path in candidates}
        matching = [path for path in candidates if digests[path] in entry.hashes]
        if not matching:
            found = ", ".join(f"{path.name} ({digests[path]})" for path in candidates)
            msg = f"hash mismatch for {entry.name}=={entry.version}: {found} is not in the lock"
            raise VendorError(msg)
        wheels.append(Wheel(entry, matching[0], digests[matching[0]]))
    return wheels


def download_wheels(lock_file: Path, wheel_dir: Path) -> None:
    """Let pip fetch the locked wheels; --require-hashes makes it verify them as well."""
    wheel_dir.mkdir(parents=True, exist_ok=True)
    command = [
        sys.executable,
        "-m",
        "pip",
        "download",
        "--only-binary=:all:",
        "--no-deps",
        "--require-hashes",
        "-r",
        str(lock_file),
        "-d",
        str(wheel_dir),
        "--disable-pip-version-check",
    ]
    print("Running:", " ".join(command), flush=True)
    result = subprocess.run(command, check=False)  # noqa: S603 - fixed arguments, no shell
    if result.returncode != 0:
        msg = f"pip download failed with exit code {result.returncode} (is pip installed?)"
        raise VendorError(msg)


def validate_wheel(wheel: Wheel) -> dict[str, list[str]]:
    """Reject anything but a pure, safe wheel of the locked project; returns its METADATA."""
    where = wheel.path.name
    _name, _version, _python_tag, abi_tag, platform_tag = wheel_tags(where)
    if (abi_tag, platform_tag) != ("none", "any"):
        msg = f"{where} is not a pure-Python wheel (*-none-any.whl)"
        raise VendorError(msg)
    if wheel.sha256 not in wheel.entry.hashes:
        msg = f"{where}: sha256 {wheel.sha256} is not in the lock"
        raise VendorError(msg)
    try:
        with zipfile.ZipFile(wheel.path) as archive:
            members = archive.infolist()
            names = [member.filename for member in members]
            if len(names) != len(set(names)):
                msg = f"{where} contains duplicate entries"
                raise VendorError(msg)
            for member in members:
                _check_member(where, member)
            dist_info = _dist_info_dir(where, names)
            wheel_meta = parse_headers(archive.read(f"{dist_info}/WHEEL").decode("utf-8"))
            metadata = parse_headers(archive.read(f"{dist_info}/METADATA").decode("utf-8"))
    except (zipfile.BadZipFile, KeyError, UnicodeDecodeError) as exc:
        msg = f"{where} is not a valid wheel: {exc}"
        raise VendorError(msg) from exc
    if _first(wheel_meta, "Root-Is-Purelib").lower() != "true":
        msg = f"{where}: WHEEL does not say Root-Is-Purelib: true"
        raise VendorError(msg)
    named = (canonical_name(_first(metadata, "Name")), _first(metadata, "Version"))
    if named != (wheel.entry.key, wheel.entry.version):
        msg = f"{where}: METADATA names {named[0]} {named[1]}, the lock {wheel.entry.name}"
        raise VendorError(msg)
    return metadata


def _check_member(where: str, member: zipfile.ZipInfo) -> None:
    name = member.filename
    path = PurePosixPath(name)
    if (
        "\\" in name
        or name.startswith("/")
        or re.match(r"[A-Za-z]:", name)
        or any(part in ("", ".", "..") for part in name.rstrip("/").split("/"))
    ):
        msg = f"{where}: unsafe path {name!r}"
        raise VendorError(msg)
    if path.parts[0].endswith(".data"):
        msg = f"{where}: {name} is in a .data directory (scripts or headers are not vendored)"
        raise VendorError(msg)
    if (member.external_attr >> 16) & _FILE_TYPE_MASK == _SYMLINK:
        msg = f"{where}: {name} is a symbolic link"
        raise VendorError(msg)
    lowered = path.name.lower()
    if lowered.endswith(NATIVE_SUFFIXES) or ".so." in lowered:
        msg = f"{where}: {name} is native code"
        raise VendorError(msg)


def _dist_info_dir(where: str, names: list[str]) -> str:
    tops = {name.split("/", 1)[0] for name in names if "/" in name}
    dist_infos = sorted(top for top in tops if top.endswith(".dist-info"))
    if len(dist_infos) != 1:
        msg = f"{where} must contain exactly one .dist-info directory, found {dist_infos}"
        raise VendorError(msg)
    return dist_infos[0]


def parse_headers(text: str) -> dict[str, list[str]]:
    """Headers of a METADATA or WHEEL file (all values per name); stops at the first blank line."""
    headers: dict[str, list[str]] = {}
    for line in text.splitlines():
        if not line.strip():
            break
        if line[0] in " \t":
            continue  # folded continuation of a long value
        key, colon, value = line.partition(":")
        if colon:
            headers.setdefault(key.strip(), []).append(value.strip())
    return headers


def _first(headers: dict[str, list[str]], key: str) -> str:
    values = headers.get(key)
    return values[0] if values else ""


def license_of(metadata: dict[str, list[str]]) -> str:
    """LICENSE_OVERRIDES, else License-Expression, else License, else the license classifiers."""
    override = LICENSE_OVERRIDES.get(_first(metadata, "Name").lower())
    if override:
        return override
    expression = _first(metadata, "License-Expression")
    if expression:
        return expression
    text = _first(metadata, "License")
    if text and text.upper() != "UNKNOWN":
        return text
    classifiers = [
        value.split("::")[-1].strip()
        for value in metadata.get("Classifier", [])
        if value.startswith("License ::")
    ]
    return "; ".join(classifiers) or "UNKNOWN"


def is_license_file(name: str) -> bool:
    path = PurePosixPath(name)
    parts = path.parts
    if parts[2:] and parts[0].endswith(".dist-info") and parts[1] == "licenses":
        return True  # PEP 639: everything below <name>.dist-info/licenses/
    return path.stem.upper().startswith(LICENSE_STEMS) and path.suffix not in (".py", ".pyi")


def pruned_by(name: str) -> str | None:
    """The prune pattern that removes ``name``, if any."""
    parts = name.split("/")
    for pattern in PRUNE_PATTERNS:
        if pattern.startswith("**/"):
            if pattern[3:-3] in parts[:-1]:
                return pattern
        elif name.startswith(pattern[:-2]):
            return pattern
    return None


# --- Vendoring --------------------------------------------------------------------------------


def unpack(wheels: list[Wheel], target: Path) -> list[PackageRecord]:
    """Validate and unpack ``wheels`` into the empty folder ``target``, in a fixed order."""
    records: list[PackageRecord] = []
    owners: dict[str, str] = {}
    for wheel in sorted(wheels, key=lambda wheel: wheel.entry.key):
        metadata = validate_wheel(wheel)
        file_count = 0
        license_files: list[str] = []
        pruned: set[str] = set()
        with zipfile.ZipFile(wheel.path) as archive:
            for member in sorted(archive.infolist(), key=lambda member: member.filename):
                name = member.filename
                if member.is_dir():
                    continue
                pattern = pruned_by(name)
                if pattern is not None and not is_license_file(name):
                    pruned.add(pattern)
                    continue
                if name in owners:
                    msg = f"{name} is in both {owners[name]} and {wheel.path.name}"
                    raise VendorError(msg)
                owners[name] = wheel.path.name
                destination = target.joinpath(*name.split("/"))
                destination.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(member) as source, destination.open("wb") as sink:
                    shutil.copyfileobj(source, sink)
                file_count += 1
                if is_license_file(name):
                    license_files.append(name)
        if not license_files:
            msg = f"{wheel.path.name} ships no license file; it cannot be redistributed as is"
            raise VendorError(msg)
        records.append(
            PackageRecord(
                name=_first(metadata, "Name"),
                version=wheel.entry.version,
                wheel=wheel.path.name,
                sha256=wheel.sha256,
                license=license_of(metadata),
                license_files=tuple(sorted(license_files)),
                pruned_patterns=tuple(p for p in PRUNE_PATTERNS if p in pruned),
                file_count=file_count,
            )
        )
    return records


def manifest_text(records: list[PackageRecord], lock_file: Path) -> str:
    """VENDOR.json: deterministic (no timestamps, sorted packages, LF line endings)."""
    try:
        lock = lock_file.resolve().relative_to(REPO_ROOT).as_posix()
    except ValueError:
        lock = lock_file.name
    manifest = {
        "formatVersion": MANIFEST_FORMAT,
        "generatedBy": "scripts/vendor_engine.py",
        "lockFile": lock,
        "packages": [record.to_json() for record in sorted(records, key=lambda r: r.name.lower())],
    }
    return json.dumps(manifest, indent=2) + "\n"


def replace_dir(staged: Path, target: Path) -> None:
    """Swap ``staged`` in as ``target``; the old folder is restored if the swap fails."""
    backup: Path | None = None
    if target.exists():
        backup = staged.with_name(f"{staged.name}-previous")
        _rename(target, backup)
    try:
        _rename(staged, target)
    except OSError:
        if backup is not None:
            _rename(backup, target)
        raise
    if backup is not None:
        shutil.rmtree(backup)


def _rename(source: Path, destination: Path) -> None:
    try:
        source.rename(destination)
    except OSError as exc:
        hint = (
            " Close programs that use it, e.g. a running engine."
            if isinstance(exc, PermissionError)
            else ""
        )
        msg = f"cannot move {source} to {destination}: {exc}.{hint}"
        raise VendorError(msg) from exc


def folder_size(folder: Path) -> tuple[int, int]:
    files = [path for path in folder.rglob("*") if path.is_file()]
    return len(files), sum(path.stat().st_size for path in files)


def vendor(
    lock_file: Path = LOCK_FILE,
    vendor_dir: Path = VENDOR_DIR,
    wheel_dir: Path = WHEEL_CACHE,
    *,
    download: bool = True,
) -> list[PackageRecord]:
    entries = parse_lock(lock_file.read_text(encoding="utf-8"), lock_file.name)
    try:
        wheels = find_wheels(entries, wheel_dir)
    except VendorError:
        if not download:
            raise
        # Something is missing or stale in the cache: let pip (re)fetch it.
        download_wheels(lock_file, wheel_dir)
        wheels = find_wheels(entries, wheel_dir)
    # Staged next to the wheel cache (both are under the git-ignored .cache/) and renamed into
    # place, so engine/vendor/ is never left half-written.
    wheel_dir.parent.mkdir(parents=True, exist_ok=True)
    staging_root = Path(tempfile.mkdtemp(prefix="vendor-staging-", dir=wheel_dir.parent))
    try:
        staged = staging_root / "vendor"
        staged.mkdir()
        records = unpack(wheels, staged)
        (staged / MANIFEST_NAME).write_text(
            manifest_text(records, lock_file), encoding="utf-8", newline="\n"
        )
        vendor_dir.parent.mkdir(parents=True, exist_ok=True)
        replace_dir(staged, vendor_dir)
    finally:
        shutil.rmtree(staging_root, ignore_errors=True)
    problems = check(lock_file, vendor_dir)
    if problems:  # pragma: no cover - would be a bug in this script
        raise VendorError("; ".join(problems))
    return records


# --- Check ------------------------------------------------------------------------------------


def check(lock_file: Path = LOCK_FILE, vendor_dir: Path = VENDOR_DIR) -> list[str]:
    """Problems that make engine/vendor/ differ from the lock; empty if it matches."""
    manifest_path = vendor_dir / MANIFEST_NAME
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return [f"{manifest_path} is missing"]
    except (OSError, ValueError) as exc:
        return [f"{manifest_path} is unreadable: {exc}"]
    packages = manifest.get("packages") if isinstance(manifest, dict) else None
    if not isinstance(packages, list) or not all(isinstance(p, dict) for p in packages):
        return [f"{manifest_path} has no valid 'packages' list"]
    locked = {entry.key: entry for entry in parse_lock(lock_file.read_text(encoding="utf-8"))}
    vendored = {canonical_name(str(package.get("name"))): package for package in packages}
    problems = [
        f"{locked[key].name} is locked but not vendored" for key in locked.keys() - vendored
    ]
    problems += [f"{key} is vendored but not locked" for key in vendored.keys() - locked]
    for key in sorted(locked.keys() & vendored.keys()):
        problems += _package_problems(locked[key], vendored[key], vendor_dir)
    return sorted(problems)


def _package_problems(entry: LockEntry, package: dict[str, object], vendor_dir: Path) -> list[str]:
    problems: list[str] = []
    if package.get("version") != entry.version:
        problems.append(f"{entry.name}: vendored {package.get('version')}, locked {entry.version}")
    if package.get("sha256") not in entry.hashes:
        problems.append(f"{entry.name}: the vendored wheel's sha256 is not in the lock")
    license_files = package.get("licenseFiles")
    if not isinstance(license_files, list) or not license_files:
        problems.append(f"{entry.name}: no license files are listed")
        return problems
    for name in license_files:
        relative = PurePosixPath(str(name))
        if relative.is_absolute() or ".." in relative.parts:
            problems.append(f"{entry.name}: invalid license file path {name!r}")
        elif not vendor_dir.joinpath(*relative.parts).is_file():
            problems.append(f"{entry.name}: license file {name} is missing")
    return problems


# --- Command line -----------------------------------------------------------------------------


def _display(path: Path) -> str:
    try:
        return path.resolve().relative_to(REPO_ROOT).as_posix()
    except ValueError:
        return str(path)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0] if __doc__ else None)
    parser.add_argument("--check", action="store_true", help="verify engine/vendor/ offline")
    parser.add_argument("--lock", type=Path, default=LOCK_FILE, help=argparse.SUPPRESS)
    parser.add_argument("--vendor-dir", type=Path, default=VENDOR_DIR, help=argparse.SUPPRESS)
    parser.add_argument("--wheel-dir", type=Path, default=WHEEL_CACHE, help=argparse.SUPPRESS)
    parser.add_argument(
        "--offline", action="store_true", help="use only wheels already in the cache"
    )
    args = parser.parse_args(argv)
    try:
        if args.check:
            return _run_check(args.lock, args.vendor_dir)
        records = vendor(args.lock, args.vendor_dir, args.wheel_dir, download=not args.offline)
    except VendorError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    files, size = folder_size(args.vendor_dir)
    names = ", ".join(f"{record.name} {record.version}" for record in records)
    where = _display(args.vendor_dir)
    print(f"Vendored {names} into {where}: {files} files, {size / 2**20:.1f} MiB.")
    return 0


def _run_check(lock_file: Path, vendor_dir: Path) -> int:
    problems = check(lock_file, vendor_dir)
    if problems:
        print(f"{_display(vendor_dir)} does not match {_display(lock_file)}:", file=sys.stderr)
        for problem in problems:
            print(f"  - {problem}", file=sys.stderr)
        print("Run: python scripts/vendor_engine.py", file=sys.stderr)
        return 1
    print(f"{_display(vendor_dir)} matches {_display(lock_file)}.")
    return 0


if __name__ == "__main__":
    if sys.version_info < (3, 10):  # noqa: UP036 - users may run this with any python3
        sys.exit("scripts/vendor_engine.py needs Python 3.10 or newer.")
    sys.exit(main())
