"""Shared fixtures. The engine is tested in the shipped layout: engine/ and engine/vendor/ come
first on sys.path, in the order engine/run_engine.py puts them there."""

import sys
from pathlib import Path

for _path in (Path(__file__).resolve().parent.parent / name for name in ("vendor", "")):
    while str(_path) in sys.path:
        sys.path.remove(str(_path))
    sys.path.insert(0, str(_path))

import logging  # noqa: E402 - the engine packages resolve only after the path setup above
from collections.abc import Iterator  # noqa: E402
from typing import Any  # noqa: E402

import pytest  # noqa: E402
import support  # noqa: E402


@pytest.fixture(autouse=True)
def _restore_logging() -> Iterator[None]:
    """Engines under test change the root log level and may install handlers; undo that."""
    root = logging.getLogger()
    level, handlers = root.level, list(root.handlers)
    yield
    for handler in root.handlers:
        if handler not in handlers:
            root.removeHandler(handler)
    root.setLevel(level)
    logging.captureWarnings(False)


@pytest.fixture
def harness() -> Iterator[support.EngineHarness]:
    """An in-process engine that is not yet started (register test handlers first)."""
    engine = support.EngineHarness()
    try:
        yield engine
    finally:
        engine.close()


@pytest.fixture
def engine(harness: support.EngineHarness) -> support.EngineHarness:
    """A started in-process engine."""
    return harness.start()


@pytest.fixture
def initialized(engine: support.EngineHarness) -> support.EngineHarness:
    engine.initialize()
    return engine


@pytest.fixture(scope="session")
def protocol_schema() -> dict[str, Any]:
    schema: dict[str, Any] = support.load_json(support.PROTOCOL_SCHEMA)
    return schema


@pytest.fixture(scope="session")
def graph_schema() -> dict[str, Any]:
    schema: dict[str, Any] = support.load_json(support.GRAPH_SCHEMA)
    return schema


@pytest.fixture(scope="session")
def vendored() -> Path:
    """engine/vendor/, failing clearly when it has not been generated yet."""
    if not (support.VENDOR_DIR / "VENDOR.json").is_file():
        pytest.fail("engine/vendor/ is missing; run: python scripts/vendor_engine.py")
    return support.VENDOR_DIR
