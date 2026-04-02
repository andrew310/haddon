import { pgTable, text, timestamp, uuid, integer } from "drizzle-orm/pg-core";

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

export type BookRecord = typeof books.$inferSelect;
export type NewBookRecord = typeof books.$inferInsert;
