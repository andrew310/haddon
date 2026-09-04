# Haddon Citation Deep-Link Routing (HADDON-041)

**Status:** Implementation for Milestone 4 (Klemata integration)

**Date:** 2026-08-15 (Rebuilt 2026-09-04 on current main)

**Scope:** URL shape, open() contract, parse/resolve functions, and demo wiring for citation deep links

**Dependencies:**
- HADDON-040: CitationEnvelopeV1 schema (complete)
- HADDON-032: Visible-location tracking (in progress; not blocking for basic focus/scroll)

**Out of scope:**
- HADDON-042: Remix 3 host adapter (deferred)
- Viewport/page identity synchronization (HADDON-032)
- Host UI policy (Klemata chrome, external link handling)
- Navigation history management beyond basic URL sync

## 1. Design Summary

HADDON-041 defines how Klemata (or another host) can construct a deep-link URL that:
1. Opens a specific volume and edition
2. Resolves a citation to a passage using the publication/locator services
3. Focuses and decorates the passage (scroll + highlight)
4. Reports recovery state (exact | recovered | ambiguous | unresolved) back to the host

The implementation delivers:
- A URL encoding contract using query parameters and base64-encoded JSON
- A portable TypeScript `openCitation()` function that parses and resolves citations
- Demo wiring in `apps/demo` that accepts citation URLs and jumps to passages
- Tests for parse/resolve outcomes without mocking envelope fields

### Design Decisions

- **Decision:** Use query parameters for simple citations, base64-encoded JSON for full envelopes
- **Decision:** The `openCitation()` function is portable (not Remix-specific) and returns typed resolution state
- **Decision:** Haddon reports recovery confidence; the host decides UI policy
- **Decision:** HADDON-042 Remix adapter is explicitly deferred; a comment in this doc points at it
- **Decision:** Decorations (highlights, marks) are optional; focus/scroll is mandatory

## 2. URL Shape and Encoding

### 2.1 Query Parameter Format (Simple Citations)

For simple citations without complex locator selectors, use query parameters:

```
https://example.com/read/{volumeId}?citation={base64-locator}
```

Or decomposed:

```
https://example.com/read/{volumeId}?
  sourceRevision={sha256}&
  href={resource-href}&
  exact={quote-text}&
  prefix={context-before}&
  suffix={context-after}
```

### 2.2 Base64-Encoded JSON Format (Full Envelopes)

For full `CitationEnvelopeV1` with normalized selectors, recovery evidence, or extensions:

```
https://example.com/read/{volumeId}?envelope={base64-json}
```

Where `{base64-json}` is the URL-safe base64 encoding of a complete `CitationEnvelopeV1` JSON object.

### 2.3 Fragment Identifiers (Optional)

Fragment identifiers (`#citation-target`) are supported as a fallback:

```
https://example.com/read/{volumeId}?sourceRevision={sha256}#{fragment-id}
```

This resolves to the structural fragment without text context.

### 2.4 Query Parameter Schema

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `envelope` | base64 string | conditional | Full CitationEnvelopeV1 (excludes other params) |
| `sourceRevision` | string | yes* | SHA-256 of EPUB bytes (64 hex chars) |
| `href` | string | yes* | Publication-relative resource href |
| `exact` | string | yes* | Exact quote text to resolve |
| `prefix` | string | no | Context before the quote |
| `suffix` | string | no | Context after the quote |
| `fragment` | string | no | Structural fragment identifier |
| `normalized` | boolean | no | Include normalized selectors if present |

\*Required unless `envelope` is provided.

### 2.5 URL Encoding Examples

**Example 1: Simple quote link**

```
https://klemata.app/read/klemata:work:example?
  sourceRevision=a3c5f1e9b2d8c4f7a1e6d3b9c8f2e5a7d4b1c9e6f3a8d5b2e9c6f1a4d7b3e0c5&
  href=text/chapter-1.xhtml&
  exact=the+patient+moon+answered+in+blue&
  prefix=Before+the+signal,+the+copper+astrolabe+clicked+once;+&
  suffix=,+and+the+lesson+continued+after+midnight.
```

**Example 2: Full envelope (base64-encoded)**

```
https://klemata.app/read/klemata:work:example?
  envelope=eyJzY2hlbWEiOiJoYWRkb24uY2l0YXRpb24tZW52ZWxvcGUiLCJ2ZXJzaW9uIjoxLCJ2b2x1bWVJZCI6ImtsZW1hdGE6d29yazpleGFtcGxlIiwic291cmNlUmV2aXNpb24iOiJhM2M1ZjFlOWIyZDhjNGY3YTFlNmQzYjljOGYyZTVhN2Q0YjFjOWU2ZjNhOGQ1YjJlOWM2ZjFhNGQ3YjNlMGM1IiwibG9jYXRvciI6eyJzY2hlbWEiOiJoYWRkb24ucHVibGljYXRpb24tbG9jYXRvciIsInZlcnNpb24iOjEsImhyZWYiOiJ0ZXh0L2NoYXB0ZXItMS54aHRtbCIsIm1lZGlhVHlwZSI6ImFwcGxpY2F0aW9uL3hodG1sK3htbCIsImxvY2F0aW9ucyI6eyJmcmFnbWVudHMiOlsiY2l0YXRpb24tdGFyZ2V0Il19LCJ0ZXh0Ijp7ImV4YWN0IjoidGhlIHBhdGllbnQgbW9vbiBhbnN3ZXJlZCBpbiBibHVlIiwicHJlZml4IjoiQmVmb3JlIHRoZSBzaWduYWwsIHRoZSBjb3BwZXIgYXN0cm9sYWJlIGNsaWNrZWQgb25jZTsgIiwic3VmZml4IjoiLCBhbmQgdGhlIGxlc3NvbiBjb250aW51ZWQgYWZ0ZXIgbWlkbmlnaHQuIn19LCJjb25maWRlbmNlIjoiZXhhY3QiLCJsYWJlbCI6IkNoYXB0ZXIgMTogTW9vbiBxdW90ZSJ9
```

**Example 3: Fragment-only fallback**

```
https://klemata.app/read/klemata:work:example?
  sourceRevision=a3c5f1e9b2d8c4f7a1e6d3b9c8f2e5a7d4b1c9e6f3a8d5b2e9c6f1a4d7b3e0c5#citation-target
```

## 3. The `openCitation()` Contract

### 3.1 Function Signature

```typescript
type OpenCitationResult =
  | { status: "exact"; target: ResolvedPassage }
  | { status: "recovered"; target: ResolvedPassage; evidence: RecoveryEvidence }
  | { status: "ambiguous"; candidates: ResolvedPassage[]; evidence: RecoveryEvidence }
  | { status: "unresolved"; reason: string; evidence?: RecoveryEvidence }

type ResolvedPassage = {
  href: string
  blockId?: string
  startOffset?: number
  endOffset?: number
  exact?: string
}

/**
 * Parse and resolve a citation URL or envelope.
 * 
 * @param citationInput - URL search params, hash, or full CitationEnvelopeV1
 * @param publication - Opened publication session (WASM or JS)
 * @returns Typed resolution outcome
 */
function openCitation(
  citationInput: URLSearchParams | string | CitationEnvelopeV1,
  publication: PublicationSession
): OpenCitationResult
```

### 3.2 Resolution Flow

1. **Parse:** Extract citation from URL params, hash, or envelope
2. **Validate:** Check required fields (sourceRevision, href, exact or fragment)
3. **Resolve:** Call publication.resolveLocator(locator) with the parsed locator
4. **Map confidence:** Map internal resolution state to exact | recovered | ambiguous | unresolved
5. **Return:** Typed outcome with passage coordinates and evidence

### 3.3 Error Handling

| Error Condition | Status | Reason |
|-----------------|--------|--------|
| Missing `exact` and `fragment` | unresolved | "missing-selector" |
| Resource `href` not in reading order | unresolved | "resource-missing" |
| Quote not found | unresolved | "quote-not-found" |
| Multiple matches with equal confidence | ambiguous | (includes candidates) |
| Structural selector resolved but quote changed | recovered | (includes evidence) |

### 3.4 Focus and Decoration

After resolution, the host should:
1. **Scroll** the target block/offset into view (center or top-aligned)
2. **Highlight** the passage if decorations are supported (CSS class or mark)
3. **Report** confidence to the user (status bar, toast, or inline indicator)

The `openCitation()` function does NOT modify the DOM. The host is responsible for:
- Scrolling to the target
- Applying CSS classes or marks
- Showing confidence indicators

## 4. Implementation Plan

### 4.1 TypeScript Package: `packages/haddon-citation-router`

Create a new portable package:

```
packages/haddon-citation-router/
├── package.json
├── open-citation.ts         # Core openCitation() function
├── parse-citation-url.ts    # URL → CitationEnvelopeV1 parser
├── open-citation.test.ts    # Unit tests
└── README.md
```

**Exports:**
- `openCitation(input, publication): OpenCitationResult`
- `parseCitationUrl(params): CitationEnvelopeV1`
- `encodeCitationUrl(envelope): URLSearchParams`

### 4.2 Demo Wiring: `apps/demo`

Update the demo app to:
1. Detect citation URLs on load (from `window.location.search`)
2. Call `openCitation()` with the parsed envelope
3. Scroll to the resolved passage
4. Apply a `.haddon-cited` CSS class to the target block
5. Show confidence indicator in the status bar

**Files to modify:**
- `apps/demo/src/App.tsx` - Parse citation on mount
- `apps/demo/src/SemanticReader.tsx` - Wire `openCitation()` to resolution
- `apps/demo/src/citationLink.ts` - Extend with envelope encoding

### 4.3 Rust Bindings (Optional for 041)

WASM bindings for `CitationEnvelopeV1` are deferred to HADDON-042. For 041, the demo uses:
- `PublicationSession.resolve_json(locatorJson, "citation")` (already exists)
- Manual envelope parsing in TypeScript

If Rust bindings are added later, they should export:
- `pub fn parse_citation_envelope(json: &str) -> Result<CitationEnvelopeV1, HaddonError>`
- `pub fn resolve_citation(envelope: &CitationEnvelopeV1) -> Result<LocatorResolution, HaddonError>`

## 5. Testing Strategy

### 5.1 Unit Tests (TypeScript)

Test `openCitation()` with fixture data:
- ✅ Exact citation (structural + quote)
- ✅ Recovered citation (normalized revision changed)
- ✅ Ambiguous citation (multiple candidates)
- ✅ Unresolved citation (quote not found)
- ✅ URL parsing (query params → envelope)
- ✅ URL encoding (envelope → query params)
- ✅ Fragment-only fallback

### 5.2 Integration Tests (Demo)

Test the demo app with fixture URLs:
- ✅ Open sample book with citation URL
- ✅ Scroll to resolved passage
- ✅ Apply `.haddon-cited` class
- ✅ Show confidence indicator

### 5.3 Test Fixtures

Reuse existing fixtures from `crates/core/tests/fixtures/citation-roundtrip/`:
- `moon-quote.json` - Exact citation
- `recovered-quote.json` - Normalized structure changed
- `ambiguous-quote.json` - Multiple matches
- `unresolved-quote.json` - Quote not found

## 6. HADDON-042 Remix Adapter (Future Work)

HADDON-042 will build a Remix 3 host adapter that:
- Integrates citation routing into Remix's loader/action pattern
- Manages session state and URL history
- Handles Klemata-specific chrome and navigation
- Persists reading location and preferences

**Separation of concerns:**
- HADDON-041 (this doc): Portable parse/resolve logic
- HADDON-042 (future): Remix-specific routing, state, and UI

## 7. Host Policy (Out of Scope)

Haddon reports recovery state but does NOT decide:
- Whether to show ambiguous candidates to the user
- Whether to block navigation on unresolved citations
- How to present confidence indicators (toast, status bar, inline)
- Whether to allow external links (Klemata's security policy)

Klemata (or another host) owns these decisions.

## 8. Known Limitations

1. **No viewport/page identity:** HADDON-032 is in progress; initial implementation uses scroll-to-block
2. **No cross-revision recovery:** `sourceRevision` must match exactly; future work may attempt recovery
3. **No multi-volume citations:** Single-volume only (series citations are future work)
4. **No print-edition sync:** EPUB-only (no page number mapping)
5. **No collaborative citations:** Single-user only (shared citations are Klemata's responsibility)

## 9. Acceptance Criteria

HADDON-041 is complete when:
- ✅ `docs/design/citation-deep-link.md` is written (this document)
- ✅ `packages/haddon-citation-router` exports `openCitation()` and URL parsers
- ✅ Demo wiring in `apps/demo` accepts citation URLs and jumps to passages
- ✅ Tests for parse/resolve outcomes pass (exact, recovered, ambiguous, unresolved)
- ✅ ROADMAP.md marks HADDON-041 as `[x]` (or `[~]` with gaps documented)

Partial completion is acceptable if:
- Parse/resolve functions exist and are tested
- Demo wiring works for at least exact citations
- Gaps are documented in ROADMAP.md

## 10. References

- **CitationEnvelopeV1 schema:** `docs/design/citation-envelope.md`
- **Publication locator:** `docs/design/publication-model.md` § 8
- **Resolution service:** `crates/core/src/publication/resolve.rs`
- **Demo app:** `apps/demo/src/SemanticReader.tsx`
- **HADDON-042 adapter:** (not yet written)

---

**Version History:**
- 2026-08-15: Initial design for HADDON-041
- 2026-09-04: Rebuilt on current main with range-accurate decorations, source drawer, and visible-location tracking preserved
