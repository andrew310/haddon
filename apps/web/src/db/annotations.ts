import { eq } from "drizzle-orm";

import {
  asAnnotationStore,
  coerceAnnotations,
  emptyAnnotations,
  toAnnotationPayload,
  type AnnotationStoreV1,
} from "../../../demo/src/annotations";
import { db } from "./client";
import { ensureBookAnnotationsTable } from "./ensure";
import { bookAnnotations, books } from "./schema";

export type BookAnnotationLoad = {
  found: boolean;
  store: AnnotationStoreV1;
};

export function annotationsFromPayload(payload: unknown): AnnotationStoreV1 {
  if (typeof payload === "string") {
    try {
      return toAnnotationPayload(coerceAnnotations(JSON.parse(payload)));
    } catch {
      return emptyAnnotations();
    }
  }
  return toAnnotationPayload(coerceAnnotations(payload));
}

export async function getBookAnnotationStore(
  bookId: string,
): Promise<BookAnnotationLoad> {
  await ensureBookAnnotationsTable();

  const [row] = await db
    .select()
    .from(bookAnnotations)
    .where(eq(bookAnnotations.bookId, bookId))
    .limit(1);

  if (!row) {
    return { found: false, store: emptyAnnotations() };
  }

  return { found: true, store: annotationsFromPayload(row.payload) };
}

export async function saveBookAnnotationStore(
  bookId: string,
  store: AnnotationStoreV1,
): Promise<AnnotationStoreV1> {
  await ensureBookAnnotationsTable();

  const [book] = await db
    .select({ id: books.id })
    .from(books)
    .where(eq(books.id, bookId))
    .limit(1);

  if (!book) {
    throw new Error("Book not found");
  }

  const payload = toAnnotationPayload(asAnnotationStore(store));
  const updatedAt = new Date();

  await db
    .insert(bookAnnotations)
    .values({
      bookId,
      payload,
      updatedAt,
    })
    .onConflictDoUpdate({
      target: bookAnnotations.bookId,
      set: { payload, updatedAt },
    });

  return payload;
}
