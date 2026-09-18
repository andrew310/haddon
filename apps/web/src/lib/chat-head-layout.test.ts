import { describe, expect, it } from "vitest";
import {
  clamp,
  clampNudge,
  DRAG_LIMIT,
  headLeftInStrip,
  laneIndex,
  readingColumns,
  restTopForHighlight,
} from "./chat-head-layout";

describe("clampNudge", () => {
  it("keeps a small drag", () => {
    expect(clampNudge(10, -8)).toEqual({ x: 10, y: -8 });
  });

  it("caps travel so heads cannot roam the panel", () => {
    expect(clampNudge(400, -400)).toEqual({ x: DRAG_LIMIT, y: -DRAG_LIMIT });
  });
});

describe("restTopForHighlight", () => {
  it("centers the head on the highlight row", () => {
    const mark = { top: 300, height: 20 } as DOMRect;
    const dock = { top: 80, height: 700 } as DOMRect;
    expect(restTopForHighlight(mark, dock, undefined, 56)).toBe(300 + 10 - 80 - 28);
  });

  it("hides when the highlight is scrolled out of the book pane", () => {
    const mark = { top: 10, height: 10 } as DOMRect;
    const dock = { top: 80, height: 400 } as DOMRect;
    const book = { top: 80, bottom: 480 } as DOMRect;
    expect(restTopForHighlight(mark, dock, book, 56)).toBeNull();
  });
});

describe("readingColumns", () => {
  it("returns one column for a single lane", () => {
    expect(readingColumns({ left: 100, width: 800 }, 1, 80)).toEqual([
      { left: 100, right: 900 },
    ]);
  });

  it("splits two lanes with a strip between them", () => {
    const cols = readingColumns({ left: 0, width: 1000 }, 2, 80);
    expect(cols).toEqual([
      { left: 0, right: 460 },
      { left: 540, right: 1000 },
    ]);
  });
});

describe("laneIndex", () => {
  const cols = readingColumns({ left: 0, width: 1000 }, 2, 80);

  it("assigns a mark to the nearer column", () => {
    expect(laneIndex(100, cols)).toBe(0);
    expect(laneIndex(800, cols)).toBe(1);
  });
});

describe("headLeftInStrip", () => {
  it("centers the head in the gutter after the column", () => {
    expect(headLeftInStrip(460, 80, 48)).toBe(460 + 16);
  });
});

describe("clamp", () => {
  it("bounds a number", () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-2, 0, 3)).toBe(0);
  });
});
