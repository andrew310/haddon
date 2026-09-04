# Haddon Remix 3 Host Adapter

Remix 3 component adapter for embedding the Haddon citation-addressable reader.

## Overview

This package provides a Remix 3 component that:
- Embeds a long-lived Haddon reader surface
- Opens citation deep links without remounting the reader
- Reports resolution state (exact | recovered | ambiguous | unresolved)
- Provides a product-quality selection UI with highlight colors and "explain this"

## Installation

```bash
pnpm add haddon-remix-adapter
```

## Usage

### Basic Reader Component

```tsx
import { HaddonReader } from 'haddon-remix-adapter'
import type { PublicationSession } from '../path/to/wasm'

function BookRoute({ handle }: { handle: Handle }) {
  let session: PublicationSession | null = null
  
  return () => (
    <HaddonReader
      handle={handle}
      session={session}
      onSessionReady={(s) => { session = s }}
    />
  )
}
```

### With Citation Deep Links

```tsx
import { HaddonReader } from 'haddon-remix-adapter'
import { parseCitationUrl } from 'haddon-citation-router'

function BookRoute({ handle, searchParams }: RouteProps) {
  let session: PublicationSession | null = null
  const citation = parseCitationUrl(searchParams)
  
  return () => (
    <HaddonReader
      handle={handle}
      session={session}
      citation={citation}
      onCitationResolved={(result) => {
        console.log('Citation status:', result.status)
      }}
    />
  )
}
```

## API

### HaddonReader Component

Main reader component that manages the publication session and citation routing.

**Props:**
- `handle: Handle` - Remix 3 component handle for reactivity
- `session: PublicationSession | null` - WASM publication session
- `citation?: CitationEnvelopeV1` - Optional citation to resolve
- `volumeId?: string` - Volume ID for citation parsing
- `onSessionReady?: (session: PublicationSession) => void` - Callback when session is loaded
- `onCitationResolved?: (result: OpenCitationResult) => void` - Callback with resolution status

### SelectionPopover Component

Floating popover for text selection with highlight colors and explain action.

**Props:**
- `handle: Handle` - Remix 3 component handle
- `selection: ReaderSelection | null` - Current text selection
- `position: { x: number; y: number }` - Popover position
- `onHighlight: (color: string) => void` - Highlight color selection
- `onExplain: () => void` - Explain this action
- `onClose: () => void` - Close popover

## Architecture

### Separation of Concerns

- **Haddon Core** (`packages/haddon-navigator`): Framework-neutral publication/locator services
- **Remix Adapter** (this package): Remix 3-specific mounting and lifecycle
- **Host Application**: Route-level volume/edition management and chrome

### Key Design Decisions

1. **Long-lived reader surface**: The reader mounts once per route and survives citation navigation
2. **Citation routing without remounts**: `openCitation()` updates the existing reader view
3. **Remix 3 component model**: Uses Remix's two-phase setup/render pattern with explicit `handle.update()`
4. **Product-quality UI**: Selection popover is not a debug widget but a polished feature

## Examples

See `apps/remix-demo` for a complete Remix 3 application using this adapter.

## License

MIT
