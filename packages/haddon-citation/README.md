# Haddon Citation Envelope

Portable TypeScript types for Haddon citation storage and deep linking (Version 1).

## Overview

The citation envelope wraps a `PublicationLocatorV1` with volume/edition identity and recovery state. This is the canonical storage and URL representation for citations across Haddon, Klemata, and future Kadmos.

See [`../../docs/design/citation-envelope.md`](../../docs/design/citation-envelope.md) for the complete specification.

## Usage

### Creating a Citation

```typescript
import type { CitationEnvelopeV1 } from "haddon-citation"

const citation: CitationEnvelopeV1 = {
  schema: "haddon.citation-envelope",
  version: 1,
  volumeId: "klemata:work:example-uuid",
  sourceRevision: "a3c5f1e9b2d8c4f7a1e6d3b9c8f2e5a7d4b1c9e6f3a8d5b2e9c6f1a4d7b3e0c5",
  locator: {
    schema: "haddon.publication-locator",
    version: 1,
    href: "text/chapter-1.xhtml",
    mediaType: "application/xhtml+xml",
    locations: {
      fragments: ["citation-target"],
    },
    text: {
      exact: "the patient moon answered in blue",
      prefix: "Before the signal, the copper astrolabe clicked once; ",
      suffix: ", and the lesson continued after midnight.",
    },
  },
  confidence: "exact",
  label: "Chapter 1: Moon quote",
}
```

### Parsing and Serializing

```typescript
import {
  parseCitationEnvelope,
  serializeCitationEnvelope,
} from "haddon-citation"

// Parse from JSON
const citation = parseCitationEnvelope(jsonString)

// Serialize to JSON
const json = serializeCitationEnvelope(citation)
```

### Version Detection

```typescript
import { isCitationEnvelopeV1, isCitationEnvelope } from "haddon-citation"

// Check if a value is specifically V1
if (isCitationEnvelopeV1(value)) {
  // Use as CitationEnvelopeV1
}

// Check if a value is any version (forward-compatible)
if (isCitationEnvelope(value)) {
  // Parse and migrate as needed
}
```

### Migration (Future V2)

```typescript
import { migrateCitationEnvelope } from "haddon-citation"

// Currently a no-op (only V1 exists)
// Future versions will migrate V1 → V2 losslessly
const latest = migrateCitationEnvelope(v1Citation)
```

## Confidence Levels

| Confidence   | Meaning                                                                |
| ------------ | ---------------------------------------------------------------------- |
| `exact`      | Locator resolved without ambiguity                                     |
| `recovered`  | Quote matched after normalized structure changed                       |
| `ambiguous`  | Multiple candidates matched with equal confidence                      |
| `unresolved` | Citation could not be resolved in this source revision                 |

## Citation Identity

Two citations are identical if and only if:

- `volumeId` matches exactly
- `sourceRevision` matches exactly
- `locator.href` matches exactly
- `locator.locations` structural selectors match
- `locator.text.exact` matches exactly

**Excluded from identity:**

- `label`, `confidence`, `recoveryEvidence` (presentation/state)
- `locator.locations.progression/totalProgression/position` (viewport-dependent)
- `editionId` (metadata, not identity)

## Testing

```bash
npm test
```

All 17 round-trip tests pass for exact, recovered, ambiguous, and unresolved citations, plus schema version detection and migration stubs.

## Related

- Design doc: [`../../docs/design/citation-envelope.md`](../../docs/design/citation-envelope.md)
- Rust types: [`../../crates/core/src/publication/citation.rs`](../../crates/core/src/publication/citation.rs)
- Publication locator: [`../../docs/design/publication-model.md`](../../docs/design/publication-model.md)
