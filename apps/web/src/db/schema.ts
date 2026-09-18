import { pgTable, text, timestamp, uuid, integer, jsonb } from "drizzle-orm/pg-core";

import type { AnnotationStoreV1 } from "../../../demo/src/annotations";

export const books = pgTable("books", {
  id: uuid("id").defaultRandom().primaryKey(),
  title: text("title").notNull(),
  originalFilename: text("original_filename").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  storageKey: text("storage_key").notNull().unique(),
  storageBucket: text("storage_bucket").notNull(),
  objectEtag: text("object_etag"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const bookAnnotations = pgTable("book_annotations", {
  bookId: uuid("book_id")
    .primaryKey()
    .references(() => books.id, { onDelete: "cascade" }),
  payload: jsonb("payload").$type<AnnotationStoreV1>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export type BookRecord = typeof books.$inferSelect;
export type NewBookRecord = typeof books.$inferInsert;
export type BookAnnotationRecord = typeof bookAnnotations.$inferSelect;
