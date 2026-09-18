import { describe, expect, it } from "vitest";
import {
  coerceAnnotations,
  emptyAnnotations,
  parseAnnotations,
  type AnnotationStoreV1,
} from "../../../demo/src/annotations";
import type { Decoration } from "../../../../packages/haddon-navigator/src/decoration-manager";
import type { PublicationLocatorV1 } from "../../../../packages/haddon-navigator/src/types";
import {
  annotationStoreToPayload,
  annotationsHaveContent,
  mergeAnnotationSources,
  serverAnnotationsFromDto,
  webAnnotationsStorageKey,
} from "./annotations-cache";

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

const localStore: AnnotationStoreV1 = {
  schema: "haddon.annotations",
  version: 1,
  href: "text/chapter-1.xhtml",
  highlights: [highlight],
  notes: [
    {
      id: "note-1",
      locator,
      quote: "the patient moon",
      content: "AI explanation coming soon...",
      highlightId: highlight.id,
    },
  ],
};

const serverStore: AnnotationStoreV1 = {
  schema: "haddon.annotations",
  version: 1,
  href: "text/chapter-2.xhtml",
  highlights: [{ ...highlight, id: "highlight-server", style: "pink" }],
  notes: [],
};

describe("parseAnnotations", () => {
  it("keeps the v1 envelope and drops foreign payloads", () => {
    expect(parseAnnotations(null)).toEqual(emptyAnnotations());
    expect(
      parseAnnotations(JSON.stringify({ schema: "other", version: 1, highlights: [highlight] })),
    ).toEqual(emptyAnnotations());

    const raw = JSON.stringify(localStore);
    expect(parseAnnotations(raw)).toEqual(localStore);
    expect(coerceAnnotations(localStore)).toEqual(localStore);
    expect(coerceAnnotations(JSON.parse(raw))).toEqual(parseAnnotations(raw));
  });
});

describe("mergeAnnotationSources", () => {
  it("uses the server row when Postgres answered", () => {
    const merged = mergeAnnotationSources(
      { ok: true, found: true, store: serverStore },
      localStore,
    );
    expect(merged.source).toBe("server");
    expect(merged.persistToServer).toBe(false);
    expect(merged.store).toEqual(serverStore);
  });

  it("keeps local cache when the server has no row yet", () => {
    const merged = mergeAnnotationSources(
      { ok: true, found: false, store: emptyAnnotations() },
      localStore,
    );
    expect(merged.source).toBe("local");
    expect(merged.persistToServer).toBe(true);
    expect(merged.store).toEqual(localStore);
  });

  it("falls back to localStorage when the server fails", () => {
    const merged = mergeAnnotationSources({ ok: false }, localStore);
    expect(merged.source).toBe("local");
    expect(merged.persistToServer).toBe(false);
    expect(merged.store).toEqual(localStore);
  });

  it("treats an empty server row as source of truth", () => {
    const merged = mergeAnnotationSources(
      { ok: true, found: true, store: emptyAnnotations() },
      localStore,
    );
    expect(merged.source).toBe("server");
    expect(merged.store).toEqual(emptyAnnotations());
    expect(annotationsHaveContent(merged.store)).toBe(false);
  });
});

describe("webAnnotationsStorageKey", () => {
  it("matches the existing localStorage prefix", () => {
    expect(webAnnotationsStorageKey("abc")).toBe("haddon:web:annotations:abc");
  });
});

describe("serverAnnotationsFromDto", () => {
  it("rehydrates a payload as if localStorage were empty", () => {
    const dto = {
      ok: true as const,
      found: true,
      payload: annotationStoreToPayload(localStore),
    };
    const loaded = serverAnnotationsFromDto(dto);
    expect(loaded).toEqual({ ok: true, found: true, store: localStore });
    expect(serverAnnotationsFromDto({ ok: false })).toEqual({ ok: false });
  });
});
