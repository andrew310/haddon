# Haddon Roadmap

This roadmap turns the e-reader north-star research into dependency-ordered tickets. Haddon is a normalized, citation-addressable reading engine embedded in Klemata, with Remix 3 as the host application.

Related documents:

- [E-Reader North-Star Research Brief](research/2026-08-13-e-reader-north-star.md)
- [Wave 1 E-Reader Reconnaissance](research/2026-08-13-wave-1-reconnaissance.md)

## Working Rules

- Run no more than three subagents concurrently.
- Keep concurrent tickets in separate files or subsystems.
- A ticket is complete only when its acceptance criteria are verified.
- Persist source identity before adding more presentation features.
- Treat semantic DOM as the default web rendition and canvas as an optional backend.
- Keep Haddon core and navigator APIs independent of Remix internals.
- Record the provenance and license of every borrowed behavior, fixture, or code pattern.

## Status Legend

- `[ ]` queued
- `[~]` in progress
- `[x]` complete
- `[?]` blocked or needs a decision

## Milestone 0: Complete the Research Set

### HADDON-001 — Vendor the current Readium Web sources

- [x] Add `readium/ts-toolkit` and `edrlab/thorium-web` under `repos/` as shallow, squashed Git subtrees.
- **Depends on:** nothing
- **Acceptance:** both source trees and license files are present; subtree metadata is recorded; the Haddon worktree is otherwise unchanged.

### HADDON-002 — Map the Readium Web and Thorium boundaries

- [x] Trace shared model, navigator, injectables, reader components, state, preferences, decorations, and host integration.
- **Depends on:** HADDON-001
- **Output:** `docs/research/readium-web-ui-boundary.md`
- **Acceptance:** exact source references distinguish engine behavior from application UI and identify the seams Klemata needs.

### HADDON-003 — Establish a provenance ledger

- [x] Create a living ledger for architectural ideas, behavior/test cases, fixtures/data, and code candidates.
- **Depends on:** nothing
- **Output:** `docs/research/gems-ledger.md`
- **Acceptance:** every entry contains source path, repository, license, intended use, and whether independent reimplementation is required.

## Milestone 1: Prove Citation Identity

This milestone is the first implementation gate. It must pass before Haddon expands its renderer or application UI.

### HADDON-010 — Create the awkward citation EPUB fixture

- [x] Build one minimal two-spine EPUB source fixture containing a nested TOC, landmarks, page list, ordinary fragment link, note, emphasis, language change, image with alt text, nonlinear item, and exact quote context.
- **Depends on:** nothing
- **Acceptance:** the fixture can be reproducibly packaged in tests; every deliberate edge case is documented; the fixture contains only project-owned or clearly licensed material.

### HADDON-011 — Specify `Publication`, `Manifest`, and resource contracts

- [x] Define the canonical publication graph, reading order, resources, navigation collections, lazy resource access, volume/edition identity, lifecycle, and invariants.
- **Depends on:** Wave 1 reconnaissance
- **Output:** `docs/design/publication-model.md`
- **Acceptance:** Rust and portable TypeScript sketches agree semantically; chapter indices are not canonical identities; missing capabilities and cleanup are explicit.

### HADDON-012 — Specify the locator envelope

- [x] Define serialized source, normalized, structural, textual, and progression selectors plus resolution confidence and ambiguity.
- **Depends on:** HADDON-011
- **Output:** locator section in `docs/design/publication-model.md`
- **Acceptance:** href is the primary resource identity; offset units and normalization revisions are explicit; fallback order is deterministic.

### HADDON-013 — Specify normalized resources and source maps

- [x] Define deterministic normalized node identity, semantic block/inline primitives, transformation revisions, and bidirectional source-map segments.
- **Depends on:** HADDON-011, HADDON-012
- **Output:** `docs/design/normalized-document.md`
- **Acceptance:** every addressable normalized node maps to source evidence; unsupported semantics produce warnings instead of disappearing.

### HADDON-014 — Define services, capabilities, errors, and warnings

- [x] Specify optional normalization, locator, search, positions, and rendition capabilities along with typed fatal errors and accumulated recoverable warnings.
- **Depends on:** HADDON-011
- **Acceptance:** publications can truthfully lack a capability; cancellation and cleanup are represented; partial success is observable.

### HADDON-015 — Implement the publication/resource skeleton

- [x] Split canonical publication/resource responsibilities from the current normalized `EpubDocument` and WASM `EpubReader`.
- **Depends on:** HADDON-011, HADDON-014
- **Acceptance:** a test opens HADDON-010 lazily, exposes manifest and navigation data, reads resource ranges, and closes deterministically.

### HADDON-016 — Implement and serialize `PublicationLocator`

- [x] Add locator types and lossless Rust JSON serialization (WASM/JS bindings deferred).
- **Depends on:** HADDON-012, HADDON-015
- **Acceptance:** Unicode offset semantics are tested; invalid progression/position data fails or is ignored according to the contract; JSON round trips are stable.

### HADDON-017 — Implement normalized source mapping

- [x] Produce normalized resources with deterministic node IDs and mappings to source href/fragment/ranges.
- **Depends on:** HADDON-013, HADDON-015
- **Acceptance:** ordinary links, element IDs, notes, and text context in HADDON-010 survive normalization and map both directions.

### HADDON-018 — Pass the citation round-trip acceptance test

- [x] Prove `source locator -> normalized range -> serialized citation -> reopen -> same passage -> source locator`.
- **Depends on:** HADDON-010, HADDON-016, HADDON-017
- **Acceptance:** structural resolution works on the original normalizer revision; quote/context recovery works after a harmless revision changes normalized structure; confidence and ambiguity are reported.

## Milestone 2: Build the Publication and Normalization Core

### HADDON-020 — Harden archive and resource access

- [ ] Implement virtual-root path safety, URL normalization, ranged reads, missing-resource behavior, MIME handling, and explicit compressed/uncompressed limits.
- **Depends on:** HADDON-015
- **Acceptance:** traversal, decompression, resource-count, and oversized-XML tests pass; ZIP and exploded fixtures expose equivalent behavior.

### HADDON-021 — Preserve the full EPUB package graph

- [ ] Parse metadata, manifest, reading order, nonlinear items, fallback chains, rendition hints, EPUB 2 NCX, EPUB 3 nav, TOC, landmarks, and page list.
- **Depends on:** HADDON-015, HADDON-020
- **Acceptance:** manifest order and spine order remain distinct; fallback cycles terminate; multiple package candidates are handled deterministically.

### HADDON-022 — Implement the semantic HTML normalizer

- [ ] Normalize sections, headings, paragraphs, lists, quotations, code, tables, figures, captions, links, notes, inline semantics, language, direction, ruby, and media references.
- **Depends on:** HADDON-013, HADDON-017, HADDON-021
- **Acceptance:** supported semantics and source mappings survive malformed but recoverable HTML; unsupported constructs produce structured warnings.

### HADDON-023 — Define normalization profiles and style policy

- [ ] Specify what default, accessible, and source-faithful profiles preserve, constrain, replace, or refuse.
- **Depends on:** HADDON-022
- **Output:** `docs/design/normalization-policy.md`
- **Acceptance:** typography cleanup is separated from semantic transformation; fixed-layout and spatial content have explicit fallback policy.

### HADDON-024 — Add lazy normalization and incremental indexing

- [ ] Normalize spine resources on demand and make whole-book indexing cancellable and resumable.
- **Depends on:** HADDON-020, HADDON-022
- **Acceptance:** opening a book does not parse or shape the whole spine; resources and temporary URLs have deterministic ownership.

### HADDON-025 — Rebuild search on normalized text and locators

- [ ] Return locator-backed results with exact quote context and correct Unicode handling.
- **Depends on:** HADDON-016, HADDON-022, HADDON-024
- **Acceptance:** multiple matches per block, case folding, diacritics, and Unicode expansion cannot produce invalid offsets.

## Milestone 3: Framework-Neutral Web Navigator

### HADDON-030 — Define the navigator package contract

- [x] Specify mount/unmount, open/close, go-to-locator, current-location events, preferences, selection, decorations, link events, warnings, and cancellation.
- **Depends on:** HADDON-002, HADDON-011, HADDON-012
- **Output:** `docs/design/navigator-api.md`
- **Acceptance:** the contract uses Web APIs and plain serializable values; it has no Remix- or React-specific dependency.

### HADDON-031 — Render normalized resources as semantic DOM

- [x] Mount one normalized spine resource with semantic elements, safe resources, selectable text, and source attributes needed for locator mapping. (Demo HTML reader + citation jump. Full navigator package still later.)
- **Depends on:** HADDON-022, HADDON-030
- **Acceptance:** native selection, keyboard traversal, copy, links, images, and an accessibility-tree smoke test work without a parallel canvas hit-test system.

### HADDON-032 — Implement visible-location tracking

- [ ] Convert viewport visibility and DOM ranges into durable publication locators.
- **Depends on:** HADDON-016, HADDON-031
- **Acceptance:** resizing, theme changes, and font changes preserve the logical location and emit a new rendition location.

### HADDON-033 — Implement selection and decorations

- [x] Expose selections as locators and render grouped citations, highlights, search results, and annotations. (Thin MVP: selection → locator, active-citation decoration, remount-stable identity. Full grouped decorations and annotation persistence deferred.)
  - [x] Range-accurate decorations: decorations now paint the exact text range specified by start/end offsets, not the entire block element. Uses span wrapping for precise highlighting.
  - [~] Source drawer: intercept in-text citation/noteref clicks and open a side drawer showing the source content instead of navigating away. First-cut implementation for the demo.
- **Depends on:** HADDON-018, HADDON-031, HADDON-032
- **Acceptance:** decoration identity is independent of DOM element instances and can be restored after remounting.

### HADDON-034 — Add scrolling and paginated modes

- [ ] Support continuous scrolling and CSS-column pagination with LTR/RTL progression.
- **Depends on:** HADDON-031, HADDON-032
- **Acceptance:** switching modes preserves location; layout behavior has browser integration and screenshot coverage.

### HADDON-035 — Add source-faithful iframe rendition

- [ ] Render content unsuitable for normalization using a separately secured iframe backend.
- **Depends on:** HADDON-020, HADDON-030
- **Acceptance:** scripts are inert by default; CSP, sandbox, external-resource, origin, and URL-lifecycle policies are tested.

### HADDON-036 — Add fixed-layout rendition

- [ ] Respect viewport, spread, direction, scaling, and letterboxing metadata.
- **Depends on:** HADDON-021, HADDON-030, HADDON-035
- **Acceptance:** image and XHTML fixed-layout fixtures render through the same navigator location contract.

### HADDON-037 — Isolate the canvas backend

- [ ] Move the existing `cosmic-text`/canvas renderer behind an optional rendition interface.
- **Depends on:** HADDON-030
- **Acceptance:** canonical publication and locator types do not depend on canvas pages; existing prototype behavior remains available for explicit use.

## Milestone 4: Klemata and Remix 3 Integration

### HADDON-040 — Finalize the Klemata citation schema

- [ ] Define volume, edition, locator, quote context, label, and schema version for storage and URLs.
- Klemata-side edition store (EPUB in blob, cards in git): `klemata/docs/sources/editions.md`. `volumeId` + `sourceRevision` (SHA-256 of the EPUB bytes) + quote. Do not treat Haddon's user-upload bucket as the canonical spine.
- **Depends on:** HADDON-018
- **Acceptance:** the schema supports migration and represents exact, recovered, ambiguous, and unresolved citations.

### HADDON-041 — Define citation deep-link routing

- [ ] Specify and implement the URL/opening contract from Klemata to a Haddon volume and passage.
- **Depends on:** HADDON-040, HADDON-032
- **Acceptance:** opening a link loads the volume, resolves the citation, focuses/decorates the passage, and reports recovery state to the host.

### HADDON-042 — Build the Remix 3 host adapter

- [ ] Package Haddon for composition from Klemata without placing Remix-specific behavior in the core or navigator.
- **Depends on:** HADDON-002, HADDON-030, HADDON-041
- **Acceptance:** a minimal Remix 3 route embeds a long-lived reader surface and responds to navigation without unnecessary reader remounts.

### HADDON-043 — Define host events and application policy

- [ ] Cover internal/external links, note presentation, selection actions, toolbar behavior, keyboard commands, loading, warnings, and unsupported content.
- **Depends on:** HADDON-030, HADDON-042
- **Acceptance:** Klemata owns educational workflow and external policy; Haddon owns book mechanics and emits sufficient events.

### HADDON-044 — Persist sessions, annotations, and migrations

- [ ] Persist current locator, preferences, bookmarks, citation decorations, and annotations with versioned migrations.
- **Depends on:** HADDON-033, HADDON-040, HADDON-042
- **Acceptance:** state restores across viewport changes and a normalizer revision; unresolved migrations retain source evidence.

## Milestone 5: Compatibility and Hardening

### HADDON-050 — Build the upstream behavior catalog

- [x] Convert high-value upstream tests into a maintained matrix of behavior, minimal input, layer, naive failure, provenance, Haddon status, priority, and test form.
- **Depends on:** HADDON-003
- **Output:** `docs/research/test-catalog.md`
- **Acceptance:** observations are traceable to exact upstream paths and code/fixture reuse is license-classified.

### HADDON-051 — Automate the supported W3C EPUB subset

- [ ] Add a harness and expected-support manifest for machine-observable W3C fixtures.
- **Depends on:** HADDON-021, HADDON-050
- **Acceptance:** every selected fixture has an expected result; unsupported cases are explicit rather than silently skipped.

### HADDON-052 — Add browser and visual regression coverage

- [ ] Cover normalized LTR, RTL, vertical/CJK, pagination, scrolling, typography preferences, fixed layout, and source-faithful fallback.
- **Depends on:** HADDON-034, HADDON-036
- **Acceptance:** screenshots run deterministically with documented fonts, viewport, pixel tolerance, and failure artifacts.

### HADDON-053 — Establish the accessibility baseline

- [ ] Test semantic navigation, screen readers/accessibility tree, keyboard-only use, reduced motion, contrast, zoom, language/direction, and reading-order integrity.
- **Depends on:** HADDON-031, HADDON-043
- **Acceptance:** baseline criteria and known exceptions are documented and enforced in CI where automatable.

### HADDON-054 — Add fuzz and hostile-input targets

- [ ] Fuzz ZIP metadata, XML, URL resolution, CFI, locator JSON, HTML normalization, quote recovery, and resource limits.
- **Depends on:** HADDON-016, HADDON-020, HADDON-022
- **Acceptance:** targets have bounded inputs, reproducible regression storage, and explicit memory/time ceilings.

### HADDON-055 — Establish performance budgets

- [ ] Benchmark opening, first render, normalization, relayout, search indexing, memory, and cleanup for representative books.
- **Depends on:** HADDON-024, HADDON-034
- **Acceptance:** budgets and representative fixtures are documented; regressions produce comparable artifacts.

### HADDON-056 — Decide the next publication profile

- [ ] Use the finished interfaces to evaluate PDF, CBZ, audiobook, or web-publication support without expanding EPUB's initial scope prematurely.
- **Depends on:** HADDON-030, HADDON-050
- **Acceptance:** decision records interface pressure, reuse, specialized rendition needs, and explicit non-goals.

## Current Work Queue

At most three subagents should work simultaneously. The next planned assignments deliberately leave one lane free for review and integration:

| Lane | Ticket | Work area |
| --- | --- | --- |
| Agent 1 | HADDON-032 | Visible-location tracking from the HTML reader |
| Agent 2 | Held | 020 archive hardening before untrusted books |
| Agent 3 | Held free | Primary-agent review, shared conformance fixtures, and conflict avoidance |

Completed agent waves delivered HADDON-002, HADDON-003, HADDON-010 through HADDON-017, HADDON-030, and HADDON-050. The primary agent completed HADDON-001, reviews all lanes, updates ticket status, and prevents contract or file overlap. WASM/JS locator bindings were deferred from HADDON-016.
