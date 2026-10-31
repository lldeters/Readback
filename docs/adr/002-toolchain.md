# ADR 002: TypeScript 6, ESLint 10, esbuild targets, Vitest 5 and Node 24

- Status: Accepted
- Date: 2026-10-31

## Context

- `engines.vscode` is `^1.105.0`. The oldest matching runtime is Electron 37 with Node 22.19 and
  Chromium 138. Cursor reports its VS Code version as an extension API level, and its Electron can
  be older than upstream's for that level, so Node 24 is not guaranteed even with a higher floor.
  Cursor 2.1 to 2.3 could not load ESM extensions.
- npm's `typescript@latest` is 7.0, the native Go port. It has no JavaScript compiler API
  (`require('typescript')` exposes only the version), and typescript-eslint 8.72.1 accepts only
  `typescript <6.1.0`. TS 7 support in typescript-eslint is still open
  ([typescript-eslint#10940](https://github.com/typescript-eslint/typescript-eslint/issues/10940)).
- TypeScript 6 changed defaults: `types` is `[]`, `target` is es2025, `strict` is on.
- vsce refuses to package when `@types/vscode` is newer than `engines.vscode`.
- jsdom 30 needs Node 22.22.2, 24.15 or newer; Node 20 is end of life.
- All of the chosen tools were installed together in a probe project and run end to end: type
  check, typed linting, Prettier, the three esbuild bundles, Vitest with coverage and
  `vsce package --pre-release`.

## Decision

- **TypeScript 6.0.3**, pinned exactly. Each code area has its own `tsconfig.json` (`src/`,
  `webview/`, `webview/worker/`, `test/`, `test/repo/`) on top of `tsconfig.base.json` with
  `strict`, `noUncheckedIndexedAccess`, `module: preserve` with bundler resolution and explicit
  `types` and `lib` (`es2024`, plus `dom` or `webworker` where needed).
- **ESLint 10** with a flat config: typescript-eslint's `strictTypeChecked` and
  `stylisticTypeChecked` presets with the project service, `eslint-plugin-react-hooks` for the
  webview, `no-eval`, rules that keep analyzed identifiers out of HTML, and
  `eslint-config-prettier` last. **Prettier** (`singleQuote`, `printWidth` 100) runs separately.
- **esbuild 0.28.2** builds three bundles: the extension as CommonJS for `node22` (`vscode`
  external), the webview as an IIFE for `chrome138` with its CSS as a separate file, and the layout
  worker as a self-contained IIFE for `chrome138`. Development builds have linked source maps,
  production builds are minified without them, and every build writes its metafile to `out/meta/`.
- **Vitest 5.0.5** with three projects: `extension` (node, `vscode` aliased to a stub), `webview`
  (jsdom with polyfills) and `repo` (node). V8 coverage. The config file is `vitest.config.mts`,
  because a `.ts` config triggers Vite 8's CommonJS warning.
- **`@vscode/test-cli` 0.0.15 and `@vscode/test-electron` 3.1.0** with Mocha for integration tests,
  against VS Code 1.105.1 and stable.
- **Node 24** for development and CI (`.nvmrc`), but `@types/node` 22.20.5 to match the oldest
  extension host, and `@types/vscode` 1.105.0 to match `engines.vscode`.
- Every dependency is pinned to an exact version, with `package-lock.json` committed.
  `@vscode/vsce` 4.1.0 is a dev dependency; `ovsx` is not a dependency and runs through `npx` in the
  release job only.

## Consequences

- Typed linting works, and type checking per folder catches APIs that the extension host, the
  webview or the worker does not have.
- TypeScript 6.0 is the last line with the JavaScript API. Migrating to TypeScript 7 becomes due
  once typescript-eslint supports it; the current tsconfigs already type-check with 7.0.
- Several tools are still 0.x (esbuild, `@vscode/test-cli`, `@vscode/l10n`), where a minor release
  can break. Update them in groups and keep `vitest` and `@vitest/coverage-v8` in lockstep.
- Unit tests run on Node 24 while the extension host runs Node 22. `@types/node` 22, the `es2024`
  lib and the integration tests at VS Code 1.105.1 keep newer APIs out.

## Alternatives considered

- **TypeScript 7:** much faster, but no typed linting until typescript-eslint supports it.
- **webpack, Rollup or Vite library mode:** slower or more configuration for the same three
  bundles; esbuild is also what the official extension generator uses.
- **Jest:** weaker native support for ESM and TypeScript; Vitest runs the node and jsdom projects
  from one configuration.
- **An ESM extension bundle:** not loadable by Cursor 2.1 to 2.3.
- **Node 22 for development:** below jsdom 30's minimum on many 22.x releases; Node 20 is end of
  life.
- **`eslint-plugin-react`:** does not install with ESLint 10.
