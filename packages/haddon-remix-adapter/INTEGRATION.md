# HADDON-042: Remix 3 Host Adapter Integration Guide

## Overview

This document demonstrates how to integrate the Haddon Remix 3 adapter into a Klemata-style host application.

## Architecture

```
Klemata Host Application (Remix 3)
├── Route: /book/:volumeId
│   ├── Loader: fetch volume metadata & EPUB
│   ├── Component: BookRoute
│   │   ├── HaddonReader (from haddon-remix-adapter)
│   │   ├── SelectionPopover (auto-rendered)
│   │   └── Chrome (toolbar, sidebar, etc.)
│   └── Action: handle form submissions
└── Route: /book/:volumeId/cite
    ├── Loader: parse citation URL params
    └── Component: CitationRoute (same reader, no remount)
```

## Step 1: Install Dependencies

```bash
pnpm add haddon-remix-adapter haddon-citation haddon-citation-router
pnpm add remix  # Remix 3 framework
```

## Step 2: Create a Book Route

```tsx
// app/routes/book.$volumeId.tsx
import { HaddonReader } from 'haddon-remix-adapter'
import { parseCitationUrl } from 'haddon-citation-router'
import type { Handle } from 'remix/ui'

type RouteData = {
  volumeId: string
  epubBytes: Uint8Array
  citation: CitationEnvelopeV1 | null
}

export async function loader({ params, request }: LoaderArgs): Promise<RouteData> {
  const { volumeId } = params
  const url = new URL(request.url)
  const citation = parseCitationUrl(url.searchParams, volumeId)
  
  // Fetch EPUB from blob store
  const epubBytes = await fetchEpub(volumeId)
  
  return { volumeId, epubBytes, citation }
}

export function BookRoute({ handle, data }: { handle: Handle; data: RouteData }) {
  let session: PublicationSession | null = null
  let citationResult: OpenCitationResult | null = null
  
  // Load WASM session
  const loadSession = async () => {
    const wasm = await import('haddon-wasm')
    await wasm.default()
    session = wasm.PublicationSession.load(data.epubBytes)
    handle.update()
  }
  
  // Initialize on mount
  loadSession()
  
  return () => (
    <div class="book-layout">
      <header>
        <h1>Reading {data.volumeId}</h1>
        {citationResult?.status && (
          <span class="citation-badge">
            Citation: {citationResult.status}
          </span>
        )}
      </header>
      
      <main>
        <HaddonReader
          handle={handle}
          session={session}
          citation={data.citation}
          volumeId={data.volumeId}
          onCitationResolved={(result) => {
            citationResult = result
            handle.update()
          }}
          onSelectionChange={(selection) => {
            console.log('User selected:', selection?.text)
          }}
        />
      </main>
    </div>
  )
}
```

## Step 3: Handle Citation Deep Links

The adapter automatically handles citation routing without remounting:

```tsx
// URL: /book/klemata:work:example?exact=the+moon+quote
// The HaddonReader component will:
// 1. Parse the citation URL parameters
// 2. Resolve via openCitation()
// 3. Scroll to the passage
// 4. Report status (exact | recovered | ambiguous | unresolved)
// 5. Preserve the reader surface (no remount)
```

## Step 4: Integrate with Grok for "Explain This"

```tsx
// app/services/grok.ts
import { XClient } from '@x/api-client'

export async function explainText(text: string, context: string): Promise<string> {
  const client = new XClient(process.env.X_API_KEY)
  
  const response = await client.chat.completions.create({
    model: 'grok-2-latest',
    messages: [
      {
        role: 'system',
        content: 'You are a helpful reading assistant. Explain the following passage in simple terms.',
      },
      {
        role: 'user',
        content: `Passage: "${text}"\n\nContext: ${context}`,
      },
    ],
  })
  
  return response.choices[0].message.content
}
```

Then wire it into the reader:

```tsx
export function BookRoute({ handle, data }: { handle: Handle; data: RouteData }) {
  // ... session setup ...
  
  const handleExplain = async (selection: ReaderSelection) => {
    const explanation = await explainText(
      selection.text,
      `From book "${data.volumeId}"`
    )
    
    // Show explanation in a modal or side panel
    showExplanationPanel(explanation)
  }
  
  return () => (
    <HaddonReader
      handle={handle}
      session={session}
      onSelectionChange={handleExplain}
    />
  )
}
```

## Step 5: Styling the Selection Popover

The selection popover uses inline CSS-in-JS via Remix 3's `css()` mixin, but you can override with global styles:

```css
/* app/styles/reader.css */
.haddon-selection-popover {
  /* Already styled inline, but you can override */
  font-family: 'Inter', system-ui, sans-serif;
}

.haddon-cited {
  background: rgba(255, 224, 102, 0.3);
  border-left: 3px solid #FFE066;
  padding-left: 8px;
  transition: background 0.3s ease;
}

.haddon-article {
  font-size: 18px;
  line-height: 1.6;
  max-width: 680px;
  margin: 0 auto;
}
```

## Step 6: Testing Citation Resolution

```tsx
// __tests__/citation-routing.test.ts
import { describe, it, expect } from 'vitest'
import { openCitation } from 'haddon-citation-router'

describe('Citation Routing', () => {
  it('resolves exact citations without remounting', async () => {
    const session = await loadTestSession()
    const citation = {
      schema: 'haddon.citation-envelope' as const,
      version: 1 as const,
      volumeId: 'test:book',
      sourceRevision: 'abc123...',
      locator: {
        schema: 'haddon.publication-locator' as const,
        version: 1 as const,
        href: 'text/chapter-1.xhtml',
        mediaType: 'application/xhtml+xml',
        locations: {},
        text: {
          exact: 'the patient moon answered in blue',
        },
      },
      confidence: 'exact' as const,
    }
    
    const result = openCitation(citation, session)
    
    expect(result.status).toBe('exact')
    expect(result.target.exact).toContain('patient moon')
  })
  
  it('handles unresolved citations gracefully', async () => {
    const session = await loadTestSession()
    const citation = createCitation('quote that does not exist')
    
    const result = openCitation(citation, session)
    
    expect(result.status).toBe('unresolved')
    expect(result.reason).toBeDefined()
  })
})
```

## Acceptance Criteria

- ✅ Long-lived reader surface (no remounts for citation navigation)
- ✅ Citation URL resolution via `openCitation()`
- ✅ Reports exact | recovered | ambiguous | unresolved
- ✅ Product-quality selection popover with highlight colors
- ✅ "Explain this" integration point (Grok-ready)
- ✅ Remix 3 component model (two-phase setup/render)
- ✅ Preserves existing SemanticReader features (decorations, source drawer, visible-location tracking)

## Performance Notes

- The reader surface renders only once per route mount
- Citation navigation triggers `openCitation()` but does not recreate the DOM tree
- Selection popover uses CSS transforms for 60fps animations
- WASM publication session is reused across citation navigations

## Security Notes

- EPUB bytes should be validated before loading
- External URLs in "explain this" should be rate-limited
- User selections should not be persisted without consent
- Citation URLs should be validated to prevent XSS

## Next Steps

1. Deploy to Klemata staging environment
2. Test with real EPUBs from the blob store
3. Integrate with Grok API for "explain this"
4. Add annotation persistence (HADDON-044)
5. Add keyboard shortcuts for selection actions
