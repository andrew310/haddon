/**
 * SelectionPopover Component
 * 
 * Product-quality floating popover for text selection with:
 * - Highlight color choices (yellow, green, blue, pink, purple)
 * - "Explain this" action (Grok integration)
 * - Tight floating chip design
 * - Smooth animations
 */

import { type Handle, on, css, clientEntry } from 'remix/ui'
import type { ReaderSelection } from './haddon-reader'

export type HighlightColor = 'yellow' | 'green' | 'blue' | 'pink' | 'purple'

export type SelectionPopoverProps = {
  handle: Handle
  selection: ReaderSelection
  onHighlight: (color: HighlightColor) => void
  onExplain: () => void
  onClose: () => void
}

const HIGHLIGHT_COLORS: Array<{ name: HighlightColor; bg: string; label: string }> = [
  { name: 'yellow', bg: '#FFE066', label: 'Yellow' },
  { name: 'green', bg: '#8CE99A', label: 'Green' },
  { name: 'blue', bg: '#74C0FC', label: 'Blue' },
  { name: 'pink', bg: '#FFA8C5', label: 'Pink' },
  { name: 'purple', bg: '#CC9EF2', label: 'Purple' },
]

/**
 * Selection Popover Component.
 */
export const SelectionPopover = clientEntry('/assets/selection-popover.js#SelectionPopover', (props: SelectionPopoverProps) => {
  const { selection } = props
  
  // Calculate popover position (centered above selection)
  const style = {
    position: 'absolute',
    left: `${selection.position.x}px`,
    top: `${selection.position.y - 60}px`,
    transform: 'translateX(-50%)',
    zIndex: 1000,
  }

  return () => (
    <div 
      class="haddon-selection-popover"
      style={style}
      mix={css({
        background: 'rgba(0, 0, 0, 0.9)',
        backdropFilter: 'blur(8px)',
        borderRadius: '12px',
        padding: '8px 12px',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(255, 255, 255, 0.1)',
        animation: 'popoverFadeIn 0.2s ease-out',
        '@keyframes popoverFadeIn': {
          from: {
            opacity: 0,
            transform: 'translateX(-50%) translateY(4px)',
          },
          to: {
            opacity: 1,
            transform: 'translateX(-50%) translateY(0)',
          },
        },
      })}
    >
      {/* Highlight Colors */}
      <div 
        class="highlight-colors"
        mix={css({
          display: 'flex',
          gap: '6px',
          paddingRight: '8px',
          borderRight: '1px solid rgba(255, 255, 255, 0.15)',
        })}
      >
        {HIGHLIGHT_COLORS.map(({ name, bg, label }) => (
          <button
            key={name}
            title={`Highlight ${label}`}
            mix={[
              on('click', () => {
                props.onHighlight(name)
              }),
              css({
                width: '28px',
                height: '28px',
                borderRadius: '6px',
                border: '2px solid rgba(255, 255, 255, 0.2)',
                background: bg,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                ':hover': {
                  transform: 'scale(1.1)',
                  borderColor: 'rgba(255, 255, 255, 0.4)',
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.2)',
                },
                ':active': {
                  transform: 'scale(0.95)',
                },
              }),
            ]}
          />
        ))}
      </div>

      {/* Explain Button */}
      <button
        class="explain-button"
        mix={[
          on('click', () => {
            props.onExplain()
          }),
          css({
            padding: '6px 12px',
            borderRadius: '6px',
            border: 'none',
            background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)',
            color: 'white',
            fontSize: '13px',
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            transition: 'all 0.15s ease',
            ':hover': {
              transform: 'translateY(-1px)',
              boxShadow: '0 4px 12px rgba(102, 126, 234, 0.4)',
            },
            ':active': {
              transform: 'translateY(0)',
            },
          }),
        ]}
      >
        <svg 
          width="14" 
          height="14" 
          viewBox="0 0 24 24" 
          fill="none" 
          stroke="currentColor" 
          stroke-width="2"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
          <circle cx="12" cy="17" r="1" />
        </svg>
        Explain this
      </button>

      {/* Close Button */}
      <button
        class="close-button"
        title="Close"
        mix={[
          on('click', () => {
            props.onClose()
          }),
          css({
            width: '24px',
            height: '24px',
            borderRadius: '4px',
            border: 'none',
            background: 'transparent',
            color: 'rgba(255, 255, 255, 0.6)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.15s ease',
            marginLeft: '4px',
            ':hover': {
              background: 'rgba(255, 255, 255, 0.1)',
              color: 'white',
            },
          }),
        ]}
      >
        <svg 
          width="14" 
          height="14" 
          viewBox="0 0 24 24" 
          fill="none" 
          stroke="currentColor" 
          stroke-width="2"
        >
          <line x1="18" y1="6" x2="6" y2="18" />
          <line x1="6" y1="6" x2="18" y2="18" />
        </svg>
      </button>

      {/* Tooltip Triangle */}
      <div
        class="popover-arrow"
        mix={css({
          position: 'absolute',
          bottom: '-6px',
          left: '50%',
          transform: 'translateX(-50%)',
          width: 0,
          height: 0,
          borderLeft: '6px solid transparent',
          borderRight: '6px solid transparent',
          borderTop: '6px solid rgba(0, 0, 0, 0.9)',
        })}
      />
    </div>
  )
})
