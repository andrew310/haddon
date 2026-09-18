import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import {
  emptyAnnotations,
  type AnnotationStoreV1,
} from "../../../demo/src/annotations";
import type { Decoration } from "../../../../packages/haddon-navigator/src/decoration-manager";
import type { PublicationLocatorV1 } from "../../../../packages/haddon-navigator/src/types";
import {
  annotationsFromPayload,
  getBookAnnotationStore,
  saveBookAnnotationStore,
} from "./annotations";
import { postgresClient, db } from "./client";
import { ensureBookAnnotationsTable } from "./ensure";
import { books, bookAnnotations } from "./schema";

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

const store: AnnotationStoreV1 = {
  schema: "haddon.annotations",
  version: 1,
  href: "text/chapter-2.xhtml",
  highlights: [
    highlight,
    { ...highlight, id: "search-1", group: "search-results" },
  ],
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

describe("annotationsFromPayload", () => {
  it("parses jsonb objects and JSON strings", () => {
    expect(annotationsFromPayload(store)).toEqual({
      ...store,
      highlights: [highlight],
    });
    expect(annotationsFromPayload(JSON.stringify(store)).highlights).toEqual([
      highlight,
    ]);
    expect(annotationsFromPayload(null)).toEqual(emptyAnnotations());
    expect(annotationsFromPayload("{not json")).toEqual(emptyAnnotations());
  });
});

describe("book_annotations postgres roundtrip", () => {
  it("saves a v1 store and reloads the same highlights and notes without localStorage", async () => {
    const bookId = crypto.randomUUID();

    try {
      await ensureBookAnnotationsTable();
      await db.insert(books).values({
        id: bookId,
        title: "Annotations roundtrip",
        originalFilename: "roundtrip.epub",
        mimeType: "application/epub+zip",
        sizeBytes: 1,
        storageKey: `test/annotations-roundtrip-${bookId}.epub`,
        storageBucket: "haddon-books",
        objectEtag: null,
      });

      const missing = await getBookAnnotationStore(bookId);
      expect(missing.found).toBe(false);
      expect(missing.store).toEqual(emptyAnnotations());

      const saved = await saveBookAnnotationStore(bookId, store);
      expect(saved.highlights).toEqual([highlight]);
      expect(saved.notes).toHaveLength(1);
      expect(saved.href).toBe("text/chapter-2.xhtml");

      const loaded = await getBookAnnotationStore(bookId);
      expect(loaded.found).toBe(true);
      expect(loaded.store.href).toBe(store.href);
      expect(loaded.store.highlights).toEqual([highlight]);
      expect(loaded.store.notes).toEqual(store.notes);
      expect(loaded.store.schema).toBe("haddon.annotations");
      expect(loaded.store.version).toBe(1);

      await saveBookAnnotationStore(bookId, {
        ...saved,
        href: "text/chapter-3.xhtml",
      });
      const reloaded = await getBookAnnotationStore(bookId);
      expect(reloaded.store.href).toBe("text/chapter-3.xhtml");
      expect(reloaded.store.highlights).toEqual([highlight]);
      expect(reloaded.store.notes).toEqual(store.notes);
    } finally {
      await db.delete(bookAnnotations).where(eq(bookAnnotations.bookId, bookId));
      await db.delete(books).where(eq(books.id, bookId));
    }
  });
});

afterAll(async () => {
  await postgresClient.end({ timeout: 5 });
});
