# Haddon E-Reader North-Star Research Brief

**Status:** Working brief, to be refined by repository research  
**Date:** 2026-08-13

## Context

Haddon is the reading surface for Klemata, an educational tool built with Remix 3. A learner should be able to click a citation in Klemata and land in the cited volume and passage in Haddon.

This makes Haddon different from a general-purpose ebook application:

- It is embedded in a larger learning workflow.
- Stable citation and passage identity matter more than reproducing every publisher quirk.
- Normalization is a feature: some books are poorly styled or difficult to read as published.
- Source fidelity still matters wherever normalization would destroy meaning, structure, or the ability to resolve a citation.

The research should therefore optimize for a dependable, legible, citation-addressable reading system rather than a perfect clone of each source publication.

## Product Thesis

Haddon should preserve the source publication while deriving a normalized reading representation from it.

```text
Source publication
  archive, metadata, resources, reading order, original anchors
                         |
                         v
Normalization pipeline
  clean structure, retain meaning, map every node back to its source
                         |
                         v
Normalized document
  predictable typography, search, selection, citation, annotation
                         |
                         v
Navigator / rendition
  layout, scrolling or pagination, current location, interactions
                         |
                         v
Klemata in Remix 3
  lessons, citations, workspace, accounts, persistence, learning UI
```

The source publication is the authority for provenance and resource access. The normalized document is the authority for Haddon's default reading experience. Normalization must never sever the mapping between them.

### The intended balance

Haddon should generally:

- Normalize hostile, broken, or excessively prescriptive publisher typography.
- Preserve semantic structure such as headings, paragraphs, lists, quotations, notes, links, figures, captions, tables, code, emphasis, and language changes.
- Preserve meaningful media and provide useful fallbacks when it cannot render something.
- Retain original resource paths, element IDs, fragments, and other anchors needed for deep links.
- Make user typography and accessibility preferences reliable.
- Report unsupported or discarded features rather than silently pretending they never existed.
- Allow a more source-faithful fallback for content whose meaning depends on its original layout.

The research must determine where the default normalized mode ends and where original-layout or specialized renditions begin. Fixed-layout EPUBs, comics, highly illustrated books, mathematical content, and complex tables are important boundary cases.

## The First Architectural Decision

The current Rust core parses EPUB XHTML into a small `Chapter` / `Block` / `Span` model and lays it out with `cosmic-text`. That model is promising as a normalized reading representation, but it is too lossy to be the canonical publication model.

The likely direction is to split the current concept into three models:

### 1. Publication

An immutable, format-aware resource graph:

- metadata and contributors
- reading order/spine
- table of contents, landmarks, and page list
- manifest resources and media types
- safe resource resolution
- rendition/profile information
- source anchors and identifiers
- optional capabilities exposed as services
- warnings and unsupported features

### 2. Normalized document

A format-neutral semantic representation derived from a publication:

- blocks and inline content rich enough for real books
- source mapping on every addressable node
- normalized text for search and quotation matching
- explicit notes, citations, links, figures, and structural roles
- deterministic transformation/version metadata
- no viewport-specific coordinates or page numbers

### 3. Reading session

Mutable user and navigator state:

- current locator
- navigation history
- active selection
- annotations and bookmarks
- reading preferences
- search state
- session restoration and synchronization state

The repository review should test this split against Foliate and Readium and produce an implementable Rust/TypeScript API sketch.

## Citation and Deep-Link Contract

Citation resolution is a primary product capability, not an add-on.

A Klemata citation must be able to identify:

1. the exact volume or edition;
2. the best available structural location within it;
3. the quoted text and surrounding context as a recovery mechanism; and
4. optionally, a conventional source label such as a print page or chapter.

The initial conceptual shape is:

```ts
type CitationTarget = {
  volumeId: string
  editionId?: string
  locator: PublicationLocator
  quote?: {
    exact: string
    prefix?: string
    suffix?: string
  }
  label?: string
}
```

This is not yet a final API. Research must determine the locator representation and serialization. Readium Locators, EPUB CFI, URL fragments, text-quote selectors, and Foliate's location handling should all be compared.

Required behavior:

- A citation deep link opens the correct volume and focuses or highlights the passage.
- It is independent of viewport size, pagination, font choice, and theme.
- It survives deterministic re-normalization where possible.
- It can fall back from a structural locator to quote/context matching.
- Ambiguous or missing matches are surfaced explicitly.
- Copying a citation from Haddon produces something Klemata can persist and reopen.
- Source mappings permit movement between normalized and original representations.

We should distinguish four concepts that are often incorrectly collapsed into a page number:

- source location
- normalized document range
- rendition location
- human-facing progress or page label

## Where the Headless Boundary Stops

Haddon should have two non-application layers.

### Pure headless core

This layer must not depend on a DOM, React, Remix, or a viewport. It should be usable from Rust tests, WASM, a worker, Node, or server-side tooling.

Responsibilities:

- open bytes, files, URLs, or streams
- parse and validate a publication
- expose metadata, reading order, navigation, and resources
- normalize supported content
- resolve links and locators
- map source locations to normalized ranges and back
- iterate content and search text
- expose positions/progression without viewport pages
- apply resource transforms such as font de-obfuscation
- report capabilities, recoverable warnings, and fatal errors
- support cancellation and deterministic cleanup

### Framework-neutral navigator

This layer may depend on browser primitives, but not on React or Remix 3. It should mount into a host-provided element or canvas and expose a small controller/event API.

Responsibilities:

- render normalized content and any supported specialized rendition
- support paginated and scrolling presentation
- apply typography and accessibility preferences
- navigate to a link, locator, or normalized range
- expose the current stable locator
- own selection mechanics
- render decorations such as citations, highlights, and search results
- handle in-publication links and note interactions
- emit location, selection, interaction, warning, and error events
- manage resource, preloading, viewport, and relayout lifecycles

The navigator is the single source of truth for the current visible location. It should contain minimal document interaction behavior, but no Klemata workflow or account state.

## Where Remix 3 and Klemata Begin

Remix 3 is not interchangeable with React in this plan. Klemata is the host application, built on the new Remix 3 runtime and UI model. Haddon should not require React as an intermediate layer.

Klemata owns:

- routes and volume-opening deep links
- lessons and educational context
- citation presentation outside the book
- library/workspace layout
- accounts, authorization, and synchronization
- persistence APIs
- application navigation and history policy
- application-level keyboard commands
- panels for TOC, search, settings, notes, and annotations
- responsive composition around the reader
- loading, unavailable-volume, and permission UX

Haddon owns:

- the publication and normalized-document APIs
- the mounted reading surface
- in-book navigation and location reporting
- selection and decoration primitives
- source/normalized location mapping
- reading preferences as data and behavior, but not necessarily their final controls

Adapters may make Haddon pleasant to use from Remix 3, React, or another host, but the canonical engine API should use portable types such as `Uint8Array`, `Blob`, `File`, `Request`, `Response`, `ReadableStream`, `EventTarget`, and plain serializable objects.

This direction is consistent with Remix 3's published principles: model-first development, Web APIs, runtime behavior, minimal dependencies, and composable single-purpose packages. Remix 3 remains under active development, so Haddon should depend on its stable Web-facing seams rather than internal framework machinery.

Reference: <https://github.com/remix-run/remix>

## UI Research

The polished Readium web UI previously recalled is Thorium Web and its Readium Playground reference implementation. It is distinct from Readium's deliberately minimal Navigator.

The UI review should separate:

### Reading mechanics

- viewport and document lifecycle
- progression and location events
- selection and decorations
- navigation commands
- typography preference model
- link and footnote behavior
- keyboard and pointer semantics

### Application chrome and policy

- toolbar visibility
- TOC and search panels
- settings controls
- progress display
- bookmark and annotation workflows
- responsive docking and sheets
- fullscreen behavior
- educational context supplied by Klemata

The goal is not to copy Thorium's Next.js application. It is to identify reusable interaction contracts and decide what Haddon must expose so Klemata can build a cohesive Remix 3 experience around it.

Primary references:

- Readium Web overview: <https://readium.org/web/>
- Readium TypeScript toolkit: <https://github.com/readium/ts-toolkit>
- Thorium Web: <https://github.com/edrlab/thorium-web>
- Readium Playground: <https://playground.readium.org>

The TypeScript toolkit and Thorium Web should be added as shallow, squashed subtrees before this research track begins.

## Test Mining

The purpose of studying upstream tests is to discover real-world promises and failure cases, not merely to count or mechanically port tests.

Each useful upstream test should become a row in a behavior catalog:

| Field | Description |
| --- | --- |
| Behavior | The user-visible or API promise being tested |
| Input shape | The smallest fixture that demonstrates it |
| Layer | Archive, parser, model, normalizer, locator, navigator, UI, etc. |
| Naive failure | What a simplistic implementation gets wrong |
| Provenance | Repository and exact source path |
| Haddon status | Supported, partial, absent, or intentionally excluded |
| Priority | Baseline, compatibility, or advanced |
| Test form | Unit, fixture, conformance, browser, visual, fuzz, or performance |

### Intended Haddon test layers

1. **Unit tests** for parsing, normalization, resource resolution, and model laws.
2. **Locator property tests** for ordering, serialization, round trips, and fallback resolution.
3. **Focused publication fixtures** containing the smallest possible EPUB for each behavior.
4. **W3C conformance corpus runs** with an explicit expected-support manifest.
5. **Golden snapshots** for publication metadata and normalized semantic output.
6. **Browser integration tests** for navigation, selection, relayout, notes, and decorations.
7. **Visual regression tests** for typography, pagination, RTL, CJK, and accessibility modes.
8. **Malformed-input and security tests** for ZIP, XML, paths, URLs, scripts, and oversized inputs.
9. **Fuzz and property tests** for parsers, locators, and normalization invariants.
10. **Performance fixtures** for large chapters, large books, many resources, and image-heavy content.
11. **Deep-link restoration tests** across viewport and preference changes.
12. **Citation recovery tests** across normalization revisions and ambiguous quote matches.

`epub-tests` is primarily a conformance corpus, not a conventional unit-test suite. Calibre and Readium are likely stronger sources for parser edge cases; Foliate and Readium for navigation and locators; Readium CSS for rendering fixtures.

## Additional Research Tracks

### Location identity

Compare Readium Locators, EPUB CFI, DOM/source fragments, text-quote selectors, print page labels, and Haddon document points. Determine which are canonical, derived, or fallback identifiers.

### Normalization policy

Document which source styles and structures are preserved, transformed, or removed. Include accessibility consequences and ensure every transformation maintains source mappings.

### Resource and security model

Study ZIP path traversal, decompression limits, scripted publications, external URLs, iframe sandboxing, MIME handling, CSP, encrypted resources, and font obfuscation.

### Typography and accessibility

Study publisher/user style precedence, RTL, vertical writing, CJK, ruby, MathML, screen readers, semantic navigation, reduced motion, keyboard use, media overlays, and TTS.

### Lifecycle and performance

Study streaming versus extraction, lazy spine loading, resource URL management, prefetching, cancellation, worker boundaries, memory ceilings, search indexes, relayout cost, and very large publications.

### Failure philosophy

Define fatal errors, recoverable warnings, fallback renderers, partial-support signaling, and useful diagnostics. Haddon should degrade deliberately when faced with a malformed or unsupported book.

### Extensibility

EPUB is the initial product format. PDF, CBZ, audiobooks, and web publications should pressure-test interfaces without expanding the first implementation's scope.

### Licensing and provenance

Every extracted gem must be tagged as one of:

- architectural idea
- behavior or test case
- data or fixture
- code candidate

Code candidates require an explicit compatibility check. Calibre, CoolReader, and MuPDF are especially useful for learning, but their strong copyleft licenses make direct transplantation a separate decision.

## Repository Roles

| Repository | Primary questions |
| --- | --- |
| Foliate JS | Compact book contract, EPUB/CFI handling, paginator/view separation, link and footnote behavior |
| Readium Kotlin | Publication/services model, locators, navigator contract, streamer boundary, error and lifecycle design |
| Readium TypeScript | Current framework-neutral web navigator, injectables, preferences, decorations, browser boundary |
| Thorium Web | Full reader UI, responsive composition, controls, accessibility, host/navigator integration |
| Readium CSS | Normalization versus publisher styles, typography, writing systems, rendering fixtures |
| W3C EPUB Tests | Standards compatibility envelope and conformance fixtures |
| Calibre | Malformed-book tolerance, conversion/normalization behavior, metadata and format edge cases |
| CoolReader | Mature normalized document/layout engine, embedded constraints, typography and format handling |
| MuPDF | Rendering-engine boundaries, resource lifetime, incremental work, error handling, fuzz/security discipline |

## Research Deliverables

Repository research should produce five documents:

1. `publication-model.md` — canonical models, invariants, and Rust/TypeScript API sketches.
2. `engine-boundary.md` — core, navigator, and Klemata/Remix 3 responsibilities.
3. `behavior-matrix.md` — supported, deferred, specialized, and rejected capabilities.
4. `test-catalog.md` — upstream behavior cases with exact provenance and proposed Haddon tests.
5. `gems-ledger.md` — useful patterns, exact source paths, applicability, and license classification.

Each conclusion should cite source files and distinguish observation from recommendation. Negative findings are valuable: agents should record approaches that are too coupled, too format-specific, obsolete, or incompatible with Haddon's goals.

## Proposed Agent Work

Research should happen in two waves so the second wave can use the architecture vocabulary established by the first.

### Wave 1: Architecture

1. **Publication and locator model:** Foliate, Readium Kotlin, Readium TypeScript, and current Haddon.
2. **Headless and navigator boundary:** Foliate paginator/view, Readium navigators, Readium CSS, and current Rust/WASM boundary.
3. **Klemata UI integration:** Thorium Web, Readium Playground, Remix 3 constraints, and current Haddon reader route.

The primary agent synthesizes these into a draft model and boundary proposal.

### Wave 2: Behavior and hardening

1. **Parsing and conformance:** W3C EPUB Tests, Calibre, and Readium parser tests.
2. **Rendition and accessibility:** Readium CSS, Foliate, CoolReader, Readium navigator tests, and Thorium Web.
3. **Security, performance, and failure behavior:** MuPDF, Calibre, CoolReader, and large/malformed fixture strategies.

The primary agent then consolidates duplicates, assigns priorities, and turns findings into the test catalog and gems ledger.

## Open Decisions the Research Must Resolve

- Which normalized block and inline semantics are mandatory for the first useful release?
- Is the default presentation continuously scrolling, paginated, or equally supports both?
- When does Haddon fall back to source-faithful HTML or another specialized renderer?
- What exact locator format crosses the Klemata/Haddon boundary?
- How are normalization algorithm versions recorded and migrated?
- Which citation selectors are persisted for redundancy?
- Does the navigator use DOM content, canvas layout, or selectable backends by publication/profile?
- Which reading controls ship with Haddon adapters versus live entirely in Klemata?
- What is the minimum accessibility and international-text baseline?
- What book failures are warnings, partial successes, or hard failures?

## Definition of Success

The research phase is complete when we can:

- explain Haddon's source, normalized, navigator, and host models without overlap;
- sketch the public APIs in enough detail to write contract tests;
- open a Klemata citation into a stable Haddon location on paper end-to-end;
- state what normalization preserves, changes, and refuses;
- classify the major EPUB real-world cases into supported, fallback, deferred, and rejected;
- identify the first high-value upstream tests to reproduce;
- show that the Haddon engine can be embedded into Remix 3 without depending on Remix internals; and
- trace every borrowed behavior, fixture, pattern, or code candidate to its source and license.
