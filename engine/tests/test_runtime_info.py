"""Interpreter facts and vendored packages reported by engine/initialize."""

from __future__ import annotations

import logging
import platform
import sys
from pathlib import Path

import pytest
import support

from hearback_engine import runtime_info


def test_python_info_describes_this_interpreter() -> None:
    info = runtime_info.python_info()
    assert info["version"] == platform.python_version()
    assert info["versionInfo"] == {
        "major": sys.version_info.major,
        "minor": sys.version_info.minor,
        "micro": sys.version_info.micro,
        "releaseLevel": sys.version_info.releaselevel,
        "serial": sys.version_info.serial,
    }
    assert info["implementation"] == sys.implementation.name
    assert info["executable"] == sys.executable
    assert info["platform"] == sys.platform


def test_engine_folders() -> None:
    assert runtime_info.ENGINE_DIR == support.ENGINE_DIR
    assert runtime_info.VENDOR_DIR == support.VENDOR_DIR


def dist_info(folder: Path, name: str, metadata: str) -> None:
    (folder / name).mkdir(parents=True)
    (folder / name / "METADATA").write_text(metadata, encoding="utf-8")


def test_vendored_packages_are_read_from_metadata(
    tmp_path: Path, caplog: pytest.LogCaptureFixture
) -> None:
    dist_info(tmp_path, "zeta-2.dist-info", "Metadata-Version: 2.1\nName: Zeta\nVersion: 2\n")
    dist_info(
        tmp_path,
        "alpha-1.0.dist-info",
        "Name: alpha\nLicense: MIT\n  folded: not a header\nVersion: 1.0\n\nName: from the body\n",
    )
    dist_info(tmp_path, "broken-0.dist-info", "Summary: no name or version\n")
    (tmp_path / "missing-1.dist-info").mkdir()
    (tmp_path / "not-a-dist-info").mkdir()
    with caplog.at_level(logging.WARNING):
        packages = runtime_info.vendored_packages(tmp_path)
    assert packages == [{"name": "alpha", "version": "1.0"}, {"name": "Zeta", "version": "2"}]
    assert "Ignored broken-0.dist-info" in caplog.text
    assert "Cannot read" in caplog.text


def test_no_vendor_folder_means_no_packages(tmp_path: Path) -> None:
    assert runtime_info.vendored_packages(tmp_path / "missing") == []


def test_the_shipped_vendor_folder(vendored: Path) -> None:
    names = [package["name"] for package in runtime_info.vendored_packages(vendored)]
    assert names == ["jedi", "parso", "sqlglot"]


def test_metadata_without_a_body(tmp_path: Path) -> None:
    path = tmp_path / "METADATA"
    path.write_text("Name: x\nName: y\nVersion: 3", encoding="utf-8")
    assert runtime_info.read_metadata(path) == {"Name": "x", "Version": "3"}
