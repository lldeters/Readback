# ADR 007: Vendoring the engine's Python dependencies

- Status: Accepted
- Date: 2026-10-31

## Context

Spec section 5.2: sqlglot and Jedi (with parso) are bundled into `engine/vendor/` as pure Python
packages with fixed versions and their license files; nothing is installed with pip at runtime;
`scripts/vendor_engine.py` creates the folder reproducibly. The research found:

- sqlglot 30.27.0, jedi 0.20.1 and parso 0.8.7 are pure `py3-none-any` wheels (`Root-Is-Purelib:
true`, no `.data` directories). sqlglot's compiled speed-ups are opt-in (`sqlglot[c]`).
- The jedi wheel has 5,626 files: its bundled typeshed has 5,058 (4,314 of them in
  `typeshed/stubs/`, the third-party stubs) and django-stubs 478. vsce warns above 5,000 files.
  Without the third-party stubs and django-stubs, all three packages come to about 1,060 files
  (6.7 MiB, about 1.8 MiB compressed), and Jedi's inference for the standard library still works.
- pip in hash-checking mode aborts on a tampered wheel. Unzipping a pure wheel gives the same files
  as `pip install --target`, without the extra metadata, the rewritten `RECORD` and the bytecode
  that pip adds.
- Microsoft's Python tools template excludes the `*.dist-info` folders from its VSIX, which drops
  the license files.

## Decision

- `engine/requirements-vendor.txt` pins `sqlglot==30.27.0`, `jedi==0.20.1` and `parso==0.8.7`, each
  with its wheel's SHA-256, which puts pip into hash-checking mode.
- `scripts/vendor_engine.py` (`npm run vendor`) downloads the pure wheels into
  `.cache/vendor-wheels`, unzips them into `engine/vendor/`, removes `jedi/third_party/typeshed/stubs`
  and `jedi/third_party/django-stubs`, keeps every license file (the `*.dist-info` folders and the
  license files inside the packages) and writes `engine/vendor/VENDOR.json` with each package's
  name, version, wheel, SHA-256, license, license files, removed paths and file count.
  `--check` (`npm run vendor:check`) verifies an existing folder.
- `engine/vendor/` is not committed (`.gitignore`). Development, CI and packaging run the script;
  CI caches the wheels keyed by the hash of the requirements file. The VSIX includes
  `engine/vendor/**`, license files included.
- `THIRD_PARTY_NOTICES.md` lists the vendored packages from `VENDOR.json`
  ([ADR 009](009-license-policy.md)).
- A version is only upgraded in a pull request that reruns the fixture snapshot tests, because
  sqlglot releases often and changes parse trees.

## Consequences

- The supply chain is pinned by hashes, the vendored files are exactly the published ones minus a
  documented list of removed paths, and no generated files end up in Git.
- The vendored part of the VSIX stays small and below vsce's file warning.
- Jedi has no bundled type information for third-party packages, and under `-S` it does not see
  site-packages ([ADR 003](003-engine-sandbox.md)); third-party calls stay `unresolved` or
  `inferred` unless Phase 1 passes environment paths.
- Every fresh checkout needs `npm run vendor`, which downloads from PyPI, before the engine can run.

## Alternatives considered

- **Committing `engine/vendor/`:** over a thousand generated files in Git and noisy upgrade diffs.
- **`pip install --target`:** adds `INSTALLER`, `REQUESTED` and `direct_url.json`, rewrites
  `RECORD` and byte-compiles; unzipping is simpler to audit.
- **Keeping the full typeshed:** about 5,900 files, a vsce warning and a larger VSIX that installs
  more slowly, especially on Windows with virus scanning.
- **Installing at runtime with pip:** needs network access and is not reproducible; the spec
  forbids it.
- **The compiled sqlglot build:** platform-specific wheels would require one VSIX per platform.
