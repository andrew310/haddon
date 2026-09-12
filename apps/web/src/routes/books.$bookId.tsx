import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { eq } from "drizzle-orm";
import { createFileRoute, Link } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { Info } from "lucide-react";

import { Button } from "#/components/ui/button";
import { db } from "#/db/client";
import { ensureBooksTable } from "#/db/ensure";
import { books } from "#/db/schema";
import type { AnnotationStoreV1 } from "../../../demo/src/annotations.ts";
import { ChatHeadDock } from "#/components/chatheads/ChatHeadDock";
import { displayBookTitle } from "#/lib/book-title";
import { TWO_LANE_MIN_WIDTH } from "#/lib/chat-head-layout";
import { threadsFromAnnotations } from "#/lib/chat-threads";
import { disposePublicationSession, getWasm } from "#/lib/wasm";

type WasmModule = typeof import("../../../../packages/wasm/pkg/haddon_wasm");
type PublicationSession = InstanceType<WasmModule["PublicationSession"]>;

const SemanticReader = lazy(() => import("../../../demo/src/SemanticReader.tsx"));

const getBook = createServerFn({ method: "GET" })
  .inputValidator((input: unknown) => {
    if (
      !input ||
      typeof input !== "object" ||
      typeof (input as { bookId?: unknown }).bookId !== "string"
    ) {
      throw new Error("Missing book id");
    }
    return { bookId: (input as { bookId: string }).bookId };
  })
  .handler(async ({ data }) => {
    await ensureBooksTable();

    const [book] = await db
      .select()
      .from(books)
      .where(eq(books.id, data.bookId))
      .limit(1);

    if (!book) {
      throw new Error("Book not found");
    }

    return book;
  });

export const Route = createFileRoute("/books/$bookId")({
  loader: ({ params }) => getBook({ data: { bookId: params.bookId } }),
  component: BookReaderPage,
});

function BookReaderPage() {
  const book = Route.useLoaderData();
  const [session, setSession] = useState<PublicationSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [annotations, setAnnotations] = useState<AnnotationStoreV1>({
    schema: "haddon.annotations",
    version: 1,
    href: null,
    highlights: [],
    notes: [],
  });
  const storageKey = `haddon:web:annotations:${book.id}`;
  const bookLabel = displayBookTitle(book.title, book.originalFilename);
  const [lanePref, setLanePref] = useState(1);
  const [wideEnough, setWideEnough] = useState(true);
  const lanes = lanePref === 2 && wideEnough ? 2 : 1;

  useEffect(() => {
    const stored = window.localStorage.getItem("haddon:web:lanes");
    if (stored === "2") setLanePref(2);
    const onResize = () => setWideEnough(window.innerWidth >= TWO_LANE_MIN_WIDTH);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const setLanes = (next: number) => {
    setLanePref(next);
    window.localStorage.setItem("haddon:web:lanes", String(next));
  };

  const handleAnnotationsChange = useCallback((store: AnnotationStoreV1) => {
    setAnnotations(store);
  }, []);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const wasm = await getWasm();
        if (cancelled) return;

        const response = await fetch(`/api/books/${book.id}/file`);
        if (!response.ok) {
          throw new Error(`Failed to load EPUB (${response.status})`);
        }

        const data = new Uint8Array(await response.arrayBuffer());
        if (cancelled) return;

        const next = wasm.PublicationSession.load(data);
        if (cancelled) {
          disposePublicationSession(next);
          return;
        }
        setSession((prev) => {
          if (prev && prev !== next) {
            queueMicrotask(() => disposePublicationSession(prev));
          }
          return next;
        });
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [book.id]);

  return (
    <main className="relative h-svh overflow-hidden bg-background">
      <header className="absolute inset-x-0 top-0 z-[100] flex items-center justify-between gap-4 border-b border-border/40 bg-background/55 px-4 py-2.5 backdrop-blur-2xl backdrop-saturate-150">
        <Link
          to="/"
          className="inline-flex h-8 items-center justify-center rounded-md px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
        >
          Back to library
        </Link>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-border p-0.5">
            <Button
              type="button"
              size="sm"
              variant={lanePref === 1 ? "default" : "ghost"}
              onClick={() => setLanes(1)}
            >
              1 lane
            </Button>
            <Button
              type="button"
              size="sm"
              variant={lanePref === 2 ? "default" : "ghost"}
              onClick={() => setLanes(2)}
              disabled={!wideEnough}
              title={
                wideEnough
                  ? "Two reading columns, each with a chathead strip"
                  : "Widen the window for two lanes"
              }
            >
              2 lanes
            </Button>
          </div>
        <div className="group relative">
          <Button type="button" variant="outline" size="icon-sm" aria-label="Book info">
            <Info className="size-4" />
          </Button>
          <div className="pointer-events-none absolute right-0 top-11 z-20 w-80 rounded-xl border bg-popover p-4 text-sm text-popover-foreground opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
            <div className="space-y-3">
              <div>
                <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  Reader
                </p>
                <h1 className="mt-1 text-lg font-semibold leading-tight">
                  {bookLabel}
                </h1>
                <p className="mt-2 break-words text-xs leading-5 text-muted-foreground">
                  {book.originalFilename}
                </p>
              </div>
              <dl className="grid gap-2 text-sm">
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted-foreground">Highlights</dt>
                  <dd className="font-medium">{annotations.highlights.length}</dd>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <dt className="text-muted-foreground">Notes</dt>
                  <dd className="font-medium">{annotations.notes.length}</dd>
                </div>
              </dl>
            </div>
          </div>
        </div>
        </div>
      </header>
      {loading && (
        <p className="absolute top-14 z-10 px-4 text-sm text-muted-foreground">
          Loading EPUB…
        </p>
      )}
      <div className="relative h-full min-h-0">
        {error ? (
          <div className="p-6">
            <div className="rounded-2xl border border-destructive/20 bg-destructive/5 px-5 py-4 text-sm text-destructive">
              {error}
            </div>
          </div>
        ) : (
          <div
            className="haddon-web-reader h-full overflow-y-auto px-5 pb-5 pt-16"
            data-lanes={lanes}
          >
            {session ? (
              <Suspense
                fallback={
                  <p className="text-sm text-muted-foreground">Opening reader…</p>
                }
              >
                <SemanticReader
                  session={session}
                  storageKey={storageKey}
                  onAnnotationsChange={handleAnnotationsChange}
                  showMarginNotes={false}
                />
              </Suspense>
            ) : null}
          </div>
        )}
        <ChatHeadDock
          threads={threadsFromAnnotations(annotations)}
          lanes={lanes}
        />
      </div>
    </main>
  );
}
