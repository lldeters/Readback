# ADR 009: License policy and the license gate

- Status: Accepted
- Date: 2026-10-31

## Context

Readback is MIT-licensed. Spec section 0.5 allows only licenses compatible with MIT and names MIT,
BSD and Apache 2.0. The dependencies the research selected are more varied:

- parso contains PSF-2.0 files (its `pgen2` package, `tokenize.py` and `token.py`), and jedi's
  bundled typeshed is Apache-2.0 with MIT parts. The d3 packages under `@xyflow/react` are ISC.
- elkjs 0.12.1 is licensed `EPL-2.0 OR GPL-3.0-or-later`. Of the JavaScript layout libraries the
  research compared, only ELK combines a layered layout with ports and robust nesting (dagre,
  d3-dag and WebCola lack one or the other; the Apache-2.0 maxGraph was not evaluated). Shipping it
  unmodified in an MIT extension
  brings EPL-2.0 duties: state that the code is available under EPL-2.0 and how to obtain its
  source (section 3.1(a)), ship a copy of the license, and keep its notices (section 3.3). esbuild's
  minification removes elkjs's copyright headers, so these duties cannot be left to the bundle.
- ovsx, the Open VSX publishing tool, is EPL-2.0 but is never shipped. `@vscode/codicons` is
  CC-BY-4.0.
- esbuild merges npm packages into a few files, so only the bundles themselves show which packages
  are shipped. Some packages omit their license text: `@vscode/l10n` 0.0.18 declares MIT but its
  npm package contains no license file.

## Decision

- **Readback is MIT** (`LICENSE`).
- **Shipped dependencies may use any permissive license.** The allowlist, as SPDX identifiers:
  MIT, ISC, BSD-2-Clause, BSD-3-Clause, Apache-2.0, 0BSD, PSF-2.0, Python-2.0, Zlib,
  BlueOak-1.0.0, CC0-1.0 and Unlicense.
- **elkjs is the only documented exception.** From Phase 1 Readback uses it under EPL-2.0 and
  fulfills the obligations: the elkjs files are shipped unmodified as separate files, not bundled
  with Readback's code; its license text (`LICENSE.md`) is shipped; `THIRD_PARTY_NOTICES.md` states
  that elkjs is used under EPL-2.0 and links its source for the shipped version
  (`https://github.com/kieler/elkjs/tree/<version>`) and the Eclipse Layout Kernel it is built
  from (`https://github.com/eclipse-elk/elk`); its notices are kept. Readback's own code that calls
  elkjs remains MIT.
- **Dev-only tools that are not shipped are not affected**, for example ovsx (EPL-2.0), which runs
  through `npx` in the release job and is not a dependency. Assets under other licenses, such as the
  codicons font, are not shipped.
- **The license gate** is `scripts/notices.mjs`:
  - It reads the esbuild metafiles (`out/meta/*.json`) and maps every input file that contributes
    bytes to a bundle to its npm package root (scoped packages and nested `node_modules` included),
    and it reads `engine/vendor/VENDOR.json` for the vendored Python packages.
  - Files that reach the VSIX without esbuild, such as the elkjs files from Phase 1, must be
    described in the same metafile format (an `out/meta/<name>.json` whose outputs list their
    `node_modules` inputs) and added to the generator's metafile list, so the gate sees them too.
  - It evaluates each declared SPDX expression against the allowlist: `OR` needs one allowed
    alternative, `AND` needs all parts, parentheses group, and a `WITH` term must be allowed as a
    whole. Missing, invalid and unknown licenses fail.
  - An exception (`NPM_LICENSE_EXCEPTIONS`) applies only to its package and only to the exact
    expression that was approved, so a license change in a new version fails again.
  - Every package needs its license text: the npm package's `LICENSE`, `LICENCE` or `COPYING` file
    (optionally `.md` or `.txt`), the license files listed in `VENDOR.json`, or for a package that
    omits it, a verbatim copy from its repository in `SUPPLEMENTARY_LICENSE_TEXTS`.
  - It writes `THIRD_PARTY_NOTICES.md` deterministically: sorted, with name, version, license,
    source URL and the full license text of each package.
  - `npm run notices:check` regenerates the file in memory and fails when the gate fails or the
    committed file differs. It runs in `vscode:prepublish` and therefore in every
    `vsce package`, including the CI package job.

## Consequences

- License compliance is checked mechanically whenever a VSIX is built, and the notices always match
  what the bundles contain, including transitive dependencies.
- A dependency under a permissive license that is not yet on the list needs this ADR and the
  allowlist updated; a non-permissive one needs an explicit exception with its own decision.
- `THIRD_PARTY_NOTICES.md` has to be regenerated (`npm run build:prod && npm run notices`) after
  dependency changes; CI fails until it is.

## Alternatives considered

- **Only MIT, BSD and Apache-2.0, as the spec lists them:** would exclude parso (PSF-2.0 parts), the
  ISC-licensed d3 packages and elkjs, with no maintained replacements of the same quality.
- **dagre instead of elkjs:** avoids the exception but gives weaker class-anatomy layouts
  ([ADR 008](008-webview.md)).
- **Tools that scan `node_modules`** (license-checker and similar): they list what is installed,
  including dev dependencies, not what esbuild bundled; the metafiles are exact.
- **Hand-written notices:** drift from the actual bundles.
