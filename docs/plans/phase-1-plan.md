# Hearback Phase 1 plan (release 0.1.0, pre-release)

Status: approved by the owner on 2026-11-08 (spec rule 0.1), with its defaults: D06 (the rule for 'modified'), D08 (Jedi on by default, setting restricted), D14 (search keybinding, Copy as Mermaid, view switcher) and the new dependencies (elkjs 0.12.1, @xyflow/react 12.12.1, playwright-core 1.64.1, actionlint 1.7.12 in CI, actions/download-artifact v8.0.2 and ovsx 1.3.0 through npx in the release job). The owner decided on 2026-11-04: the name Hearback (ADR 010), the one-time confirmation for workspace interpreters (ADR 011) and Trusted Publishing (D18). Deviations found during the implementation are recorded in the ADRs and reported to the owner.

## Overview

Phase 1 plan (release 0.1.0, pre-release) for the owner's approval under spec rule 0.1. Revised after review.

Baseline: origin/claude/kind-wozniak-gg8kz0 at f954d7d. That is the Phase 0 commit 0b8271c plus nine follow-up commits:

- the rename to Hearback (ADR 010);
- the confirmation of workspace interpreters chosen by the Python extension (SEC-2, ADR 011).
  CI run 41926511345 passed all 18 jobs, and the local checkout is fast-forwarded to it (WP00 done).

Identifiers follow ADR 010: hearback.* commands and settings, view type hearback.graph, engine/hearback_engine/, HEARBACK_*, .hearback/, ID lldeters.hearback. The owner chose Hearback on 2026-11-04.

Scope: spec 5.4 and 6.1 in full, export, and the Hearback sidebar with Changes.

Order of work, 30 packages:

1. WP00 baseline and name.
2. WP01 contract v2, schema first.
3. WP02–WP11 engine analyses with fixture snapshots.
4. WP12–WP13 host scheduler, chunked workspace index and Git.
5. WP14 webview protocol and ELK worker.
6. WP15–WP19 scanner, panel, editor sync, CodeLens, Changes tree.
7. WP20–WP24 webview model, views, interaction, language-server comparison.
8. WP25 export.
9. WP26–WP29 end-to-end tests, CI gates, documentation, release preparation.

Every package ends green locally: lint, typecheck, unit tests, engine tests on 3.10 and 3.15, l10n export diff, schema:check, notices:check. Each package is then pushed so CI runs the VS Code integration tests it adds; the sandbox cannot download VS Code.

Review changes compared with the draft:

- The rename and SEC-2 are already done (WP00 replaces WP00a and WP00b; no confirmationRequired state).
- Call-graph resolution follows spec 6.1.3 exactly: the custom type inference is dropped, Jedi is step 3 and on by default, and the P1-070 example is restored.
- A scheduler with one request in flight and deadlines that start at dispatch, plus index batches, sits in front of the serial engine.
- maxNodes counts member rows. The ELK variant is chosen from a cost estimate (boxes, ports, edges), and the benchmark sets are pinned.
- Integration tests move into the packages that introduce each feature. Quiet-start checks run in the root hook; the no-writes proof runs in a real Git repository.
- Bounded regular-file readers on host and engine.
- PEP 701 detection on 3.10 and 3.11.
- Strict 5.4 for 'modified', with flags.
- CodeLens also on nested functions.
- Diagnostics and unresolved reasons are localized on both sides.

Measured basis (4-vCPU sandbox):

- Engine cold start: 52–87 ms.
- Warm analysis of 1,000 lines: 196–252 ms for all views together; classAnatomy alone 90–125 ms; diff/compare about 60 ms.
- Jedi: about 1 s on first use (2.5–3.8 s with an empty parso cache), then 5–31 ms per call site.
- ELK 0.12.1, 300 nodes:
  - realistic class anatomy 0.39–0.51 s;
  - dense random port graph 3.1–3.4 s, or 1.7 s with thoroughness 1 (Chromium worker);
  - call DAG 0.64–0.71 s warm (Chromium);
  - nested module graph 4.4 s (Node), hence flat by default.
- The fixture prototype reproduces every fact of spec 11.1 on 3.10 and 3.15.
- The PEP 701 detector prototype passes 13 of 13 cases on 3.10.20 and 3.11.17, with 0 false positives on 289 vendored files.

New dependencies:

- Required: elkjs 0.12.1 (EPL-2.0 exception, ADR 009). It embeds a 2-line Apache-2.0 web-worker shim, which gets its own notice entry.
- Release workflow: actions/download-artifact v8.0.2.
- Optional: @xyflow/react 12.12.1, playwright-core 1.64.1 (dev), actionlint 1.7.12 (CI).

New ADRs 012–020. ADRs 003, 005, 006 and 008 get 'amended by' status lines.

Before WP01, the owner approves this plan with its defaults, in particular D06, D08, D14 and elkjs. Release questions wait for WP29: icon, screenshots, environment (Trusted Publishing was chosen on 2026-11-04). Nothing is published without the owner's approval of the release environment.

## Work packages

### WP00 Baseline (done): Phase 0 follow-ups landed

**Goal:** Start Phase 1 from the reviewed, CI-green follow-up commits and fix the product name before any Phase 1 identifier exists.

**Requirements:** P1-001, P1-006, P1-169

**Details:**

- Done on 2026-11-05: the local checkout is fast-forwarded to f954d7d (rename to Hearback, ADR 010; workspace interpreter confirmation, ADR 011), the scratch worktree is removed, CI run 41926511345 passed all 18 jobs.
- Phase 1 ADRs are numbered 012 to 020.

**Tests:**

- CI on the fast-forwarded head: run 41926511345 passed all 18 jobs (lint; unit on 3 OS; engine on 3 OS × 3.10/3.15; integration on 3 OS × 1.105.1/stable; Restricted Mode; package).
- Locally after the fast-forward: npm ci, lint, typecheck, test:unit, test:engine on 3.10 and 3.15, schema:check, notices:check.
- Fallback only: the same suite after the reverse rename, and 'git grep -n -i hearback' lists only ADR 010's history.

### WP01 Contract v2: graph schema and engine protocol (schema first)

**Goal:** Define every Phase 1 parameter and result before any engine code, with types on both sides and both versions bumped once.

**Depends on:** WP00

**Requirements:** P1-020, P1-032, P1-033, P1-035, P1-036, P1-037, P1-005

**Files:**

- shared/graph-schema.json
- shared/engine-protocol.schema.json
- src/shared/generated/graph.ts (regenerated)
- src/shared/generated/engineProtocol.ts (regenerated)
- src/engine/protocol.ts (PROTOCOL_VERSION 2)
- engine/hearback_engine/**init**.py (PROTOCOL_VERSION 2, SCHEMA_VERSION 2)
- engine/hearback_engine/graph.py
- engine/hearback_engine/protocol.py
- engine/hearback_engine/validation.py
- engine/tests/test_schema_conformance.py
- engine/tests/test_validation.py
- engine/tests/test_graph.py
- shared/examples/graph-class-anatomy.json (corrected by hand to spec 11.1)
- shared/examples/initialize-result.json (versions 2/2)
- shared/examples/change-summary.json (new)
- test/repo/schema.test.ts
- test/repo/versions.test.ts
- test/integration/engine.test.ts (protocolVersion 2)
- docs/adr/012-contract-v2-and-analysis-requests.md
- docs/adr/005-engine-protocol.md and docs/adr/006-graph-schema.md (status line: amended by 012)

**Details:**

- Graph schema v2 (full list under schemaChanges): schemaVersion 2, Range.revision, Node.selectionRange, GraphDocument.focus, Node.changeDetail, typed props $defs with NodePropsByKind and EdgePropsByKind, the DiagnosticCode and UnresolvedReasonCode enums, ChangeSummary, Hunk, IndexResult, and a corrected Meta.truncated text.
- Protocol v2: InitializeParams.storageDirectory plus the params $defs. Results are defined only in graph-schema.json, so there is no cross-file $ref and scripts/gen-schema-types.mjs stays unchanged. Measured: a cross-file $ref duplicates every graph type into engineProtocol.ts.
- Method entries are not added here. Each analysis package adds, in one commit:
- its Methods entry (protocol.ts and protocol.py);
- its handler;
- test_server.ENGINE_METHODS;
- its RequestType in src/engine/analysis/requests.ts;
- initialize-result.json capabilities.
- This keeps test_protocol_sync green after every commit.
- The method order is fixed in ADR 012: engine/initialize, engine/ping, engine/shutdown, python/classAnatomy, python/callGraph, python/controlFlow, python/moduleGraph, python/indexFiles, diff/compare, then the notifications engine/exit and engine/setLogLevel. Requests come before notifications, as MethodTable.names() lists them.
- schemaVersion 2 and PROTOCOL_VERSION 2 stay fixed for the rest of Phase 1. Later additions within Phase 1 stay within v2, because nothing ships before 0.1.0.
- Python side:
- TypedDicts for every new def; NodePropsByKind uses the functional syntax because 'class' is a keyword; Literal[2] for the schema version;
- hand-written validators for every new params def, run side by side with the schema.
- Example correction: e2 runs from call_by_name to unresolved; the self-unused diagnostic sits on _log_retry; the class range spans lines 5–39 and ends at character 36. WP11 regenerates the example from the snapshot.

**Tests:**

- npm run schema:check
- test_schema_conformance: all new defs; NodePropsByKind keys equal the NodeKind values; enums match
- test_validation side by side for every new params def
- test/repo/versions.test.ts at 2/2
- schema.test.ts:
- - examples are valid;
- - an unknown props key is rejected by the kind def;
- - revision ranges are accepted;
- - unresolved nodes require a reason
- integration engine.test.ts asserts protocolVersion 2 (CI)

### WP02 Engine foundations: positions, safe reading, parsing, newer syntax, cache, snapshots

**Goal:** Building blocks shared by every analysis, tested on 3.10 and 3.15.

**Depends on:** WP01

**Requirements:** P1-014, P1-021, P1-025, P1-026, P1-029, P1-032

**Files:**

- engine/hearback_engine/python_analysis/positions.py
- engine/hearback_engine/python_analysis/source.py
- engine/hearback_engine/python_analysis/syntax.py
- engine/hearback_engine/python_analysis/fstrings.py (PEP 701 scanner)
- engine/hearback_engine/cache.py
- engine/hearback_engine/workspace.py (safe reader)
- engine/hearback_engine/analysis.py (handler registry with lazy imports, meta, cancellation checkpoints)
- engine/tests/support.py (snapshot helper)
- engine/tests/conftest.py (--snapshot-update through pytest_addoption)
- engine/tests/fixtures/python/syntax/*.py (LF only)
- engine/tests/test_positions.py
- engine/tests/test_source.py
- engine/tests/test_syntax.py
- engine/tests/test_fstrings.py
- engine/tests/test_cache.py
- engine/tests/test_workspace.py
- engine/pyproject.toml (mypy exclude tests/fixtures; norecursedirs; marker perf; addopts -m 'not perf')
- .prettierignore (engine/tests/snapshots/, engine/tests/fixtures/)
- .github/workflows/ci.yml (engine job: extra 'mypy --python-version 3.15' on the 3.15 leg)

**Details:**

- LineIndex:
- split lines only on CRLF, CR and LF;
- convert UTF-8 byte columns to UTF-16, with an ASCII fast path;
- convert code points to UTF-16 (for SyntaxError and Jedi);
- strip a leading BOM.
- Parsing:
- ast.parse runs under warnings.catch_warnings();
- SyntaxError, ValueError (NUL on 3.10), MemoryError and RecursionError become a syntax-error diagnostic with a range;
- bad input never fails a request with -32603;
- compile() is never called.
- Newer syntax: token markers plus the SyntaxError line, with a feature table (PEP, version) for 3.11–3.15: except*, PEP 646, PEP 695, PEP 696, PEP 758, t-strings, PEP 810 lazy import and PEP 798.
- PEP 701 on 3.10 and 3.11 (fstrings.py):
- trigger: the message starts with 'f-string', or is 'unterminated string literal' or 'f-string expression part cannot include a backslash';
- a quote- and brace-aware scanner then re-lexes the file under 3.12 rules;
- if it lexes cleanly and a replacement field reuses an enclosing quote, contains a backslash or '#', or spans lines, the result is newer-syntax (PEP 701, Python 3.12) at that line;
- otherwise the result stays syntax-error.
- Prototype: scratchpad/phase1-plan/plan-revise/fstring701.py.
- Safe reader (workspace.py):
- os.stat must report S_ISREG (symlinks followed) and a size of at most 1 MiB;
- os.open with O_NONBLOCK where it exists, fstat again, read at most cap + 1 bytes;
- failures give file-too-large or file-unreadable{reason};
- PEP 263 decoding through tokenize.detect_encoding;
- host overlays take precedence;
- it never writes.
- Cache: a bounded in-memory LRU keyed by (path, sha256, ENGINE_VERSION). For files on disk, a (size, mtime_ns) pre-check means unchanged files are neither re-read nor re-hashed. Counters for tests.
- Snapshots:
- JSON with indent 2, sort_keys and ensure_ascii False;
- durationMs set to 0, engineVersion replaced by '<engine>';
- absolute paths with either separator replaced by '<fixtures>/';
- every snapshot validated against the graph schema;
- engine/tests/snapshots/ is in .prettierignore.
- CRLF and lone-CR variants are built inside the tests from LF sources, because .gitattributes forces LF. Each such test asserts that its input contains a carriage return.
- pytest norecursedirs adds 'fixtures' and 'snapshots' to the defaults, so a conftest.py among the fixtures never runs inside pytest (verified in scratchpad/phase1-plan/plan-revise/pytrap).
- Code conventions:
- version-specific AST access through sys.version_info guards;
- analyzers use dispatch tables;
- PLR per-file ignores only with a stated reason.

**Tests:**

- test_positions:
- - the ADR 006 line 'Größe 😀';
- - a property test over 3,000 random sources;
- - CRLF, CR, form feed and U+2028 lines built in the test
- test_syntax (version-gated):
- - except* maps to 3.11;
- - type aliases, PEP 695 and PEP 701 forms map to 3.12 on 3.10;
- - 'except A, B:' and t-strings map to 3.14;
- - real errors stay syntax-error;
- - the same files parse on 3.15
- test_fstrings:
- - the 13 prototype cases: nested same quotes in calls and subscripts, backslash, comment, multi-line field, triple nesting;
- - negatives: an unclosed field, a single '}', valid f-strings;
- - a corpus pass over engine/vendor with 0 false positives
- test_workspace: /dev/zero, a FIFO and a symlink to /dev/zero (POSIX) and NUL (Windows) give file-unreadable without blocking; a file of 1 MiB + 1 byte gives file-too-large
- test_cache:
- - no reparse on a repeat (parse counter);
- - the (size, mtime_ns) skip;
- - a one-byte edit reparses;
- - another engine version misses;
- - eviction
- snapshot helper: missing, different and update cases

### WP03 Engine: symbols, stable IDs, ranges, module names, import resolution

**Goal:** Deterministic node ids, ranges and module names that match between base and working version.

**Depends on:** WP02

**Requirements:** P1-030, P1-031, P1-063, P1-069, P1-005

**Files:**

- engine/hearback_engine/python_analysis/symbols.py
- engine/hearback_engine/python_analysis/modules.py
- engine/tests/fixtures/python/ids_cases.py
- engine/tests/fixtures/python/ws_src_layout/** (src/shop/...)
- engine/tests/fixtures/python/ws_imports/**
- engine/tests/test_symbols.py
- engine/tests/test_modules.py
- docs/adr/013-python-analysis-model.md

**Details:**

- Symbol IDs: py:<module>.<qualname>, without <locals>.
- Shadowed earlier definitions get #1, #2 and so on; the last definition keeps the plain id. They also get duplicate-definition.
- @overload stubs fold into the implementation.
- Property accessors fold into one property node.
- On an attribute/method name clash, the attribute id gets the suffix ~attr.
- Attributes belong to the defining class along the MRO.
- Other ids:
- unresolved:<source id>/<expression>
- e:<kind>:<source>-><target>
- CFG nodes: <function id>@<structural path>
- Ranges: Node.range runs from the first decorator to the last statement; Node.selectionRange covers the name. Clicks go to selectionRange, the CodeLens anchors on the range's start line, and cursor sync uses range.
- Module names come from source roots: the deepest of the workspace folder and a top-level src/.
- Outside every root: the **init** chain, otherwise the file stem.
- PEP 420 namespace packages are supported.
- IDs are unique per root only, so every index and cache key includes the root.
- Import table:
- absolute and relative imports (**package** semantics), aliases, from-imports of submodules;
- re-export chains up to depth 10; star imports (inferred);
- TYPE_CHECKING and deferred flags;
- stdlib detection through sys.stdlib_module_names.
- ADR 013 records:
- IDs, ranges and module names;
- the resolution order (spec 6.1.3 exactly, see D05);
- the workspace index and cache (in memory only, keys, 5,000-file cap, file-set rules).

**Tests:**

- ids stay equal after a reformat, after member reordering and with lines inserted above
- duplicate, overload and property folding
- src layout: 'from shop.orders import OrderService' resolves to py:shop.orders.OrderService; a loose file uses its stem
- 'import pkg.mod as m', 'from .sub import f as g' and 'from . import x' resolve to the right functions
- a decorated def: range.start is on the decorator line, selectionRange on the name

### WP04 Engine: facts, class anatomy, state matrix, metrics (python/classAnatomy)

**Goal:** Class cards, state edges, MRO, LCOM4-like groups and metrics for a whole file, focused on the symbol at the cursor.

**Depends on:** WP03

**Requirements:** P1-019, P1-028, P1-047, P1-052, P1-053, P1-054, P1-055, P1-056, P1-057, P1-058, P1-060, P1-061, P1-062, P1-063, P1-064, P1-065, P1-066, P1-088

**Files:**

- engine/hearback_engine/python_analysis/facts.py
- engine/hearback_engine/python_analysis/class_anatomy.py
- engine/hearback_engine/python_analysis/state_matrix.py
- engine/hearback_engine/python_analysis/metrics.py
- engine/hearback_engine/analysis.py (registers python/classAnatomy)
- engine/hearback_engine/protocol.py and src/engine/protocol.ts (Methods entry)
- engine/tests/test_server.py (ENGINE_METHODS)
- shared/examples/initialize-result.json
- engine/tests/fixtures/python/retrying_client.py (exactly spec 11.1)
- engine/tests/fixtures/python/anatomy_cases.py
- engine/tests/test_facts.py
- engine/tests/test_class_anatomy.py
- engine/tests/test_state_matrix.py
- engine/tests/test_metrics.py
- engine/tests/test_handlers.py
- engine/tests/snapshots/**

**Details:**

- python/classAnatomy analyzes the whole file and focuses on the symbol at the position. Its method entry lands at its fixed place in the ADR 012 order.
- The receiver is the first parameter, whatever its name.
- Access kinds:
- writes: assignment, annotated assignment, tuple/for/with targets, del;
- reads plus writes: augmented assignment;
- mutates: subscript or attribute assignment, del of an item, and known mutating methods. A mutation counts as certain when the attribute's container type is known from its annotation or initializer, inferred otherwise. It is not also counted as a read.
- Self-calls (self, cls, super()) resolve along the C3 MRO.
- An inconsistent MRO gives mro-conflict.
- An external base ends the lookup with reasonCode external-base.
- attribute-outside-init: initializers are **init**, **new**, **post_init**, **init_subclass**, setUp, and the methods they call through self, transitively.
- Method groups: the decorator kind beats visibility. Private means a leading '_' but not a dunder; name-mangled __x counts as private.
- FunctionProps: signature, parameters, async, decorators, visibility, methodKind, group, abstract, overloads, selfUnused, metrics, sideEffects, raises, catches, builtinCalls, dynamicSelfAccess.
- Metrics: radon-style McCabe complexity, nesting depth, lines (first decorator to end), sloc, and the parameter count without self and cls.
- LCOM4-like components exclude constructors, static and class methods, self-unused methods and methods with dynamic self access.
- selfUnused excludes static and class methods, dunders, abstract methods, stubs and overrides of workspace bases.
- Base classes from other workspace files appear as context cards (ClassProps.context). Stdlib and third-party calls are not drawn on cards.
- State-matrix data (R/W/RW cells; mutates counts as W) goes into ClassProps.matrix, so the webview needs no extra request.
- The jedi, parso and sqlglot imports stay lazy. classAnatomy never imports Jedi, whatever useJedi says.

**Tests:**

- the facts for P1-052 to P1-066 on anatomy_cases: dataclass, setter and deleter, static/class/abstract methods, nested class and closure, late attribute, diamond and inconsistent MRO, disjoint halves, cls.x(), async
- subprocess: after initialize and classAnatomy with useJedi true and with false, 'jedi', 'parso' and 'sqlglot' are not in sys.modules
- outputs schema-valid; snapshots equal on 3.10 and 3.15; test_protocol_sync green

### WP05 Engine: side-effect rules, the rules schema and the exceptions overlay

**Goal:** Side effects with category, confidence, evidence and rule id; raises, catches and inferred propagation.

**Depends on:** WP04

**Requirements:** P1-084, P1-085, P1-086, P1-087, P1-149, P1-150, P1-151, P1-152

**Files:**

- shared/side-effect-rules.schema.json
- engine/hearback_engine/python_analysis/side_effects.py
- engine/hearback_engine/python_analysis/side_effects.default.json (Prettier-formatted)
- engine/hearback_engine/python_analysis/exceptions.py
- engine/tests/fixtures/python/side_effects_cases.py
- engine/tests/fixtures/python/exc_chain.py
- engine/tests/test_side_effects.py
- engine/tests/test_exceptions.py
- engine/tests/test_rules_schema.py
- engine/tests/snapshots/rules/builtin-rule-ids.json
- package.json (jsonValidation)
- .vscodeignore (!shared/side-effect-rules.schema.json, !engine/hearback_engine/**/*.json)
- test/repo/manifest.test.ts
- docs/adr/014-side-effect-rules.md

**Details:**

- Rules format (JSON, because Python 3.10 has no tomllib): {version: 1, rules: [{id, category, calls?, methods?, receiverNames?, confidence?, description}], disable?: [ids]}.
- Categories: output, logging, file, network, subprocess, database, write, environment, global-state, argument-mutation.
- Confidence:
- A match on a name that imports or builtins resolve is certain.
- A method-name match on an unknown receiver is inferred; network.request-methods matches *.request.
- User rules add rules and disable built-in ones by id.
- The host reads the file and sends RulesSource{path, text} (WP12).
- An invalid file gives rules-file-invalid with the rule index; the built-in rules still apply.
- The editor validates rules files through contributes.jsonValidation: fileMatch hearback-rules.json and *.hearback-rules.json, schema ./shared/side-effect-rules.schema.json.
- The built-in rule ids are written to engine/tests/snapshots/rules/builtin-rule-ids.json. The webview test in WP20 requires English and German text for each id.
- Exceptions:
- Own raises that are not surely caught are certain.
- Propagation is a fixed point over the call graph, inferred, with via.
- Matching uses builtin issubclass plus workspace MROs.
- Unresolved callees set sideEffectsComplete false, shown as 'may raise more'.

**Tests:**

- one function per category
- a custom file adds a rule and disables a built-in one
- broken JSON gives rules-file-invalid and the built-in rules stay active
- the hand-written validator and the JSON schema agree on every case
- _request_with_retry catches TimeoutError and raises RuntimeError; get may raise RuntimeError (inferred)
- manifest.test.ts: the jsonValidation entry and the shipped schema file

### WP06 Engine: call graph steps 1–2 and the workspace index (python/callGraph, python/indexFiles)

**Goal:** Callers and callees over k hops across workspace files, built from a cached per-file index, with unresolved and external nodes.

**Depends on:** WP04

**Requirements:** P1-019, P1-022, P1-034, P1-067, P1-068, P1-069, P1-072, P1-073

**Files:**

- engine/hearback_engine/python_analysis/call_graph.py
- engine/hearback_engine/python_analysis/workspace_index.py
- engine/hearback_engine/analysis.py (registers python/callGraph and python/indexFiles)
- engine/hearback_engine/protocol.py, src/engine/protocol.ts, engine/tests/test_server.py, shared/examples/initialize-result.json
- engine/tests/fixtures/python/ws_calls/**
- engine/tests/test_call_graph.py
- engine/tests/test_workspace_index.py

**Details:**

- Resolution follows spec 6.1.3:
- 1. local scopes, self, cls and super(): certain;
- 2. workspace imports, aliases and re-exports: certain;
- 3. optional Jedi (WP07): inferred;
- 4. optional language-server comparison (WP24).
- There is no custom type inference (D05). When step 3 is off or finds nothing, an obj.method() site becomes an unresolved node with reasonCode type-resolution-off or unknown-receiver-type.
- Other reason codes: dynamic-call (getattr; the reason text names getattr), subscript-call, local-value.
- Targets in the stdlib or third-party code, reached through step 2, collapse into one external node per top-level package (py:json). Builtins are not call targets; they are listed in props.builtinCalls.
- python/indexFiles {workspace: {root, files ≤ 500}, overlays?}:
- parses and caches per-file summaries: definitions, imports, and call sites with their syntactic form and attribute names;
- keyed by (path, size, mtime_ns → sha256, engine version);
- calls check_cancelled() between files;
- summaries built before a cancellation stay in the cache;
- returns IndexResult.
- python/callGraph:
- outgoing hops parse reachable files on demand;
- incoming and both use a reverse index over the cached summaries;
- files missing from the cache are parsed on demand, cancellably.
- The engine cap is 10 × maxNodes, at most 10,000. Beyond it, meta.truncated is set with graph-truncated.

**Tests:**

- the multi-file fixture gives the expected node sets for k=1 and k=2 in both directions
- dict dispatch and getattr give unresolved nodes with reason codes
- json.dumps gives an external json node
- self.session.request is unresolved with a reason
- 'c = Client(); c.get()' is unresolved (type-resolution-off) with useJedi false
- indexFiles:
- - a second call on unchanged files reuses the summaries without reading the files (counter);
- - a cancelled batch keeps its finished summaries
- outputs validated against the schema

### WP07 Engine: Jedi as resolution step 3, with a safe configuration and sandbox hardening

**Goal:** Optional type-aware resolution of obj.method() in the call graph (default on) that can never import or run workspace code.

**Depends on:** WP06

**Requirements:** P1-027, P1-028, P1-070, P1-129

**Files:**

- engine/hearback_engine/python_analysis/jedi_support.py
- engine/hearback_engine/sandbox.py
- engine/hearback_engine/server.py (storageDirectory)
- engine/tests/test_jedi_support.py
- engine/tests/test_sandbox.py
- docs/adr/015-jedi-and-sandbox-rules.md
- docs/adr/003-engine-sandbox.md (status line: amended by 015)
- docs/architecture.md
- SECURITY.md

**Details:**

- Scope: useJedi (default true, D08) enables step 3 in python/callGraph only.
- Outgoing: the unresolved obj.method() sites of the functions on the hop frontier.
- Incoming: candidate sites whose attribute name equals the target's name, prefiltered from the index.
- classAnatomy, controlFlow, moduleGraph and diff/compare never import Jedi.
- Jedi call: jedi.Script(code, path=..., project=jedi.Project(path, sys_path=[stdlib..., source roots], smart_sys_path=False, load_unsafe_extensions=False), environment=jedi.InterpreterEnvironment()).
- Settings: auto_import_modules = [] and cache_directory = <storageDirectory>/jedi.
- jedi.Interpreter and get_default_project are never used.
- Calls run under warnings.catch_warnings().
- No site-packages in 0.1.0.
- Budget:
- 1,500 ms per request, with check_cancelled() between sites;
- results are inferred with props.resolvedBy 'jedi' and cached per (file sha256, site);
- sites beyond the budget stay unresolved, with jedi-budget-exceeded;
- on any exception, delete <cache>/CPython-3XX-* once and continue without Jedi (jedi-unavailable).
- New sandbox audit rules:
- pickle.find_class allowlist: parso.cache and parso.python.tree;
- 'import' outside the stdlib, the engine and vendor is refused while sys.path holds foreign entries; stdlib module names stay exempt, so traceback's lazy _colorize import works on 3.15;
- 'exec' of code objects from files outside the engine, vendor and stdlib roots is refused.
- The rule logic is tested in-process (EngineHarness with sandboxed=False, plus direct tests of the rule functions), so coverage counts it. Subprocesses serve only the end-to-end proof.
- ADR 015 amends ADR 003.

**Tests:**

- traps are written into tmp_path at test time: gi/**init**.py, .jedi/project.json, sitecustomize.py, conftest.py, a planted pickle and a native module copied at test time; none leaves a marker, in a sandboxed subprocess
- positive cache test: two runs under the sandbox with the same storageDirectory:
- - the second run hits the parso cache (pickle mtimes unchanged);
- - nothing is deleted;
- - no jedi-unavailable
- the Jedi settings are asserted
- P1-070: 'c = Client(); c.get()' resolves to Client.get, inferred with resolvedBy jedi, when useJedi is true; it stays unresolved when false
- the budget and degrade paths

### WP08 Engine: control flow (python/controlFlow)

**Goal:** One flowchart for the innermost function at the position.

**Depends on:** WP03

**Requirements:** P1-019, P1-074, P1-075, P1-076, P1-077, P1-078, P1-079, P1-080, P1-153, P1-154, P1-155

**Files:**

- engine/hearback_engine/python_analysis/control_flow.py
- engine/hearback_engine/analysis.py (registers python/controlFlow)
- engine/hearback_engine/protocol.py, src/engine/protocol.ts, engine/tests/test_server.py, shared/examples/initialize-result.json
- engine/tests/fixtures/python/cfg_cases.py
- engine/tests/fixtures/python/cfg_except_star.py (3.11+)
- engine/tests/test_control_flow.py

**Details:**

- Runs of simple statements merge into one block with a '(+N)' label.
- Each construct gets its own node: condition, loop (for, while, async for), try, handler, finally, with, match, case, return, raise, break, continue.
- There is one entry, one exit, and an exceptional exit (an exit with props.exceptional).
- Edges have kind flow, with FlowEdgeProps.branch codes (true, false, loopNext, loopDone, loopElse, case, noMatch, exception, finallyThen, back) and text fragments.
- Exception edges are inferred and run from nodes that may raise to the matching handlers, or outward.
- Semantics:
- the loop else runs only on exhaustion;
- while True has no false edge;
- a single finally node, with 'then <jump>' labels;
- unreachable code is marked;
- early exits are flagged.
- Every return and raise gets its own terminal node (layout policy, D12).
- Labels come from source segments, not ast.unparse.

**Tests:**

- if/elif/else
- for-else with break; while-else
- try/except/else/finally: every path reaches finally
- except* only on 3.11+
- with encloses its body
- match with a guard and a final wildcard
- _request_with_retry:
- - loop → try → return → exit;
- - TimeoutError → handler → loop;
- - loopDone → raise → exceptional exit

### WP09 Engine: module graph (python/moduleGraph)

**Goal:** Workspace import dependencies with cycles and collapsed external packages, built on the cached index.

**Depends on:** WP06

**Requirements:** P1-019, P1-022, P1-081, P1-082, P1-083

**Files:**

- engine/hearback_engine/python_analysis/module_graph.py
- engine/hearback_engine/analysis.py (registers python/moduleGraph)
- engine/hearback_engine/protocol.py, src/engine/protocol.ts, engine/tests/test_server.py, shared/examples/initialize-result.json
- engine/tests/fixtures/python/ws_modgraph/**
- engine/tests/test_module_graph.py

**Details:**

- Imports come from the WP06 per-file summaries. Missing files are parsed on demand, with check_cancelled() between files.
- Cycles: iterative Tarjan SCC.
- Hard cycles count import-time edges only.
- Soft cycles need TYPE_CHECKING, deferred or lazy edges.
- Both give import-cycle and ImportEdgeProps.cycle.
- Flags: typeOnly, deferred, conditional, lazy, star, dynamic.
- A constant importlib.import_module is inferred.
- A computed name is unresolved, with reasonCode computed-import.
- External packages: one node per top-level package, grouped as stdlib or thirdParty.
- Folder scopes come from the Explorer, including multi-select.

**Tests:**

- the expected imports edge set
- a→b→c→a is marked cyclic
- json, os.path and requests give collapsed json, os and requests nodes
- $/cancelRequest on a generated 2,000-file workspace answers -32800 within 250 ms (EngineHarness)

### WP10 Engine: change detection (diff/compare and a base in every view)

**Goal:** added, modified, deleted and unchanged per node and edge, with ghosts, change details and hunks.

**Depends on:** WP05, WP06, WP08, WP09

**Requirements:** P1-019, P1-041, P1-042, P1-045, P1-047, P1-049, P1-157

**Files:**

- engine/hearback_engine/python_analysis/changes.py
- engine/hearback_engine/analysis.py (registers diff/compare)
- engine/hearback_engine/protocol.py, src/engine/protocol.ts, engine/tests/test_server.py, shared/examples/initialize-result.json
- engine/tests/fixtures/python/changes/** (base and working pairs, LF only)
- engine/tests/test_changes.py
- engine/tests/test_diff_compare.py
- docs/adr/016-change-detection.md

**Details:**

- Rule D06, strict spec 5.4: a node is modified if and only if the position-free AST (ast.dump(include_attributes=False)) of its own part differs. Identical source lines and hunk overlap are only a pre-filter.
- Change details:
- formatting- or comment-only edits: unchanged with formattingOnly;
- docstring-only edits: modified with docstringOnly;
- reordered module imports: the module is modified with importsReorderedOnly;
- reordered members: the container is modified with membersReorderedOnly.
- Containers count only their own statements (nested defs as ordered placeholders) and report changedDescendants.
- Deleted symbols become ghosts: Range.revision set to the base SHA, and the file is the original path for renamed files.
- Renames:
- An equal hash without the name, with the same kind and parent, gives the added node renamedFrom and no ghost.
- A renamed file remaps the module prefix.
- Edges are compared by id.
- CFG blocks align statements with difflib and add a '− N lines' marker.
- The module graph uses the file status plus the import edges.
- diff/compare without a base returns the outline and covers python/analyzeFile. Hunks come from difflib.

**Tests:**

- each scenario on 3.10 and 3.15:
- - modified, deleted;
- - a black-style reformat of retrying_client (everything unchanged, formattingOnly);
- - comment-only, docstring-only (modified, docstringOnly);
- - an added method;
- - reordered imports (module modified with importsReorderedOnly, no symbol modified);
- - reordered members (class modified with membersReorderedOnly, members unchanged);
- - a rename, an added decorator;
- - CRLF-only, built in the test
- an added or removed call gives an added or deleted edge
- no attribution in any output

### WP11 Fixture contract for retrying_client.py and refreshed shared examples

**Goal:** Every fact of spec 11.1 asserted explicitly, plus snapshots of every view.

**Depends on:** WP07, WP10

**Requirements:** P1-014, P1-034, P1-037, P1-133, P1-134, P1-135, P1-136, P1-137, P1-138, P1-139, P1-140, P1-141, P1-142, P1-143, P1-144, P1-145, P1-146, P1-147, P1-148, P1-149, P1-150, P1-151, P1-152, P1-153, P1-154, P1-155, P1-156

**Files:**

- engine/tests/test_fixture_retrying_client.py
- engine/tests/test_props_contract.py
- engine/tests/snapshots/test_fixture_retrying_client/*.json
- shared/examples/graph-class-anatomy.json
- shared/examples/graph-control-flow.json
- shared/examples/change-summary.json
- test/repo/examples.test.ts
- test/repo/schema.test.ts
- package.json (script snapshots:update)

**Details:**

- Assert P1-134 to P1-156: kind, endpoints, confidence and evidence lines.
- Negative assertions:
- call_by_name has no certain call;
- the property has no writes;
- no other method gets the self-unused hint.
- Snapshots, with useJedi false (Jedi results are covered by test_jedi_support):
- classAnatomy;
- callGraph (get, k=2);
- controlFlow for get, _request_with_retry and call_by_name;
- moduleGraph;
- diff/compare (the reformat pair).
- test_props_contract validates every node's and edge's props in all snapshots against NodePropsByKind and EdgePropsByKind.
- 'npm run snapshots:update' runs pytest --snapshot-update, then 'prettier --write shared/examples'. test/repo/examples.test.ts compares the parsed examples with the normalized snapshots.
- The explicit fact tests replace the draft's owner review of the snapshot.

**Tests:**

- the explicit facts
- snapshot equality on 3.10 and 3.15
- the props contract
- the examples validate in Ajv and in jsonschema, and equal their snapshots

### WP12 Host analysis client: scheduler, workspace indexing, failure states, settings

**Goal:** One vscode-free request layer between the views and EngineConnection that never starves or kills a healthy engine.

**Depends on:** WP01

**Requirements:** P1-011, P1-018, P1-022, P1-023, P1-024, P1-118, P1-122, P1-123, P1-124, P1-125, P1-126

**Files:**

- src/engine/analysis/scheduler.ts
- src/engine/analysis/scheduler.test.ts
- src/engine/analysis/analysisClient.ts
- src/engine/analysis/analysisClient.test.ts
- src/engine/analysis/failureState.ts
- src/engine/analysis/failureState.test.ts
- src/engine/analysis/fileSet.ts
- src/engine/analysis/fileSet.test.ts
- src/engine/analysis/workspaceIndexer.ts
- src/engine/analysis/workspaceIndexer.test.ts
- src/engine/analysis/rulesFile.ts
- src/engine/analysis/rulesFile.test.ts
- src/engine/analysis/requests.ts
- src/engine/settings.ts
- src/engine/engineConnection.ts (storageDirectory)
- src/engine/engineService.ts and src/engine/restartPolicy.ts (reset hook for tests)
- src/views/diagnosticText.ts
- src/views/diagnosticText.test.ts
- src/extension.ts
- test/fixtures/fakeEngine.cjs (analysis scenarios: ok, slow, cancellable, crash, syntaxError)
- test/stubs/vscode.ts
- package.json (settings useJedi, graph.maxNodes, graph.defaultHops, sideEffects.rulesFile; restrictedConfigurations += hearback.engine.useJedi after D08)
- package.nls.json
- package.nls.de.json
- l10n/bundle.l10n.json
- l10n/bundle.l10n.de.json
- test/repo/manifest.test.ts
- test/repo/l10nCodes.test.ts

**Details:**

- Scheduler (vscode-free):
- At most one analysis request is in flight.
- Priorities: foreground (visible panel, explicit command, CodeLens or tree click), then a tree file the user expanded, then background (hidden or stale panels, Git-triggered refreshes, index batches).
- Entries coalesce per key (panel or tree, view, root, file); superseded entries are dropped before they are sent.
- EngineConnection.request is called only at dispatch, so its deadline starts then. Verified at f954d7d: the deadline starts when request() is called; rpc.py answers a cancelled queued request only when that request reaches the front.
- A foreground arrival cancels an in-flight background request, which is requeued if still wanted.
- Late results are ignored.
- Timeouts:
- hearback.engine.timeoutMs stays the single per-request timeout: cancel at the deadline, kill 2 s later.
- Workspace-wide work is split into python/indexFiles batches of at most 250 files or 4 MB of source, so every request fits the timeout and foreground requests interleave.
- The panel's busy banner shows 'Indexing {0} of {1} files'.
- Retry resumes from the engine's cached summaries.
- Failure states map to banners: noInterpreter, crashed, crashLoop, timeout, engineError, cancelled. There is no confirmationRequired state: non-interactive starts follow ADR 011.
- Only user actions use interactive: true and may show one notification. Background work never shows a popup.
- File set:
- workspace.findFiles('**/*.py') honoring files.exclude;
- filtered for .venv, venv, env, .tox, .nox, site-packages, node_modules, build, dist, **pycache**, .hearback and hidden directories;
- per root in multi-root windows;
- capped at 5,000 files per root, with a banner when capped.
- Overlays are sent for dirty open documents only. Bases are capped at 16 MB in total; beyond that the document gets changes-partial.
- Rules file:
- resolved relative to the folder;
- read with Node fs: stat must be a regular file (symlinks followed) of at most 1 MiB;
- opened with O_NONBLOCK where it exists, fstat again, at most 1 MiB + 1 bytes read;
- contents are never logged or echoed; errors appear as rules-file-invalid in the banner.
- storageDirectory = globalStorageUri/engine (the Jedi cache), created before the engine starts.
- Settings take effect with the next request, without a reload: onDidChangeConfiguration re-reads them and open panels re-request.
- Host diagnostic texts: src/views/diagnosticText.ts maps every DiagnosticCode and UnresolvedReasonCode to vscode.l10n.t literals (Record<…>). The webview keeps its own table (WP20); test/repo/l10nCodes.test.ts checks both tables against the enums and the German bundle.
- hearback._test.resetRestartPolicy (ExtensionMode.Test only) keeps kill tests from pushing later suites into crashLoop.

**Tests:**

- scheduler:
- - 10 background requests queued behind a slow one cause no kill, and a foreground request goes out next;
- - a superseded entry never reaches the engine;
- - the deadline starts at dispatch;
- - foreground preempts background
- supersede, cancel and late-ignore against fakeEngine.cjs
- deadline, then kill; a crash gives crashed, and the next request uses the restarted engine
- background failure: 0 show*Message calls; user failure: exactly 1
- fileSet filters and the cap; workspaceIndexer batching, progress and resume
- rulesFile: /dev/zero, a FIFO, a symlink to /dev/zero and 1 MiB + 1 byte give errors without blocking (POSIX), NUL on Windows
- live settings: configuration-change events for useJedi, maxNodes, defaultHops and rulesFile change the next request's params
- manifest tests for the new settings and restrictedConfigurations; l10nCodes.test.ts

### WP13 Host Git integration and base resolution (src/changes), with the 'changes' test label

**Goal:** Base selection and changed-file state per repository through the vscode.git API only, checked against a real repository in CI.

**Depends on:** WP01

**Requirements:** P1-038, P1-039, P1-040, P1-048, P1-049, P1-050, P1-051, P1-119, P1-120

**Files:**

- src/changes/git.d.ts (trimmed copy of release/1.105, MIT header plus a modification note, import type only)
- src/changes/gitConstants.ts
- src/changes/gitConstants.test.ts
- src/changes/gitAvailability.ts
- src/changes/gitAvailability.test.ts
- src/changes/gitAccess.ts
- src/changes/baseResolver.ts
- src/changes/baseResolver.test.ts
- src/changes/changeSet.ts
- src/changes/changeSet.test.ts
- src/changes/changeTracker.ts
- src/changes/changeTracker.test.ts
- eslint.config.mjs (ignore src/changes/git.d.ts; no child_process in src/changes and src/views)
- .prettierignore (src/changes/git.d.ts)
- package.json (diff.base, diff.mainBranch)
- package.nls.json
- package.nls.de.json
- .vscode-test.mjs (label 'changes', hermetic Git environment)
- esbuild.mjs (--tests also bundles test/changes/** and test/multiroot/**)
- scripts/git-fixture.mjs
- test/changes/smoke.test.ts

**Details:**

- The Git extension is acquired lazily (Changes view visible, or a view request), never in activate(). No extensionDependencies: Git declares untrustedWorkspaces.supported false, so a dependency would disable Hearback in Restricted Mode.
- Unavailable reasons: untrusted, extensionDisabled, gitDisabled, gitMissing, noRepository, notOpened (parent or unsafe repository). Retry on a trust grant, on extension changes and on onDidChangeEnablement.
- After onDidOpenRepository, wait for api.state 'initialized' and a HEAD.
- Allowed API: show, getMergeBase, getConfig (read only), diffWith(ref), the state groups and toGitUri. Never called: getBranchBase, setConfig, fetch, hashObject, status() and state.refs.
- mainBranch detection; the first candidate that has a merge base wins:
- 1. hearback.diff.mainBranch (validated);
- 2. branch.<HEAD>.vscode-merge-base, read only. VS Code's own history provider writes this key (extensions/git/src/historyProvider.ts, release/1.105).
- 3. origin/HEAD, origin/main, origin/master, main, master.
- Changed files:
- base HEAD: the index, working-tree and untracked groups;
- base mergeBase: diffWith(sha) plus untracked files;
- untracked files count as added; deleted files give ghosts; renames use originalUri;
- paths are compared repo-relative, case-insensitively on win32 and darwin.
- Snapshot debounce 500 ms. Base texts are cached by (sha, path). Settings are read per repository root.
- git.d.ts is trimmed, because @types/vscode 1.105.0 lacks SourceControlHistoryItem (line 6), which SourceControlHistoryItemDetailsProvider (line 343) uses:
- SourceControlHistoryItemDetailsProvider, registerSourceControlHistoryItemDetailsProvider and that import are removed;
- the file keeps upstream tabs and is excluded from Prettier and ESLint;
- const enums are replaced by our own constants (gitConstants.ts), because of TS2748 under verbatimModuleSyntax.
- scripts/git-fixture.mjs:
- creates repositories with mkdtemp plus realpath.native;
- runs git hermetically: GIT_CONFIG_NOSYSTEM, an empty GIT_CONFIG_GLOBAL, autocrlf false, gpgsign false;
- copies engine/tests/fixtures/python/retrying_client.py, so no second copy exists.

**Tests:**

- status mapping (UNTRACKED, DELETED, INDEX_RENAMED, conflicts)
- the base chain and validation (leading '-', '..', '@{', .lock)
- availability reasons
- a tracker against a typed fake API: HEAD arrives late, and events without changes are skipped
- gitConstants pin test against the git.d.ts values
- CI 'changes' label smoke test: the API is initialized, HEAD is resolved, and show() of a committed file returns its text

### WP14 Webview protocol v2, view state, ELK options and the layout worker

**Goal:** A long-lived worker running unmodified elkjs, plus validated messages and view state, proven in real VS Code.

**Depends on:** WP01

**Requirements:** P1-005, P1-008, P1-097, P1-099, P1-101, P1-117, P1-131

**Files:**

- package.json (+elkjs 0.12.1; scripts test:unit and test:coverage with --project extension --project webview --project repo; test:perf)
- package-lock.json
- esbuild.mjs (copies elk.bundled.js and LICENSE.md to dist/webview/elkjs/; writes out/meta/elkjs.json)
- scripts/notices.mjs (DEFAULT_METAFILES += out/meta/elkjs.json; embedded web-worker entry with its Apache-2.0 text)
- THIRD_PARTY_NOTICES.md
- .vscodeignore (!dist/webview/elkjs/elk.bundled.js, !dist/webview/elkjs/LICENSE.md)
- src/shared/webviewProtocol.ts
- src/shared/webviewProtocol.test.ts
- src/views/webviewHtml.ts (elkUri, testMode, localized <title>)
- src/views/webviewHtml.test.ts
- src/views/graphPanel.ts (hearback._test.showDocument, ExtensionMode.Test only)
- webview/src/bootData.ts
- webview/src/hostApi.ts (getState and setState)
- webview/src/state/viewState.ts
- webview/src/layout/layoutClient.ts
- webview/src/layout/layoutProtocol.ts
- webview/src/graph/elk/options.ts (variants and the cost estimate)
- webview/src/graph/elk/buildGeneric.ts (flat fallback builder)
- webview/worker/layout.worker.ts
- webview/src/workerCheck.ts
- webview/test/layoutClient.test.ts
- webview/test/layoutWorker.test.ts
- webview/test/options.test.ts
- test/repo/workerBundle.test.ts
- test/repo/notices.test.ts
- vitest.config.mts (project perf)
- webview/test/perf/layout.perf.test.ts
- webview/test/fixtures/perf/*.json
- scripts/gen-perf-graphs.mjs
- test/integration/graphView.test.ts
- docs/adr/018-elk-layout-and-size-policy.md
- docs/adr/008-webview.md (status line: amended by 018)

**Details:**

- The Blob: the page fetches elkjs/elk.bundled.js and layout.worker.js (connect-src) and starts one classic Worker from Blob([elk, '\n;\n', worker]). The worker:
- runs new ELK({algorithms:['layered']}) without workerUrl or workerFactory;
- then sets self.onmessage = null, because ELK takes over onmessage;
- answers ping, warmUp and layout{id};
- strips $H.
- Lifecycle:
- The worker starts lazily on the first layout-cache miss, or early when the host sends setBusy.
- It stays alive between layouts.
- A superseded layout finishes and its result is discarded.
- The worker is terminated and restarted (with a warm-up) only after a superseded layout has run 750 ms, or at the 10 s timeout.
- options.ts: base layered and orthogonal, nodeNode 24, between layers 48. The fast variant (thoroughness 1, greedySwitch OFF) applies when boxes > 100, ports > 150 or edges > 300. NETWORK_SIMPLEX is never used.
- buildGeneric.ts lays out any document flat until the view builders of WP20 exist.
- Messages and caps are listed under protocolChanges; text stays capped at 2,000 characters.
- View state:
- view, target key (root, nodeId), filters, hops, focus, collapsed, viewport;
- setState is throttled (idle, at most every 500 ms);
- the layout cache (at most 512 KB) is written only after a layout, the viewport separately.
- Notices: elk.bundled.js embeds browserify module 4, web-worker 1.4.1's dist/browser/index.cjs (Apache-2.0, two lines, byte-identical in 1.5.0). scripts/notices.mjs gets an embedded-package entry with the Apache-2.0 text from the web-worker 1.4.1 tarball.
- The CSP string stays exactly as in ADR 008.
- ADR 018 amends ADR 008: two fetched files joined into one blob, a long-lived worker, boot data elkUri and testMode, and getState/setState.
- test:unit and test:coverage list their projects explicitly, so the perf project never runs in the unit job.

**Tests:**

- guards reject unknown and oversized messages
- the worker handler with injected ELK: ping, layout, onmessage reset
- workerBundle.test.ts:
- - neither the worker bundle nor the concatenated blob contains importScripts, fetch( or import(;
- - ELK is constructed without workerUrl or workerFactory
- notices: the elkjs metafile, the exception and the embedded web-worker entry
- perf project (Node), on committed corpora:
- - a realistic class anatomy: 30 cards, about 300 rows, at least 80 % intra-card edges plus inheritance and override edges;
- - a 300-node call DAG;
- - a control flow graph with one terminal per exit;
- - a random port graph, report only.
- Gate: median in-worker layoutMs ≤ 1.3 s with the shipped options
- the exact CSP string
- integration graphView.test.ts (CI, 1.105.1 and stable): a document loaded with hearback._test.showDocument reaches layoutDone through the real blob worker, with zero CSP violations

### WP15 Host Python definition scanner (for Quick Picks and CodeLens)

**Goal:** Definitions with qualified names and positions without the engine, matching the engine's ranges.

**Depends on:** WP03

**Requirements:** P1-089

**Files:**

- src/views/pythonDefinitions.ts
- src/views/pythonDefinitions.test.ts
- engine/tests/fixtures/python/scanner/*.py
- engine/tests/test_scanner_expectations.py
- engine/tests/snapshots/scanner/*.json

**Details:**

- The scanner uses one regex per line plus a tokenizer that tracks triple-quoted strings, comments, brackets and continuations. The prototype matched 7,811 of 7,811 definitions, at about 0.8 ms per 1,000 lines.
- Output per definition: kind, qualname, anchor line (the first decorator line, equal to the engine's range.start) and name position (the engine's selectionRange.start). Nested functions are included.
- test_scanner_expectations.py writes the engine's symbols for the scanner fixtures to engine/tests/snapshots/scanner/*.json; the Vitest test compares the scanner's output with them.

**Tests:**

- the scanner's positions and qualnames equal the pinned engine expectations
- def inside a string gets no entry
- nested and conditional defs, decorators, Unicode identifiers

### WP16 Host graph panel controller and commands

**Goal:** Show* commands, context menus and one retargetable panel with history and re-analysis, multi-root aware.

**Depends on:** WP11, WP12, WP13, WP14, WP15

**Requirements:** P1-012, P1-013, P1-015, P1-018, P1-024, P1-050, P1-090, P1-091, P1-092, P1-101, P1-117

**Files:**

- src/views/graphPanel.ts
- src/views/graphPanelState.ts
- src/views/graphSession.ts
- src/views/graphSession.test.ts
- src/views/graphController.ts
- src/views/graphController.test.ts
- src/views/targets.ts
- src/views/targets.test.ts
- src/views/commands.ts
- src/testing/testCommands.ts
- src/extension.ts
- package.json (commands, submenu hearback.context, menus editor/context, explorer/context, commandPalette)
- package.nls.json
- package.nls.de.json
- l10n/*.json
- test/repo/manifest.test.ts
- test/fixtures/workspace/retrying_client.py (copy of the engine fixture)
- test/repo/fixtures.test.ts (byte-identical copy)
- test/integration/views.test.ts
- docs/adr/017-host-integration.md

**Details:**

- One panel (hearback.graph), opened Beside with preserveFocus true. Show* commands retarget it; the view switcher and the back/forward history (50 entries) live in graphSession.
- Targets:
- Class Anatomy: the whole file, focused on the class or method at the cursor.
- Call Graph and Control Flow: the function at the cursor, otherwise a Quick Pick of the scanner's definitions.
- Module Graph: the workspace folder, or the selected Explorer folders.
- Quick Pick items show qualified names only. Signatures never go into Quick Pick text, which renders $(icon) syntax.
- Multi-root:
- history, caches and _test state are keyed by (root, nodeId);
- a Quick Pick of workspace folders appears when neither an editor nor an Explorer selection identifies a root;
- a file outside every folder is analyzed on its own (module name = stem), and workspace-wide views explain why they are unavailable.
- Re-analysis:
- 500 ms after the last edit (unsaved text), immediately on save, on Git changes and on setting changes;
- hidden panels are marked stale and refreshed in the foreground when revealed.
- The webview sends node ids only; the host resolves locations from its copy of the document.
- Hidden _test commands return state. Acting ones (webviewAction, exportTo, showDocument, resetRestartPolicy, and Phase 0's restartEngine) are registered only in ExtensionMode.Test.
- No WebviewPanelSerializer.

**Tests:**

- targets from a Uri, a position and a tree item; the multi-root key
- session history
- a superseded request is cancelled
- an unknown nodeId does nothing
- manifest:
- - commands, menus and when clauses;
- - no contributed hearback._test.*;
- - enabledApiProposals undefined, engines.vscode '^1.105.0'
- integration views.test.ts (CI): each Show command opens the panel with a schema-valid document of the right view and focus (hearback._test.lastGraph), with zero CSP violations; also with a Uri argument and a folder

### WP17 Editor sync and navigation

**Goal:** A node click reveals its source; the cursor highlights the matching node.

**Depends on:** WP16

**Requirements:** P1-043, P1-095, P1-102, P1-103, P1-158

**Files:**

- src/views/editorSync.ts
- src/views/editorSync.test.ts
- src/views/columnChoice.ts
- src/views/columnChoice.test.ts
- src/views/navigation.ts
- src/views/navigation.test.ts
- src/shared/pathKey.ts
- src/shared/pathKey.test.ts
- test/fixtures/workspace/non_ascii.py
- test/integration/navigation.test.ts

**Details:**

- Cursor sync highlights the innermost node whose range contains the cursor in the same file, throttled to 120 ms, without the engine. Ranges with a revision (ghosts, deleted evidence) never take part.
- A click or Enter reveals with preserveFocus true and selects the node's selectionRange (or the range start). A double-click or Shift+Enter focuses the editor.
- Column: a visible editor already showing the file, otherwise the first group without the panel. Uses revealRange with InCenterIfOutsideViewport.
- Our own reveal is not echoed back (same range within 500 ms).
- pathKey.ts is the single comparison of Range.file with editor URIs, used by editor sync, navigation and the tree: Uri.file(path).toString(), compared case-insensitively on win32 and darwin.
- Special nodes:
- Ghost nodes open the base version (toGitUri) read-only at the base range; the details panel offers vscode.diff.
- External nodes explain why there is no location.
- Unresolved nodes go to their evidence.

**Tests:**

- the innermost node; ranges with a revision are skipped
- echo suppression
- column choice
- pathKey: drive-letter case ('C:' versus 'c:') and macOS case
- ghost and external cases
- integration navigation.test.ts (CI):
- - a click (hearback._test.webviewAction clickNode) selects the node's selectionRange;
- - an unresolved node's evidence after 'Größe 😀' on the same line lands at the right UTF-16 column;
- - a selection inside get highlights py:retrying_client.RetryingClient.get

### WP18 CodeLens 'Visualize' without the engine, and the quiet-start root hook

**Goal:** Lenses from the host scanner that never start the engine, proven before any suite starts it.

**Depends on:** WP15, WP16

**Requirements:** P1-016, P1-017, P1-089, P1-090, P1-121

**Files:**

- src/views/codeLens.ts
- src/views/codeLens.test.ts
- package.json (activationEvents ['onLanguage:python']; hearback.codeLens.enabled)
- package.nls.json
- package.nls.de.json
- test/repo/manifest.test.ts
- test/integration/activation.test.ts (root-level suiteSetup)
- test/integration/codeLens.test.ts

**Details:**

- Lenses go on every class, function and method, nested functions included (spec 6.1, D23). They are anchored at the range start line (the first decorator). The selector is {language: python, scheme: file}.
- The hidden command hearback.visualize opens:
- for a class: Class Anatomy;
- for a method: Class Anatomy focused on its row;
- for a module-level or nested function: Control Flow.
- The setting is read live, and onDidChangeCodeLenses fires when it changes.
- The root-level suiteSetup in activation.test.ts runs before any suite can start the engine:
- open retrying_client.py;
- wait 3 s;
- collect lenses with vscode.executeCodeLensProvider;
- record engineState, which must be 'idle'.
- Mocha loads files in no fixed order, so only a root hook is reliable.

**Tests:**

- unit: lens positions from the scanner; the setting turns lenses off
- manifest: activationEvents deep-equals ['onLanguage:python']
- integration (CI):
- - the root hook sees lenses and engineState 'idle';
- - codeLens.test.ts: the lens command sets the panel's view and focused node id, and the toggle removes the lenses

### WP19 Hearback sidebar and the Changes tree

**Goal:** Changed symbols since the base, grouped by repository and file, computed only on a user action.

**Depends on:** WP10, WP13, WP16

**Requirements:** P1-048, P1-051, P1-093, P1-094, P1-095, P1-096, P1-100

**Files:**

- media/hearback-activitybar.svg
- src/views/changesTreeModel.ts
- src/views/changesTreeModel.test.ts
- src/views/changesTree.ts
- src/views/changesTree.test.ts
- package.json (viewsContainers.activitybar hearback, views hearback.changes, viewsWelcome, view/title refresh, view/item/context)
- package.nls.json
- package.nls.de.json
- .vscodeignore (!media/hearback-activitybar.svg)
- test/integration/activation.test.ts (root hook also focuses the container)
- test/changes/changesTree.test.ts

**Details:**

- Repository and file levels come from the change tracker alone. Symbols come from diff/compare only when the user expands a file or presses Refresh, never eagerly, even when the engine is already running.
- Item ids are <root>|<file>|<nodeId>; contextValue is hearback.symbol.<kind>.<change>.
- The markers + ~ − go into the description. Icons are ThemeIcons with core charts.* colors. No badge.
- Tooltips are plain strings, or MarkdownStrings built only with appendText and appendCodeblock, with isTrusted false and supportHtml false. Text from analyzed code is never rendered as Markdown.
- The context key hearback.changes.state drives the welcome views: untrusted, gitDisabled, gitMissing, noRepository, notOpened, baseNotFound. Dynamic text goes into TreeView.message and description, for example 'vs HEAD (abc1234)'.
- An item click runs the hidden hearback.openChangedSymbol, ghosts included.
- The root hook (WP18) also focuses workbench.view.extension.hearback and checks that the engine stays idle.

**Tests:**

- tree model grouping and ghosts
- lazy children: visibility changes and getChildren never call ensureStarted
- welcome-state mapping
- a hostile symbol name or signature containing '![x](https://example.com/a.png)' stays literal text
- integration (CI, 'changes' label): items and clicks, ghosts included; the 'integration' label (parent repository not opened) shows the welcome content

### WP20 Webview graph model: derive, filter, focus, collapse, search, ELK builders, typed props

**Goal:** Pure functions from the document and the UI state to the laid-out React Flow graph.

**Depends on:** WP14

**Requirements:** P1-011, P1-036, P1-059, P1-104, P1-105, P1-106, P1-107, P1-108, P1-109, P1-110, P1-116

**Files:**

- webview/src/graph/documentIndex.ts (propsOf)
- webview/src/graph/filters.ts
- webview/src/graph/focus.ts
- webview/src/graph/collapse.ts
- webview/src/graph/search.ts
- webview/src/graph/derive.ts
- webview/src/graph/elk/buildClassAnatomy.ts
- webview/src/graph/elk/buildCallGraph.ts
- webview/src/graph/elk/buildControlFlow.ts
- webview/src/graph/elk/buildModuleGraph.ts
- webview/src/graph/toReactFlow.ts
- webview/src/graph/aria.ts
- webview/src/l10n/diagnostics.ts
- webview/src/l10n/unresolvedReasons.ts
- webview/src/l10n/sideEffectRules.ts
- eslint.config.mjs (no-restricted-syntax: no .props access in webview code outside documentIndex.ts)
- webview/test/graph/*.test.ts

**Details:**

- propsOf(node) returns NodePropsByKind[node.kind]. The ESLint rule bans direct .props access elsewhere, so reading a key the contract lacks fails the typecheck.
- Filters: private, dunder, edge kinds, confidence, and changed nodes plus k neighbors.
- Focus mode: k hops.
- Collapse:
- the deepest and largest groups collapse first until at most maxNodes visible GraphDocument nodes remain, member rows included (P1-110);
- the focused symbol's group stays open;
- the warning shows above maxNodes.
- ELK input per view, with the WP14 options and cost estimate:
- Class anatomy: cards with FIXED_POS ports, one per side per row; self-loops EQUALLY distributed; inheritance UP.
- Control flow: DOWN with DEPTH_FIRST and NODES_AND_EDGES; one terminal per return and raise.
- Module graph: flat by default; nested package boxes only up to 100 boxes, with INCLUDE_CHILDREN and ROOT coordinates.
- The input order is deterministic. Sizes come from an injected measure function (canvas measureText).
- Localized aria labels for nodes and edges.
- Record<…> tables for DiagnosticCode, UnresolvedReasonCode and the built-in rule ids.

**Tests:**

- each filter
- k=1 focus on get shows get, _request_with_retry and _cache
- 1,000 nodes start collapsed with at most maxNodes visible nodes (rows counted) and the warning
- search ordering
- ELK layout snapshots ($H stripped)
- port ids equal handle ids
- every DiagnosticCode, UnresolvedReasonCode and built-in rule id (builtin-rule-ids.json) has English and German text

### WP21 Webview: class anatomy and state matrix

**Goal:** Class cards with member rows and handles, the MRO pane and the matrix table.

**Depends on:** WP20

**Requirements:** P1-043, P1-044, P1-046, P1-052, P1-053, P1-054, P1-055, P1-056, P1-057, P1-058, P1-061, P1-062, P1-064, P1-065, P1-066, P1-088, P1-098

**Files:**

- webview/src/views/ClassAnatomyView.tsx
- webview/src/components/nodes/ClassCard.tsx
- webview/src/components/StateMatrix.tsx
- webview/src/components/MroPanel.tsx
- webview/src/components/icons/*.tsx
- webview/src/theme.css
- webview/test/ClassCard.test.tsx
- webview/test/StateMatrix.test.tsx
- webview/test/MroPanel.test.tsx
- webview/test/theme.test.ts
- test/integration/views.test.ts (class anatomy lays out)

**Details:**

- Card header: name, bases and decorators.
- Sections:
- class attributes with annotation and default;
- instance attributes with their assignment places and an outside-init marker;
- inherited members;
- properties with their accessors;
- method groups.
- Rows have a fixed height of 20 px with ellipsis, a Left and a Right Handle, and badges: async, complexity (neutral colors) and side effects (category plus confidence).
- Change status shows as the symbol + ~ − in text and aria labels, plus the border style. Ghosts are dashed with '−'. changeDetail flags show as a short note, for example '~ docstring only'.
- The state matrix is a <table> with th scope, R/W/RW cells, the 'This class consists of N independent parts' hint and a self-unused marker.
- The MRO list sits in a details pane inside the webview.
- Icons are inline SVG components.

**Tests:**

- the card renders bases, @dataclass, max_retries, _timeout and _cache with lines, session as inherited, and the timeout getter
- the matrix cells of the fixture
- ghost style and '−' text
- high-contrast classes
- integration (CI): Show Class Anatomy reaches layoutDone with zero CSP violations

### WP22 Webview: call graph, control flow and module graph views

**Goal:** The remaining views with ELK edges, cycle markers and expandable groups.

**Depends on:** WP20

**Requirements:** P1-046, P1-067, P1-074, P1-075, P1-076, P1-077, P1-078, P1-079, P1-080, P1-081, P1-082, P1-083, P1-110

**Files:**

- webview/src/views/CallGraphView.tsx
- webview/src/views/ControlFlowView.tsx
- webview/src/views/ModuleGraphView.tsx
- webview/src/components/nodes/FunctionNode.tsx
- webview/src/components/nodes/FlowNode.tsx
- webview/src/components/nodes/ModuleNode.tsx
- webview/src/components/nodes/SummaryNode.tsx
- webview/src/components/edges/ElkEdge.tsx
- webview/test/CallGraphView.test.tsx
- webview/test/ControlFlowView.test.tsx
- webview/test/ModuleGraphView.test.tsx
- test/integration/views.test.ts (all views lay out)

**Details:**

- ElkEdge:
- draws the BaseEdge path from the ELK bend points, with the end points snapped to the handles;
- the dash pattern follows confidence (theme variables), the line style follows the change status;
- arrowheads are Hearback's own <marker> elements; branch labels are localized.
- CFG shapes: decision, loop, terminal, handler. Exception edges are dashed.
- Module graph: the cycle marker is a symbol plus a line style; external packages expand.
- Call graph:
- a hop control (requestView);
- the 'Compare with language server' action;
- unresolved nodes show their localized reason, for example 'type-aware resolution is off'.

**Tests:**

- each view renders change markers from a compared document
- the cycle marker and the legend
- expanding a summary node
- hop changes send requestView
- integration (CI): every view reaches layoutDone on the fixture with zero CSP violations

### WP23 Webview: toolbar, search, filters, legend, details, banners, keyboard and screen reader

**Goal:** The shared interaction layer and accessibility.

**Depends on:** WP21, WP22

**Requirements:** P1-023, P1-024, P1-025, P1-044, P1-098, P1-100, P1-104, P1-105, P1-106, P1-107, P1-108, P1-109, P1-115, P1-116, P1-117

**Files:**

- webview/src/App.tsx
- webview/src/components/GraphCanvas.tsx
- webview/src/components/Toolbar.tsx
- webview/src/components/SearchBox.tsx
- webview/src/components/FilterMenu.tsx
- webview/src/components/Legend.tsx
- webview/src/components/DetailsPanel.tsx
- webview/src/components/Banner.tsx
- webview/src/components/LiveRegion.tsx
- webview/src/hooks/useKeyboardModel.ts
- webview/src/hooks/useViewState.ts
- webview/test/*.test.tsx
- package.json (keybinding ctrl+f / cmd+f → hearback.focusGraphSearch, with the narrowed when clause)
- test/repo/manifest.test.ts
- test/integration/viewState.test.ts

**Details:**

- Selection is controlled through useNodesState. nodesFocusable is on and edgesFocusable off; edges are reached through the details panel's buttons.
- Keyboard: a roving tabindex with arrow keys to neighbors; Enter opens; Escape leaves search and focus mode. onlyRenderVisibleElements applies only above 300 boxes.
- Search is a combobox with aria-activedescendant. '/' or the keybinding focuses it.
- The keybinding's when clause: activeWebviewPanelId == 'hearback.graph' && !sideBarFocus && !panelFocus && !auxiliaryBarFocus && !inputFocus && !terminalFocus. Extension keybindings outrank the workbench's Find bindings, and VS Code's own webview Find also excludes other focus (webviewCommands.ts, release/1.105).
- Banners:
- syntax error, with an open-position action, keeping the last graph;
- newer syntax, with Select Interpreter…;
- engine unavailable or crashed, with Retry;
- timeout, keeping the last graph;
- indexing progress;
- Git unavailable, with its reason;
- truncated, and the large-graph warning.
- A polite live region announces layout and filter results. Reduced motion is honored.
- Identifiers are always rendered as text.

**Tests:**

- Tab reaches a node and Enter sends openNode
- aria labels in English and German
- '<img src=x onerror=alert(1)>' renders as text
- each banner
- the legend lists the kinds present
- 'certain only' hides dashed edges
- getState and setState round trip, throttled
- manifest: the keybinding's when clause
- integration viewState.test.ts (CI): hiding and showing the panel keeps the filters and the viewport

### WP24 Optional language-server comparison for the call graph

**Goal:** Resolution step 4 as an explicit toolbar action, without a setting.

**Depends on:** WP16, WP22

**Requirements:** P1-071

**Files:**

- src/views/callHierarchyCompare.ts
- src/views/callHierarchyMerge.ts
- src/views/callHierarchyMerge.test.ts
- test/integration/callHierarchy.test.ts

**Details:**

- Uses vscode.prepareCallHierarchy, vscode.provideIncomingCalls and vscode.provideOutgoingCalls up to k hops, within 5 s.
- Results map to nodes by URI (pathKey) and range containment.
- Edges that only the language server reports are inferred, with props.resolvedBy 'languageServer'. Disagreements are flagged.
- Without a provider, a banner explains why.

**Tests:**

- merge with stubbed command results
- no provider
- integration (CI): a fake CallHierarchyProvider registered by the test adds inferred edges

### WP25 Export: SVG, PNG, Mermaid, JSON and saving in the host

**Goal:** Deterministic exports without a new dependency and without a CSP change.

**Depends on:** WP23

**Requirements:** P1-010, P1-100, P1-111, P1-112, P1-113, P1-114, P1-128

**Files:**

- webview/src/export/displayList.ts
- webview/src/export/svg.ts
- webview/src/export/png.ts
- webview/src/export/mermaid.ts
- webview/src/export/json.ts
- webview/src/components/ExportMenu.tsx
- webview/test/export/*.test.ts
- src/views/exportPolicy.ts
- src/views/exportPolicy.test.ts
- src/views/exportFile.ts
- src/views/exportFile.test.ts
- test/integration/export.test.ts
- docs/adr/019-export-formats.md

**Details:**

- The display list is built from the layout of the visible graph; theme colors are resolved at export time.
- SVG: a string builder that escapes XML and contains no script and no external references.
- PNG:
- drawn by a Canvas 2D backend from the same display list, so no img element and no img-src is needed;
- scaled down to fit at most 16,384 px per side and 64 M px in area;
- a null toBlob result gives a localized error;
- sent to the host as a Uint8Array transfer.
- Mermaid:
- classDiagram for class anatomy, flowchart for the other views, none for the state matrix;
- generated ids, quoted labels and #<n>; entities, underscores at word boundaries;
- never click or init directives.
- JSON is the full GraphDocument.
- Host:
- checks format and size (strings ≤ 32 MB, PNG ≤ 64 MB);
- shows showSaveDialog with filters and the default <folder>/<label>.<ext>;
- writes with workspace.fs.writeFile;
- 'Copy as Mermaid' uses env.clipboard.

**Tests:**

- SVG parses (DOMParser); labels are text; hostile labels are escaped
- PNG: call recording on a fake 2D context; the scale clamp; the null-toBlob error
- Mermaid golden files for the fixture, plus hostile labels
- JSON valid in Ajv
- the policy rejects oversized or unknown formats
- integration export.test.ts (CI): SVG and PNG written to os.tmpdir() through hearback._test.exportTo; the PNG signature and size; zero CSP violations

### WP26 End-to-end integration and Restricted Mode (CI only)

**Goal:** The Phase 1 acceptance scenarios end to end in real VS Code 1.105.1 and stable.

**Depends on:** WP17, WP18, WP19, WP24, WP25

**Requirements:** P1-007, P1-010, P1-017, P1-039, P1-046, P1-048, P1-050, P1-051, P1-095, P1-102, P1-103, P1-125, P1-126, P1-157, P1-158

**Files:**

- .vscode-test.mjs (label multiroot)
- scripts/git-fixture.mjs (scenario repository, multi-root workspace)
- test/changes/scenario.test.ts
- test/changes/noWrites.test.ts
- test/changes/settings.test.ts
- test/multiroot/*.test.ts
- test/integration/engineRecovery.test.ts
- test/untrusted/restricted.test.ts
- scripts/test-untrusted.mjs

**Details:**

- The scenario repository has a baseline commit on main, a feature commit, and these edits: _send changed, _log_retry deleted, get reformatted, refund added, a CRLF-only file, an untracked file, branch_only.py.
- The noWrites repository has no remote. VS Code's own Git history provider calls getBranchBase on a HEAD change and writes branch.<name>.vscode-merge-base when it finds an upstream or a default remote branch. Without a remote it writes nothing, so any change is Hearback's.
- noWrites.test.ts, in the 'changes' label:
- hashes the working tree plus .git/config, .git/info/** and .git/hooks/** (not .git/index) before and after every command, every view, a Changes refresh and every export to os.tmpdir(), under HEAD and under mergeBase;
- asserts that neither .hearback/ nor .vscode/ appears.
- Tests change settings only with ConfigurationTarget.Global and restore them in teardown.
- The multi-root workspace is a .code-workspace file with two repositories and one folder without Git. updateWorkspaceFolders is never called.
- engineRecovery kills the engine through hearback._test, reruns the view, then calls hearback._test.resetRestartPolicy.

**Tests:**

- changes scenario: _send modified, _log_retry a ghost, get unchanged
- an unsaved edit marks a node modified; after a commit it is unchanged
- the mergeBase setting switch: branch_only.py is unchanged with HEAD and modified with mergeBase
- every view opens on the modified fixture with change markers
- Changes tree items and clicks, ghosts included
- noWrites: no change in the hashed files
- multiroot: each subtree lists only its repository's changes; the folder without Git shows the explanation
- engine recovery: kill, then the view works again
- Restricted Mode: the views work, the change banner gives the reason untrusted, no marker file

### WP27 Quality gates and CI

**Goal:** The spec 8 goals and the package rules enforced in CI.

**Depends on:** WP26

**Requirements:** P1-002, P1-008, P1-009, P1-012, P1-127, P1-129, P1-130, P1-131, P1-132, P1-159, P1-165, P1-167

**Files:**

- .github/workflows/ci.yml
- engine/tests/perf/test_analysis_budget.py
- engine/tests/perf/test_workspace_cold.py
- engine/tests/fixtures/python/perf/gen_module.py
- engine/tests/fixtures/python/perf/perf_1000_lines.py
- test/integration/layoutPerf.test.ts
- package.json (scripts test:engine:perf)
- test/repo/purity.test.ts
- test/repo/workflows.test.ts
- test/repo/noNetwork.test.ts

**Details:**

- New coverage job (ubuntu):
- runs pytest under 3.10 and 3.15 with coverage --parallel-mode;
- coverage combine;
- coverage report --include='hearback_engine/python_analysis/*' --fail-under=85.
- The per-leg global fail_under 85 stays.
- New perf job: gates on ubuntu-latest, report only on windows-latest, up to 3 rounds.
- Engine: classAnatomy with overlays plus diff/compare on the 1,000-line file; a unique comment per request forces a cache miss; Jedi not involved; 3 warm-ups, then 15 runs; median under 300 ms on 3.10 and 3.15.
- Engine cold report on a generated 2,000-file workspace: report only.
- Layout in Node: median in-worker layoutMs ≤ 1.3 s on the pinned corpora.
- Layout in VS Code on ubuntu: benchmark documents loaded through hearback._test.showDocument; layoutMs under 2,000 ms and no long task over 200 ms. The first-view time (worker start, layout, render) is reported separately.
- Cold start stays under 2 s in test_e2e on every OS, and in the realEngine test from the unpacked VSIX.
- Package job:
- the VSIX is named <name>-<version>.vsix (name from package.json), with SHA256SUMS;
- extension.vsixmanifest is checked for Identity and the PreRelease property;
- elk.bundled.js is byte-identical to node_modules;
- the size is reported against a 12 MB budget;
- new expected files: media/_, shared/side-effect-rules.schema.json, dist/webview/elkjs/_.
- ci.yml gets workflow_call inputs (release-ref, pre-release) and 35-day artifact retention for releases.
- A commit-subject check against Conventional Commits.
- actionlint 1.7.12 runs if approved. workflows.test.ts checks SHA pins, minimal permissions and the environment either way.

**Tests:**

- the CI run itself
- purity: the listed pure modules do not import vscode
- workflows: SHA pins and minimal permissions; no literal tokens
- noNetwork: no network call or telemetry dependency in src/

### WP28 Documentation: ADR index, architecture, CLAUDE.md, SECURITY, README and CONTRIBUTING

**Goal:** Docs match the code; the README is user-facing.

**Depends on:** WP27

**Requirements:** P1-005, P1-007, P1-125, P1-168

**Files:**

- docs/adr/README.md
- docs/architecture.md
- CLAUDE.md
- SECURITY.md
- README.md
- CONTRIBUTING.md (new; development sections moved from the README)
- test/repo/readme.test.ts
- test/repo/docs.test.ts

**Details:**

- docs/adr/README.md:
- lists ADRs 012–020 as Accepted;
- marks 003, 005, 006 and 008 'Accepted, amended by …';
- accepted Decision sections stay unedited, as the README requires.
- architecture.md:
- describes the Phase 1 components and the scheduler;
- adds a quality-goals section that defines 'warm';
- corrects the sandbox note: Chromium 153 through Playwright is available, VS Code is not.
- CLAUDE.md:
- Phase 1 state and the new npm scripts;
- pitfalls: ELK's onmessage, Git API traps (state.refs, diffWithHEAD, getBranchBase, VS Code's own vscode-merge-base writes), snapshot updates and .prettierignore, norecursedirs, CRLF built in tests, ExtensionMode gating, the scheduler's dispatch-time deadlines.
- SECURITY.md: the Jedi configuration and audit rules, exports, Restricted Mode without Git, the safe readers, and SEC-2 (ADR 011).
- README:
- the views with screenshots and the 'Install Pre-Release' text;
- VSCodium, and the VSIX fallback for Cursor, Windsurf and Kiro; the remote CLI note;
- requirements, commands and settings tables;
- a privacy section, Restricted Mode, and known limits (untitled documents and notebooks unsupported).

**Tests:**

- readme.test.ts: every setting and command appears in the tables; images are PNG files that exist; no SVG and no http://
- docs.test.ts: the CLAUDE.md command table equals the package.json scripts
- vsce package accepts the README

### WP29 Release preparation for 0.1.0 (no publishing)

**Goal:** A ready pre-release VSIX, a gated workflow and the checklist.

**Depends on:** WP28

**Requirements:** P1-003, P1-004, P1-160, P1-161, P1-162, P1-163, P1-164, P1-165, P1-166, P1-167, P1-168, P1-169

**Files:**

- scripts/set-version.mjs
- package.json (0.1.0, icon)
- engine/hearback_engine/**init**.py
- engine/pyproject.toml
- CHANGELOG.md
- media/icon.png (at least 128 px)
- .vscodeignore (!media/icon.png)
- docs/images/*.png
- scripts/screenshots.mjs (if playwright-core is approved)
- .github/workflows/release.yml
- scripts/release-check.mjs
- scripts/release-notes.mjs
- docs/releasing.md
- docs/manual-test-checklist.md
- docs/adr/020-release-and-publishing.md
- test/repo/changelog.test.ts

**Details:**

- release.yml triggers on tags v*, plus a workflow_dispatch dry run.
- check: the tag, the three versions, the CHANGELOG, the tag on main.
- ci: the reusable ci.yml packages once, with --githubBranch <tag>.
- publish (environment release, id-token: write): sha256sum --check; vsce publish --packagePath --oidc --skip-duplicate --pre-release; then npx --yes ovsx@1.3.0 publish <vsix> --skip-duplicate. OVSX_PAT exists as an environment secret only for the first Open VSX release.
- The publish steps stay in release.yml itself, so the OIDC workflow_ref names release.yml.
- github-release (contents: write): gh release create --prerelease --verify-tag with the VSIX and SHA256SUMS.
- Names come from package.json (node -p "require('./package.json').name"). Actions are pinned by SHA, including actions/download-artifact 9000827ccba6bdab643e8b6fd33ac0654aef8333 (v8.0.2).
- CHANGELOG [0.1.0] merges Phase 0 and Phase 1 into one user-facing entry.
- The checklist requires VS Code, Cursor and VSCodium, plus Windows and remote rows (including a panel reveal over SSH or WSL). Windsurf and Kiro are best effort.
- docs/releasing.md repeats the name check (P1-169) at release time.
- We never push a v* tag. The final German 'So probierst du es aus' report goes to the owner.

**Tests:**

- versions.test.ts at 0.1.0
- changelog.test.ts names every command and setting
- the release-check self-tests
- a workflow_dispatch dry run stays green up to packaging

## Schema changes

- graph-schema.json: schemaVersion const 1 → 2, an incompatible change because every object has additionalProperties false. SCHEMA_VERSION 2 and Literal[2] in engine/hearback_engine. Fixed for the rest of Phase 1.
- Range.revision?: string. When present, the positions refer to that Git revision's text (ghost nodes, deleted evidence). Such ranges never take part in cursor sync.
- Node.selectionRange?: Range. The name of a definition, inside its range; the navigation target. Node.range starts at the first decorator.
- GraphDocument.focus?: the id of the requested symbol.
- Node.changeDetail?: ChangeDetail {formattingOnly?, docstringOnly?, importsReorderedOnly?, membersReorderedOnly?, changedDescendants?, renamedFrom?}.
- Props defs, all with additionalProperties false:
- node props: ModuleProps, PackageProps, ClassProps (bases, decorators, mro, mroError, components, context, matrix), FunctionProps (signature, parameters, async, decorators, visibility, methodKind, group, abstract, overloads, selfUnused, metrics, sideEffects, sideEffectsComplete, raises, catches, builtinCalls, dynamicSelfAccess), AttributeProps (scope, annotation, default, assignments, outsideInit, owner), PropertyProps (accessors), ExternalProps (group, package), UnresolvedProps (expression, reasonCode, args), FlowNodeProps;
- edge props: CallEdgeProps (resolvedBy: jedi | languageServer; absent for steps 1–2), AccessEdgeProps (mutation, method), FlowEdgeProps (branch, text, exceptional, back), ImportEdgeProps (flags, cycle), ExceptionEdgeProps (via, handled);
- shared: SideEffect, Metrics, ExceptionInfo;
- mappings: NodePropsByKind and EdgePropsByKind, keyed by kind.
- DiagnosticCode enum: syntax-error, newer-syntax, base-syntax-error, self-unused, attribute-outside-init, mro-conflict, duplicate-definition, import-cycle, rules-file-invalid, graph-truncated, file-too-large, file-unreadable, symbol-not-found, jedi-unavailable, jedi-budget-exceeded, changes-partial, git-unavailable.
- UnresolvedReasonCode enum: dynamic-call, subscript-call, local-value, unknown-receiver-type, type-resolution-off, external-base, never-assigned, computed-import.
- New result defs:
- ChangeSummary {schemaVersion, file, module, baseRevision?, symbols: Node[], hunks: Hunk[], diagnostics, meta};
- Hunk {base: {start, count}, working: {start, count}};
- IndexResult {schemaVersion, root, files, parsed, reused, diagnostics, meta}.
- Meta.truncated description corrected: set when the engine reaches its safety cap (10 × maxNodes, at most 10,000).
- Examples:
- graph-class-anatomy.json corrected by hand, then regenerated;
- new graph-control-flow.json and change-summary.json;
- all Prettier-formatted, and test/repo/examples.test.ts compares them with the engine snapshots.

## Protocol changes

- PROTOCOL_VERSION 1 → 2 on both sides, fixed for the rest of Phase 1.
- InitializeParams.storageDirectory?: an absolute directory owned by Hearback (globalStorageUri/engine), used for Jedi's cache.
- New params defs: TextPosition, SourceFile{file, text?}, BaseVersion{revision, file?, text|null}, FileOverlay, FileBase, RulesSource{path, text}, AnalysisOptions{useJedi?, maxNodes?, sideEffectRules?}, WorkspaceRoot{root}, WorkspaceFiles{root, files ≤ 5000, overlays?, bases?}, WorkspaceBatch{root, files ≤ 500, overlays?}.
- Analysis requests:
- python/classAnatomy {source, position?, base?, workspace?: WorkspaceRoot, options?} → GraphDocument;
- python/callGraph {source, position, hops 1–10, direction: outgoing | incoming | both, workspace: WorkspaceFiles, base?, options?} → GraphDocument;
- python/controlFlow {source, position, base?, workspace?, options?} → GraphDocument;
- python/moduleGraph {workspace: WorkspaceFiles, scopes?, focusFile?, options?} → GraphDocument;
- python/indexFiles {workspace: WorkspaceBatch, options?} → IndexResult. It fills the engine's per-file summaries; the host sends batches of at most 250 files or 4 MB;
- diff/compare {language: 'python', source, base?, workspace?, options?} → ChangeSummary. Without a base it returns the outline and replaces python/analyzeFile.
- Method order in the TS Methods object and in MethodTable.names(): engine/initialize, engine/ping, engine/shutdown, python/classAnatomy, python/callGraph, python/controlFlow, python/moduleGraph, python/indexFiles, diff/compare, then the notifications engine/exit and engine/setLogLevel. Each entry lands together with its handler.
- Errors: analysis problems become diagnostics in the result. JSON-RPC errors are used only for invalid params, cancellation and internal errors. The engine sends no notifications to the host in 0.1.0.
- Host side: the scheduler calls EngineConnection.request only at dispatch, so every deadline starts when the request is actually sent.
- Webview messages from host to page: setGraph{document, target, compare, settings}, setBusy{busy, progress?: {done, total}} (also prewarms the worker), setBanner, highlight, focusNode, settings, focusSearch, exportDone, test (test mode only).
- Webview messages from page to host: ready, workerReady, workerError, cspViolation, error, openNode{nodeId, focusEditor}, requestView{view, nodeId?, hops?}, navigate, retry, selectInterpreter, openDiagnostic, exportFile{format, suggestedName, data ≤ 32 MB text or ≤ 64 MB PNG}, copyText (≤ 1 MB), compareWithLanguageServer, layoutDone{layoutMs, firstViewMs?, longTasks?}.
- Boot data adds elkUri, testMode and a localized <title>. The CSP is unchanged.

## New settings

- hearback.engine.useJedi: boolean, default true, scope window. Added to restrictedConfigurations after D08. Applies from the next request. Enables Jedi as call-graph resolution step 3.
- hearback.diff.base: enum HEAD | mergeBase, default HEAD, scope resource, localized enumDescriptions.
- hearback.diff.mainBranch: string, default '' (empty means detect: branch.<HEAD>.vscode-merge-base read only, then origin/HEAD, origin/main, origin/master, main, master), scope resource. Manifest pattern ^$|^[A-Za-z0-9._][A-Za-z0-9._/-]*$ plus checks in code.
- hearback.codeLens.enabled: boolean, default true, scope window. Read live.
- hearback.graph.maxNodes: integer, default 300, range 50–5,000, scope window. Counts visible graph nodes, member rows included; the engine cap is 10 × this value, at most 10,000.
- hearback.graph.defaultHops: integer, default 2, range 1–10, scope window.
- hearback.sideEffects.rulesFile: string, default '' (built-in rules only), scope resource. Relative to the folder or absolute; read with the bounded regular-file reader; not restricted.
- Unchanged: hearback.engine.pythonPath and hearback.engine.timeoutMs (still the single per-request timeout).

## Commands and contributions

- activationEvents: ['onLanguage:python'] only (WP18)
- Commands in category Hearback: hearback.showClassAnatomy, hearback.showCallGraph, hearback.showControlFlow, hearback.showModuleGraph, hearback.refreshChanges. hearback.openGraphView stays.
- Hidden commands, not contributed:
- hearback.visualize (CodeLens), hearback.openChangedSymbol (tree), hearback.focusGraphSearch (keybinding);
- test state: hearback._test.graphPanelState (extended), hearback._test.changeTrackerState, hearback._test.changesTree, hearback._test.lastGraph;
- registered only in ExtensionMode.Test: hearback._test.webviewAction, hearback._test.exportTo, hearback._test.showDocument, hearback._test.resetRestartPolicy, and Phase 0's hearback._test.restartEngine.
- Submenu hearback.context in editor/context (editorLangId == python && resourceScheme == file) and in explorer/context (resourceLangId == python || explorerResourceIsFolder).
- commandPalette when clauses: editorLangId == python || activeWebviewPanelId == 'hearback.graph'. showModuleGraph also appears when workspaceFolderCount > 0.
- viewsContainers.activitybar 'hearback' with icon media/hearback-activitybar.svg; views.hearback contains hearback.changes.
- viewsWelcome for hearback.changes, driven by the context key hearback.changes.state: untrusted, gitDisabled, gitMissing, noRepository, notOpened, baseNotFound.
- menus view/title: refreshChanges (view == hearback.changes). view/item/context: the show* commands (viewItem =~ /^hearback\.symbol\./).
- keybindings: ctrl+f / cmd+f → hearback.focusGraphSearch, when activeWebviewPanelId == 'hearback.graph' && !sideBarFocus && !panelFocus && !auxiliaryBarFocus && !inputFocus && !terminalFocus.
- jsonValidation: fileMatch hearback-rules.json and *.hearback-rules.json → ./shared/side-effect-rules.schema.json (WP05).
- restrictedConfigurations += hearback.engine.useJedi (after the owner approves D08).
- Test labels in .vscode-test.mjs: integration (existing), changes (temporary repository, hermetic Git), multiroot (.code-workspace). esbuild --tests also bundles test/changes/** and test/multiroot/**.
- l10n policy:
- every new string goes into package.nls(.de).json, vscode.l10n.t literals (host) or l10n.t literals (webview), with the German text in the same commit;
- diagnostic codes, unresolved reasons and built-in rule ids are localized through Record<…> tables on both sides.
- npm scripts: test:unit and test:coverage with explicit projects, test:perf, test:engine:perf, snapshots:update, release:check, version:set, screenshots (if playwright-core is approved).

## New dependencies

- **elkjs 0.12.1** (EPL-2.0 OR GPL-3.0-or-later (used under EPL-2.0; ADR 009 exception); runtime; shipped unmodified as dist/webview/elkjs/elk.bundled.js plus LICENSE.md; not bundled): ELK layered layout with ports, run in the worker (spec 5.5)
- **web-worker (embedded in elk.bundled.js) 1.4.1 (elkjs's exact devDependency pin; the code is byte-identical in 1.5.0)** (Apache-2.0; embedded as browserify module 4 of elk.bundled.js (two lines); not installed; notice entry only): elk.bundled.js contains its browser shim, so the license gate and THIRD_PARTY_NOTICES must list it
- **actions/download-artifact v8.0.2 (9000827ccba6bdab643e8b6fd33ac0654aef8333)** (MIT; CI action, release workflow only): The publish job takes the VSIX packaged by the CI job
- **@xyflow/react 12.12.0 -> 12.12.1** (MIT; runtime, bundled (optional upgrade)): Fixes ResizeObservers left connected after unmount (#6054) and mutation of the selection state (#6097), which controlled selection relies on
- **playwright-core 1.64.1** (Apache-2.0; dev-only, optional, no dependencies): Reproducible README screenshots from the production webview bundle (scripts/screenshots.mjs)
- **actionlint 1.7.12** (MIT; CI-only tool (release archive pinned by SHA-256), optional): Lints the workflow files (P1-165); workflows.test.ts is the fallback
- **ovsx 1.3.0** (EPL-2.0; release job only, through npx; never a dependency (ADR 009)): Publishing to Open VSX; listed for explicit confirmation
- **git.d.ts (microsoft/vscode release/1.105, trimmed) 1.105** (MIT; vendored type-only source, erased at build): Typed access to the vscode.git API

## Decisions

### D01 Product name (spec deviation, ADR 010)

Resolved: the owner chose Hearback on 2026-11-04 from the offered options (Hearback, keeping Readback, "Readback Code"). ADR 010 is accepted; the rename is on the branch and green in CI. Re-checked on 2026-11-05: free on both registries.

Alternatives:

- Keep Readback with lldeters.readback-code (free, but next to speechify.readback, which serves the same audience)
- 'Readback Code' as the display name
- Another name, checked on both registries first

### D02 SEC-2: confirm workspace interpreters chosen by the Python extension (ADR 011)

Implemented as ADR 011 after the owner chose the one-time confirmation on 2026-11-04. An interpreter from the Python extension inside a workspace folder needs a confirmation per (workspace, path); non-interactive starts skip it and use PATH; Show Engine Status names the reason. Phase 1 adds no further failure state for it.

Alternatives:

- Keep the known limit of ADR 004
- Fail background starts with a confirmationRequired banner (the draft's idea; contradicts ADR 011)

### D03 Contract v2 (ADR 012)

Bump schemaVersion to 2 and PROTOCOL_VERSION to 2, once in WP01. Both stay fixed for the rest of Phase 1.

Results (GraphDocument, ChangeSummary, IndexResult) live only in graph-schema.json and params only in engine-protocol.schema.json. With no cross-file $ref, the generator stays unchanged.

Props are typed through NodePropsByKind and EdgePropsByKind, and DiagnosticCode and UnresolvedReasonCode are enums. Each method entry arrives with its handler, in an order fixed by ADR 012.

Alternatives:

- $ref the graph schema from the protocol and post-process the generator output (measured: duplicates every graph type)
- Stay on v1 with optional fields only (additionalProperties false makes old readers reject new fields anyway)

### D04 Request set (ADR 012)

Six requests:

- python/classAnatomy (whole file plus state-matrix data)
- python/callGraph
- python/controlFlow
- python/moduleGraph
- python/indexFiles (the workspace index, in batches)
- diff/compare (without a base it returns the outline and covers python/analyzeFile; spec 5.2 allows other names)

Requests are stateless: the host sends the file list and the text of dirty documents, and the engine reads every other file itself with the safe reader. Analysis problems come back as diagnostics in the result. JSON-RPC errors are reserved for invalid params, cancellation and internal errors. The engine sends no notifications to the host in 0.1.0.

Alternatives:

- A separate python/analyzeFile
- A stateful workspace sync
- $/progress notifications for one long request instead of index batches

### D05 Call-graph resolution exactly as spec 6.1.3 (ADR 013)

Steps in the spec's order:

1. Local scopes, self, cls and super(): certain.
2. Workspace imports with aliases and re-exports: certain.
3. Optional Jedi for obj.method() (hearback.engine.useJedi): inferred, resolvedBy jedi.
4. Optional language-server comparison, as an explicit action: inferred, resolvedBy languageServer.
   Anything else becomes an unresolved node with a reason and a reasonCode (type-resolution-off when step 3 is off).

The draft's always-on custom type inference is dropped. It was an unflagged spec deviation and custom code beside a maintained library (rule 0.5). The P1-070 example 'c = Client(); c.get()' is restored.

Builtins are not call targets (props.builtinCalls). Stdlib and third-party targets collapse into one external node per top-level package. Cards draw only edges within the class hierarchy; bases from other files appear as context cards.

Alternatives:

- Always-on light type inference before Jedi (a spec deviation that needs the owner's OK; see open questions)
- Position-based IDs
- Drawing every builtin call

### D06 What counts as 'modified' (spec 5.4 contradicts itself) (needs the owner's OK, ADR 016)

Strict spec 5.4 for the visualizations: a node is modified if and only if the position-free AST of its own part differs. Hunk overlap is only a pre-filter, because a reformatted method always overlaps a hunk.

Change details:

- Formatting- and comment-only edits stay unchanged, with formattingOnly.
- Docstring-only edits are modified, with docstringOnly.
- Reordered module imports make the module modified, with importsReorderedOnly.
- Reordered members make the container modified, with membersReorderedOnly.

Containers count only their own statements and report changedDescendants. The flags let Phase 3 treat docstrings and reordered imports as understood (spec 7.2) without changing this rule. Deleted symbols become ghosts; a detected rename shows renamedFrom.

Alternatives:

- Apply spec 7.2's ledger rule to the views as well: docstring-only edits and reordered imports or members stay unchanged; the flags are kept
- Modified when a hunk overlaps and the AST differs
- Hunk overlap alone (reformatting would show as modified, against 5.4)

### D07 Git access (ADR 016)

vscode.git getAPI(1), acquired lazily, without extensionDependencies (a dependency would disable Hearback in Restricted Mode). Hearback never spawns git and uses a read-only subset: show, getMergeBase, getConfig, diffWith(ref), the state groups and toGitUri. getBranchBase, setConfig, fetch, hashObject, status() and state.refs are never called; getBranchBase writes .git/config.

The main-branch chain is: the setting; the key branch.<HEAD>.vscode-merge-base, read only; then origin/HEAD, origin/main, origin/master, main and master. VS Code's own history provider writes that key, Hearback only reads it.

Base text comes from Repository.show, working text from the document, and the engine computes the hunks.

Alternatives:

- Parse 'git diff' output (sees only files on disk, depends on user config)
- extensionDependencies on vscode.git

### D08 Jedi on by default, setting restricted (needs the owner's OK, ADR 015)

hearback.engine.useJedi defaults to true, because Jedi is the only type-aware step in 0.1.0 (D05).

Jedi runs only in python/callGraph and only for obj.method() sites:

- outgoing: the sites on the hop frontier;
- incoming: sites whose attribute name matches the target, prefiltered from the index.
  Each request has a 1,500 ms budget, and results are cached by file content hash.

Measured cost: about 1 s on first use per engine session (2.5–3.8 s with an empty parso cache), then 5–31 ms per site. The safe configuration and three new audit rules are in ADR 015.

The setting joins restrictedConfigurations, so a workspace cannot turn Jedi on for a user who turned it off. P1-006 requires the owner's OK for that.

Alternatives:

- Default false: faster call graphs, but every obj.method() call stays unresolved until the user opts in
- Jedi in every view (breaks the 300 ms goal)
- Not restricted

### D09 One graph panel, no restore (ADR 017)

A single hearback.graph panel that the commands retarget, with a view switcher and history. Without a serializer, activationEvents stays exactly ['onLanguage:python'] (spec 8). getState and setState keep the view state across hide and show.

Alternatives:

- One panel per view kind
- A serializer with onWebviewPanel and a restore placeholder

### D10 Quiet operation (ADR 017)

The engine starts only on a user action: a command, a CodeLens click, expanding a tree file, Refresh or Retry. CodeLens uses the host scanner, cursor sync stays on the host, and Git is acquired only when needed. Tree symbols are never computed eagerly. Background work reports through banners, the log or the tree message.

Alternatives:

- Start the engine for CodeLens or for a visible tree

### D11 ELK packaging and worker lifecycle (ADR 018)

Ship elk.bundled.js unmodified in dist/webview/elkjs/, together with its LICENSE.md.

Worker setup:

- The page fetches it together with layout.worker.js and joins both into one Blob for a classic worker.
- new ELK({algorithms:['layered']}) runs without workerUrl or workerFactory, then self.onmessage = null.
- $H is stripped from results.

Lifecycle:

- The worker starts lazily on a layout-cache miss, or early when an analysis is running.
- It stays alive between layouts.
- It lets a superseded layout finish and discards the result.
- It is terminated, and restarted with a warm-up, only after a superseded layout has run 750 ms or at the 10 s timeout.

elk.bundled.js embeds two lines from web-worker 1.4.1 (Apache-2.0), which get their own notice entry.

Alternatives:

- Run elk-worker.min.js as the worker and speak ELK's message protocol from the page
- Bundle elkjs with esbuild (contradicts ADR 009 and strips the EPL headers)
- Terminate on every superseded layout (0.34 s restart plus a cold first layout each time)

### D12 Graph size policy (ADR 018)

hearback.graph.maxNodes (default 300) counts visible GraphDocument nodes, member rows included (P1-110). Groups collapse deepest and largest first; the focused symbol's group stays open.

ELK switches to its fast variant (thoroughness 1, greedySwitch OFF) when there are more than 100 boxes, 150 ports or 300 edges. NETWORK_SIMPLEX is never used.

The module graph is flat by default, with nested package boxes only up to 100 boxes. Control flow gets one terminal per return and raise. The engine caps at 10 × maxNodes (at most 10,000) and sets meta.truncated.

Alternatives:

- Count boxes only (the draft; redefines maxNodes)
- Switch variants by box count only (misses dense port graphs: 3.1–3.4 s measured)
- Let the engine cut at maxNodes

### D13 Export (ADR 019)

An own SVG renderer, plus PNG through a Canvas 2D backend from the same display list, so the CSP stays exactly as in ADR 008.

PNG is scaled down to at most 16,384 px per side and 64 M px in area. A null toBlob result gives a localized error.

Mermaid uses classDiagram and flowchart, and JSON is the full document. SVG, PNG and Mermaid export the visible graph in the current theme. The host saves files through the save dialog and workspace.fs.

Alternatives:

- img-src blob: plus an img element and a canvas
- html-to-image (needs img-src data:, is slow, and drops edges)
- A 268 M px clamp (a 1 GiB RGBA canvas in the webview)

### D14 Small UI additions beyond the spec (needs the owner's OK, ADR 017)

Three additions:

- A Ctrl/Cmd+F keybinding for hearback.focusGraphSearch, with the when clause activeWebviewPanelId == 'hearback.graph' && !sideBarFocus && !panelFocus && !auxiliaryBarFocus && !inputFocus && !terminalFocus. Extension keybindings outrank the workbench's Find bindings, so this guard keeps Explorer and terminal find working.
- 'Copy as Mermaid' in the export menu.
- A view switcher with back and forward.

No contributed commands beyond the four Show commands and Refresh Changes.

Alternatives:

- Search only through '/' inside the graph, and no clipboard export

### D15 Side-effect rules file (ADR 014)

A JSON file with a schema, validated through jsonValidation. User rules add rules or disable built-in ones by id.

The host reads the file with a bounded regular-file reader (regular file only, at most 1 MiB, O_NONBLOCK, at most 1 MiB + 1 bytes read), so a FIFO, /dev/zero or a symlink to them cannot hang the extension host. The engine reads source files the same way.

The setting stays unrestricted: the file is read only as data and is never echoed.

Alternatives:

- Add hearback.sideEffects.rulesFile to restrictedConfigurations (needs the owner's OK under P1-126)
- TOML (no tomllib on Python 3.10)
- YAML (a new dependency)

### D16 Settings defaults

No settings beyond spec 8:

- useJedi: true (window; restricted after D08)
- diff.base: HEAD (resource)
- diff.mainBranch: '' with detection (resource)
- codeLens.enabled: true
- graph.maxNodes: 300 (50–5,000; visible nodes including member rows)
- graph.defaultHops: 2 (1–10)
- sideEffects.rulesFile: '' (resource)

Alternatives:

- useJedi false
- maxNodes 500
- defaultHops 1

### D17 Changes tree (ADR 017)

Repository and file levels come from Git. Symbols are computed only when the user expands a file or presses Refresh. Welcome states use a context key. No activity-bar badge. Ghost symbols are listed. Tooltips are plain text.

Alternatives:

- Analyze every changed file while the view is visible
- Compute symbols right away whenever the engine is already running (the draft)

### D18 Release and publishing (spec deviation, ADR 020)

Package once in CI and publish that same VSIX. Publishing waits for the owner's approval in the GitHub environment 'release'.

Both registries use Trusted Publishing (OIDC): vsce 4.1.0 with --oidc, ovsx 1.3.0 with trusted publishing. Fallbacks: a manual upload of the same VSIX, or OVSX_PAT as a release-environment secret for the first Open VSX version only.

A GitHub pre-release carries the VSIX and SHA256SUMS. Tags only on main. Owner decision 2026-11-04: Trusted Publishing.

Alternatives:

- VSCE_PAT and OVSX_PAT as the spec says (global Azure DevOps PATs end on 2026-12-01)
- Manual uploads only

### D19 Test hooks (ADR 017)

Hidden hearback._test.* commands are never contributed. Acting ones are registered only in ExtensionMode.Test: webviewAction, exportTo, showDocument, resetRestartPolicy, and Phase 0's restartEngine. The webview test hooks exist only with boot.testMode.

Alternatives:

- Always registered, as in Phase 0

### D20 Unsupported in 0.1.0 (ADR 017)

Untitled documents, notebooks and .pyi files: only the file scheme is supported. Documented as known limits.

Alternatives:

- Synthetic module IDs for untitled documents

### D21 Host scheduler and chunked workspace index (ADR 012)

A vscode-free scheduler:

- keeps at most one analysis request in flight;
- runs foreground work before background work;
- coalesces requests per key and drops superseded ones before sending;
- starts each deadline at dispatch;
- lets foreground work cancel in-flight background work.

Workspace-wide analyses run through python/indexFiles batches of at most 250 files or 4 MB, so:

- each request fits engine.timeoutMs;
- foreground requests interleave;
- the panel shows 'Indexing {0} of {1} files';
- Retry resumes from the cached summaries.

engine.timeoutMs stays the single per-request timeout (spec 5.2).

Alternatives:

- A higher timeout floor for workspace-wide requests (would override the setting)
- One long request with progress notifications
- Supersede per key only (the draft; a healthy engine gets killed behind a long request)

### D22 Ranges and the navigation target (ADR 013)

Node.range starts at the first decorator and covers the whole definition; Node.selectionRange covers the name.

- Clicks select selectionRange (or the range start).
- Cursor sync uses range, so a cursor on a decorator line highlights its definition.
- CodeLens anchors on range.start.
- Ranges with a revision never take part in cursor sync and open the base version.

Alternatives:

- Ranges start at 'def', so the scanner and the engine disagree for every decorated definition
- A props.nameRange instead of a schema field

### D23 CodeLens placement (ADR 017)

Lenses on every class, function and method, nested functions included (spec 6.1 'über Klassen und Funktionen', P1-089). A module-level or nested function opens Control Flow, a method opens Class Anatomy focused on its row, and a class opens Class Anatomy.

Alternatives:

- Skip nested functions (the draft; an unrecorded deviation)

### D24 Localizing engine texts by code (ADR 017)

The engine sends codes plus English fallbacks: DiagnosticCode, UnresolvedReasonCode and the built-in rule ids.

- The webview localizes them through Record<…> tables.
- The host keeps its own table (src/views/diagnosticText.ts, vscode.l10n.t literals) for tree messages and notifications.
- A repo test checks both tables against the enums and the German bundle.

Alternatives:

- One shared table (the two l10n exporters each need literal calls of their own API)

### D25 Review points not adopted as proposed

1. Editing the Decision sections of ADRs 003, 005, 006 and 008: not done. docs/adr/README.md forbids editing accepted records; the new ADRs amend them, and their status lines and the index say so.
2. A timeout floor for workspace-wide requests: replaced by index batches (D21), which keep engine.timeoutMs authoritative.
3. Pushing followup-hearback: not needed, it is already on origin/claude/kind-wozniak-gg8kz0 with CI green.
4. Writing the plan in hearback terms only after the owner confirms: the plan already uses hearback because the branch does, with the mechanical fallback in WP00.
5. Owner approval for D05: no longer needed, because the custom inference is dropped and D05 matches the spec.

Alternatives:

- Adopt each point literally

## Risks

- **Risk:** ELK layout of dense graphs is slow:
- 20–30 class cards with random cross-card port edges took 3.1–3.4 s in a Chromium worker;
- a module graph with nested packages took 4.4 s at 300 nodes;
- one shared CFG exit node took 73 s at 1,000 nodes.
  **Mitigation:** - View-specific options and the fast variant chosen by cost (boxes, ports, edges).
- A flat module graph by default and one terminal per CFG exit.
- Collapse to maxNodes, member rows counted.
- A 10 s worker timeout and a warm-up layout.
- Gates on pinned, realistic corpora in Node and in VS Code (Electron 138), with the random graph report-only.
- **Risk:** In-process Jedi, now on by default, could import or run workspace code. This was proven with load_unsafe_extensions and with a planted parso pickle.
  **Mitigation:** - The safe configuration and three new audit rules.
- Trap tests written into tmp_path and run in a sandboxed subprocess.
- A positive cache test, so the allowlist does not silently disable Jedi.
- A 1,500 ms budget and a degrade path.
- The setting is restricted, so a workspace cannot turn it on in Restricted Mode.
- **Risk:** The engine handles one request at a time, and today's deadlines start at send. Queued requests can time out behind a long one and get a healthy engine killed, which can end in a crash loop.
  **Mitigation:** - The scheduler: one request in flight, deadlines from dispatch, foreground first, superseded requests dropped before sending.
- Workspace work in index batches.
- check_cancelled() between files and functions.
- No engine use for CodeLens or cursor sync.
- resetRestartPolicy between test suites.
- **Risk:** Git API traps:
- state.refs is always [].
- diffWithHEAD compares with the index.
- getBranchBase writes .git/config, and VS Code's own history provider calls it on HEAD changes.
- HEAD is still undefined at onDidOpenRepository.
- Const enums fail under verbatimModuleSyntax.
  **Mitigation:** - A read-only subset with our own numeric constants and a pin test.
- Waiting for HEAD after a repository opens.
- A typed fake for unit tests.
- A no-writes repository without a remote, so VS Code's own writes cannot occur there.
- **Risk:** Git is unavailable in Restricted Mode, when disabled or not installed, and for parent or unsafe repositories.
  **Mitigation:** Reasons shown as welcome states and banners, views without the overlay, and tests in the untrusted and integration runs.
- **Risk:** Multi-root workspaces, Windows and macOS path case, and symlinks can drop changed files or match the wrong node.
  **Mitigation:** - Everything is keyed by root, and the panel by (root, nodeId).
- One pathKey helper compares paths case-insensitively on win32 and darwin.
- Fixtures use realpath.
- A multiroot test label.
- **Risk:** Integration, Restricted Mode and Git tests cannot run in the cloud sandbox.
  **Mitigation:** - Each package adds its own integration tests and is pushed, so CI catches failures early.
- Logic lives in pure modules.
- Webview code is checked with the Chromium harness in the sandbox.
- **Risk:** About 250 new strings, plus diagnostic and reason codes, could leave gaps in the German localization.
  **Mitigation:** - The CI export diff and test/repo/l10n.test.ts.
- Record<…> tables, checked at compile time.
- l10nCodes.test.ts for the host and webview tables, including built-in rule ids.
- A manual check with the German language pack.
- **Risk:** Hostile identifiers or docstrings could inject markup through webview labels, tree tooltips, Quick Picks or exports.
  **Mitigation:** - Text-only rendering, enforced by the ESLint rule.
- Plain-string or appendText-only tooltips with isTrusted false.
- Quick Picks show qualified names only.
- XML and Mermaid escaping tests, and generated Mermaid ids.
- **Risk:** Hostile files can hang the extension host or the engine: a rules file or a .py file that is a FIFO, /dev/zero, a symlink to them, or a Windows device name.
  **Mitigation:** Bounded regular-file readers on both sides (stat, O_NONBLOCK, fstat, at most cap + 1 bytes), with tests on POSIX and Windows.
- **Risk:** Large workspaces: cold callers and module graphs cost 25–55 s for about 1 M lines, above the default 30 s timeout. Payloads approach the 64 MiB message limit.
  **Mitigation:** - Index batches with resumable cached summaries.
- A (size, mtime_ns) pre-check.
- A 5,000-file cap and a 16 MB cap on bases and overlays.
- The engine node cap.
- A progress banner.
- A cold-time report on a generated 2,000-file workspace.
- **Risk:** Python 3.15 AST changes (is_lazy, DictComp.value None, constructor TypeError) and unparse differences across versions.
  **Mitigation:** - sys.version_info guards.
- mypy for 3.10 and 3.15 from WP02 on.
- Labels from source segments.
- No hashes persisted across interpreters.
- **Risk:** The PEP 701 heuristic could misclassify a real f-string error as newer syntax, or miss a form.
  **Mitigation:** - It runs only below 3.12, and only when the file re-lexes cleanly under 3.12 rules; otherwise the result stays syntax-error.
- Corpus test with 0 false positives on 289 vendored files.
- The exact 3.10 and 3.11 messages are pinned in the tests.
- **Risk:** Publishing:
- Global Azure DevOps PATs end on 2026-12-01.
- Whether OIDC can create a new extension on its first publish is unverified.
- Open VSX cannot use trusted publishing for the first version.
  **Mitigation:** A manual upload of the same VSIX, or OVSX_PAT as an environment secret once. All of it sits behind the environment approval.
- **Risk:** Cursor's Open VSX mirror lags, and the remote CLI does not forward --pre-release.
  **Mitigation:** The VSIX in the GitHub release, README instructions, and the manual checklist.
- **Risk:** Screen readers enter focus mode because of role=application. VS Code swallows Ctrl+F, Z, Y, P and S in webviews. An unguarded extension keybinding would hijack Find elsewhere in the window.
  **Mitigation:** A complete keyboard model, the details panel, the matrix as a table, and the narrowed when clause with a manifest test and a checklist row.
- **Risk:** Mocha loads files in no fixed order. Engine state and crash counts leak between suites.
  **Mitigation:** Quiet-start checks in the root-level hook, resetRestartPolicy after kill tests, and separate test labels for Git and multi-root.
- **Risk:** Perf numbers come from a 4-vCPU sandbox. Windows and macOS runners are 1.5–3 times slower.
  **Mitigation:** Gate only on ubuntu-latest, use medians with warm-ups and up to 3 rounds, and report the other systems.

## Open questions

- **Spec 5.4 contradicts itself on 'modified': hunk overlap versus 'reformatting is not a change'. And spec 7.2 treats docstrings and reordered imports as understood.**
  Recommendation: Approve D06: strict 5.4 for the views, so docstring-only edits and reordered imports or members show as '~' with a note, and Phase 3 uses the flags for 7.2. German for the owner: „Eine Methode gilt als geändert, wenn sich ihr Code ohne Positionen unterscheidet. Reine Umformatierungen und Kommentare bleiben unverändert. Docstring-Änderungen und umsortierte Imports oder Methoden zeigen wir als geändert mit Hinweis, im Verständnis-Modus (Phase 3) zählen sie automatisch als verstanden.“
- **Jedi on by default (D08), and adding hearback.engine.useJedi to restrictedConfigurations.**
  Recommendation: Approve. Jedi runs only in the call graph, with a budget of 1,500 ms per request and the hardened configuration. Without it, every obj.method() call stays unresolved. The restriction keeps a repository from switching Jedi on for a user who switched it off.
- **New dependencies.**
  Recommendation: elkjs 0.12.1 is required from WP14; it contains a 2-line Apache-2.0 shim that gets its own notice entry. The release workflow needs actions/download-artifact v8.0.2. Also recommended:
- @xyflow/react 12.12.1 (fixes for controlled selection and ResizeObserver);
- playwright-core 1.64.1 as a dev dependency for reproducible screenshots;
- actionlint 1.7.12 in CI.
  Not recommended: mermaid or axe-core as dev dependencies.
- **Small additions: the Ctrl/Cmd+F keybinding with the narrowed when clause, 'Copy as Mermaid', the view switcher with history.**
  Recommendation: Approve D14.
- **Should a light type-inference pre-pass (annotations, constructors, return annotations) join step 3 later? The prototype shows it resolves common cases in about 10 ms.**
  Recommendation: Not in 0.1.0. It would be custom code beside Jedi (rule 0.5) and a deviation from spec 6.1.3. Revisit with call-graph measurements from real repositories after the release.
- **README media: section 12 asks for GIFs, the Phase 1 acceptance asks for screenshots.**
  Recommendation: PNG screenshots for 0.1.0, GIFs later.
- **Extension icon (PNG, at least 128 px).**
  Recommendation: We create a simple monochrome placeholder; the owner may replace it before the release.
- **Release mechanics: tags only on main? A GitHub pre-release with the VSIX? Build attestations?**
  Recommendation: Merge Phase 1 into main before tagging. Attach the VSIX and SHA256SUMS to the GitHub release. No attestations in 0.1.0.
- **Should a node click move focus to the editor?**
  Recommendation: No: preserveFocus on click and Enter; a double-click or Shift+Enter focuses the editor.

## Owner to-dos

- Before WP01: approve this plan with its defaults, in particular D06 (the rule for 'modified'), D08 (Jedi on by default, setting restricted) and D14 (search keybinding, Copy as Mermaid, view switcher).
- Before WP01: approve elkjs 0.12.1. It is required from WP14, licensed EPL-2.0 under ADR 009, and contains a 2-line Apache-2.0 web-worker shim.
- Any time before the package that uses them: decide on the optional dependencies @xyflow/react 12.12.1 (WP14), actionlint 1.7.12 (WP27) and playwright-core 1.64.1 (WP29 screenshots).
- Before the release: approve actions/download-artifact v8.0.2 for release.yml.
- Before the release, after D18: create a Trusted Publishing policy for publisher lldeters at marketplace.visualstudio.com/manage, with repository owner lldeters, repository Readback, workflow release.yml and environment release.
- Before the release, Open VSX (the namespace lldeters is verified):

1. Create an access token for the first release of lldeters.hearback.
2. Store it as the secret OVSX_PAT in the GitHub environment 'release', or upload the first version by hand.
3. After the first release, register the trusted publisher at open-vsx.org/user-settings/trusted-publishers and delete the secret.

- Before the release: create the GitHub environment 'release' with you as required reviewer, 'prevent self-review' off, admin bypass disallowed and the deployment tag rule v*. Optionally add a ruleset for v* tags.
- Before the release: enable private vulnerability reporting (Settings → Security).
- Before the release: review and merge the Phase 1 branch into main, then push v0.1.0 yourself.
- Before the release: check the German strings with the language pack, and provide or approve the icon and the screenshots.
- Before the release: fill in the manual checklist (VS Code, Cursor, VSCodium, Windows, remote) on the VSIX from the release run, then approve the deployment.

## Acceptance mapping

| Requirement | How it is proven                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1-001      | The main session sends this plan to the owner in German. WP01 is the first Phase 1 commit and comes after the recorded approval. Every open question has a default, and release-only questions do not block WP01.                                                                                                                                                                                                                            |
| P1-002      | WP27: the last CI run of the Phase 1 branch is green in every job, including perf, the combined coverage job and the integration labels integration, changes and multiroot.                                                                                                                                                                                                                                                                  |
| P1-003      | WP29: CHANGELOG [0.1.0] with Added, Changed and Security. changelog.test.ts checks that it names every command and setting; release-check.mjs checks the section and its links.                                                                                                                                                                                                                                                              |
| P1-004      | WP29: the final German 'So probierst du es aus' report; git log shows no Phase 2 commits.                                                                                                                                                                                                                                                                                                                                                    |
| P1-005      | ADRs 012–020 are listed as Accepted in docs/adr/README.md, and 003, 005, 006 and 008 are marked amended. architecture.md describes the Phase 1 components. docs.test.ts compares the CLAUDE.md command table with the package.json scripts.                                                                                                                                                                                                  |
| P1-006      | Decisions marked needsOwnerOk (D01, D06, D08, D14, D18) land only after approval. manifest.test.ts pins the exact settings list and restrictedConfigurations.                                                                                                                                                                                                                                                                                |
| P1-007      | ADRs cite their sources. Integration runs on 1.105.1 and stable. tsc compiles against @types/vscode 1.105.0, which versions.test.ts keeps equal to the engines minimum. Phase 1 uses no API newer than 1.105.                                                                                                                                                                                                                                |
| P1-008      | WP14: the hand-made out/meta/elkjs.json and the embedded web-worker entry pass notices:check. The CI package job checks that the VSIX's elk.bundled.js is byte-identical (SHA-256) to the npm file and that LICENSE.md ships. notices.test.ts covers both entries.                                                                                                                                                                           |
| P1-009      | WP27: a CI check of commit subjects against Conventional Commits; workflows.test.ts finds no literal tokens.                                                                                                                                                                                                                                                                                                                                 |
| P1-010      | WP26 noWrites.test.ts runs in the 'changes' label, in a temporary repository with Git active and no remote. Before and after every command, view, Changes refresh and export to os.tmpdir(), under HEAD and under mergeBase, it hashes the working tree plus .git/config, .git/info/** and .git/hooks/** (not .git/index). It asserts that neither .hearback/ nor .vscode/ appears. Settings change only through ConfigurationTarget.Global. |
| P1-011      | Every package that adds strings runs l10n:export and adds the German text. CI's export diff and l10n.test.ts check the bundles. l10nCodes.test.ts checks that the host and webview tables cover every DiagnosticCode, every UnresolvedReasonCode and every built-in rule id in English and German. German is checked manually with the language pack.                                                                                        |
| P1-012      | The folders src/changes, src/views, webview/, engine/hearback_engine/python_analysis and engine/tests/fixtures/python exist. purity.test.ts checks that the pure modules do not import vscode.                                                                                                                                                                                                                                               |
| P1-013      | WP16 manifest.test.ts: enabledApiProposals is undefined and engines.vscode is '^1.105.0'. The CI package job builds the VSIX.                                                                                                                                                                                                                                                                                                                |
| P1-014      | Normalized snapshots in engine/tests/snapshots (WP02, WP11) are identical on 3.10 and 3.15. Webview tests (WP20–WP25) cover filters, search, legend, matrix, banners and export.                                                                                                                                                                                                                                                             |
| P1-015      | WP16 testCommands.ts. manifest.test.ts finds no contributed hearback._test.* command. Acting test commands exist only in ExtensionMode.Test.                                                                                                                                                                                                                                                                                                 |
| P1-016      | WP18 manifest.test.ts: activationEvents deep-equals ['onLanguage:python'].                                                                                                                                                                                                                                                                                                                                                                   |
| P1-017      | The root-level suiteSetup in test/integration/activation.test.ts (WP18, WP19) opens retrying_client.py and the Hearback container, waits 3 s and collects the CodeLenses; engineState is still 'idle' before any suite starts the engine. views.test.ts then sees 'running' after Show Class Anatomy.                                                                                                                                        |
| P1-018      | WP12 and WP16 unit tests: background failures cause 0 show*Message calls; a failed user action causes exactly one notification with its actions.                                                                                                                                                                                                                                                                                             |
| P1-019      | test_handlers.py validates every method's result against the schema. test_protocol_sync, test_server.ENGINE_METHODS and initialize-result.json change with each method. python/analyzeFile is folded into diff/compare (ADR 012).                                                                                                                                                                                                            |
| P1-020      | schema:check, test_schema_conformance, versions.test.ts at 2/2, and examples valid in Ajv and jsonschema (WP01, WP11).                                                                                                                                                                                                                                                                                                                       |
| P1-021      | test_cache.py: the parse counter, the (size, mtime_ns) skip, a one-byte edit, the engine-version key and eviction.                                                                                                                                                                                                                                                                                                                           |
| P1-022      | test_module_graph: $/cancelRequest on a generated 2,000-file workspace answers -32800 within 250 ms. scheduler.test.ts and analysisClient.test.ts with fakeEngine.cjs: a superseded request is dropped before it is sent, or cancelled, and a late result is ignored.                                                                                                                                                                        |
| P1-023      | analysisClient.test.ts with the slow fake engine: the deadline starts at dispatch, the request is cancelled at the deadline and the engine killed 2 s later. Banner.test keeps the previous document and shows the timeout banner.                                                                                                                                                                                                           |
| P1-024      | analysisClient.test.ts with the crashing fake engine. engineRecovery.test.ts kills the engine through hearback._test, reruns the view, then resets the restart policy.                                                                                                                                                                                                                                                                       |
| P1-025      | test_source and test_handlers: a broken file gives syntax-error with a range and no -32603. Banner.test keeps the earlier nodes. views.test.ts types an error and sees the banner.                                                                                                                                                                                                                                                           |
| P1-026      | test_syntax and test_fstrings, version-gated, on 3.10: - except* maps to 3.11. - Type aliases, PEP 695 and PEP 701 forms (nested same quotes, backslash, comment, multi-line field) map to 3.12. - 'except A, B:' and t-strings map to 3.14. - Real errors stay syntax-error. - The same files parse on 3.15.                                                                                                                                |
| P1-027      | test_jedi_support and test_sandbox: traps written into tmp_path leave no marker in a sandboxed subprocess. The Jedi settings are asserted. The analyses run under the sandbox without audit violations.                                                                                                                                                                                                                                      |
| P1-028      | Subprocess test: after initialize and classAnatomy, with useJedi true and with false, jedi, parso and sqlglot are not in sys.modules.                                                                                                                                                                                                                                                                                                        |
| P1-029      | ruff, ruff format and mypy for 3.10 and 3.15 run in CI. vendor:check passes and engine/requirements-vendor.txt is unchanged.                                                                                                                                                                                                                                                                                                                 |
| P1-030      | test_symbols.py: reformatting, reordering, inserted lines, and duplicate ids with the diagnostic.                                                                                                                                                                                                                                                                                                                                            |
| P1-031      | test_modules.py: the src layout and the file-stem fallback.                                                                                                                                                                                                                                                                                                                                                                                  |
| P1-032      | The snapshot helper validates every output. test_positions checks 'Größe 😀' in UTF-16 units.                                                                                                                                                                                                                                                                                                                                                |
| P1-033      | Fixture tests: every code-derived edge has evidence; edge ids are equal across runs and after a reformat.                                                                                                                                                                                                                                                                                                                                    |
| P1-034      | Fact P1-140. The schema's if/then requires the reason, and UnresolvedProps carries a reasonCode.                                                                                                                                                                                                                                                                                                                                             |
| P1-035      | Handler tests assert engineVersion, durationMs, baseRevision and truncated; snapshots normalize durationMs.                                                                                                                                                                                                                                                                                                                                  |
| P1-036      | The DiagnosticCode enum; the webview and host tables render every code in German (WP12, WP20).                                                                                                                                                                                                                                                                                                                                               |
| P1-037      | Engine side: test_props_contract.py validates every props object in all snapshots against NodePropsByKind and EdgePropsByKind. Webview side: propsOf() in documentIndex.ts plus an ESLint rule against direct .props access, so reading a key the contract lacks fails the typecheck.                                                                                                                                                        |
| P1-038      | src/changes tests against a typed fake of the 1.105 git.d.ts. ESLint bans child_process in src/changes. The 'changes' label smoke test (WP13).                                                                                                                                                                                                                                                                                               |
| P1-039      | test/changes: branch_only.py is unchanged with HEAD and modified with mergeBase.                                                                                                                                                                                                                                                                                                                                                             |
| P1-040      | baseResolver.test.ts: the detection order, the validation (leading '-', '..', '@{', .lock) and the not-found message.                                                                                                                                                                                                                                                                                                                        |
| P1-041      | test_changes.py fixture pairs: added, deleted, modified and unchanged.                                                                                                                                                                                                                                                                                                                                                                       |
| P1-042      | test_changes: after a black-style reformat every node is unchanged, with formattingOnly. Also covered by scenario P1-157.                                                                                                                                                                                                                                                                                                                    |
| P1-043      | ClassCard.test checks the ghost style and the '−' text; the changes scenario.                                                                                                                                                                                                                                                                                                                                                                |
| P1-044      | Change and confidence style tests under vscode-high-contrast and vscode-high-contrast-light (WP21–WP23).                                                                                                                                                                                                                                                                                                                                     |
| P1-045      | test_changes: an added call gives an added edge, a removed call a deleted ghost edge.                                                                                                                                                                                                                                                                                                                                                        |
| P1-046      | Webview tests render change markers in every view; test/changes opens each view on the modified fixture.                                                                                                                                                                                                                                                                                                                                     |
| P1-047      | test_props_contract: no node has attribution 'ai' or 'human'.                                                                                                                                                                                                                                                                                                                                                                                |
| P1-048      | test/multiroot (WP26): two repositories plus a folder without Git; each subtree lists only its own repository's changes.                                                                                                                                                                                                                                                                                                                     |
| P1-049      | changeSet.test.ts: UNTRACKED, DELETED and INDEX_RENAMED (originalUri). The engine remaps the module prefix of renamed files.                                                                                                                                                                                                                                                                                                                 |
| P1-050      | test/changes: an unsaved edit makes the node modified; committing the edit makes it unchanged.                                                                                                                                                                                                                                                                                                                                               |
| P1-051      | gitAvailability.test.ts with enabled false and every unavailable reason; the untrusted suite shows the explanation.                                                                                                                                                                                                                                                                                                                          |
| P1-052      | test_class_anatomy plus ClassCard.test: the RetryingClient card shows the base BaseClient; a dataclass fixture shows @dataclass.                                                                                                                                                                                                                                                                                                             |
| P1-053      | Fixture: max_retries has annotation int and default 3.                                                                                                                                                                                                                                                                                                                                                                                       |
| P1-054      | Fixture: _timeout and _cache are assigned on lines 10 and 11; self.late in another method gets attribute-outside-init.                                                                                                                                                                                                                                                                                                                       |
| P1-055      | Fixture: session is listed as inherited from BaseClient.                                                                                                                                                                                                                                                                                                                                                                                     |
| P1-056      | timeout has a getter only; the setter/deleter fixture shows both accessors.                                                                                                                                                                                                                                                                                                                                                                  |
| P1-057      | The fixture's method groups: public get and call_by_name; private _request_with_retry, _send and _log_retry; dunder **init**; property timeout.                                                                                                                                                                                                                                                                                              |
| P1-058      | _send shows '(self, method: str, url: str) -> bytes' and an inferred network badge; the async fixture shows the async flag.                                                                                                                                                                                                                                                                                                                  |
| P1-059      | WP20: handle ids equal port ids, one port per side and row.                                                                                                                                                                                                                                                                                                                                                                                  |
| P1-060      | Facts P1-136 to P1-139, plus the cls.x() fixture.                                                                                                                                                                                                                                                                                                                                                                                            |
| P1-061      | Facts P1-141 to P1-148; a toggle test per edge kind (WP21).                                                                                                                                                                                                                                                                                                                                                                                  |
| P1-062      | The fixture's MRO, the C3 order of the diamond case, and mro-conflict; MroPanel.test.                                                                                                                                                                                                                                                                                                                                                        |
| P1-063      | The nested class and closure fixture: parent ids and a certain call to the closure.                                                                                                                                                                                                                                                                                                                                                          |
| P1-064      | The fixture's matrix cells in test_state_matrix and StateMatrix.test.                                                                                                                                                                                                                                                                                                                                                                        |
| P1-065      | Disjoint halves give 2 parts; RetryingClient gets no hint.                                                                                                                                                                                                                                                                                                                                                                                   |
| P1-066      | _log_retry is marked and gets self-unused.                                                                                                                                                                                                                                                                                                                                                                                                   |
| P1-067      | test_call_graph: the multi-file fixture's node sets for k=1 and k=2, in both directions.                                                                                                                                                                                                                                                                                                                                                     |
| P1-068      | The fixture's call facts are certain with useJedi false.                                                                                                                                                                                                                                                                                                                                                                                     |
| P1-069      | The import-form fixture ('import pkg.mod as m', 'from .sub import f as g', 'from . import x') gives certain edges.                                                                                                                                                                                                                                                                                                                           |
| P1-070      | test_jedi_support: 'c = Client(); c.get()' resolves to Client.get as inferred (resolvedBy jedi) with useJedi true, and stays unresolved (type-resolution-off) with useJedi false.                                                                                                                                                                                                                                                            |
| P1-071      | callHierarchyMerge.test.ts with stubbed commands; callHierarchy.test.ts registers a fake CallHierarchyProvider (WP24); manual check with Pylance and basedpyright.                                                                                                                                                                                                                                                                           |
| P1-072      | Fact P1-140, plus the dict-dispatch fixture.                                                                                                                                                                                                                                                                                                                                                                                                 |
| P1-073      | json.dumps leads to an external json node; self.session.request is unresolved with a reasonCode.                                                                                                                                                                                                                                                                                                                                             |
| P1-074      | test_control_flow: if/elif/else with labeled true and false edges.                                                                                                                                                                                                                                                                                                                                                                           |
| P1-075      | for-else with break, while-else, async for.                                                                                                                                                                                                                                                                                                                                                                                                  |
| P1-076      | Every path reaches finally; except* is tested only on 3.11+.                                                                                                                                                                                                                                                                                                                                                                                 |
| P1-077      | A with node encloses its body.                                                                                                                                                                                                                                                                                                                                                                                                               |
| P1-078      | One edge per case, the guard labeled, the wildcard last.                                                                                                                                                                                                                                                                                                                                                                                     |
| P1-079      | Facts P1-153 to P1-155, plus break, continue and the early-exit flags.                                                                                                                                                                                                                                                                                                                                                                       |
| P1-080      | The RuntimeError raise reaches the exceptional exit.                                                                                                                                                                                                                                                                                                                                                                                         |
| P1-081      | test_module_graph: the expected imports edge set, all certain, with the deferred and typeOnly flags.                                                                                                                                                                                                                                                                                                                                         |
| P1-082      | In a→b→c→a all three edges are cyclic; the legend explains the marker (WP22).                                                                                                                                                                                                                                                                                                                                                                |
| P1-083      | json and os (stdlib) and requests (third party) appear as collapsed nodes.                                                                                                                                                                                                                                                                                                                                                                   |
| P1-084      | test_side_effects: one function per category; a custom file adds a rule and disables a built-in one.                                                                                                                                                                                                                                                                                                                                         |
| P1-085      | Facts P1-151 and P1-152.                                                                                                                                                                                                                                                                                                                                                                                                                     |
| P1-086      | Broken JSON gives rules-file-invalid and the built-in rules still apply; manifest.test checks the jsonValidation entry (WP05).                                                                                                                                                                                                                                                                                                               |
| P1-087      | test_exceptions: get may raise RuntimeError (inferred via _request_with_retry).                                                                                                                                                                                                                                                                                                                                                              |
| P1-088      | test_metrics values: get 2, _request_with_retry 3 with nesting 2. theme.test: the badge CSS uses no warning or error colors.                                                                                                                                                                                                                                                                                                                 |
| P1-089      | pythonDefinitions.test.ts against the pytest-pinned expectations: the anchor is the range.start line including decorators, the name is the selectionRange, and nested functions are included. codeLens.test.ts toggles the setting. The root hook shows the engine idle while lenses render.                                                                                                                                                 |
| P1-090      | codeLens.test.ts (integration): the lens command sets the panel's view and focused node id (hearback._test.graphPanelState).                                                                                                                                                                                                                                                                                                                 |
| P1-091      | manifest.test.ts checks the commands and their nls titles; views.test.ts runs each command on the fixture.                                                                                                                                                                                                                                                                                                                                   |
| P1-092      | manifest.test.ts checks the editor/context and explorer/context when clauses. views.test.ts calls the commands with Uri arguments; a folder scopes the module graph.                                                                                                                                                                                                                                                                         |
| P1-093      | manifest.test.ts checks viewsContainers and views; the CI VSIX check finds media/hearback-activitybar.svg.                                                                                                                                                                                                                                                                                                                                   |
| P1-094      | changesTreeModel.test.ts, and test/changes/changesTree.test.ts with the modified fixture repository.                                                                                                                                                                                                                                                                                                                                         |
| P1-095      | test/changes/changesTree.test.ts: clicking items, ghosts included, sets the panel's view and focused node id.                                                                                                                                                                                                                                                                                                                                |
| P1-096      | changesTree.test.ts (unit): visibility changes and getChildren never call ensureStarted. The integration label, where the parent repository is not opened, shows the welcome content.                                                                                                                                                                                                                                                        |
| P1-097      | graphView.test.ts (WP14) on 1.105.1 and stable: layoutDone arrives through the real blob worker with zero CSP violations. workerBundle.test.ts scans the worker bundle and the concatenated blob.                                                                                                                                                                                                                                            |
| P1-098      | theme.test.ts covers the new classes; both High Contrast themes are checked manually.                                                                                                                                                                                                                                                                                                                                                        |
| P1-099      | webviewHtml.test.ts asserts the exact, unchanged CSP. The views and export integration tests see zero securitypolicyviolation events.                                                                                                                                                                                                                                                                                                        |
| P1-100      | A webview test renders '<img src=x onerror=alert(1)>' as text. SVG and Mermaid escaping tests. changesTree.test.ts with a hostile name containing a Markdown image. The ESLint rule stays.                                                                                                                                                                                                                                                   |
| P1-101      | webviewProtocol.test.ts: the guards reject unknown and oversized messages. graphController.test.ts: an openNode with an unknown id does nothing.                                                                                                                                                                                                                                                                                             |
| P1-102      | navigation.test.ts (integration): after a click, the active editor's URI and selection equal the node's selectionRange (or its range start). This also holds for evidence after non-ASCII text on the same line.                                                                                                                                                                                                                             |
| P1-103      | navigation.test.ts: a selection inside get highlights py:retrying_client.RetryingClient.get. editorSync.test.ts: ranges with a revision are skipped.                                                                                                                                                                                                                                                                                         |
| P1-104      | Search test: typing _send highlights one node, and Enter focuses it.                                                                                                                                                                                                                                                                                                                                                                         |
| P1-105      | Filter test: the toggles hide and restore _-prefixed and **x** members.                                                                                                                                                                                                                                                                                                                                                                      |
| P1-106      | Test of the changes-plus-k=1 filter.                                                                                                                                                                                                                                                                                                                                                                                                         |
| P1-107      | Focus test: focusing get with k=1 shows get, _request_with_retry and _cache.                                                                                                                                                                                                                                                                                                                                                                 |
| P1-108      | Legend test: every kind present in the document is listed.                                                                                                                                                                                                                                                                                                                                                                                   |
| P1-109      | 'Certain only' hides the dashed and dotted edges.                                                                                                                                                                                                                                                                                                                                                                                            |
| P1-110      | collapse.test.ts: 1,000 generated nodes start collapsed, at most maxNodes visible GraphDocument nodes remain (member rows counted), and the warning shows. Expanding a group shows its children.                                                                                                                                                                                                                                             |
| P1-111      | svg.test.ts: the SVG parses with DOMParser, labels are text, and it has no script and no external reference. export.test.ts writes it to a temporary path.                                                                                                                                                                                                                                                                                   |
| P1-112      | export.test.ts: the PNG starts with the PNG signature and has the expected size, with no CSP violation. png.test.ts covers the scale clamp.                                                                                                                                                                                                                                                                                                  |
| P1-113      | Mermaid golden files for the fixture and a hostile-label test; no click or init directives.                                                                                                                                                                                                                                                                                                                                                  |
| P1-114      | json.test.ts validates the export with Ajv.                                                                                                                                                                                                                                                                                                                                                                                                  |
| P1-115      | Keyboard test: Tab reaches a node, Enter sends openNode, Escape leaves search and focus mode.                                                                                                                                                                                                                                                                                                                                                |
| P1-116      | aria-label tests for nodes and edges, in English and German.                                                                                                                                                                                                                                                                                                                                                                                 |
| P1-117      | useViewState test with mocked, throttled getState and setState. viewState.test.ts (integration) hides and shows the panel and finds the same filters and viewport.                                                                                                                                                                                                                                                                           |
| P1-118      | manifest.test.ts: boolean, default true, nls key, listed in restrictedConfigurations. pytest covers both modes. A configuration-change unit test checks that the next request's options change.                                                                                                                                                                                                                                              |
| P1-119      | manifest.test.ts: enum HEAD / mergeBase with localized enumDescriptions.                                                                                                                                                                                                                                                                                                                                                                     |
| P1-120      | manifest.test.ts checks the pattern; baseResolver.test.ts checks the validation.                                                                                                                                                                                                                                                                                                                                                             |
| P1-121      | manifest.test.ts plus the CodeLens toggle tests.                                                                                                                                                                                                                                                                                                                                                                                             |
| P1-122      | manifest.test.ts (default 300, range 50–5,000), the collapse warning test and a live-change unit test.                                                                                                                                                                                                                                                                                                                                       |
| P1-123      | manifest.test.ts (default 2, range 1–10), the focus and changes-filter tests, and a live-change unit test.                                                                                                                                                                                                                                                                                                                                   |
| P1-124      | manifest.test.ts. rulesFile.test.ts covers relative resolution, a missing file and non-regular files; pytest covers the diagnostic.                                                                                                                                                                                                                                                                                                          |
| P1-125      | readme.test.ts compares the settings table with the manifest. WP12 unit tests fire configuration changes for useJedi, maxNodes, defaultHops and rulesFile. Integration tests change codeLens.enabled and diff.base at runtime.                                                                                                                                                                                                               |
| P1-126      | test:untrusted: a view opens in the untrusted fixture, no marker file appears, and the banner says change detection is unavailable. manifest.test.ts asserts restrictedConfigurations.                                                                                                                                                                                                                                                       |
| P1-127      | The CSP has no external source. ruff's banned-api rules and the audit hook guard the engine. noNetwork.test.ts finds no network call or telemetry dependency in src/.                                                                                                                                                                                                                                                                        |
| P1-128      | manifest.test.ts keeps extensionKind ['workspace']; exportFile uses workspace.fs only; the remote row of the manual checklist.                                                                                                                                                                                                                                                                                                               |
| P1-129      | test_e2e stays under 2 s on every OS; realEngine.test.ts runs from the unpacked VSIX. Jedi is imported only by the first call graph.                                                                                                                                                                                                                                                                                                         |
| P1-130      | WP27 perf job on ubuntu-latest, 3.10 and 3.15: classAnatomy with overlays plus diff/compare on the committed 1,000-line file, with a cache miss, 3 warm-ups and 15 runs; the median stays under 300 ms. Jedi is not involved.                                                                                                                                                                                                                |
| P1-131      | Node perf gate (WP14, WP27): the median in-worker layoutMs stays at or under 1.3 s on the pinned corpora with the shipped options; the random port graph is report only. VS Code gate on ubuntu: benchmark documents loaded with hearback._test.showDocument lay out in under 2,000 ms with no long task over 200 ms. The first-view time is reported separately.                                                                            |
| P1-132      | WP27 coverage job: combines the 3.10 and 3.15 data and runs coverage report --include='hearback_engine/python_analysis/*' --fail-under=85.                                                                                                                                                                                                                                                                                                   |
| P1-133      | test_fixture_retrying_client.py asserts P1-134 to P1-156. Snapshots: classAnatomy, callGraph (get, k=2, useJedi false), controlFlow (get, _request_with_retry, call_by_name), moduleGraph and diff/compare (the reformat pair). The VSIX contains no fixture.                                                                                                                                                                                |
| P1-134      | Assert: inherits py:retrying_client.RetryingClient → py:retrying_client.BaseClient, certain, evidence on line 5.                                                                                                                                                                                                                                                                                                                             |
| P1-135      | Assert: overrides RetryingClient.**init** → BaseClient.**init**, certain.                                                                                                                                                                                                                                                                                                                                                                    |
| P1-136      | Assert: calls RetryingClient.**init** → BaseClient.**init** through super(), certain, line 9.                                                                                                                                                                                                                                                                                                                                                |
| P1-137      | Assert: calls get → _request_with_retry, certain, line 20.                                                                                                                                                                                                                                                                                                                                                                                   |
| P1-138      | Assert: calls _request_with_retry → _send, certain, line 27.                                                                                                                                                                                                                                                                                                                                                                                 |
| P1-139      | Assert: calls _request_with_retry → _log_retry, certain, line 29.                                                                                                                                                                                                                                                                                                                                                                            |
| P1-140      | Assert: calls call_by_name → an unresolved node whose reason names getattr (reasonCode dynamic-call), confidence unresolved, line 39, and no certain call from call_by_name.                                                                                                                                                                                                                                                                 |
| P1-141      | Assert: writes **init** → _timeout, certain, line 10.                                                                                                                                                                                                                                                                                                                                                                                        |
| P1-142      | Assert: writes **init** → _cache, certain, line 11.                                                                                                                                                                                                                                                                                                                                                                                          |
| P1-143      | Assert: reads get → _cache, lines 18 and 19.                                                                                                                                                                                                                                                                                                                                                                                                 |
| P1-144      | Assert: mutates get → _cache, certain, line 21.                                                                                                                                                                                                                                                                                                                                                                                              |
| P1-145      | Assert: reads timeout → _timeout, line 15, and the property has no writes.                                                                                                                                                                                                                                                                                                                                                                   |
| P1-146      | Assert: reads _send → _timeout, line 33.                                                                                                                                                                                                                                                                                                                                                                                                     |
| P1-147      | Assert: reads _send → py:retrying_client.BaseClient.session, certain (assigned on line 2).                                                                                                                                                                                                                                                                                                                                                   |
| P1-148      | Assert: reads _request_with_retry → py:retrying_client.RetryingClient.max_retries, line 25.                                                                                                                                                                                                                                                                                                                                                  |
| P1-149      | Assert: catches TimeoutError, certain, line 28.                                                                                                                                                                                                                                                                                                                                                                                              |
| P1-150      | Assert: raises RuntimeError, certain, line 30.                                                                                                                                                                                                                                                                                                                                                                                               |
| P1-151      | Assert: _log_retry has side effect output (print), certain, line 36.                                                                                                                                                                                                                                                                                                                                                                         |
| P1-152      | Assert: _send has side effect network, inferred, rule network.request-methods, line 33.                                                                                                                                                                                                                                                                                                                                                      |
| P1-153      | Assert: the CFG has a loop whose body is a try with a TimeoutError handler, and the handler flows back to the loop.                                                                                                                                                                                                                                                                                                                          |
| P1-154      | Assert: the return inside the try leads to the exit.                                                                                                                                                                                                                                                                                                                                                                                         |
| P1-155      | Assert: loopDone leads to the RuntimeError raise, which reaches the exceptional exit.                                                                                                                                                                                                                                                                                                                                                        |
| P1-156      | Assert: self-unused only on py:retrying_client.RetryingClient._log_retry, plus the matrix marker.                                                                                                                                                                                                                                                                                                                                            |
| P1-157      | The test/changes scenario (edit _send, delete _log_retry, reformat get), plus the same text pairs in test_changes.                                                                                                                                                                                                                                                                                                                           |
| P1-158      | navigation.test.ts in both directions.                                                                                                                                                                                                                                                                                                                                                                                                       |
| P1-159      | The WP27 gates for P1-129 to P1-132 fail on violations, and the activation tests for P1-016 and P1-017 pass.                                                                                                                                                                                                                                                                                                                                 |
| P1-160      | docs/manual-test-checklist.md, filled in by the owner for VS Code, Cursor and VSCodium; Windsurf and Kiro best effort.                                                                                                                                                                                                                                                                                                                       |
| P1-161      | The CI artifact hearback-0.1.0.vsix is built with --pre-release and passes the PreRelease manifest check. The release environment's approval gates publishing.                                                                                                                                                                                                                                                                               |
| P1-162      | release.yml packages once and logs the SHA-256 once; SHA256SUMS is verified before both publishes.                                                                                                                                                                                                                                                                                                                                           |
| P1-163      | After D18 the publish step uses vsce --oidc. docs/releasing.md documents the policy and the manual-upload fallback.                                                                                                                                                                                                                                                                                                                          |
| P1-164      | docs/releasing.md: the namespace lldeters exists and is verified; npx --yes ovsx@1.3.0. The first version uses OVSX_PAT as a release-environment secret or a manual upload, then trusted publishing.                                                                                                                                                                                                                                         |
| P1-165      | workflows.test.ts checks SHA pins, minimal permissions, id-token only in the publish job, and the environment. actionlint 1.7.12 runs in CI if approved.                                                                                                                                                                                                                                                                                     |
| P1-166      | versions.test.ts at 0.1.0; the VSIX is a pre-release at 0.1.0.                                                                                                                                                                                                                                                                                                                                                                               |
| P1-167      | The CI package checks (no tests, fixtures, source maps or bytecode; at most 2,000 files; complete content; vendored check) plus the size report against the 12 MB budget.                                                                                                                                                                                                                                                                    |
| P1-168      | vsce accepts the README. readme.test.ts: images are PNG files that exist, no SVG, no http://. SECURITY.md is updated.                                                                                                                                                                                                                                                                                                                        |
| P1-169      | WP00 re-checked on 2026-11-05: lldeters.hearback and the name Hearback are free on both registries. docs/releasing.md repeats the check at release time.                                                                                                                                                                                                                                                                                     |
