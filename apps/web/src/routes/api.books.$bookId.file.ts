import { GetObjectCommand } from "@aws-sdk/client-s3";
import { eq } from "drizzle-orm";
import { createFileRoute } from "@tanstack/react-router";

import { db } from "#/db/client";
import { ensureBooksTable } from "#/db/ensure";
import { books } from "#/db/schema";
import { s3Client } from "#/lib/s3-client";

export const Route = createFileRoute("/api/books/$bookId/file")({
  server: {
    handlers: {
      GET: async ({ params }: { params: { bookId: string } }) => {
        await ensureBooksTable();

        const [book] = await db
          .select()
          .from(books)
          .where(eq(books.id, params.bookId))
          .limit(1);

        if (!book) {
          return new Response("Book not found", { status: 404 });
        }

        const object = await s3Client.send(
          new GetObjectCommand({
            Bucket: book.storageBucket,
            Key: book.storageKey,
          }),
        );

        if (!object.Body) {
          return new Response("Stored book file is empty", { status: 404 });
        }

        const bytes = await object.Body.transformToByteArray();

        return new Response(bytes, {
          status: 200,
          headers: {
            "content-type": book.mimeType,
            "content-length": String(bytes.byteLength),
          },
        });
      },
    },
  },
});
