/**
 * Tests for HADDON-041: citation deep-link routing.
 * 
 * Tests parse/resolve outcomes (exact, recovered, ambiguous, unresolved)
 * without mocking away envelope fields.
 */

import { describe, test, expect } from "vitest"
import {
  openCitation,
  parseCitationUrl,
  encodeCitationUrl,
  parseFragmentFromHash,
  type PublicationSession,
  type CitationEnvelopeV1,
} from "./open-citation"

class MockPublicationSession implements PublicationSession {
  constructor(private mockResult: object | Error) {}

  resolve_json(locatorJson: string, _policy: string): string {
    if (this.mockResult instanceof Error) {
      throw this.mockResult
    }
    return JSON.stringify(this.mockResult)
  }
}

describe("parseCitationUrl", () => {
  test("parses simple query parameters", () => {
    const params = new URLSearchParams(
      "sourceRevision=a3c5f1e9b2d8c4f7&href=text/chapter-1.xhtml&exact=hello+world&prefix=the&suffix=end"
    )
    const result = parseCitationUrl(params, "test-volume")

    expect(result).toBeDefined()
    expect(result?.schema).toBe("haddon.citation-envelope")
    expect(result?.version).toBe(1)
    expect(result?.volumeId).toBe("test-volume")
    expect(result?.sourceRevision).toBe("a3c5f1e9b2d8c4f7")
    expect(result?.locator.href).toBe("text/chapter-1.xhtml")
    expect(result?.locator.text?.exact).toBe("hello world")
    expect(result?.locator.text?.prefix).toBe("the")
    expect(result?.locator.text?.suffix).toBe("end")
  })

  test("parses fragment-only citation", () => {
    const params = new URLSearchParams(
      "sourceRevision=abc123&href=text/chapter-1.xhtml&fragment=citation-target"
    )
    const result = parseCitationUrl(params, "test-volume")

    expect(result).toBeDefined()
    expect(result?.locator.locations.fragments).toEqual(["citation-target"])
  })

  test("parses base64-encoded envelope", () => {
    const envelope: CitationEnvelopeV1 = {
      schema: "haddon.citation-envelope",
      version: 1,
      volumeId: "test-volume",
      sourceRevision: "abc123",
      locator: {
        schema: "haddon.publication-locator",
        version: 1,
        href: "text/chapter-1.xhtml",
        mediaType: "application/xhtml+xml",
        locations: {},
        text: { exact: "hello world" },
      },
      confidence: "exact",
    }
    const encoded = btoa(JSON.stringify(envelope))
    const params = new URLSearchParams(`envelope=${encoded}`)

    const result = parseCitationUrl(params, "ignored-volume")

    expect(result).toEqual(envelope)
  })

  test("returns null for missing selector", () => {
    const params = new URLSearchParams("sourceRevision=abc123&href=text/chapter-1.xhtml")
    const result = parseCitationUrl(params, "test-volume")

    expect(result).toBeNull()
  })

  test("returns null for missing sourceRevision", () => {
    const params = new URLSearchParams("href=text/chapter-1.xhtml&exact=hello")
    const result = parseCitationUrl(params, "test-volume")

    expect(result).toBeNull()
  })
})

describe("encodeCitationUrl", () => {
  test("encodes simple citation as query parameters", () => {
    const envelope: CitationEnvelopeV1 = {
      schema: "haddon.citation-envelope",
      version: 1,
      volumeId: "test-volume",
      sourceRevision: "abc123",
      locator: {
        schema: "haddon.publication-locator",
        version: 1,
        href: "text/chapter-1.xhtml",
        mediaType: "application/xhtml+xml",
        locations: {},
        text: { exact: "hello world", prefix: "the", suffix: "end" },
      },
      confidence: "exact",
    }

    const params = encodeCitationUrl(envelope)

    expect(params.get("sourceRevision")).toBe("abc123")
    expect(params.get("href")).toBe("text/chapter-1.xhtml")
    expect(params.get("exact")).toBe("hello world")
    expect(params.get("prefix")).toBe("the")
    expect(params.get("suffix")).toBe("end")
    expect(params.has("envelope")).toBe(false)
  })

  test("encodes complex citation as base64", () => {
    const envelope: CitationEnvelopeV1 = {
      schema: "haddon.citation-envelope",
      version: 1,
      volumeId: "test-volume",
      sourceRevision: "abc123",
      locator: {
        schema: "haddon.publication-locator",
        version: 1,
        href: "text/chapter-1.xhtml",
        mediaType: "application/xhtml+xml",
        locations: {
          normalized: {
            revision: "haddon-normalizer/1",
            start: {
              blockId: "block-1",
              offset: { value: 0, unit: "utf16-code-unit" },
            },
          },
        },
        text: { exact: "hello world" },
      },
      confidence: "exact",
    }

    const params = encodeCitationUrl(envelope)

    expect(params.has("envelope")).toBe(true)
    expect(params.has("sourceRevision")).toBe(false)
    expect(params.has("exact")).toBe(false)

    const decoded = parseCitationUrl(params, "ignored")
    expect(decoded).toEqual(envelope)
  })

  test("forces base64 encoding when requested", () => {
    const envelope: CitationEnvelopeV1 = {
      schema: "haddon.citation-envelope",
      version: 1,
      volumeId: "test-volume",
      sourceRevision: "abc123",
      locator: {
        schema: "haddon.publication-locator",
        version: 1,
        href: "text/chapter-1.xhtml",
        mediaType: "application/xhtml+xml",
        locations: {},
        text: { exact: "hello world" },
      },
      confidence: "exact",
    }

    const params = encodeCitationUrl(envelope, true)

    expect(params.has("envelope")).toBe(true)
    expect(params.has("sourceRevision")).toBe(false)
  })
})

describe("parseFragmentFromHash", () => {
  test("parses fragment with leading #", () => {
    expect(parseFragmentFromHash("#citation-target")).toBe("citation-target")
  })

  test("parses fragment without leading #", () => {
    expect(parseFragmentFromHash("citation-target")).toBe("citation-target")
  })

  test("returns null for empty hash", () => {
    expect(parseFragmentFromHash("")).toBeNull()
    expect(parseFragmentFromHash("#")).toBeNull()
  })
})

describe("openCitation", () => {
  test("resolves exact citation", () => {
    const envelope: CitationEnvelopeV1 = {
      schema: "haddon.citation-envelope",
      version: 1,
      volumeId: "test-volume",
      sourceRevision: "abc123",
      locator: {
        schema: "haddon.publication-locator",
        version: 1,
        href: "text/chapter-1.xhtml",
        mediaType: "application/xhtml+xml",
        locations: {},
        text: { exact: "hello world" },
      },
      confidence: "exact",
    }

    const session = new MockPublicationSession({
      status: "resolved",
      confidence: "exact",
      strategy: "quote",
      href: "text/chapter-1.xhtml",
      blockId: "block-1",
      start: 0,
      end: 11,
      exact: "hello world",
    })

    const result = openCitation(envelope, session)

    expect(result.status).toBe("exact")
    if (result.status === "exact") {
      expect(result.target.href).toBe("text/chapter-1.xhtml")
      expect(result.target.blockId).toBe("block-1")
      expect(result.target.startOffset).toBe(0)
      expect(result.target.endOffset).toBe(11)
      expect(result.target.exact).toBe("hello world")
    }
  })

  test("resolves recovered citation", () => {
    const envelope: CitationEnvelopeV1 = {
      schema: "haddon.citation-envelope",
      version: 1,
      volumeId: "test-volume",
      sourceRevision: "abc123",
      locator: {
        schema: "haddon.publication-locator",
        version: 1,
        href: "text/chapter-1.xhtml",
        mediaType: "application/xhtml+xml",
        locations: {},
        text: { exact: "hello world", prefix: "say ", suffix: " to everyone" },
      },
      confidence: "exact",
    }

    const session = new MockPublicationSession({
      status: "resolved",
      confidence: "strong",
      strategy: "quote-match",
      href: "text/chapter-1.xhtml",
      blockId: "block-2",
      start: 5,
      end: 16,
      exact: "hello world",
    })

    const result = openCitation(envelope, session)

    expect(result.status).toBe("recovered")
    if (result.status === "recovered") {
      expect(result.target.href).toBe("text/chapter-1.xhtml")
      expect(result.target.blockId).toBe("block-2")
      expect(result.evidence.strategy).toBe("quote-match")
    }
  })

  test("resolves ambiguous citation with multiple candidates", () => {
    const envelope: CitationEnvelopeV1 = {
      schema: "haddon.citation-envelope",
      version: 1,
      volumeId: "test-volume",
      sourceRevision: "abc123",
      locator: {
        schema: "haddon.publication-locator",
        version: 1,
        href: "text/chapter-1.xhtml",
        mediaType: "application/xhtml+xml",
        locations: {},
        text: { exact: "hello" },
      },
      confidence: "exact",
    }

    const session = new MockPublicationSession({
      status: "resolved",
      confidence: "weak",
      strategy: "quote",
      href: "text/chapter-1.xhtml",
      blockId: "block-1",
      start: 0,
      end: 5,
      exact: "hello",
      candidates: [
        {
          href: "text/chapter-1.xhtml",
          blockId: "block-1",
          start: 0,
          end: 5,
          exact: "hello",
          score: 0.9,
        },
        {
          href: "text/chapter-2.xhtml",
          blockId: "block-10",
          start: 100,
          end: 105,
          exact: "hello",
          score: 0.9,
        },
      ],
    })

    const result = openCitation(envelope, session)

    expect(result.status).toBe("ambiguous")
    if (result.status === "ambiguous") {
      expect(result.candidates.length).toBe(2)
      expect(result.candidates[0].href).toBe("text/chapter-1.xhtml")
      expect(result.candidates[1].href).toBe("text/chapter-2.xhtml")
      expect(result.evidence.candidates?.length).toBe(2)
    }
  })

  test("returns unresolved for missing resource", () => {
    const envelope: CitationEnvelopeV1 = {
      schema: "haddon.citation-envelope",
      version: 1,
      volumeId: "test-volume",
      sourceRevision: "abc123",
      locator: {
        schema: "haddon.publication-locator",
        version: 1,
        href: "text/missing.xhtml",
        mediaType: "application/xhtml+xml",
        locations: {},
        text: { exact: "hello world" },
      },
      confidence: "exact",
    }

    const session = new MockPublicationSession({
      status: "unresolved",
      reason: "resource-missing",
    })

    const result = openCitation(envelope, session)

    expect(result.status).toBe("unresolved")
    if (result.status === "unresolved") {
      expect(result.reason).toBe("resource-missing")
    }
  })

  test("returns unresolved for missing quote", () => {
    const envelope: CitationEnvelopeV1 = {
      schema: "haddon.citation-envelope",
      version: 1,
      volumeId: "test-volume",
      sourceRevision: "abc123",
      locator: {
        schema: "haddon.publication-locator",
        version: 1,
        href: "text/chapter-1.xhtml",
        mediaType: "application/xhtml+xml",
        locations: {},
        text: { exact: "missing quote" },
      },
      confidence: "exact",
    }

    const session = new MockPublicationSession({
      status: "unresolved",
      reason: "quote-not-found",
    })

    const result = openCitation(envelope, session)

    expect(result.status).toBe("unresolved")
    if (result.status === "unresolved") {
      expect(result.reason).toBe("quote-not-found")
    }
  })

  test("returns unresolved for missing selector", () => {
    const params = new URLSearchParams("sourceRevision=abc123&href=text/chapter-1.xhtml")
    const session = new MockPublicationSession({})

    const result = openCitation(params, session, "test-volume")

    expect(result.status).toBe("unresolved")
    if (result.status === "unresolved") {
      expect(result.reason).toBe("missing-selector")
    }
  })

  test("handles WASM resolve_json errors", () => {
    const envelope: CitationEnvelopeV1 = {
      schema: "haddon.citation-envelope",
      version: 1,
      volumeId: "test-volume",
      sourceRevision: "abc123",
      locator: {
        schema: "haddon.publication-locator",
        version: 1,
        href: "text/chapter-1.xhtml",
        mediaType: "application/xhtml+xml",
        locations: {},
        text: { exact: "hello world" },
      },
      confidence: "exact",
    }

    const session = new MockPublicationSession(new Error("WASM panic"))

    const result = openCitation(envelope, session)

    expect(result.status).toBe("unresolved")
    if (result.status === "unresolved") {
      expect(result.reason).toBe("WASM panic")
    }
  })

  test("parses citation from URLSearchParams", () => {
    const params = new URLSearchParams(
      "sourceRevision=abc123&href=text/chapter-1.xhtml&exact=hello+world"
    )

    const session = new MockPublicationSession({
      status: "resolved",
      confidence: "exact",
      strategy: "quote",
      href: "text/chapter-1.xhtml",
      blockId: "block-1",
      start: 0,
      end: 11,
      exact: "hello world",
    })

    const result = openCitation(params, session, "test-volume")

    expect(result.status).toBe("exact")
    if (result.status === "exact") {
      expect(result.target.exact).toBe("hello world")
    }
  })

  test("parses fragment from hash string", () => {
    const hash = "#citation-target"

    const session = new MockPublicationSession({
      status: "resolved",
      confidence: "exact",
      strategy: "fragment",
      href: "text/chapter-1.xhtml",
      blockId: "citation-target",
    })

    const result = openCitation(hash, session, "test-volume")

    expect(result.status).toBe("exact")
    if (result.status === "exact") {
      expect(result.target.blockId).toBe("citation-target")
    }
  })
})
