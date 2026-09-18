import { memo, useEffect, useRef, useState } from "react";
import type { PublicationLocatorV1 } from "../../../packages/haddon-navigator/src/types";
import "./MarginNote.css";

export interface MarginNoteProps {
  /** Reference to the article DOM element for positioning */
  articleRoot: HTMLElement | null;
  /** The locator this note is anchored to */
  locator: PublicationLocatorV1;
  /** The quoted text */
  quote: string;
  /** The note content (AI response or placeholder) */
  content: string;
  /** Handler for closing the note */
  onClose: () => void;
}

export const MarginNote = memo(function MarginNote({
  articleRoot,
  locator,
  quote,
  content,
  onClose,
}: MarginNoteProps) {
  const noteRef = useRef<HTMLDivElement>(null);
  const [topOffset, setTopOffset] = useState<number>(0);

  useEffect(() => {
    if (!articleRoot || !locator.locations.normalized) return;

    const startBlockId = locator.locations.normalized.start.blockId;
    const startOffset = locator.locations.normalized.start.offset.value;

    const block = articleRoot.querySelector(
      `[data-haddon-id="${CSS.escape(startBlockId)}"]`
    );

    if (!(block instanceof HTMLElement)) return;

    const articleRect = articleRoot.getBoundingClientRect();
    const blockRect = block.getBoundingClientRect();
    
    const relativeTop = blockRect.top - articleRect.top + articleRoot.scrollTop;
    setTopOffset(relativeTop);
  }, [articleRoot, locator]);

  return (
    <div 
      ref={noteRef}
      className="haddon-margin-note" 
      style={{ top: `${topOffset}px` }}
    >
      <div className="haddon-margin-note-header">
        <div className="haddon-margin-note-icon">💭</div>
        <button
          type="button"
          className="haddon-margin-note-close"
          onClick={onClose}
          aria-label="Close note"
        >
          ×
        </button>
      </div>
      <div className="haddon-margin-note-quote">
        "{quote.length > 100 ? `${quote.slice(0, 100)}…` : quote}"
      </div>
      <div className="haddon-margin-note-content">{content}</div>
    </div>
  );
});
