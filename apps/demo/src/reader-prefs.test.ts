import { describe, expect, it } from "vitest";
import {
  DEFAULT_READER_PREFS,
  FONT_SIZE_STEPS,
  LINE_HEIGHT_STEPS,
  MEASURE_STEPS,
  clampToSteps,
  defaultReaderPrefs,
  loadReaderPrefs,
  normalizeReaderPrefs,
  nudgeSteppedPref,
  parseReaderPrefs,
  readerPaneCssVars,
  readerPrefsCssVars,
  readerPrefsSignature,
  saveReaderPrefs,
  serializeReaderPrefs,
  stepValue,
} from "./reader-prefs";

describe("parseReaderPrefs", () => {
  it("returns defaults for missing, invalid, or foreign payloads", () => {
    expect(parseReaderPrefs(null)).toEqual(DEFAULT_READER_PREFS);
    expect(parseReaderPrefs("{not json")).toEqual(DEFAULT_READER_PREFS);
    expect(
      parseReaderPrefs(
        JSON.stringify({ schema: "other", version: 1, font: "serif" }),
      ),
    ).toEqual(DEFAULT_READER_PREFS);
    expect(
      parseReaderPrefs(
        JSON.stringify({
          schema: "haddon.prefs",
          version: 2,
          font: "serif",
        }),
      ),
    ).toEqual(DEFAULT_READER_PREFS);
  });

  it("round-trips a valid prefs object", () => {
    const raw = serializeReaderPrefs({
      schema: "haddon.prefs",
      version: 1,
      font: "serif",
      fontSize: 22,
      lineHeight: 1.8,
      measure: 38,
      theme: "sepia",
    });
    expect(parseReaderPrefs(raw)).toEqual({
      schema: "haddon.prefs",
      version: 1,
      font: "serif",
      fontSize: 22,
      lineHeight: 1.8,
      measure: 38,
      theme: "sepia",
    });
  });

  it("drops unknown fonts and themes", () => {
    expect(
      parseReaderPrefs(
        JSON.stringify({
          schema: "haddon.prefs",
          version: 1,
          font: "comic",
          theme: "solarized",
          fontSize: 18,
          lineHeight: 1.65,
          measure: 45,
        }),
      ),
    ).toEqual(DEFAULT_READER_PREFS);
  });
});

describe("stepped clamp", () => {
  it("snaps to the nearest configured step and clamps out of range", () => {
    expect(clampToSteps(16, FONT_SIZE_STEPS)).toBe(16);
    expect(clampToSteps(19, FONT_SIZE_STEPS)).toBe(18);
    expect(clampToSteps(21, FONT_SIZE_STEPS)).toBe(20);
    expect(clampToSteps(8, FONT_SIZE_STEPS)).toBe(16);
    expect(clampToSteps(99, FONT_SIZE_STEPS)).toBe(28);
    expect(clampToSteps(Number.NaN, FONT_SIZE_STEPS)).toBe(16);
    expect(clampToSteps(1.62, LINE_HEIGHT_STEPS)).toBe(1.65);
    expect(clampToSteps(1.9, LINE_HEIGHT_STEPS)).toBe(1.8);
    expect(clampToSteps(40, MEASURE_STEPS)).toBe(38);
    expect(clampToSteps(70, MEASURE_STEPS)).toBe(60);
  });

  it("picks the lower step on a tie", () => {
    expect(clampToSteps(17, FONT_SIZE_STEPS)).toBe(16);
    expect(clampToSteps(35, MEASURE_STEPS)).toBe(32);
  });

  it("nudges along the step ladder and stops at the ends", () => {
    expect(stepValue(18, FONT_SIZE_STEPS, 1)).toBe(20);
    expect(stepValue(18, FONT_SIZE_STEPS, -1)).toBe(16);
    expect(stepValue(16, FONT_SIZE_STEPS, -1)).toBe(16);
    expect(stepValue(28, FONT_SIZE_STEPS, 1)).toBe(28);
    expect(stepValue(19, FONT_SIZE_STEPS, 1)).toBe(20);
    expect(stepValue(1.65, LINE_HEIGHT_STEPS, 1)).toBe(1.8);
    expect(stepValue(45, MEASURE_STEPS, -1)).toBe(38);
  });

  it("normalizes a partial patch onto the step ladder", () => {
    expect(
      normalizeReaderPrefs({
        font: "dyslexia",
        fontSize: 23.4,
        lineHeight: 1.72,
        measure: 50,
        theme: "dark",
      }),
    ).toEqual({
      schema: "haddon.prefs",
      version: 1,
      font: "dyslexia",
      fontSize: 24,
      lineHeight: 1.65,
      measure: 52,
      theme: "dark",
    });
  });

  it("nudges a named stepped field", () => {
    const start = defaultReaderPrefs();
    expect(nudgeSteppedPref(start, "fontSize", 1).fontSize).toBe(20);
    expect(nudgeSteppedPref(start, "lineHeight", -1).lineHeight).toBe(1.5);
    expect(nudgeSteppedPref(start, "measure", 1).measure).toBe(52);
  });
});

describe("load/saveReaderPrefs", () => {
  it("persists through a Storage-like map", () => {
    const memory = new Map<string, string>();
    const storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memory.set(key, value);
      },
    };

    saveReaderPrefs(
      {
        schema: "haddon.prefs",
        version: 1,
        font: "serif",
        fontSize: 24,
        lineHeight: 2,
        measure: 32,
        theme: "dark",
      },
      storage,
    );

    const loaded = loadReaderPrefs(storage);
    expect(loaded.font).toBe("serif");
    expect(loaded.fontSize).toBe(24);
    expect(loaded.theme).toBe("dark");
    expect(loaded.measure).toBe(32);
  });
});

describe("readerPrefsCssVars", () => {
  it("emits custom properties for the article", () => {
    const vars = readerPrefsCssVars({
      ...DEFAULT_READER_PREFS,
      font: "serif",
      fontSize: 22,
      theme: "sepia",
    });
    expect(vars["--haddon-font-family"]).toContain("Literata");
    expect(vars["--haddon-font-size"]).toBe("22px");
    expect(vars["--haddon-measure"]).toBe("45rem");
    expect(vars["--haddon-page-bg"]).toBe("#f4ecd8");
    expect(readerPrefsSignature(DEFAULT_READER_PREFS)).toBe(
      "sans|18|1.65|45|light",
    );
  });

  it("keeps pane vars to page fill so chrome typefaces stay put", () => {
    const pane = readerPaneCssVars({
      ...DEFAULT_READER_PREFS,
      font: "serif",
      theme: "dark",
    });
    expect(pane["--haddon-page-bg"]).toBe("#1c1916");
    expect(pane["--haddon-font-family"]).toBeUndefined();
  });
});
