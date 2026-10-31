"""Readback analysis engine.

The extension host starts it as ``python -I -S -X utf8 engine/run_engine.py`` and talks
JSON-RPC 2.0 over stdio (see shared/engine-protocol.schema.json).
"""

__all__ = ["ENGINE_VERSION", "MIN_PYTHON", "PROTOCOL_VERSION", "SCHEMA_VERSION"]

# Must equal "version" in package.json (checked by test/repo/versions.test.ts).
ENGINE_VERSION = "0.0.1"
# Must equal PROTOCOL_VERSION in src/engine/protocol.ts.
PROTOCOL_VERSION = 1
# Must equal schemaVersion in shared/graph-schema.json.
SCHEMA_VERSION = 1
MIN_PYTHON = (3, 10)
