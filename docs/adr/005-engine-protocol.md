# ADR 005: JSON-RPC 2.0 over stdio between extension and engine

- Status: Accepted
- Date: 2026-10-31

## Context

Spec section 5.2 asks for lean [JSON-RPC 2.0](https://www.jsonrpc.org/specification) over stdio,
with `vscode-jsonrpc` on the TypeScript side and a small implementation of its own in Python, and
no Language Server Protocol. Requests must be cancellable and limited by a timeout setting. A
smoke test with vscode-jsonrpc and a 47-line Python server, and later a 174-line prototype, found:

- vscode-jsonrpc 10.0.0 is CommonJS with an exports map; it must be imported from
  `vscode-jsonrpc/node`, because the bare package name fails at runtime.
- The client writes only a `Content-Length` header that counts UTF-8 bytes.
- On cancellation the client sends `$/cancelRequest` and keeps the request pending until the server
  answers. A server that never answers leaves the promise pending forever, so the client needs its
  own deadline.
- python-lsp-jsonrpc has framing bugs, an optional native dependency (ujson) and no cooperative
  cancellation.

## Decision

- **Framing:** `Content-Length: <bytes>\r\n\r\n` plus UTF-8 JSON, as in LSP's base protocol. The
  engine reads `sys.stdin.buffer`, writes to its private copy of stdout in binary mode and flushes
  after each message.
- **Client:** vscode-jsonrpc 10.0.0 imported from `vscode-jsonrpc/node`, with
  `StreamMessageReader` and `StreamMessageWriter` on the child's pipes, bundled into
  `dist/extension.js`.
- **Server:** a small standard-library implementation in `engine/hearback_engine/`.
- **Semantics:** requests are processed serially. `$/cancelRequest` sets the cancel flag of the
  request, which long analyses check. Every request gets exactly one response; a cancelled request
  answers with -32800 (LSP `RequestCancelled`). The standard codes -32700, -32600, -32601, -32602
  and -32603 are used as JSON-RPC defines them, and -32002 (LSP `ServerNotInitialized`) answers any
  request before `engine/initialize`. Error responses carry `EngineErrorData` (`kind`, `detail`).
- **Methods:** `engine/initialize` (handshake with the protocol version; returns engine, Python and
  vendored versions, the method list, the process id and the sandbox state), `engine/ping`,
  `engine/shutdown`, `engine/exit` and `engine/setLogLevel`. Payloads are defined in
  `shared/engine-protocol.schema.json`; names, codes and exit codes in `src/engine/protocol.ts`.
  `PROTOCOL_VERSION` (1) also lives in `engine/hearback_engine/__init__.py`, and a repository test
  keeps both equal.
- **Timeouts:** the client enforces `hearback.engine.timeoutMs` per request. At the deadline it
  cancels; if the engine has still not answered two seconds later, the client kills it. Crashed or
  hung engines restart with exponential backoff.
- **stderr:** one log record per line, `[<level>] <message>`, continuation lines indented by four
  spaces. A failed start writes one `HEARBACK_ENGINE_FATAL <json>` line and exits with code 3
  (Python too old) or 4 (bootstrap failed).
- **Shutdown:** `engine/shutdown` request, `engine/exit` notification, end of stdin, kill after two
  seconds. The engine also exits at end of stdin.

## Consequences

- The framing is standard and easy to debug, the client is mature, and the server needs no
  dependency.
- Serial processing keeps the engine simple, but one slow request delays the next. The client
  cancels superseded requests (from Phase 1) and kills an engine that hangs.
- Cancellation is cooperative: a single long sqlglot or Jedi call cannot be interrupted except by
  killing the process.
- Any incompatible change needs a new protocol version on both sides.

## Alternatives considered

- **The Language Server Protocol** (`vscode-languageclient`): document synchronization and
  capability negotiation that custom graph requests do not need.
- **python-lsp-jsonrpc:** see the context above.
- **Newline-delimited JSON:** no ready-made client, and fragile with multi-line payloads and stray
  output.
- **Sockets or named pipes:** the engine must not open sockets, and stdio ties the engine's
  lifetime to the extension host.
- **Concurrent request handling:** the analyses are CPU-bound under the GIL and would gain nothing.
