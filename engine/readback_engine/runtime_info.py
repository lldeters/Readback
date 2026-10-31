"""Facts about the running interpreter and the vendored packages, reported by engine/initialize."""

import logging
import platform
import sys
from pathlib import Path
from typing import Final

from .protocol import PythonInfo, VendoredPackage

log = logging.getLogger("readback.runtime")

# The shipped layout: engine/run_engine.py, engine/readback_engine/, engine/vendor/.
ENGINE_DIR: Final = Path(__file__).absolute().parent.parent
VENDOR_DIR: Final = ENGINE_DIR / "vendor"


def python_info() -> PythonInfo:
    version = sys.version_info
    return {
        "version": platform.python_version(),
        "versionInfo": {
            "major": version.major,
            "minor": version.minor,
            "micro": version.micro,
            "releaseLevel": version.releaselevel,
            "serial": version.serial,
        },
        "implementation": sys.implementation.name,
        "executable": sys.executable,
        "platform": sys.platform,
    }


def vendored_packages(vendor_dir: Path = VENDOR_DIR) -> list[VendoredPackage]:
    """Name and version of every ``*.dist-info`` in ``vendor_dir``, sorted by name.

    Read from METADATA instead of importing the packages: initialize must stay fast, and Phase 0
    imports neither sqlglot nor jedi. A missing folder (not vendored yet) yields an empty list.
    """
    packages: list[VendoredPackage] = []
    for dist_info in sorted(vendor_dir.glob("*.dist-info")):
        headers = read_metadata(dist_info / "METADATA")
        name, version = headers.get("Name"), headers.get("Version")
        if name and version:
            packages.append({"name": name, "version": version})
        else:
            log.warning("Ignored %s: its METADATA has no Name or Version.", dist_info.name)
    packages.sort(key=lambda package: (package["name"].lower(), package["name"]))
    return packages


def read_metadata(path: Path) -> dict[str, str]:
    """First value of every header of a core metadata file; the headers end at a blank line."""
    try:
        text = path.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        log.warning("Cannot read %s: %s", path, exc)
        return {}
    headers: dict[str, str] = {}
    for line in text.splitlines():
        if not line.strip():
            break
        if line[0] in " \t":
            continue  # continuation of a folded header such as a long License text
        key, colon, value = line.partition(":")
        if colon:
            headers.setdefault(key.strip(), value.strip())
    return headers
