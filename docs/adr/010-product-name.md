# ADR 010: Product name Hearback

- Status: Accepted
- Date: 2026-11-04

## Context

Phase 0 was built under the working title Readback: extension ID `lldeters.readback-code`, display
name "Readback – Understand AI-Written Code", settings and commands under `readback.`. Nothing has
been released. Before the first release the owner found the name taken in the Visual Studio
Marketplace:

- `speechify.readback`, display name "Readback", from the verified publisher Speechify, published
  since September 2026. It reads the replies of AI coding agents aloud, so it serves the same
  audience in the same niche.
- The Marketplace requires every extension name to be unique, and the same rule applies to display
  names (FAQ of
  [Publishing Extensions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)).
  The extension's package name and display name differed from Speechify's only by a suffix and a
  subtitle, so the product would have shared its name with an established extension for the same
  users: confusing in search results, reviews and support, and a name the project could never own.
- A search on 2026-11-04 found no extension called Hearback in the Visual Studio Marketplace or on
  Open VSX.

On 2026-11-04 the owner chose Hearback from three options: Hearback, keeping Readback with the
distinct display name, and "Readback Code".

## Decision

- The product is called **Hearback**. In aviation, pilots read safety-critical clearances back to
  air traffic control (the readback); the controller listens and corrects any mistake (the
  hearback). Hearback takes the controller's part for AI-written code: the AI delivers the code,
  the developer reads it back through visualizations and checks, and Hearback verifies that
  understanding against static analysis.
- Every identifier follows: package name `hearback` (extension ID `lldeters.hearback`; the
  publisher stays `lldeters`), display name "Hearback – Understand AI-Written Code" ("Hearback –
  KI-geschriebenen Code verstehen" in German), command category `Hearback`, commands `hearback.*`
  and hidden test commands `hearback._test.*`, settings `hearback.*`, `globalState` keys
  `hearback.*`, the output channel and log "Hearback", the view type `hearback.graph`, CSS custom
  properties `--hearback-*` and the boot element `hearback-boot`, environment variables
  `HEARBACK_*`, the engine package `engine/hearback_engine/` with its `hearback.*` loggers, the
  fatal startup line `HEARBACK_ENGINE_FATAL`, the per-repository work folder `.hearback/` and the
  VSIX that CI builds, `hearback.vsix`. Every other name that the specification spells with
  readback uses hearback as well, for example the side bar "Hearback" (Phase 1), the comment
  `-- hearback: dialect=…` in SQL files (Phase 2) and the hook script
  `.hearback/bin/hearback_hook.py`, in the repository `hooks/hearback_hook.py` (Phase 4).
- **What stays:** the GitHub repository `lldeters/Readback` and its URLs (`repository`, `bugs` and
  `homepage` in `package.json`, the schemas' `$id`, links in the documentation) until the owner
  renames the repository; the slogan **Readback correct.**, the phrase with which the controller
  may confirm a correct readback and so exactly Hearback's role; and the aviation term readback
  where the name story uses it.
- `PROTOCOL_VERSION` and `schemaVersion` stay 1. The fatal startup prefix is a contract between
  `run_engine.py` and the extension, which always ship together, and both sides changed in the
  same commit; the JSON-RPC payloads and the graph schema are unchanged apart from descriptions.

## Consequences

- Nothing is migrated: no version was released, so no user has settings, `globalState` entries or
  a work folder under the old names.
- Nothing reserves the name before the first release: until then another publisher could publish
  an extension called Hearback in the Visual Studio Marketplace.
- The name suggests listening, which is near what `speechify.readback` offers ("Hear your AI coding
  agent's replies in a Speechify voice…"); the subtitle "Understand AI-Written Code" and the
  visualizations set Hearback apart. The slogan "Readback correct." (specification section 1)
  contains the other extension's name; it stays because it is the aviation phrase for a confirmed
  readback.
- The earlier records (ADR 001 to 009) and the other documents use the new names. This is an
  editorial change; their decisions and dates stay as they were.
- Repository name and product name differ until the repository is renamed. GitHub then redirects
  the old URLs, and the URLs listed above are updated in one change.

## Alternatives considered

- **Keeping Readback** with the package name `readback-code` and the subtitle in the display name:
  even if the Marketplace accepted these identifiers, the product would share its name with an
  established extension for the same audience.
- **"Readback Code"** as the display name with the ID `lldeters.readback-code`: a little more
  distance, but still next to Speechify's extension in search results.
- **Other aviation terms**, checked in the Visual Studio Marketplace and on Open VSX on
  2026-11-04: Crosscheck (pilots cross-check each other's actions and readings) and Walkaround (the
  inspection around the aircraft before a flight) were free and do not suggest listening, but they
  lose the link to the readback and its slogan. Debrief and Preflight are taken by extensions for
  AI-written code.
- **Renaming the GitHub repository at the same time:** left to the owner; the redirects make the
  timing uncritical.
- **Migrating `readback.*` settings and state:** unnecessary, since nothing was released.
- **A name without the aviation story:** would lose the link to the slogan and to the readback
  idea that the comprehension checks build on.
