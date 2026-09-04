/**
 * HADDON-042: Remix 3 Host Adapter
 * 
 * Remix 3 component for embedding the Haddon reader with citation routing.
 * 
 * Key features:
 * - Long-lived reader surface (no remounts for citation navigation)
 * - Citation deep-link resolution via openCitation()
 * - Product-quality selection popover with highlight colors + explain
 * - Remix 3 component model with explicit state management
 */

import { type Handle, on, css, clientEntry } from 'remix/ui'
import type { CitationEnvelopeV1 } from 'haddon-citation'
import { openCitation, type OpenCitationResult } from 'haddon-citation-router'
import { SelectionPopover, type HighlightColor } from './selection-popover'

/**
 * WASM Publication Session interface (minimal for adapter).
 */
export interface PublicationSession {
  resolve_json(locatorJson: string, policy: string): string
  render_html(href: string): string
  first_linear_href(): string | null
  reading_order_json(): string
  resource_bytes(href: string): Uint8Array
  close(): void
}

/**
 * Reader selection state.
 */
export type ReaderSelection = {
  text: string
  citation: {
    exact: string
    href: string
    prefix?: string
    suffix?: string
  }
  position: { x: number; y: number }
}

/**
 * HaddonReader component props.
 */
export type HaddonReaderProps = {
  /** Remix 3 component handle for reactivity. */
  handle: Handle
  /** WASM publication session (null until loaded). */
  session: PublicationSession | null
  /** Optional citation to resolve on mount or update. */
  citation?: CitationEnvelopeV1 | null
  /** Volume ID for citation URL parsing. */
  volumeId?: string
  /** Callback when session is ready. */
  onSessionReady?: (session: PublicationSession) => void
  /** Callback when citation is resolved. */
  onCitationResolved?: (result: OpenCitationResult) => void
  /** Callback when selection changes. */
  onSelectionChange?: (selection: ReaderSelection | null) => void
}

/**
 * Haddon Reader Remix 3 Component.
 * 
 * Embeds a citation-addressable reader without remounting for navigation.
 */
export const HaddonReader = clientEntry('/assets/haddon-reader.js#HaddonReader', (props: HaddonReaderProps) => {
  // State
  let mounted = false
  let currentHref: string | null = null
  let html = ''
  let error: string | null = null
  let selection: ReaderSelection | null = null
  let showSelectionPopover = false
  let citationStatus: string | null = null
  
  // Refs
  let rootRef: HTMLElement | null = null
  let blobUrls: string[] = []

  /**
   * Cleanup blob URLs.
   */
  const revokeBlobs = () => {
    for (const url of blobUrls) {
      URL.revokeObjectURL(url)
    }
    blobUrls = []
  }

  /**
   * Rewrite resource URLs to blob URLs.
   */
  const rewriteResources = (root: HTMLElement) => {
    if (!props.session) return
    
    revokeBlobs()
    const images = root.querySelectorAll<HTMLImageElement>('img[data-haddon-src]')
    
    images.forEach((img) => {
      const resourceHref = img.getAttribute('data-haddon-src')
      if (!resourceHref) return
      
      try {
        const bytes = props.session!.resource_bytes(resourceHref)
        const blob = new Blob([bytes], {
          type: resourceHref.endsWith('.svg') ? 'image/svg+xml' : undefined,
        })
        const url = URL.createObjectURL(blob)
        blobUrls.push(url)
        img.src = url
      } catch {
        img.replaceWith(
          Object.assign(document.createElement('span'), {
            className: 'haddon-missing-media',
            textContent: img.alt || resourceHref,
          })
        )
      }
    })
  }

  /**
   * Render a specific href.
   */
  const showHref = (href: string, scrollToId?: string) => {
    if (!props.session) {
      error = 'No session loaded'
      props.handle.update()
      return
    }

    try {
      currentHref = href
      html = props.session.render_html(href)
      error = null
      props.handle.update()
      
      // Rewrite resources and scroll after render
      requestAnimationFrame(() => {
        if (rootRef) {
          rewriteResources(rootRef)
          
          if (scrollToId) {
            const target = rootRef.querySelector(`#${CSS.escape(scrollToId)}`)
            target?.scrollIntoView({ behavior: 'smooth', block: 'center' })
          }
        }
      })
    } catch (err) {
      error = err instanceof Error ? err.message : String(err)
      html = ''
      props.handle.update()
    }
  }

  /**
   * Open and resolve a citation.
   */
  const applyCitation = (citation: CitationEnvelopeV1) => {
    if (!props.session) return
    
    const result = openCitation(citation, props.session, props.volumeId || 'unknown')
    
    if (result.status === 'exact' || result.status === 'recovered') {
      const { target } = result
      showHref(target.href)
      
      citationStatus = result.status === 'exact' 
        ? `Found: "${target.exact?.substring(0, 80)}..."` 
        : `Recovered: "${target.exact?.substring(0, 80)}..." (${result.evidence.strategy})`
      
      // Scroll to block after render
      if (target.blockId) {
        requestAnimationFrame(() => {
          if (rootRef) {
            const block = rootRef.querySelector(`[data-haddon-id="${CSS.escape(target.blockId!)}"]`)
            if (block) {
              block.classList.add('haddon-cited')
              block.scrollIntoView({ behavior: 'smooth', block: 'center' })
            }
          }
        })
      }
      
      if (props.onCitationResolved) {
        props.onCitationResolved(result)
      }
    } else if (result.status === 'ambiguous') {
      citationStatus = `Ambiguous: found ${result.candidates.length} matches`
      
      if (props.onCitationResolved) {
        props.onCitationResolved(result)
      }
    } else {
      citationStatus = `Unresolved: ${result.reason}`
      
      // Fallback to first chapter
      const first = props.session.first_linear_href()
      if (first) showHref(first)
      
      if (props.onCitationResolved) {
        props.onCitationResolved(result)
      }
    }
    
    props.handle.update()
  }

  /**
   * Handle text selection.
   */
  const handleSelection = (event: MouseEvent) => {
    if (!rootRef) return
    
    const domSelection = window.getSelection()
    if (!domSelection || domSelection.isCollapsed) {
      selection = null
      showSelectionPopover = false
      props.handle.update()
      return
    }
    
    const text = domSelection.toString().trim()
    if (!text) return
    
    // Extract citation context
    const range = domSelection.getRangeAt(0)
    const container = range.commonAncestorContainer
    const blockElement = container.nodeType === Node.TEXT_NODE 
      ? container.parentElement 
      : container as HTMLElement
    
    const fullText = blockElement?.textContent || ''
    const startIndex = fullText.indexOf(text)
    const prefix = startIndex > 0 ? fullText.substring(Math.max(0, startIndex - 50), startIndex) : undefined
    const suffix = fullText.substring(startIndex + text.length, Math.min(fullText.length, startIndex + text.length + 50))
    
    // Calculate popover position (center above selection)
    const rect = range.getBoundingClientRect()
    const rootRect = rootRef.getBoundingClientRect()
    
    selection = {
      text,
      citation: {
        exact: text,
        href: currentHref || '',
        prefix,
        suffix,
      },
      position: {
        x: rect.left + rect.width / 2 - rootRect.left,
        y: rect.top - rootRect.top,
      },
    }
    showSelectionPopover = true
    
    if (props.onSelectionChange) {
      props.onSelectionChange(selection)
    }
    
    props.handle.update()
  }

  /**
   * Handle highlight color selection.
   */
  const handleHighlight = (color: HighlightColor) => {
    console.log('Highlight with color:', color)
    // TODO: Integrate with decoration system
    showSelectionPopover = false
    props.handle.update()
  }

  /**
   * Handle "explain this" action.
   */
  const handleExplain = () => {
    if (!selection) return
    console.log('Explain:', selection.text)
    // TODO: Integrate with Grok or explanation service
    showSelectionPopover = false
    props.handle.update()
  }

  /**
   * Initialize on mount.
   */
  if (!mounted && props.session) {
    mounted = true
    
    // Apply initial citation or load first chapter
    if (props.citation) {
      applyCitation(props.citation)
    } else {
      const first = props.session.first_linear_href()
      if (first) showHref(first)
    }
    
    if (props.onSessionReady) {
      props.onSessionReady(props.session)
    }
  }

  /**
   * Handle citation updates (without remounting).
   */
  if (mounted && props.citation) {
    applyCitation(props.citation)
  }

  /**
   * Cleanup on unmount.
   */
  const cleanup = () => {
    revokeBlobs()
    if (props.session) {
      props.session.close()
    }
  }

  // Render function
  return () => (
    <div 
      class="haddon-reader-remix"
      ref={(el) => { rootRef = el }}
      mix={[
        on('mouseup', handleSelection),
        css({
          position: 'relative',
          width: '100%',
          height: '100%',
          overflow: 'auto',
        }),
      ]}
    >
      {error && (
        <div class="haddon-error" mix={css({ padding: '20px', color: 'red' })}>
          {error}
        </div>
      )}
      
      {citationStatus && (
        <div class="haddon-citation-status" mix={css({ 
          padding: '10px', 
          background: '#f0f0f0', 
          borderBottom: '1px solid #ccc',
          fontSize: '14px',
        })}>
          {citationStatus}
        </div>
      )}
      
      {html && (
        <article 
          class="haddon-article"
          dangerouslySetInnerHTML={{ __html: html }}
          mix={css({ padding: '20px' })}
        />
      )}
      
      {showSelectionPopover && selection && (
        <SelectionPopover
          handle={props.handle}
          selection={selection}
          onHighlight={handleHighlight}
          onExplain={handleExplain}
          onClose={() => {
            showSelectionPopover = false
            props.handle.update()
          }}
        />
      )}
    </div>
  )
})
