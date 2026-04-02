import { useMemo, useState } from "react";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { createFileRoute, Link } from "@tanstack/react-router";
import { createServerFn, useServerFn } from "@tanstack/react-start";
import { useUploadFiles } from "@better-upload/client";

import { UploadDropzone } from "#/components/ui/upload-dropzone";
import { Button } from "#/components/ui/button";
import { db } from "#/db/client";
import { ensureBooksTable } from "#/db/ensure";
import { books, type BookRecord } from "#/db/schema";
import { uploadBucketName } from "#/lib/upload-router";

const createBookSchema = z.object({
  title: z.string().min(1),
  originalFilename: z.string().min(1),
  mimeType: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  storageKey: z.string().min(1),
  storageBucket: z.string().min(1),
  objectEtag: z.string().nullable().optional(),
});

const listBooks = createServerFn({ method: "GET" }).handler(async () => {
  try {
    await ensureBooksTable();
    return db.select().from(books).orderBy(desc(books.createdAt));
  } catch {
    return [];
  }
});

const createBookRecord = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => createBookSchema.parse(data))
  .handler(async ({ data }) => {
    await ensureBooksTable();

    const [created] = await db
      .insert(books)
      .values({
        title: data.title,
        originalFilename: data.originalFilename,
        mimeType: data.mimeType,
        sizeBytes: data.sizeBytes,
        storageKey: data.storageKey,
        storageBucket: data.storageBucket,
        objectEtag: data.objectEtag ?? null,
      })
      .onConflictDoNothing({ target: books.storageKey })
      .returning();

    if (created) return created;

    const [existing] = await db
      .select()
      .from(books)
      .where(eq(books.storageKey, data.storageKey));

    if (!existing) {
      throw new Error("Upload stored, but metadata record was not found.");
    }

    return existing;
  });

export const Route = createFileRoute("/")({
  loader: () => listBooks(),
  component: HomePage,
});

function HomePage() {
  const initialBooks = Route.useLoaderData();
  const createBookRecordFn = useServerFn(createBookRecord);
  const [items, setItems] = useState(initialBooks);
  const [error, setError] = useState<string | null>(null);

  const totalBytes = useMemo(
    () => items.reduce((sum, item) => sum + item.sizeBytes, 0),
    [items],
  );

  const upload = useUploadFiles({
    api: "/api/upload",
    route: "book",
    onError: (uploadError) => {
      console.error("better-upload error", uploadError);
      const detailed =
        uploadError.file?.error?.message || uploadError.message;
      setError(detailed);
    },
    onUploadBegin: (data) => {
      console.log("better-upload begin", data);
    },
    onUploadProgress: (data) => {
      console.log("better-upload progress", data);
    },
    onUploadComplete: async ({ files }) => {
      console.log("better-upload complete", files);
      setError(null);
      const created = await Promise.all(
        files.map((file) =>
          createBookRecordFn({
            data: {
              title: file.name.replace(/\.[^.]+$/, ""),
              originalFilename: file.name,
              mimeType: file.type || "application/epub+zip",
              sizeBytes: file.size,
              storageKey: file.objectInfo.key,
              storageBucket: uploadBucketName,
              objectEtag:
                typeof file.objectInfo.metadata?.etag === "string"
                  ? file.objectInfo.metadata.etag
                  : null,
            },
          }),
        ),
      );
      setItems((current) => {
        const merged = [...created, ...current];
        const seen = new Set<string>();
        return merged.filter((item) => {
          if (seen.has(item.id)) return false;
          seen.add(item.id);
          return true;
        });
      });
    },
  });

  return (
    <main className="page-wrap px-4 pb-10 pt-10">
      <section className="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="island-shell rounded-[1.75rem] p-5 lg:sticky lg:top-6 lg:h-fit">
          <p className="island-kicker mb-3">Library Intake</p>
          <h1 className="display-title text-4xl font-bold tracking-tight text-[var(--sea-ink)]">
            Build the book workspace.
          </h1>
          <p className="mt-4 text-sm leading-7 text-[var(--sea-ink-soft)]">
            The first useful slice is simple: upload EPUBs into MinIO, persist
            metadata in Postgres, and use that library as the basis for the
            reader and writing tools.
          </p>

          <div className="mt-6 rounded-2xl border border-[var(--line)] bg-white/60 p-4">
            <dl className="grid gap-3 text-sm">
              <div className="flex items-center justify-between gap-4">
                <dt className="text-[var(--sea-ink-soft)]">Books stored</dt>
                <dd className="font-semibold text-[var(--sea-ink)]">
                  {items.length}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-[var(--sea-ink-soft)]">Bytes uploaded</dt>
                <dd className="font-semibold text-[var(--sea-ink)]">
                  {new Intl.NumberFormat().format(totalBytes)}
                </dd>
              </div>
              <div className="flex items-center justify-between gap-4">
                <dt className="text-[var(--sea-ink-soft)]">Pending</dt>
                <dd className="font-semibold text-[var(--sea-ink)]">
                  {upload.isPending ? `${Math.round(upload.averageProgress * 100)}%` : "Idle"}
                </dd>
              </div>
            </dl>
          </div>
        </aside>

        <section className="grid gap-6">
          <div className="island-shell rounded-[1.75rem] p-6">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <p className="island-kicker mb-2">Upload</p>
                <h2 className="text-2xl font-semibold text-[var(--sea-ink)]">
                  Add a book
                </h2>
              </div>
              <p className="max-w-lg text-sm text-[var(--sea-ink-soft)]">
                This uses Better Upload’s dropzone UI and direct S3-compatible
                upload flow, then writes a `books` row through a TanStack Start
                server function.
              </p>
            </div>

            <div className="mt-6 grid gap-4">
              <UploadDropzone
                control={upload.control}
                accept=".epub,application/epub+zip"
                description={{
                  fileTypes: "EPUB files",
                  maxFiles: 1,
                  maxFileSize: "100 MB",
                }}
              />

              <div className="flex items-center gap-3">
                <Button
                  type="button"
                  variant="outline"
                  disabled={upload.isPending}
                  onClick={() => upload.reset()}
                >
                  Reset Upload State
                </Button>
                {error && (
                  <p className="text-sm font-medium text-[hsl(0_70%_45%)]">
                    {error}
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="island-shell rounded-[1.75rem] p-6">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="island-kicker mb-2">Catalog</p>
                <h2 className="text-2xl font-semibold text-[var(--sea-ink)]">
                  Uploaded books
                </h2>
              </div>
            </div>

            <div className="mt-6 grid gap-3">
              {items.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-[var(--line)] bg-white/45 px-5 py-10 text-sm text-[var(--sea-ink-soft)]">
                  No books yet. Start by dropping one EPUB into the uploader.
                </div>
              ) : (
                items.map((book) => <BookCard key={book.id} book={book} />)
              )}
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}

function BookCard({ book }: { book: BookRecord }) {
  return (
    <Link
      to="/books/$bookId"
      params={{ bookId: book.id }}
      className="block rounded-2xl border border-[var(--line)] bg-white/60 px-5 py-4 transition hover:-translate-y-0.5 hover:border-[var(--sea-accent)]/50 hover:bg-white hover:shadow-[0_18px_50px_rgba(15,23,42,0.08)]"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-base font-semibold text-[var(--sea-ink)]">
            {book.title}
          </h3>
          <p className="text-sm text-[var(--sea-ink-soft)]">
            {book.originalFilename}
          </p>
        </div>
        <div className="text-right text-xs uppercase tracking-[0.16em] text-[var(--sea-ink-soft)]">
          {new Intl.NumberFormat().format(book.sizeBytes)} bytes
        </div>
      </div>
      <div className="mt-3 text-xs text-[var(--sea-ink-soft)]">
        <span>{book.storageBucket}</span>
        <span className="mx-2">/</span>
        <code>{book.storageKey}</code>
      </div>
    </Link>
  );
}
