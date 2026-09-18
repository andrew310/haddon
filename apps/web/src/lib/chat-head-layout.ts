export const CHAT_HEAD_SIZE = 48;
export const DRAG_LIMIT = 36;
export const CLICK_SLOP = 6;
export const TWO_LANE_MIN_WIDTH = 900;

export type ReadingColumn = { left: number; right: number };

export function readingColumns(
  article: { left: number; width: number },
  lanes: number,
  strip: number,
): ReadingColumn[] {
  const count = Math.max(1, Math.floor(lanes));
  if (count === 1) {
    return [{ left: article.left, right: article.left + article.width }];
  }
  const gaps = strip * (count - 1);
  const colW = (article.width - gaps) / count;
  return Array.from({ length: count }, (_, i) => {
    const left = article.left + i * (colW + strip);
    return { left, right: left + colW };
  });
}

export function laneIndex(markX: number, columns: ReadingColumn[]): number {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < columns.length; i++) {
    const col = columns[i];
    if (!col) continue;
    const mid = (col.left + col.right) / 2;
    const d = Math.abs(markX - mid);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

export function headLeftInStrip(
  columnRight: number,
  strip: number,
  headSize = CHAT_HEAD_SIZE,
): number {
  return columnRight + (strip - headSize) / 2;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function clampNudge(x: number, y: number): { x: number; y: number } {
  return {
    x: clamp(x, -DRAG_LIMIT, DRAG_LIMIT),
    y: clamp(y, -DRAG_LIMIT, DRAG_LIMIT),
  };
}

/** Rest Y for a head so it sits on the same row as a highlight in the book. */
export function restTopForHighlight(
  mark: DOMRect,
  dock: DOMRect,
  book?: DOMRect,
  headSize = CHAT_HEAD_SIZE,
): number | null {
  const markCenter = mark.top + mark.height / 2;
  if (book && (markCenter < book.top || markCenter > book.bottom)) {
    return null;
  }
  return markCenter - dock.top - headSize / 2;
}
