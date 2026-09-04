import { memo } from "react";
import "./SelectionChip.css";

export type HighlightColor = "yellow" | "blue" | "green" | "pink";

export interface SelectionChipProps {
  /** Ref callback for floating-ui positioning */
  floatingRef: (node: HTMLElement | null) => void;
  /** Styles from floating-ui */
  floatingStyles: React.CSSProperties;
  /** Handler for color selection */
  onColorSelect: (color: HighlightColor) => void;
  /** Handler for Ask AI action */
  onAskAI: () => void;
}

const HIGHLIGHT_COLORS: { color: HighlightColor; label: string; bg: string }[] = [
  { color: "yellow", label: "Yellow", bg: "#ffd740" },
  { color: "blue", label: "Blue", bg: "#448aff" },
  { color: "green", label: "Green", bg: "#69f0ae" },
  { color: "pink", label: "Pink", bg: "#ff80ab" },
];

export const SelectionChip = memo(function SelectionChip({
  floatingRef,
  floatingStyles,
  onColorSelect,
  onAskAI,
}: SelectionChipProps) {
  return (
    <div
      ref={floatingRef}
      className="haddon-selection-chip"
      style={floatingStyles}
    >
      <div className="haddon-selection-chip-colors">
        {HIGHLIGHT_COLORS.map(({ color, label, bg }) => (
          <button
            key={color}
            type="button"
            className="haddon-selection-chip-color-btn"
            style={{ backgroundColor: bg }}
            aria-label={`Highlight ${label}`}
            title={`Highlight ${label}`}
            onClick={() => onColorSelect(color)}
          />
        ))}
      </div>
      <div className="haddon-selection-chip-divider" />
      <button
        type="button"
        className="haddon-selection-chip-action"
        onClick={onAskAI}
      >
        Ask AI
      </button>
    </div>
  );
});
