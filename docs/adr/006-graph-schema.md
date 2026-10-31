# ADR 006: Graph schema, positions and types on both sides

- Status: Accepted
- Date: 2026-10-31

## Context

Spec section 5.3 makes one versioned JSON Schema, `shared/graph-schema.json`, the single source of
truth; the TypeScript and Python types must be generated from it or checked against it by tests.
The positions in the graph have to work for click-to-source, but the sources disagree on units:
CPython's `ast` reports UTF-8 byte offsets, sqlglot reports code-point offsets, and VS Code
positions count UTF-16 code units. On a line such as `s = "Größe 😀"; y = 2`, `y` is at byte 20,
code point 15 and UTF-16 unit 16.

json-schema-to-typescript 16 handles draft 2020-12 but does not support `prefixItems` and treats
`oneOf` like `anyOf`. Generating Python types with datamodel-code-generator would add a
`typing_extensions` import at runtime and a heavy toolchain.

## Decision

- Both `shared/graph-schema.json` and `shared/engine-protocol.schema.json` use JSON Schema draft
  2020-12 with `additionalProperties: false`, enums for kinds, confidence, change status and
  attribution, and `$defs` for shared shapes.
- `GraphDocument.schemaVersion` is a constant (1) and is bumped on every incompatible change, in
  step with `SCHEMA_VERSION` in `engine/readback_engine/__init__.py`.
- **Positions are zero-based lines and UTF-16 code units (LSP semantics).** `Range.file` is the
  absolute path that the extension passed to the engine. The engine converts from `ast` and sqlglot
  offsets.
- **Confidence** is `certain`, `inferred` or `unresolved` on every edge. A target that cannot be
  resolved becomes a node of kind `unresolved` with a required `reason` (an `if`/`then` rule in the
  schema); edges are never dropped.
- **TypeScript types are generated** by `scripts/gen-schema-types.mjs` (json-schema-to-typescript
  16.0.0, formatted with Prettier) into `src/shared/generated/`. `npm run schema:check` fails CI
  when they are stale, and the repository tests validate the examples in `shared/examples/` with
  Ajv.
- **Python uses hand-written standard-library `TypedDict`s**, checked by conformance tests: the
  keys and `Literal` values must match the schema, and engine output and snapshots are validated
  with `jsonschema` (a development dependency only).
- The schemas avoid tuples (`prefixItems`) and exclusive alternatives (`oneOf`).

## Consequences

- One contract for engine, extension host and webview; drift on either side fails CI, and the
  engine has no runtime dependency for typing.
- The Python types duplicate the schema by hand; the conformance tests keep them honest.
- Changes are schema-first: edit the schema, run `npm run schema:generate`, update both sides and
  the examples.
- Click-to-source stays correct on lines with non-ASCII characters.

## Alternatives considered

- **Generated Python types** (datamodel-code-generator): a runtime import of `typing_extensions`
  and a large toolchain.
- **TypeScript-first types** (for example zod) that emit a schema: the Python side would depend on
  a TypeScript build step.
- **Protocol Buffers or another binary format:** more tooling, while JSON is small enough and
  readable.
- **Code-point or UTF-8 positions:** wrong columns in VS Code for non-ASCII text.
