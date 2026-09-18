import { lazy, Suspense, useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { eq } from "drizzle-orm";
import { createFileRoute, Link } from "@tanstack/react-router";
import { createServerFn, useServerFn } from "@tanstack/react-start";
import { Info } from "lucide-react";

import { Button } from "#/components/ui/button";
import { ReaderTypography } from "#/components/reader/ReaderTypography";
import {
  getBookAnnotationStore,
  saveBookAnnotationStore,
} from "#/db/annotations";
import { db } from "#/db/client";
import { ensureBooksTable } from "#/db/ensure";
import { books } from "#/db/schema";
import {
  asAnnotationStore,
  emptyAnnotations,
  loadAnnotations,
  saveAnnotations,
  type AnnotationStoreV1,
} from "../../../demo/src/annotations.ts";
import type { ExplainPassageRequest } from "../../../demo/src/SemanticReader.tsx";
import { ChatHeadDock } from "#/components/chatheads/ChatHeadDock";
import { askAboutPassage } from "#/lib/ask-ai-fn";
import { replyFromAskAiResult } from "#/lib/ask-ai";
import {
  annotationStoreToPayload,
  mergeAnnotationSources,
  serverAnnotationsFromDto,
  webAnnotationsStorageKey,
  type ServerAnnotationsDto,
} from "#/lib/annotations-cache";
import { displayBookTitle } from "#/lib/book-title";
import { TWO_LANE_MIN_WIDTH } from "#/lib/chat-head-layout";
import { threadsFromAnnotations } from "#/lib/chat-threads";
import { disposePublicationSession, getWasm } from "#/lib/wasm";
import {
  defaultReaderPrefs,
  loadReaderPrefs,
  readerPaneCssVars,
  saveReaderPrefs,
  subscribeReaderPrefs,
  type ReaderPrefsV1,
} from "../../../demo/src/reader-prefs";

const ANNOTATIONS_SAVE_DEBOUNCE_MS = 400;

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

const getBookAnnotations = createServerFn({ method: "GET" })
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
  .handler(async ({ data }): Promise<ServerAnnotationsDto> => {
    try {
      const loaded = await getBookAnnotationStore(data.bookId);
      return {
        ok: true,
        found: loaded.found,
        payload: annotationStoreToPayload(loaded.store),
      };
    } catch {
      return { ok: false };
    }
  });

const persistBookAnnotations = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => {
    if (!input || typeof input !== "object") {
      throw new Error("Missing annotation payload");
    }
    const bookId = (input as { bookId?: unknown }).bookId;
    const payload = (input as { payload?: unknown }).payload;
    if (typeof bookId !== "string" || bookId.length === 0) {
      throw new Error("Missing book id");
    }
    if (typeof payload !== "string") {
      throw new Error("Missing annotation store");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      throw new Error("Invalid annotation store");
    }
    asAnnotationStore(parsed);
    return { bookId, payload };
  })
  .handler(async ({ data }) => {
    await saveBookAnnotationStore(
      data.bookId,
      asAnnotationStore(JSON.parse(data.payload)),
    );
    return { ok: true as const };
  });

export const Route = createFileRoute("/books/$bookId")({
  loader: async ({ params }) => {
    const book = await getBook({ data: { bookId: params.bookId } });
    const annotations = await getBookAnnotations({
      data: { bookId: params.bookId },
    });
    return { book, annotations };
  },
  component: BookReaderPage,
});

function BookReaderPage() {
  const { book, annotations: annotationsDto } = Route.useLoaderData();
  const annotationsLoad = serverAnnotationsFromDto(annotationsDto);
  const askAboutPassageFn = useServerFn(askAboutPassage);
  const persistBookAnnotationsFn = useServerFn(persistBookAnnotations);
  const [session, setSession] = useState<PublicationSession | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [seededBookId, setSeededBookId] = useState<string | null>(null);
  const [annotations, setAnnotations] = useState<AnnotationStoreV1>(() =>
    annotationsLoad.ok && annotationsLoad.found
      ? annotationsLoad.store
      : emptyAnnotations(),
  );
  const storageKey = webAnnotationsStorageKey(book.id);
  const cacheReady = seededBookId === book.id;
  const bookLabel = displayBookTitle(book.title, book.originalFilename);
  const [lanePref, setLanePref] = useState(1);
  const [wideEnough, setWideEnough] = useState(true);
  const lanes = lanePref === 2 && wideEnough ? 2 : 1;
  const [prefs, setPrefs] = useState<ReaderPrefsV1>(defaultReaderPrefs);
  const pendingStoreRef = useRef<AnnotationStoreV1 | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const annotationsLoadRef = useRef(annotationsLoad);
  annotationsLoadRef.current = annotationsLoad;

  useEffect(() => {
    const stored = window.localStorage.getItem("haddon:web:lanes");
    if (stored === "2") setLanePref(2);
    setPrefs(loadReaderPrefs());
    const onResize = () => setWideEnough(window.innerWidth >= TWO_LANE_MIN_WIDTH);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => subscribeReaderPrefs(setPrefs), []);

  const setLanes = (next: number) => {
    setLanePref(next);
    window.localStorage.setItem("haddon:web:lanes", String(next));
  };

  const flushAnnotationsSave = useCallback(
    (store: AnnotationStoreV1) => {
      pendingStoreRef.current = null;
      void persistBookAnnotationsFn({
        data: { bookId: book.id, payload: annotationStoreToPayload(store) },
      }).catch(() => {
        // localStorage already holds the envelope
      });
    },
    [book.id, persistBookAnnotationsFn],
  );
  const flushAnnotationsSaveRef = useRef(flushAnnotationsSave);
  flushAnnotationsSaveRef.current = flushAnnotationsSave;

  const handleAnnotationsChange = useCallback((store: AnnotationStoreV1) => {
    setAnnotations(store);
    pendingStoreRef.current = store;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      flushAnnotationsSaveRef.current(store);
    }, ANNOTATIONS_SAVE_DEBOUNCE_MS);
  }, []);

  const explainPassage = useCallback(
    async (input: ExplainPassageRequest) => {
      const result = await askAboutPassageFn({
        data: {
          ...input,
          bookTitle: bookLabel,
          bookId: book.id,
        },
      });
      return replyFromAskAiResult(result);
    },
    [askAboutPassageFn, book.id, bookLabel],
  );

  useEffect(() => {
    const local = loadAnnotations(storageKey);
    const merged = mergeAnnotationSources(annotationsLoadRef.current, local);
    saveAnnotations(storageKey, merged.store);
    setAnnotations(merged.store);
    setSeededBookId(book.id);
    if (merged.persistToServer) {
      flushAnnotationsSaveRef.current(merged.store);
    }
  }, [book.id, storageKey]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      if (pendingStoreRef.current) {
        flushAnnotationsSaveRef.current(pendingStoreRef.current);
      }
    };
  }, [book.id]);

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
          <ReaderTypography
            prefs={prefs}
            onChange={(next) => setPrefs(saveReaderPrefs(next))}
          />
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
            data-reader-theme={prefs.theme}
            style={readerPaneCssVars(prefs) as CSSProperties}
          >
            {session && cacheReady ? (
              <Suspense
                fallback={
                  <p className="text-sm text-muted-foreground">Opening reader…</p>
                }
              >
                <SemanticReader
                  session={session}
                  storageKey={storageKey}
                  onAnnotationsChange={handleAnnotationsChange}
                  explainPassage={explainPassage}
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
