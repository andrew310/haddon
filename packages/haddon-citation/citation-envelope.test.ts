/**
 * Citation Envelope JSON Round-Trip Tests
 * 
 * Tests for exact, recovered, ambiguous, and unresolved citations,
 * plus schema version detection and migration stubs.
 */

import { describe, it, expect } from "vitest"
import {
  CitationEnvelopeV1,
  PublicationLocatorV1,
  isCitationEnvelopeV1,
  isCitationEnvelope,
  parseCitationEnvelope,
  serializeCitationEnvelope,
  migrateCitationEnvelope,
} from "./citation-envelope"

const EXAMPLE_VOLUME_ID = "klemata:work:example-book-uuid"
const EXAMPLE_SOURCE_REV =
  "a3c5f1e9b2d8c4f7a1e6d3b9c8f2e5a7d4b1c9e6f3a8d5b2e9c6f1a4d7b3e0c5"

function exampleLocator(): PublicationLocatorV1 {
  return {
    schema: "haddon.publication-locator",
    version: 1,
    href: "text/chapter-1.xhtml",
    mediaType: "application/xhtml+xml",
    locations: {
      fragments: ["citation-target"],
      normalized: {
        revision: "haddon-normalizer/1+testdigest",
        start: {
          blockId: "src:text/chapter-1.xhtml#citation-target",
          offset: { value: 54, unit: "utf16-code-unit" },
        },
        end: {
          blockId: "src:text/chapter-1.xhtml#citation-target",
          offset: { value: 87, unit: "utf16-code-unit" },
        },
      },
    },
    text: {
      exact: "the patient moon answered in blue",
      prefix: "Before the signal, the copper astrolabe clicked once; ",
      suffix: ", and the lesson continued after midnight.",
    },
  }
}

describe("Citation Envelope - Exact", () => {
  it("round-trips an exact citation with all required fields", () => {
    const envelope: CitationEnvelopeV1 = {
      schema: "haddon.citation-envelope",
      version: 1,
      volumeId: EXAMPLE_VOLUME_ID,
      sourceRevision: EXAMPLE_SOURCE_REV,
      locator: exampleLocator(),
      confidence: "exact",
    }

    const json = serializeCitationEnvelope(envelope)
    const parsed = parseCitationEnvelope(json)

    expect(parsed).toEqual(envelope)
    expect(parsed.confidence).toBe("exact")
    expect(parsed.recoveryEvidence).toBeUndefined()
  })

  it("preserves optional label and editionId", () => {
    const envelope: CitationEnvelopeV1 = {
      schema: "haddon.citation-envelope",
      version: 1,
      volumeId: EXAMPLE_VOLUME_ID,
      editionId: "edition-123",
      sourceRevision: EXAMPLE_SOURCE_REV,
      locator: exampleLocator(),
      confidence: "exact",
      label: "Chapter 1: Moon quote",
    }

    const json = serializeCitationEnvelope(envelope)
    const parsed = parseCitationEnvelope(json)

    expect(parsed.editionId).toBe("edition-123")
    expect(parsed.label).toBe("Chapter 1: Moon quote")
  })

  it("preserves extensions", () => {
    const envelope: CitationEnvelopeV1 = {
      schema: "haddon.citation-envelope",
      version: 1,
      volumeId: EXAMPLE_VOLUME_ID,
      sourceRevision: EXAMPLE_SOURCE_REV,
      locator: exampleLocator(),
      confidence: "exact",
      extensions: {
        "klemata.cardId": "card-abc123",
        "haddon.createdAt": "2026-08-15T15:45:00Z",
      },
    }

    const json = serializeCitationEnvelope(envelope)
    const parsed = parseCitationEnvelope(json)

    expect(parsed.extensions).toEqual({
      "klemata.cardId": "card-abc123",
      "haddon.createdAt": "2026-08-15T15:45:00Z",
    })
  })
})

describe("Citation Envelope - Recovered", () => {
  it("round-trips a recovered citation with evidence", () => {
    const originalLocator = exampleLocator()
    const recoveredLocator: PublicationLocatorV1 = {
      ...exampleLocator(),
      locations: {
        ...exampleLocator().locations,
        normalized: {
          revision: "haddon-normalizer/2+newdigest",
          start: {
            blockId: "src:text/chapter-1.xhtml#citation-target",
            offset: { value: 60, unit: "utf16-code-unit" },
          },
          end: {
            blockId: "src:text/chapter-1.xhtml#citation-target",
            offset: { value: 93, unit: "utf16-code-unit" },
          },
        },
      },
    }

    const envelope: CitationEnvelopeV1 = {
      schema: "haddon.citation-envelope",
      version: 1,
      volumeId: EXAMPLE_VOLUME_ID,
      sourceRevision: EXAMPLE_SOURCE_REV,
      locator: recoveredLocator,
      confidence: "recovered",
      recoveryEvidence: {
        originalLocator,
        strategy: "quote-match",
        message:
          "Normalized structure changed (revision haddon-normalizer/1+testdigest → haddon-normalizer/2+newdigest); quote matched at new offset",
      },
    }

    const json = serializeCitationEnvelope(envelope)
    const parsed = parseCitationEnvelope(json)

    expect(parsed.confidence).toBe("recovered")
    expect(parsed.recoveryEvidence).toBeDefined()
    expect(parsed.recoveryEvidence?.originalLocator).toEqual(originalLocator)
    expect(parsed.recoveryEvidence?.strategy).toBe("quote-match")
    expect(parsed.recoveryEvidence?.message).toContain("Normalized structure changed")
  })

  it("accepts all recovery strategies", () => {
    const strategies: Array<"quote-match" | "fragment-fallback" | "progression-estimate" | "manual"> = [
      "quote-match",
      "fragment-fallback",
      "progression-estimate",
      "manual",
    ]

    for (const strategy of strategies) {
      const envelope: CitationEnvelopeV1 = {
        schema: "haddon.citation-envelope",
        version: 1,
        volumeId: EXAMPLE_VOLUME_ID,
        sourceRevision: EXAMPLE_SOURCE_REV,
        locator: exampleLocator(),
        confidence: "recovered",
        recoveryEvidence: {
          strategy,
          message: `Recovered via ${strategy}`,
        },
      }

      const json = serializeCitationEnvelope(envelope)
      const parsed = parseCitationEnvelope(json)

      expect(parsed.recoveryEvidence?.strategy).toBe(strategy)
    }
  })
})

describe("Citation Envelope - Ambiguous", () => {
  it("round-trips an ambiguous citation with multiple candidates", () => {
    const locator1 = exampleLocator()
    const locator2: PublicationLocatorV1 = {
      ...exampleLocator(),
      href: "text/chapter-3.xhtml",
      locations: {
        normalized: {
          revision: "haddon-normalizer/1+testdigest",
          start: {
            blockId: "src:text/chapter-3.xhtml#para-12",
            offset: { value: 15, unit: "utf16-code-unit" },
          },
          end: {
            blockId: "src:text/chapter-3.xhtml#para-12",
            offset: { value: 48, unit: "utf16-code-unit" },
          },
        },
      },
    }

    const envelope: CitationEnvelopeV1 = {
      schema: "haddon.citation-envelope",
      version: 1,
      volumeId: EXAMPLE_VOLUME_ID,
      sourceRevision: EXAMPLE_SOURCE_REV,
      locator: locator1,
      confidence: "ambiguous",
      recoveryEvidence: {
        strategy: "quote-match",
        message: "Multiple instances of quote found with equal confidence",
        candidates: [
          { locator: locator1, score: 0.95 },
          { locator: locator2, score: 0.95 },
        ],
      },
    }

    const json = serializeCitationEnvelope(envelope)
    const parsed = parseCitationEnvelope(json)

    expect(parsed.confidence).toBe("ambiguous")
    expect(parsed.recoveryEvidence?.candidates).toHaveLength(2)
    expect(parsed.recoveryEvidence?.candidates?.[0].score).toBe(0.95)
    expect(parsed.recoveryEvidence?.candidates?.[1].score).toBe(0.95)
    expect(parsed.recoveryEvidence?.candidates?.[0].locator.href).toBe(
      "text/chapter-1.xhtml"
    )
    expect(parsed.recoveryEvidence?.candidates?.[1].locator.href).toBe(
      "text/chapter-3.xhtml"
    )
  })
})

describe("Citation Envelope - Unresolved", () => {
  it("round-trips an unresolved citation", () => {
    const originalLocator = exampleLocator()

    const envelope: CitationEnvelopeV1 = {
      schema: "haddon.citation-envelope",
      version: 1,
      volumeId: EXAMPLE_VOLUME_ID,
      sourceRevision: "c5e7f3a1d9b6e4f2c0a8d5b3e1f9c7a4d2b0e8f6c3a1d7b5e9f2c4a6d8b1e3c0",
      locator: {
        schema: "haddon.publication-locator",
        version: 1,
        href: "text/removed-chapter.xhtml",
        mediaType: "application/xhtml+xml",
        locations: {},
        text: {
          exact: "This passage was removed in the new edition",
        },
      },
      confidence: "unresolved",
      label: "Removed passage",
      recoveryEvidence: {
        originalLocator,
        strategy: "quote-match",
        message:
          "Quote not found in source revision c5e7f3a1...; resource text/chapter-5.xhtml no longer contains matching text",
      },
    }

    const json = serializeCitationEnvelope(envelope)
    const parsed = parseCitationEnvelope(json)

    expect(parsed.confidence).toBe("unresolved")
    expect(parsed.recoveryEvidence?.originalLocator).toEqual(originalLocator)
    expect(parsed.recoveryEvidence?.message).toContain("Quote not found")
  })
})

describe("Schema Version Detection", () => {
  it("detects a V1 citation envelope", () => {
    const envelope: CitationEnvelopeV1 = {
      schema: "haddon.citation-envelope",
      version: 1,
      volumeId: EXAMPLE_VOLUME_ID,
      sourceRevision: EXAMPLE_SOURCE_REV,
      locator: exampleLocator(),
      confidence: "exact",
    }

    expect(isCitationEnvelopeV1(envelope)).toBe(true)
    expect(isCitationEnvelope(envelope)).toBe(true)
  })

  it("rejects objects with wrong schema", () => {
    const notEnvelope = {
      schema: "wrong.schema",
      version: 1,
      volumeId: EXAMPLE_VOLUME_ID,
      sourceRevision: EXAMPLE_SOURCE_REV,
      locator: exampleLocator(),
      confidence: "exact",
    }

    expect(isCitationEnvelopeV1(notEnvelope)).toBe(false)
    expect(isCitationEnvelope(notEnvelope)).toBe(false)
  })

  it("rejects objects with missing version", () => {
    const noVersion = {
      schema: "haddon.citation-envelope",
      volumeId: EXAMPLE_VOLUME_ID,
      sourceRevision: EXAMPLE_SOURCE_REV,
      locator: exampleLocator(),
      confidence: "exact",
    }

    expect(isCitationEnvelopeV1(noVersion)).toBe(false)
    expect(isCitationEnvelope(noVersion)).toBe(false)
  })

  it("detects future versions as citation envelopes but not V1", () => {
    const futureVersion = {
      schema: "haddon.citation-envelope",
      version: 2,
      volumeId: EXAMPLE_VOLUME_ID,
      sourceRevision: EXAMPLE_SOURCE_REV,
      locator: exampleLocator(),
      confidence: "exact",
    }

    expect(isCitationEnvelopeV1(futureVersion)).toBe(false)
    expect(isCitationEnvelope(futureVersion)).toBe(true)
  })
})

describe("Migration Stub", () => {
  it("migrates a V1 envelope to itself (no-op)", () => {
    const envelope: CitationEnvelopeV1 = {
      schema: "haddon.citation-envelope",
      version: 1,
      volumeId: EXAMPLE_VOLUME_ID,
      sourceRevision: EXAMPLE_SOURCE_REV,
      locator: exampleLocator(),
      confidence: "exact",
    }

    const migrated = migrateCitationEnvelope(envelope)

    expect(migrated).toEqual(envelope)
  })

  it("throws on unsupported future versions", () => {
    const futureVersion = {
      schema: "haddon.citation-envelope",
      version: 99,
      volumeId: EXAMPLE_VOLUME_ID,
      sourceRevision: EXAMPLE_SOURCE_REV,
      locator: exampleLocator(),
      confidence: "exact",
    } as any

    expect(() => migrateCitationEnvelope(futureVersion)).toThrow(
      "Unsupported citation envelope version: 99"
    )
  })
})

describe("Parse Errors", () => {
  it("throws on invalid JSON", () => {
    expect(() => parseCitationEnvelope("not valid json")).toThrow()
  })

  it("throws on missing required fields", () => {
    const missingVolumeId = JSON.stringify({
      schema: "haddon.citation-envelope",
      version: 1,
      sourceRevision: EXAMPLE_SOURCE_REV,
      locator: exampleLocator(),
      confidence: "exact",
    })

    expect(() => parseCitationEnvelope(missingVolumeId)).toThrow()
  })

  it("throws on unsupported version", () => {
    const unsupportedVersion = JSON.stringify({
      schema: "haddon.citation-envelope",
      version: 2,
      volumeId: EXAMPLE_VOLUME_ID,
      sourceRevision: EXAMPLE_SOURCE_REV,
      locator: exampleLocator(),
      confidence: "exact",
    })

    expect(() => parseCitationEnvelope(unsupportedVersion)).toThrow(
      "Unsupported citation envelope version: 2"
    )
  })

  it("throws on wrong schema", () => {
    const wrongSchema = JSON.stringify({
      schema: "wrong.schema",
      version: 1,
      volumeId: EXAMPLE_VOLUME_ID,
      sourceRevision: EXAMPLE_SOURCE_REV,
      locator: exampleLocator(),
      confidence: "exact",
    })

    expect(() => parseCitationEnvelope(wrongSchema)).toThrow(
      "Invalid citation envelope"
    )
  })
})
