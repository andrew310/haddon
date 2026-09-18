import { describe, expect, it } from "vitest";
import type { Decoration } from "../../../packages/haddon-navigator/src/decoration-manager";
import type { PublicationLocatorV1 } from "../../../packages/haddon-navigator/src/types";
import {
  asAnnotationStore,
  coerceAnnotations,
  emptyAnnotations,
  loadAnnotations,
  parseAnnotations,
  saveAnnotations,
} from "./annotations";

const locator: PublicationLocatorV1 = {
  schema: "haddon.publication-locator",
  version: 1,
  href: "text/chapter-1.xhtml",
  mediaType: "application/xhtml+xml",
  locations: {
    normalized: {
      revision: "v1",
      start: {
        blockId: "p-1",
        offset: { value: 0, unit: "utf-16-code-unit" },
      },
    },
  },
  text: { exact: "the patient moon" },
};

const highlight: Decoration = {
  id: "highlight-yellow-1",
  locator,
  group: "highlights",
  style: "yellow",
};

describe("parseAnnotations", () => {
  it("returns empty store for missing or foreign payloads", () => {
    expect(parseAnnotations(null)).toEqual(emptyAnnotations());
    expect(parseAnnotations("{not json")).toEqual(emptyAnnotations());
    expect(
      parseAnnotations(JSON.stringify({ schema: "other", version: 1, highlights: [highlight] })),
    ).toEqual(emptyAnnotations());
  });

  it("round-trips highlights and notes", () => {
    const raw = JSON.stringify({
      schema: "haddon.annotations",
      version: 1,
      href: "text/chapter-2.xhtml",
      highlights: [highlight, { id: "bad" }],
      notes: [
        {
          id: "note-1",
          locator,
          quote: "the patient moon",
          content: "AI explanation coming soon...",
          highlightId: highlight.id,
        },
      ],
    });
    const store = parseAnnotations(raw);
    expect(store.href).toBe("text/chapter-2.xhtml");
    expect(store.highlights).toEqual([highlight]);
    expect(store.notes).toHaveLength(1);
    expect(store.notes[0]?.quote).toBe("the patient moon");
  });

  it("coerces a jsonb-shaped object the same way as a JSON string", () => {
    const payload = {
      schema: "haddon.annotations",
      version: 1,
      href: "text/chapter-2.xhtml",
      highlights: [highlight],
      notes: [],
    };
    expect(coerceAnnotations(payload)).toEqual(parseAnnotations(JSON.stringify(payload)));
  });

  it("rejects a foreign schema on strict parse", () => {
    expect(() => asAnnotationStore({ schema: "other", version: 1 })).toThrow(
      /Unsupported annotation schema/,
    );
  });
});

describe("load/saveAnnotations", () => {
  it("persists through a Storage-like map", () => {
    const memory = new Map<string, string>();
    const storage = {
      getItem: (key: string) => memory.get(key) ?? null,
      setItem: (key: string, value: string) => {
        memory.set(key, value);
      },
    };

    saveAnnotations(
      "haddon:web:annotations:book-1",
      {
        schema: "haddon.annotations",
        version: 1,
        href: "text/chapter-1.xhtml",
        highlights: [
          highlight,
          { ...highlight, id: "search-1", group: "search-results" },
        ],
        notes: [],
      },
      storage,
    );

    const loaded = loadAnnotations("haddon:web:annotations:book-1", storage);
    expect(loaded.href).toBe("text/chapter-1.xhtml");
    expect(loaded.highlights).toEqual([highlight]);
  });
});
