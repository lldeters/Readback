# ADR 008: Webview: CSP, workers, theme and localization

- Status: Accepted
- Date: 2026-10-31

## Context

Spec section 5.5 asks for React and TypeScript bundled with esbuild, graphs with `@xyflow/react`,
an ELK layout in a Web Worker, VS Code theme variables including high contrast, a strict Content
Security Policy with a nonce, no external resources, no `eval` and identifiers rendered as text.
Section 8 adds that the extension host passes the webview's strings through. The research found:

- The [VS Code webview guide](https://github.com/microsoft/vscode-docs/blob/main/api/extension-guides/webview.md)
  allows workers only from `data:` or `blob:` URLs, and worker scripts cannot use `importScripts`
  or `import()`. Since VS Code 1.118, requests from a worker to webview resources hang
  ([microsoft/vscode#315494](https://github.com/microsoft/vscode/issues/315494), still open).
- React 19.3 and `@xyflow/react` 12.12 need neither `'unsafe-inline'` nor `'unsafe-eval'`: they set
  styles through the CSSOM and work with their CSS loaded as a file.
- VS Code defines a `--vscode-*` variable only when the active theme has that color
  (`contrastBorder`, for example, only in high contrast themes).
- `@vscode/l10n` works in the browser when it is configured with the bundle's contents.
- `@vscode/codicons` is CC-BY-4.0 and `@vscode/webview-ui-toolkit` is deprecated.
- elkjs 0.12.1 is licensed `EPL-2.0 OR GPL-3.0-or-later`, and esbuild's minification strips its
  copyright headers ([ADR 009](009-license-policy.md)).

## Decision

- **Stack:** React 19.3 and `@xyflow/react` 12.12, bundled by esbuild as an IIFE for Chromium 138,
  with the CSS emitted as `dist/webview/main.css` and loaded through a `<link>`.
- **CSP**, exactly:
  `default-src 'none'; script-src 'nonce-<NONCE>'; style-src <cspSource>; connect-src <cspSource>; worker-src blob:; base-uri 'none'; form-action 'none';`
  with a fresh nonce for every rendered document. The page has no inline script or style; the boot
  data (view, locale, l10n bundle, worker URI) travels as HTML-escaped JSON in a `data-boot`
  attribute.
- **Workers only from `blob:` URLs:** the page fetches the worker script, creates a Blob URL and
  starts a classic worker. The worker bundle is self-contained and never loads anything itself.
- **Theme:** CSS only, through `--vscode-*` variables with fallbacks, the theme classes on `<body>`
  and rules for high contrast and reduced motion. The change status is always shown by a symbol
  and a line style as well as by color.
- **Localization:** `l10n.t()` from `@vscode/l10n`, configured with the bundle the host passes in
  the boot data, before the first render.
- **Phase 0** shows an empty React Flow canvas and checks the worker with a ping (approved
  addition). The page reports `ready`, `workerReady`, CSP violations (`securitypolicyviolation`)
  and errors to the host, so an integration test can prove the setup in a real VS Code.
- **Panel options:** no forms, no command URIs, `localResourceRoots` limited to `dist/webview`, no
  `retainContextWhenHidden` (the page announces itself with `ready` after every reload), and every
  message is validated on arrival.
- **elkjs arrives in Phase 1** and is then shipped as its unmodified files, separate from the
  bundles, with its license text and a source link.

## Consequences

- No CSP relaxation is needed, and violations are visible to the tests.
- The worker must stay a single self-contained file, and libraries that load code or data inside a
  worker cannot be used as they are.
- Icons and controls are Readback's own, since the codicons font is not permissively licensed and
  the toolkit is deprecated.
- Hidden panels are rebuilt when shown again, so view state has to be restored from the host or
  from the webview's saved state.

## Alternatives considered

- **`'unsafe-inline'` for styles:** not needed.
- **Starting the worker from its webview resource URL:** not supported by VS Code.
- **Module workers:** no benefit for a self-contained bundle, and untested in VS Code.
- **`retainContextWhenHidden`:** keeps every hidden panel's page in memory.
- **dagre (MIT) instead of elkjs:** no ports, so class-anatomy edges cannot attach to member rows,
  and its nested layout failed on most 300-node test graphs.
- **A string table built by the host with `vscode.l10n.t`:** equally compliant, but more
  boilerplate than one extraction pipeline for host and webview.
- **`@vscode/webview-ui-toolkit`:** deprecated.
