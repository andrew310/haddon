# Haddon Citation Envelope Schema (Version 1)

**Status:** HADDON-040 design freeze for Klemata/Haddon citation storage and URLs

**Date:** 2026-08-15

**Scope:** Volume identity, edition identity, source revision, publication locator, quote context, label, schema versioning, and migration detection for citations used by:
- Haddon highlights and decorations
- Klemata deep links (HADDON-041 routing)
- Future Kadmos "suggest citation while typing" (not implemented here)

**Out of scope:** Remix UI, navigation routing (HADDON-041), Klemata storage adapter (HADDON-042), Kadmos write-side consumer, renderer implementation

## 1. Decision Summary

The labels in this section are normative for Version 1.

- **Decision:** A citation envelope wraps a `PublicationLocatorV1` with volume/edition identity and recovery state. The locator alone is not globally addressable.
- **Decision:** The join key for citation identity is: `volumeId` + `sourceRevision` + `PublicationLocatorV1` (href, locations, text). Layout, page number, and viewport position must not appear in the identity.
- **Decision:** `PublicationLocatorV1` is reused unchanged from `haddon.publication-locator` version 1. No second locator schema is invented.
- **Decision:** The envelope supports four confidence states: `exact`, `recovered`, `ambiguous`, `unresolved`. Recovery evidence is preserved.
- **Decision:** Klemata's canonical edition store is EPUB bytes in blob storage plus cards in git. `sourceRevision` is SHA-256 of the EPUB bytes. Haddon's user-upload bucket is not the canonical spine.
- **Decision:** Schema version and migration detection enable future envelope versions. A v1 document is detected by `schema: "haddon.citation-envelope"` and `version: 1`.
- **Decision:** Haddon remains its own product. Klemata is one host. Kadmos is a later write-side consumer of the same envelope.

## 2. Citation Envelope Contract

### 2.1 Core Types

```typescript
/**
 * Haddon Citation Envelope Version 1
 * 
 * Wraps a PublicationLocatorV1 with volume/edition identity and recovery state.
 * This is the canonical storage and URL representation for citations across
 * Haddon, Klemata, and future Kadmos.
 */
type CitationEnvelopeV1 = {
  /** Schema identifier for migration detection. */
  schema: "haddon.citation-envelope"
  /** Schema version. Must be 1 for V1 documents. */
  version: 1
  
  /** Klemata's stable identity for the conceptual volume. */
  volumeId: string
  
  /** Stable identity for the edition when Klemata has one. */
  editionId?: string
  
  /** 
   * SHA-256 fingerprint of the canonical EPUB bytes in Klemata's blob store.
   * Hex-encoded lowercase, 64 characters.
   */
  sourceRevision: string
  
  /** 
   * The publication locator identifying the citation target.
   * Reuses haddon.publication-locator version 1 unchanged.
   */
  locator: PublicationLocatorV1
  
  /** 
   * Recovery confidence when resolving this citation.
   * - exact: locator was resolved without ambiguity
   * - recovered: quote/context matched after normalized structure changed
   * - ambiguous: multiple candidates matched with equal confidence
   * - unresolved: citation could not be resolved in this source revision
   */
  confidence: "exact" | "recovered" | "ambiguous" | "unresolved"
  
  /** 
   * Human-readable label for UI presentation.
   * Optional. When present, used for link text, tooltips, or decoration labels.
   */
  label?: string
  
  /** 
   * Recovery evidence when confidence is not "exact".
   * Preserved to enable auditing, re-resolution, or manual override.
   */
  recoveryEvidence?: RecoveryEvidence
  
  /** 
   * Application-specific extensions.
   * Haddon core and Klemata may store workflow state here.
   */
  extensions?: Record<string, JsonValue>
}

/**
 * Evidence collected during citation recovery.
 * Preserved when confidence is "recovered", "ambiguous", or "unresolved".
 */
type RecoveryEvidence = {
  /** The original locator that failed exact resolution. */
  originalLocator?: PublicationLocatorV1
  
  /** Recovery strategy that produced this result. */
  strategy?: "quote-match" | "fragment-fallback" | "progression-estimate" | "manual"
  
  /** 
   * Alternative candidates when confidence is "ambiguous".
   * Each candidate includes its locator and a quality score [0, 1].
   */
  candidates?: Array<{
    locator: PublicationLocatorV1
    score: number
  }>
  
  /** Human-readable recovery message. */
  message?: string
}

/**
 * PublicationLocatorV1 from haddon.publication-locator version 1.
 * Reproduced here for reference; see crates/core/src/publication/locator.rs
 * and docs/design/publication-model.md for the canonical definition.
 */
type PublicationLocatorV1 = {
  schema: "haddon.publication-locator"
  version: 1
  href: string
  mediaType: string
  title?: string
  locations: LocatorLocations
  text?: LocatorText
  extensions?: Record<string, JsonValue>
}

type LocatorLocations = {
  fragments?: string[]
  epubCfi?: string
  cssSelector?: string
  domRange?: DomRangeSelector
  normalized?: NormalizedRangeSelector
  progression?: number
  totalProgression?: number
  position?: number
}

type LocatorText = {
  exact: string
  prefix?: string
  suffix?: string
}

type DomRangeSelector = {
  start: DomPointSelector
  end?: DomPointSelector
}

type DomPointSelector = {
  cssSelector: string
  textNodeIndex: number
  offset?: TextOffset
}

type NormalizedRangeSelector = {
  revision: string
  start: NormalizedPointSelector
  end?: NormalizedPointSelector
}

type NormalizedPointSelector = {
  blockId: string
  offset: TextOffset
}

type TextOffset = {
  value: number
  unit: "utf16-code-unit"
}

type JsonValue = 
  | string 
  | number 
  | boolean 
  | null 
  | JsonValue[] 
  | { [key: string]: JsonValue }
```

### 2.2 Identity and Join Key Rules

1. **Citation Identity:** Two citations are identical if and only if:
   - `volumeId` matches exactly
   - `sourceRevision` matches exactly
   - `locator.href` matches exactly (canonical publication-relative URI)
   - `locator.locations` structural selectors match (fragments, normalized, domRange)
   - `locator.text.exact` matches exactly

2. **Excluded from Identity:**
   - `editionId` (metadata, not identity)
   - `locator.locations.progression` (viewport-dependent)
   - `locator.locations.totalProgression` (viewport-dependent)
   - `locator.locations.position` (viewport-dependent)
   - `locator.locations.epubCfi` (fallback only)
   - `locator.locations.cssSelector` (fallback only)
   - `locator.title` (metadata)
   - `label` (presentation)
   - `confidence` (resolution state)
   - `recoveryEvidence` (debugging)

3. **Volume and Source Revision:**
   - `volumeId` is Klemata's stable conceptual identity (e.g., `klemata:work:uuid`)
   - `sourceRevision` is the SHA-256 hex digest of the canonical EPUB bytes
   - A citation persisted without `sourceRevision` is invalid (cannot be re-resolved)
   - `editionId` is optional until Klemata's edition model is finalized

4. **Locator Reuse:**
   - The envelope embeds `PublicationLocatorV1` unchanged
   - All locator validation rules apply (see `crates/core/src/publication/locator.rs`)
   - `locator.schema` must be `"haddon.publication-locator"`
   - `locator.version` must be `1` for V1 envelopes

### 2.3 Confidence Levels

| Confidence | Meaning | When Set |
|------------|---------|----------|
| `exact` | Locator resolved without ambiguity using normalized or structural selectors | Initial citation capture; re-resolution on unchanged source revision |
| `recovered` | Quote/context matched after normalized structure changed; new locator computed | Normalizer revision changed but text is stable |
| `ambiguous` | Multiple candidates matched with equal confidence | Quote appears multiple times; structural selectors failed |
| `unresolved` | Citation could not be resolved in this source revision | Source revision changed significantly; quote no longer present |

**Rules:**
- New citations captured by Haddon always start with `confidence: "exact"` (or `"ambiguous"` if multiple matches)
- When re-opening a citation, if the `sourceRevision` matches and the locator resolves, confidence remains `"exact"`
- If `sourceRevision` matches but the locator fails, recovery attempts to find the quote and sets `confidence: "recovered"` or `"ambiguous"`
- If `sourceRevision` does not match, resolution fails and sets `confidence: "unresolved"` (future work: attempt cross-revision recovery)
- `recoveryEvidence` must be present when confidence is not `"exact"`

### 2.4 Recovery Evidence

Recovery evidence is preserved to enable:
- Auditing: which recovery strategy was used?
- Re-resolution: can we retry with a different strategy?
- Manual override: does the user want to accept/reject this candidate?
- Debugging: why did exact resolution fail?

**When to populate `recoveryEvidence`:**
- `confidence: "recovered"` → include `originalLocator`, `strategy`, and `message`
- `confidence: "ambiguous"` → include `candidates` array with all matches and scores
- `confidence: "unresolved"` → include `originalLocator` and `message` explaining failure

**Recovery strategies (for future HADDON-042 implementation):**
- `quote-match`: text.exact + prefix/suffix matched in normalized text
- `fragment-fallback`: structural fragment resolved but range/offset failed
- `progression-estimate`: used totalProgression to estimate location
- `manual`: user selected a candidate or corrected the locator

## 3. JSON Serialization

### 3.1 Example: Exact Citation

```json
{
  "schema": "haddon.citation-envelope",
  "version": 1,
  "volumeId": "klemata:work:example-book-uuid",
  "sourceRevision": "a3c5f1e9b2d8c4f7a1e6d3b9c8f2e5a7d4b1c9e6f3a8d5b2e9c6f1a4d7b3e0c5",
  "locator": {
    "schema": "haddon.publication-locator",
    "version": 1,
    "href": "text/chapter-1.xhtml",
    "mediaType": "application/xhtml+xml",
    "locations": {
      "fragments": ["citation-target"],
      "normalized": {
        "revision": "haddon-normalizer/1+testdigest",
        "start": {
          "blockId": "src:text/chapter-1.xhtml#citation-target",
          "offset": { "value": 54, "unit": "utf16-code-unit" }
        },
        "end": {
          "blockId": "src:text/chapter-1.xhtml#citation-target",
          "offset": { "value": 87, "unit": "utf16-code-unit" }
        }
      }
    },
    "text": {
      "exact": "the patient moon answered in blue",
      "prefix": "Before the signal, the copper astrolabe clicked once; ",
      "suffix": ", and the lesson continued after midnight."
    }
  },
  "confidence": "exact",
  "label": "Chapter 1: Moon quote"
}
```

### 3.2 Example: Recovered Citation

```json
{
  "schema": "haddon.citation-envelope",
  "version": 1,
  "volumeId": "klemata:work:example-book-uuid",
  "sourceRevision": "b4d6e2f0c3a9d7b5e1f8c2a6d9b3e7f1c4a0d8e5f2b9c6e3f0a7d4b1e8c5f2",
  "locator": {
    "schema": "haddon.publication-locator",
    "version": 1,
    "href": "text/chapter-1.xhtml",
    "mediaType": "application/xhtml+xml",
    "locations": {
      "fragments": ["citation-target"],
      "normalized": {
        "revision": "haddon-normalizer/2+newdigest",
        "start": {
          "blockId": "src:text/chapter-1.xhtml#citation-target",
          "offset": { "value": 60, "unit": "utf16-code-unit" }
        },
        "end": {
          "blockId": "src:text/chapter-1.xhtml#citation-target",
          "offset": { "value": 93, "unit": "utf16-code-unit" }
        }
      }
    },
    "text": {
      "exact": "the patient moon answered in blue",
      "prefix": "Before the signal, the copper astrolabe clicked once; ",
      "suffix": ", and the lesson continued after midnight."
    }
  },
  "confidence": "recovered",
  "label": "Chapter 1: Moon quote",
  "recoveryEvidence": {
    "originalLocator": {
      "schema": "haddon.publication-locator",
      "version": 1,
      "href": "text/chapter-1.xhtml",
      "mediaType": "application/xhtml+xml",
      "locations": {
        "fragments": ["citation-target"],
        "normalized": {
          "revision": "haddon-normalizer/1+testdigest",
          "start": {
            "blockId": "src:text/chapter-1.xhtml#citation-target",
            "offset": { "value": 54, "unit": "utf16-code-unit" }
          },
          "end": {
            "blockId": "src:text/chapter-1.xhtml#citation-target",
            "offset": { "value": 87, "unit": "utf16-code-unit" }
          }
        }
      },
      "text": {
        "exact": "the patient moon answered in blue",
        "prefix": "Before the signal, the copper astrolabe clicked once; ",
        "suffix": ", and the lesson continued after midnight."
      }
    },
    "strategy": "quote-match",
    "message": "Normalized structure changed (revision haddon-normalizer/1+testdigest → haddon-normalizer/2+newdigest); quote matched at new offset"
  }
}
```

### 3.3 Example: Ambiguous Citation

```json
{
  "schema": "haddon.citation-envelope",
  "version": 1,
  "volumeId": "klemata:work:example-book-uuid",
  "sourceRevision": "a3c5f1e9b2d8c4f7a1e6d3b9c8f2e5a7d4b1c9e6f3a8d5b2e9c6f1a4d7b3e0c5",
  "locator": {
    "schema": "haddon.publication-locator",
    "version": 1,
    "href": "text/chapter-2.xhtml",
    "mediaType": "application/xhtml+xml",
    "locations": {
      "normalized": {
        "revision": "haddon-normalizer/1+testdigest",
        "start": {
          "blockId": "src:text/chapter-2.xhtml#para-5",
          "offset": { "value": 0, "unit": "utf16-code-unit" }
        },
        "end": {
          "blockId": "src:text/chapter-2.xhtml#para-5",
          "offset": { "value": 12, "unit": "utf16-code-unit" }
        }
      }
    },
    "text": {
      "exact": "Hello, world",
      "prefix": "The message read: ",
      "suffix": ". It was simple."
    }
  },
  "confidence": "ambiguous",
  "label": "Hello world reference",
  "recoveryEvidence": {
    "strategy": "quote-match",
    "message": "Multiple instances of quote found with equal confidence",
    "candidates": [
      {
        "locator": {
          "schema": "haddon.publication-locator",
          "version": 1,
          "href": "text/chapter-2.xhtml",
          "mediaType": "application/xhtml+xml",
          "locations": {
            "normalized": {
              "revision": "haddon-normalizer/1+testdigest",
              "start": {
                "blockId": "src:text/chapter-2.xhtml#para-5",
                "offset": { "value": 0, "unit": "utf16-code-unit" }
              },
              "end": {
                "blockId": "src:text/chapter-2.xhtml#para-5",
                "offset": { "value": 12, "unit": "utf16-code-unit" }
              }
            }
          },
          "text": {
            "exact": "Hello, world"
          }
        },
        "score": 0.95
      },
      {
        "locator": {
          "schema": "haddon.publication-locator",
          "version": 1,
          "href": "text/chapter-3.xhtml",
          "mediaType": "application/xhtml+xml",
          "locations": {
            "normalized": {
              "revision": "haddon-normalizer/1+testdigest",
              "start": {
                "blockId": "src:text/chapter-3.xhtml#para-12",
                "offset": { "value": 15, "unit": "utf16-code-unit" }
              },
              "end": {
                "blockId": "src:text/chapter-3.xhtml#para-12",
                "offset": { "value": 27, "unit": "utf16-code-unit" }
              }
            }
          },
          "text": {
            "exact": "Hello, world"
          }
        },
        "score": 0.95
      }
    ]
  }
}
```

### 3.4 Example: Unresolved Citation

```json
{
  "schema": "haddon.citation-envelope",
  "version": 1,
  "volumeId": "klemata:work:example-book-uuid",
  "sourceRevision": "c5e7f3a1d9b6e4f2c0a8d5b3e1f9c7a4d2b0e8f6c3a1d7b5e9f2c4a6d8b1e3c0",
  "locator": {
    "schema": "haddon.publication-locator",
    "version": 1,
    "href": "text/removed-chapter.xhtml",
    "mediaType": "application/xhtml+xml",
    "locations": {},
    "text": {
      "exact": "This passage was removed in the new edition"
    }
  },
  "confidence": "unresolved",
  "label": "Removed passage",
  "recoveryEvidence": {
    "originalLocator": {
      "schema": "haddon.publication-locator",
      "version": 1,
      "href": "text/chapter-5.xhtml",
      "mediaType": "application/xhtml+xml",
      "locations": {
        "fragments": ["old-section"],
        "normalized": {
          "revision": "haddon-normalizer/1+olddigest",
          "start": {
            "blockId": "src:text/chapter-5.xhtml#old-section",
            "offset": { "value": 0, "unit": "utf16-code-unit" }
          },
          "end": {
            "blockId": "src:text/chapter-5.xhtml#old-section",
            "offset": { "value": 44, "unit": "utf16-code-unit" }
          }
        }
      },
      "text": {
        "exact": "This passage was removed in the new edition"
      }
    },
    "strategy": "quote-match",
    "message": "Quote not found in source revision c5e7f3a1...; resource text/chapter-5.xhtml no longer contains matching text"
  }
}
```

## 4. Schema Versioning and Migration

### 4.1 Version Detection

To detect a V1 citation envelope:

```typescript
function isCitationEnvelopeV1(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "schema" in value &&
    value.schema === "haddon.citation-envelope" &&
    "version" in value &&
    value.version === 1
  )
}
```

To detect any citation envelope (forward-compatible):

```typescript
function isCitationEnvelope(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "schema" in value &&
    value.schema === "haddon.citation-envelope" &&
    "version" in value &&
    typeof value.version === "number" &&
    value.version >= 1
  )
}
```

### 4.2 Migration Stub

When a future version 2 is introduced:

```typescript
type CitationEnvelope = CitationEnvelopeV1 | CitationEnvelopeV2 // | ...

function migrateCitationEnvelope(
  envelope: CitationEnvelope
): CitationEnvelopeV2 {
  switch (envelope.version) {
    case 1:
      return migrateCitationV1toV2(envelope)
    case 2:
      return envelope
    default:
      throw new Error(
        `Unsupported citation envelope version: ${(envelope as any).version}`
      )
  }
}

function migrateCitationV1toV2(
  v1: CitationEnvelopeV1
): CitationEnvelopeV2 {
  // Future implementation
  throw new Error("V1→V2 migration not yet implemented")
}
```

### 4.3 Migration Invariants

1. **Forward compatibility:** Old clients ignore unknown fields (via `extensions`)
2. **Backward compatibility:** New versions must support reading V1 envelopes
3. **Lossless migration:** All V1 data is preserved in V2 (possibly in `extensions.v1Legacy`)
4. **Identity preservation:** `volumeId` + `sourceRevision` + locator identity must remain stable across migrations
5. **Confidence preservation:** A V1 `exact` citation migrated to V2 remains `exact` until re-resolved

## 5. Klemata Integration Contract

### 5.1 Edition Store (External to Haddon)

From `klemata/docs/sources/editions.md` (not reproduced here):
- Klemata stores canonical EPUB bytes in blob storage
- Each volume has one or more editions
- Each edition has a `sourceRevision` (SHA-256 of EPUB bytes)
- Klemata's card store (git) references editions by `volumeId` + `editionId`/`sourceRevision`

### 5.2 Haddon's Responsibilities

1. **Citation creation:** Haddon produces `CitationEnvelopeV1` when user creates a highlight/decoration
2. **Citation resolution:** Haddon accepts `CitationEnvelopeV1` and resolves it to a visible decoration
3. **Recovery:** Haddon attempts quote-match recovery when structural selectors fail
4. **Confidence reporting:** Haddon reports `exact`, `recovered`, `ambiguous`, `unresolved` to Klemata

### 5.3 Klemata's Responsibilities

1. **Volume/Edition mapping:** Klemata provides `volumeId`, `editionId`, `sourceRevision` when opening a publication
2. **Storage:** Klemata persists `CitationEnvelopeV1` in its card store
3. **Deep linking (HADDON-041):** Klemata constructs URLs from envelopes and routes to Haddon
4. **UI policy:** Klemata decides how to present `ambiguous` or `unresolved` citations to users

### 5.4 URL Encoding (HADDON-041 Preview)

Future deep-link URLs will encode a citation envelope. Example structures (not finalized):

**Option A: Base64-encoded JSON**
```
https://klemata.app/read/klemata:work:uuid?citation=eyJzY2hlbWEiOiJoYWRkb24uY2l0YXRpb24tZW52ZWxvcGUiLCAidmVyc2lvbiI6MX0=
```

**Option B: Query-parameter decomposition (simple citations only)**
```
https://klemata.app/read/klemata:work:uuid?
  sourceRevision=a3c5f1e9...&
  href=text/chapter-1.xhtml&
  exact=the+patient+moon+answered+in+blue&
  prefix=Before+the+signal...
```

**Decision:** URL encoding is deferred to HADDON-041. Both approaches are compatible with `CitationEnvelopeV1`.

## 6. Open Questions and Future Work

### 6.1 Not Addressed in V1

- **HADDON-041:** Deep-link URL routing from Klemata to Haddon
- **HADDON-042:** Remix 3 host adapter and storage integration
- **Kadmos integration:** Write-side citation suggestions (no target date)
- **Cross-revision recovery:** Resolving citations when `sourceRevision` changes
- **Multi-volume citations:** Citing across multiple volumes (e.g., series)
- **Edition preferences:** Which edition to open when multiple exist

### 6.2 Known Limitations

1. **No page number mapping:** `locator.locations.position` is viewport-dependent and not stable across devices
2. **No print-edition sync:** Mapping EPUB citations to print page numbers requires external data
3. **No annotation storage:** Comments, tags, and user notes belong in Klemata's card schema, not the envelope
4. **No collaborative citations:** Shared/public citations require Klemata identity and permissions
5. **No citation graphs:** Citation-to-citation references (replies, threads) belong in Klemata

### 6.3 Testing Requirements (HADDON-040 Acceptance)

The implementation must include round-trip tests for:
- ✅ Exact citation (structural + quote)
- ✅ Recovered citation (normalized revision changed)
- ✅ Ambiguous citation (multiple candidates)
- ✅ Unresolved citation (quote not found)
- ✅ Schema version detection (V1 vs. unknown version)
- ✅ Migration stub (forward-compatible detection)

## 7. References

- **Publication model:** `docs/design/publication-model.md`
- **Locator contract:** `docs/design/publication-model.md` § 8
- **Locator implementation:** `crates/core/src/publication/locator.rs`
- **Locator tests:** `crates/core/tests/locator_contract.rs`
- **Klemata edition store:** `klemata/docs/sources/editions.md` (external)
- **HADDON-041 routing:** (not yet written)
- **HADDON-042 adapter:** (not yet written)

---

**Version History:**
- 2026-08-15: Initial V1 design freeze for HADDON-040
