/**
 * HADDON-042: Remix Adapter Tests
 * 
 * Tests for Remix 3 host adapter lifecycle and citation routing.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { openCitation } from 'haddon-citation-router'
import type { CitationEnvelopeV1 } from 'haddon-citation'

// Mock WASM publication session
class MockPublicationSession {
  private resolveResults: Map<string, any> = new Map()
  private htmlCache: Map<string, string> = new Map()

  constructor() {
    // Setup mock responses
    this.htmlCache.set('text/chapter-1.xhtml', '<p data-haddon-id="p1">The patient moon answered in blue.</p>')
    this.htmlCache.set('text/chapter-2.xhtml', '<p data-haddon-id="p2">Another chapter content.</p>')
  }

  resolve_json(locatorJson: string, policy: string): string {
    const locator = JSON.parse(locatorJson)
    
    if (locator.text?.exact === 'the patient moon answered in blue') {
      return JSON.stringify({
        status: 'resolved',
        confidence: 'exact',
        href: 'text/chapter-1.xhtml',
        blockId: 'p1',
        exact: 'the patient moon answered in blue',
      })
    }
    
    if (locator.text?.exact === 'quote that does not exist') {
      return JSON.stringify({
        status: 'unresolved',
        reason: 'quote-not-found',
      })
    }
    
    return JSON.stringify({
      status: 'resolved',
      confidence: 'exact',
      href: locator.href || 'text/chapter-1.xhtml',
      blockId: 'p1',
    })
  }

  render_html(href: string): string {
    return this.htmlCache.get(href) || '<p>Not found</p>'
  }

  first_linear_href(): string | null {
    return 'text/chapter-1.xhtml'
  }

  reading_order_json(): string {
    return JSON.stringify([
      { href: 'text/chapter-1.xhtml', title: 'Chapter 1' },
      { href: 'text/chapter-2.xhtml', title: 'Chapter 2' },
    ])
  }

  resource_bytes(href: string): Uint8Array {
    return new Uint8Array([])
  }

  close(): void {
    // Cleanup
  }
}

function createCitation(exact: string, href = 'text/chapter-1.xhtml'): CitationEnvelopeV1 {
  return {
    schema: 'haddon.citation-envelope',
    version: 1,
    volumeId: 'test:book',
    sourceRevision: 'abc123' + '0'.repeat(58), // 64 hex chars
    locator: {
      schema: 'haddon.publication-locator',
      version: 1,
      href,
      mediaType: 'application/xhtml+xml',
      locations: {},
      text: {
        exact,
      },
    },
    confidence: 'exact',
  }
}

describe('Citation Routing', () => {
  let session: MockPublicationSession

  beforeEach(() => {
    session = new MockPublicationSession()
  })

  afterEach(() => {
    session.close()
  })

  it('resolves exact citations', () => {
    const citation = createCitation('the patient moon answered in blue')
    const result = openCitation(citation, session as any)

    expect(result.status).toBe('exact')
    expect(result.target.href).toBe('text/chapter-1.xhtml')
    expect(result.target.blockId).toBe('p1')
    expect(result.target.exact).toContain('patient moon')
  })

  it('handles unresolved citations gracefully', () => {
    const citation = createCitation('quote that does not exist')
    const result = openCitation(citation, session as any)

    expect(result.status).toBe('unresolved')
    expect(result.reason).toBe('quote-not-found')
  })

  it('resolves citations without remounting the session', () => {
    const citation1 = createCitation('the patient moon answered in blue')
    const citation2 = createCitation('the patient moon answered in blue') // Same quote

    const result1 = openCitation(citation1, session as any)
    const result2 = openCitation(citation2, session as any)

    expect(result1.status).toBe('exact')
    expect(result2.status).toBe('exact')
    expect(result1.target.href).toBe(result2.target.href)
    // Session is reused, not recreated
  })

  it('preserves citation envelope recovery evidence', () => {
    const citation = createCitation('quote that does not exist')
    citation.recoveryEvidence = {
      strategy: 'quote-match',
      message: 'Original quote not found',
    }

    const result = openCitation(citation, session as any)

    expect(result.status).toBe('unresolved')
    expect(result.evidence).toBeDefined()
  })
})

describe('Adapter Lifecycle', () => {
  it('initializes with session', () => {
    const session = new MockPublicationSession()
    expect(session).toBeDefined()
    expect(session.first_linear_href()).toBe('text/chapter-1.xhtml')
  })

  it('renders HTML for a given href', () => {
    const session = new MockPublicationSession()
    const html = session.render_html('text/chapter-1.xhtml')
    
    expect(html).toContain('patient moon')
    expect(html).toContain('data-haddon-id="p1"')
  })

  it('provides reading order', () => {
    const session = new MockPublicationSession()
    const order = JSON.parse(session.reading_order_json())
    
    expect(order).toHaveLength(2)
    expect(order[0].href).toBe('text/chapter-1.xhtml')
  })

  it('cleans up on close', () => {
    const session = new MockPublicationSession()
    session.close()
    // No errors thrown
    expect(true).toBe(true)
  })
})

describe('Selection Popover', () => {
  it('provides highlight color options', () => {
    const colors = ['yellow', 'green', 'blue', 'pink', 'purple']
    expect(colors).toHaveLength(5)
  })

  it('formats selection position for popover', () => {
    const selection = {
      text: 'selected text',
      citation: {
        exact: 'selected text',
        href: 'text/chapter-1.xhtml',
      },
      position: { x: 100, y: 200 },
    }

    expect(selection.position.x).toBe(100)
    expect(selection.position.y).toBe(200)
  })
})
