# HADDON-041 Implementation Summary

**Date:** 2026-08-15  
**Status:** Complete  
**PR:** [#6](https://github.com/andrew310/haddon/pull/6)  
**Branch:** `cursor/citation-deep-link-haddon-041-29a8`

## What Was Delivered

HADDON-041 implements the URL/opening contract for citation deep linking from Klemata (or other hosts) to Haddon volumes and passages.

### 1. Design Document

**File:** `docs/design/citation-deep-link.md`

Defines:
- URL shape and encoding (query parameters + base64-encoded JSON)
- `openCitation()` contract with typed resolution outcomes
- Error handling and confidence level mapping
- Integration points for HADDON-042 Remix adapter (future work)
- Testing strategy and acceptance criteria

### 2. Portable Citation Router Package

**Location:** `packages/haddon-citation-router/`

**Exports:**
- `openCitation(input, publication, volumeId?): OpenCitationResult`
  - Parse and resolve citations from URLs, envelopes, or fragments
  - Returns typed outcomes: `exact | recovered | ambiguous | unresolved`
- `parseCitationUrl(params, volumeId): CitationEnvelopeV1 | null`
  - URL search params → CitationEnvelopeV1
  - Supports query parameters and base64-encoded envelopes
- `encodeCitationUrl(envelope, useBase64?): URLSearchParams`
  - CitationEnvelopeV1 → URL search params
  - Auto-detects simple vs. complex citations

**Tests:** 20/20 passing
- Exact citation resolution
- Recovered citation (structure changed, quote matched)
- Ambiguous citation (multiple candidates)
- Unresolved citation (resource missing, quote not found)
- URL parsing/encoding roundtrips
- Fragment-only fallback

### 3. Demo Integration

**File:** `apps/demo/src/SemanticReader.tsx`

Updated `applyCitation()` function to:
- Build CitationEnvelopeV1 from simple CitationQuery
- Call `openCitation()` with publication session
- Handle all resolution outcomes (exact, recovered, ambiguous, unresolved)
- Display confidence indicators in status bar
- Scroll and focus on resolved passages
- Apply `.haddon-cited` CSS class to target blocks

### 4. Documentation

- **Design doc:** `docs/design/citation-deep-link.md` (complete specification)
- **Package README:** `packages/haddon-citation-router/README.md` (usage examples)
- **ROADMAP update:** Marked HADDON-041 as `[x]` complete

## Acceptance Criteria

✅ `docs/design/citation-deep-link.md` is written  
✅ Portable `openCitation()` function exists and returns typed outcomes  
✅ Demo wiring accepts citation URLs and jumps to passages  
✅ Tests for parse/resolve outcomes pass (20/20) without mocking envelope fields  
✅ ROADMAP.md marks HADDON-041 as `[x]`

## Technical Decisions

1. **Framework-neutral design:** Citation router package has no React or Remix dependencies
2. **URL encoding strategy:**
   - Simple citations (quote + href) → query parameters
   - Complex citations (normalized selectors, evidence) → base64-encoded JSON
3. **Resolution confidence:**
   - Haddon reports `exact | recovered | ambiguous | unresolved`
   - Host (Klemata) decides UI policy for each state
4. **HADDON-032 not blocking:** Basic scroll/focus works without full viewport sync
5. **HADDON-042 explicitly deferred:** Remix adapter is out of scope for this PR

## Known Limitations

1. **No viewport/page identity:** HADDON-032 is in progress; scroll-to-block is sufficient for now
2. **No cross-revision recovery:** `sourceRevision` must match exactly (future work)
3. **No multi-volume citations:** Single-volume only (series citations are future work)
4. **Demo uses minimal envelope:** Full envelope wiring requires HADDON-042

## Test Results

```bash
cd packages/haddon-citation-router
pnpm test
```

```
✓ open-citation.test.ts (20 tests) 6ms
  ✓ parseCitationUrl (5 tests)
    ✓ parses simple query parameters
    ✓ parses fragment-only citation
    ✓ parses base64-encoded envelope
    ✓ returns null for missing selector
    ✓ returns null for missing sourceRevision
  ✓ encodeCitationUrl (3 tests)
    ✓ encodes simple citation as query parameters
    ✓ encodes complex citation as base64
    ✓ forces base64 encoding when requested
  ✓ parseFragmentFromHash (3 tests)
    ✓ parses fragment with leading #
    ✓ parses fragment without leading #
    ✓ returns null for empty hash
  ✓ openCitation (9 tests)
    ✓ resolves exact citation
    ✓ resolves recovered citation
    ✓ resolves ambiguous citation with multiple candidates
    ✓ returns unresolved for missing resource
    ✓ returns unresolved for missing quote
    ✓ returns unresolved for missing selector
    ✓ handles WASM resolve_json errors
    ✓ parses citation from URLSearchParams
    ✓ parses fragment from hash string

Test Files  1 passed (1)
     Tests  20 passed (20)
```

## Next Steps

1. **HADDON-042:** Build Remix 3 host adapter using this router
   - Integrate with Remix loaders/actions
   - Manage session state and URL history
   - Handle Klemata-specific chrome and navigation

2. **HADDON-032:** Complete visible-location tracking
   - Enables better viewport/page synchronization
   - Preserves scroll position across theme changes
   - Emits rendition location events

3. **Future enhancements:**
   - Cross-revision recovery when `sourceRevision` changes
   - Multi-volume citations for series
   - Print-edition page number mapping
   - Collaborative citation sharing

## Files Changed

```
docs/design/citation-deep-link.md                      (new, 339 lines)
packages/haddon-citation-router/package.json           (new)
packages/haddon-citation-router/open-citation.ts       (new, 261 lines)
packages/haddon-citation-router/parse-citation-url.ts  (new, 141 lines)
packages/haddon-citation-router/open-citation.test.ts  (new, 466 lines)
packages/haddon-citation-router/README.md              (new, 134 lines)
apps/demo/src/SemanticReader.tsx                       (modified, +74 lines)
docs/ROADMAP.md                                        (modified, +7 lines)
```

## Dependencies

- **HADDON-040:** CitationEnvelopeV1 schema (complete, PR #5)
- **HADDON-032:** Visible-location tracking (in progress, not blocking)

## References

- **Design doc:** `docs/design/citation-deep-link.md`
- **Citation envelope:** `docs/design/citation-envelope.md`
- **Publication model:** `docs/design/publication-model.md`
- **PR #6:** https://github.com/andrew310/haddon/pull/6
- **Base branch:** `cursor/citation-envelope-haddon-040-2416`

---

**Version History:**
- 2026-08-15: Initial implementation complete
