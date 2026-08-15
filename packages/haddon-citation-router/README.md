# Haddon Citation Router

Portable TypeScript functions for citation deep-link routing (HADDON-041).

## Overview

This package provides portable, framework-neutral functions to:
- Parse citation URLs (query parameters or base64-encoded envelopes)
- Resolve citations using the publication/locator services
- Return typed resolution outcomes (exact, recovered, ambiguous, unresolved)

See [`../../docs/design/citation-deep-link.md`](../../docs/design/citation-deep-link.md) for the complete specification.

## Usage

### Open a Citation

```typescript
import { openCitation } from "haddon-citation-router"

// From URL search params
const params = new URLSearchParams(window.location.search)
const result = openCitation(params, publicationSession, volumeId)

// From CitationEnvelopeV1
const result = openCitation(envelope, publicationSession)

// From fragment hash
const result = openCitation("#citation-target", publicationSession)
```

### Parse Citation URLs

```typescript
import { parseCitationUrl } from "haddon-citation-router"

const params = new URLSearchParams(
  "sourceRevision=abc123&href=text/chapter-1.xhtml&exact=hello+world"
)
const envelope = parseCitationUrl(params, "volume-id")
```

### Encode Citation URLs

```typescript
import { encodeCitationUrl } from "haddon-citation-router"

const envelope: CitationEnvelopeV1 = { /* ... */ }
const params = encodeCitationUrl(envelope)

// Use in URL
const url = `https://example.com/read/volume-id?${params.toString()}`
```

## Resolution Outcomes

### Exact

```typescript
{
  status: "exact",
  target: {
    href: "text/chapter-1.xhtml",
    blockId: "block-1",
    startOffset: 0,
    endOffset: 11,
    exact: "hello world"
  }
}
```

### Recovered

```typescript
{
  status: "recovered",
  target: { /* ... */ },
  evidence: {
    originalLocator: { /* ... */ },
    strategy: "quote-match",
    message: "Quote matched with strong confidence using quote-match"
  }
}
```

### Ambiguous

```typescript
{
  status: "ambiguous",
  candidates: [
    { href: "text/chapter-1.xhtml", blockId: "block-1", /* ... */ },
    { href: "text/chapter-2.xhtml", blockId: "block-10", /* ... */ }
  ],
  evidence: {
    strategy: "quote",
    candidates: [
      { locator: { /* ... */ }, score: 0.9 },
      { locator: { /* ... */ }, score: 0.9 }
    ],
    message: "Found 2 candidates with equal confidence"
  }
}
```

### Unresolved

```typescript
{
  status: "unresolved",
  reason: "quote-not-found",
  evidence: { /* optional */ }
}
```

## URL Formats

### Simple Query Parameters

```
?sourceRevision=abc123&href=text/chapter-1.xhtml&exact=hello+world&prefix=say+&suffix=+everyone
```

### Base64-Encoded Envelope

```
?envelope=eyJzY2hlbWEiOiJoYWRkb24uY2l0YXRpb24tZW52ZWxvcGUiLCAidmVyc2lvbiI6MX0=
```

### Fragment Identifier

```
#citation-target
```

## Testing

```bash
npm test
```

All tests pass for exact, recovered, ambiguous, and unresolved citations, plus URL parsing/encoding roundtrips.

## Related

- Design doc: [`../../docs/design/citation-deep-link.md`](../../docs/design/citation-deep-link.md)
- Citation envelope: [`../haddon-citation/`](../haddon-citation/)
- Demo wiring: [`../../apps/demo/src/SemanticReader.tsx`](../../apps/demo/src/SemanticReader.tsx)
