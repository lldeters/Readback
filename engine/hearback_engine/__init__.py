"""Hearback analysis engine.

The extension host starts it as ``python -I -S -X utf8 engine/run_engine.py`` and talks
JSON-RPC 2.0 over stdio (see shared/engine-protocol.schema.json).

Modules:
    server        process setup (stdio, sandbox, logging) and the engine/* methods
    rpc           Content-Length framing, message dispatch and cancellation
    protocol      payload types and constants, mirroring the protocol schema
    validation    checks of incoming params
    graph         graph model, mirroring shared/graph-schema.json
    logs          the stderr log format
    sandbox       audit hook against process creation, network and native code
    runtime_info  interpreter facts and vendored packages for engine/initialize
    python_analysis, sql_analysis  analyses of later phases

Nothing here imports sqlglot or jedi at startup; analyses load them lazily.
"""

__all__ = ["ENGINE_VERSION", "MIN_PYTHON", "PROTOCOL_VERSION", "SCHEMA_VERSION"]

# Must equal "version" in package.json (checked by test/repo/versions.test.ts).
ENGINE_VERSION = "0.0.1"
# Must equal PROTOCOL_VERSION in src/engine/protocol.ts.
PROTOCOL_VERSION = 1
# Must equal schemaVersion in shared/graph-schema.json.
SCHEMA_VERSION = 1
MIN_PYTHON = (3, 10)
