# Architecture decision records

Each record states one decision: its context, the decision itself, the consequences and the
alternatives that were considered. A record is not edited once it is accepted; a later record
supersedes it instead and both are marked accordingly. Editorial updates that leave the decision
unchanged, such as the new names after the rename in [ADR 010](010-product-name.md), are the only
exception. [`docs/architecture.md`](../architecture.md) describes the resulting design.

| ADR                                 | Decision                                                  | Status   |
| ----------------------------------- | --------------------------------------------------------- | -------- |
| [001](001-architecture.md)          | Extension host, Python analysis engine and React webview  | Accepted |
| [002](002-toolchain.md)             | TypeScript 6, ESLint 10, esbuild targets, Vitest, Node 24 | Accepted |
| [003](003-engine-sandbox.md)        | Engine process isolation and sandbox                      | Accepted |
| [004](004-interpreter-discovery.md) | Interpreter discovery and Restricted Mode                 | Accepted |
| [005](005-engine-protocol.md)       | JSON-RPC 2.0 over stdio between extension and engine      | Accepted |
| [006](006-graph-schema.md)          | Graph schema, positions and types on both sides           | Accepted |
| [007](007-vendoring.md)             | Vendoring the engine's Python dependencies                | Accepted |
| [008](008-webview.md)               | Webview: CSP, workers, theme and localization             | Accepted |
| [009](009-license-policy.md)        | License policy and the license gate                       | Accepted |
| [010](010-product-name.md)          | Product name Hearback                                     | Accepted |

New records use the next number and this outline:

```markdown
# ADR NNN: Title

- Status: Proposed | Accepted | Superseded by ADR NNN
- Date: YYYY-MM-DD

## Context

## Decision

## Consequences

## Alternatives considered
```
