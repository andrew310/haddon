import { memo } from "react";
import type { PublicationLocatorV1 } from "../../../packages/haddon-navigator/src/types";
import "./MarginNote.css";

export interface MarginNoteProps {
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
  locator,
  quote,
  content,
  onClose,
}: MarginNoteProps) {
  return (
    <div className="haddon-margin-note">
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
