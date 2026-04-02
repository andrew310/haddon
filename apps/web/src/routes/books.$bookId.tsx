import { useCallback, useEffect, useRef, useState } from "react";
import { eq } from "drizzle-orm";
import { createFileRoute, Link } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import {
  autoUpdate,
  flip,
  offset,
  shift,
  useFloating,
} from "@floating-ui/react";
import { Info } from "lucide-react";

import { Layout, LayoutPanel } from "#/components/layout/rutabega";
import { Button } from "#/components/ui/button";
import { db } from "#/db/client";
import { ensureBooksTable } from "#/db/ensure";
import { books } from "#/db/schema";
import type { LayoutModel } from "rutabega";

type WasmModule = typeof import("../../../../packages/wasm/pkg/haddon_wasm");
type ReaderInstance = InstanceType<WasmModule["EpubReader"]>;
type DocumentPoint = {
  chapterIndex: number;
  blockIndex: number;
  offset: number;
};
type DocumentRange = {
  start: DocumentPoint;
  end: DocumentPoint;
};
type SelectionAnchor = {
  x: number;
  y: number;
  width: number;
  height: number;
};

let wasmModule: WasmModule | null = null;
const HIGHLIGHT_STORAGE_PREFIX = "haddon:web:highlights:";
const WORKSPACE_LAYOUT_MODEL: LayoutModel = {
  orientation: "horizontal",
  panels: [
    { id: "reader", label: "Book", weight: 68, minWeight: 35 },
    { id: "workbench", label: "Workbench", weight: 32, minWeight: 18 },
  ],
};

async function getWasm() {
  if (!wasmModule) {
    const mod = await import("../../../../packages/wasm/pkg/haddon_wasm");
    await mod.default();
    wasmModule = mod;
  }
  return wasmModule;
}

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
  const [reader, setReader] = useState<ReaderInstance | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedText, setSelectedText] = useState<string | null>(null);
  const [selectionAnchor, setSelectionAnchor] = useState<SelectionAnchor | null>(
    null,
  );
  const [savedHighlightCount, setSavedHighlightCount] = useState(0);
  const [isSelecting, setIsSelecting] = useState(false);
  const [tooltip, setTooltip] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const readerRef = useRef<ReaderInstance | null>(null);
  const selectingRef = useRef(false);
  const selectionPointerIdRef = useRef<number | null>(null);
  const selectionReferenceRef = useRef<{
    getBoundingClientRect: () => DOMRect;
  } | null>(null);
  const noteReferenceRef = useRef<{
    getBoundingClientRect: () => DOMRect;
  } | null>(null);

  const { refs, floatingStyles } = useFloating({
    placement: "top",
    whileElementsMounted: autoUpdate,
    middleware: [offset(12), flip(), shift({ padding: 12 })],
    strategy: "fixed",
  });
  const { refs: noteRefs, floatingStyles: noteFloatingStyles } = useFloating({
    placement: "top",
    whileElementsMounted: autoUpdate,
    middleware: [offset(10), flip(), shift({ padding: 12 })],
    strategy: "fixed",
  });

  const highlightStorageKey = `${HIGHLIGHT_STORAGE_PREFIX}${book.id}`;

  const getCanvasPoint = useCallback(
    (canvas: HTMLCanvasElement, clientX: number, clientY: number) => {
      const dpr = window.devicePixelRatio || 2;
      const rect = canvas.getBoundingClientRect();
      const scaleX = (canvas.width / dpr) / rect.width;
      const scaleY = (canvas.height / dpr) / rect.height;
      return {
        x: (clientX - rect.left) * scaleX,
        y: (clientY - rect.top) * scaleY,
      };
    },
    [],
  );

  const renderPage = useCallback((pageIndex: number) => {
    const instance = readerRef.current;
    const canvas = canvasRef.current;
    if (!instance || !canvas) return;
    instance.render_page(canvas, pageIndex, window.devicePixelRatio || 2);
    canvas.style.width = `${canvas.width / (window.devicePixelRatio || 2)}px`;
    canvas.style.height = `${canvas.height / (window.devicePixelRatio || 2)}px`;
  }, []);

  const rerenderCurrentPage = useCallback(() => {
    try {
      renderPage(currentPage);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [currentPage, renderPage]);

  const syncSelectionState = useCallback(() => {
    const instance = readerRef.current;
    if (!instance) return;
    const text = instance.selected_text();
    setSelectedText(text && text.length > 0 ? text : null);
    if (!text) {
      setSelectionAnchor(null);
      selectionReferenceRef.current = null;
      refs.setPositionReference(null);
    }
  }, [refs]);

  const syncSelectionAnchor = useCallback(() => {
    const instance = readerRef.current;
    const canvas = canvasRef.current;
    if (!instance || !canvas) return;

    const raw = instance.selection_anchor_rect(currentPage) as
      | { x: number; y: number; width: number; height: number }
      | null;

    if (!raw) {
      setSelectionAnchor(null);
      selectionReferenceRef.current = null;
      refs.setPositionReference(null);
      return;
    }

    const dpr = window.devicePixelRatio || 2;
    const rect = canvas.getBoundingClientRect();
    const scaleX = rect.width / (canvas.width / dpr);
    const scaleY = rect.height / (canvas.height / dpr);
    const anchor = {
      x: rect.left + raw.x * scaleX,
      y: rect.top + raw.y * scaleY,
      width: raw.width * scaleX,
      height: raw.height * scaleY,
    };
    setSelectionAnchor(anchor);

    const virtualReference = {
      getBoundingClientRect: () =>
        new DOMRect(anchor.x, anchor.y, anchor.width, anchor.height),
    };
    selectionReferenceRef.current = virtualReference;
    refs.setPositionReference(virtualReference);
  }, [currentPage, refs]);

  const hydrateHighlights = useCallback(() => {
    const instance = readerRef.current;
    if (!instance) return;
    const raw = localStorage.getItem(highlightStorageKey);
    const ranges = raw ? (JSON.parse(raw) as DocumentRange[]) : [];
    instance.set_highlights(ranges);
    setSavedHighlightCount(ranges.length);
    rerenderCurrentPage();
  }, [highlightStorageKey, rerenderCurrentPage]);

  const persistHighlights = useCallback(() => {
    const instance = readerRef.current;
    if (!instance) return;
    const highlights = Array.from(
      instance.highlights() as ArrayLike<DocumentRange>,
    );
    localStorage.setItem(highlightStorageKey, JSON.stringify(highlights));
    setSavedHighlightCount(highlights.length);
    rerenderCurrentPage();
  }, [highlightStorageKey, rerenderCurrentPage]);

  const relayout = useCallback(
    (instance: ReaderInstance) => {
      const width = Math.min(containerRef.current?.clientWidth ?? 700, 900) - 48;
      instance.relayout(Math.max(width, 420), 880);
      const count = instance.page_count();
      setPageCount(count);
      setCurrentPage((prev) => Math.min(prev, Math.max(0, count - 1)));
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const [wasm, response] = await Promise.all([
          getWasm(),
          fetch(`/api/books/${book.id}/file`),
        ]);

        if (!response.ok) {
          throw new Error(`Failed to load EPUB (${response.status})`);
        }

        const data = new Uint8Array(await response.arrayBuffer());
        const instance = wasm.EpubReader.load(data);
        if (cancelled) return;
        readerRef.current = instance;
        setReader(instance);
        relayout(instance);
        hydrateHighlights();
        requestAnimationFrame(() => {
          if (!cancelled) {
            try {
              renderPage(0);
            } catch (renderError) {
              setError(
                renderError instanceof Error
                  ? renderError.message
                  : String(renderError),
              );
            }
          }
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

    load();

    return () => {
      cancelled = true;
      readerRef.current = null;
    };
  }, [book.id, hydrateHighlights, relayout, renderPage]);

  useEffect(() => {
    if (!reader || pageCount === 0) return;
    try {
      renderPage(currentPage);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [currentPage, pageCount, reader, renderPage]);

  useEffect(() => {
    const instance = readerRef.current;
    if (!instance) return;

    let timeout: ReturnType<typeof setTimeout>;
    const handleResize = () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        const active = readerRef.current;
        if (!active) return;
        try {
          relayout(active);
          requestAnimationFrame(() => {
            try {
              renderPage(currentPage);
            } catch (err) {
              setError(err instanceof Error ? err.message : String(err));
            }
          });
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        }
      }, 50);
    };

    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      clearTimeout(timeout);
    };
  }, [currentPage, relayout, renderPage, reader]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "c" && selectedText) {
        event.preventDefault();
        navigator.clipboard.writeText(selectedText);
      }
      if (event.key === "Escape" && selectedText) {
        const instance = readerRef.current;
        if (!instance) return;
        instance.clear_selection();
        setSelectedText(null);
        setSelectionAnchor(null);
        setTooltip(null);
        refs.setPositionReference(null);
        noteRefs.setPositionReference(null);
        rerenderCurrentPage();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [noteRefs, refs, rerenderCurrentPage, selectedText]);

  const handleMouseMove = useCallback(
    (clientX: number, clientY: number) => {
      const instance = readerRef.current;
      const canvas = canvasRef.current;
      if (!instance || !canvas || selectingRef.current) return;

      const { x, y } = getCanvasPoint(canvas, clientX, clientY);
      const raw = instance.noteref_anchor_rect(currentPage, x, y) as
        | { id: string; x: number; y: number; width: number; height: number }
        | null;

      if (raw) {
        const noteText = instance.get_note(raw.id);
        if (noteText) {
          canvas.style.cursor = "pointer";
          const dpr = window.devicePixelRatio || 2;
          const rect = canvas.getBoundingClientRect();
          const scaleX = rect.width / (canvas.width / dpr);
          const scaleY = rect.height / (canvas.height / dpr);
          const virtualReference = {
            getBoundingClientRect: () =>
              new DOMRect(
                rect.left + raw.x * scaleX,
                rect.top + raw.y * scaleY,
                raw.width * scaleX,
                raw.height * scaleY,
              ),
          };
          noteReferenceRef.current = virtualReference;
          noteRefs.setPositionReference(virtualReference);
          setTooltip(noteText);
          return;
        }
      }

      canvas.style.cursor = "default";
      noteReferenceRef.current = null;
      noteRefs.setPositionReference(null);
      setTooltip(null);
    },
    [currentPage, getCanvasPoint, noteRefs],
  );

  const handleMouseLeave = useCallback(() => {
    const canvas = canvasRef.current;
    if (canvas) {
      canvas.style.cursor = "default";
    }
    noteReferenceRef.current = null;
    noteRefs.setPositionReference(null);
    setTooltip(null);
  }, [noteRefs]);

  const handleSelectionStart = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      event.preventDefault();
      const instance = readerRef.current;
      const canvas = canvasRef.current;
      if (!instance || !canvas || event.button !== 0) return;
      const { x, y } = getCanvasPoint(canvas, event.clientX, event.clientY);
      selectingRef.current = true;
      selectionPointerIdRef.current = event.pointerId;
      event.currentTarget.setPointerCapture(event.pointerId);
      setIsSelecting(true);
      setTooltip(null);
      instance.begin_selection(currentPage, x, y);
      rerenderCurrentPage();
    },
    [currentPage, getCanvasPoint, rerenderCurrentPage],
  );

  const handleSelectionMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (!selectingRef.current) {
        handleMouseMove(event.clientX, event.clientY);
        return;
      }
      event.preventDefault();
      const instance = readerRef.current;
      const canvas = canvasRef.current;
      if (!instance || !canvas) return;
      const { x, y } = getCanvasPoint(canvas, event.clientX, event.clientY);
      instance.update_selection(currentPage, x, y);
      rerenderCurrentPage();
    },
    [currentPage, getCanvasPoint, handleMouseMove, rerenderCurrentPage],
  );

  const handleSelectionEnd = useCallback(() => {
    const canvas = canvasRef.current;
    const pointerId = selectionPointerIdRef.current;
    if (canvas && pointerId !== null && canvas.hasPointerCapture(pointerId)) {
      canvas.releasePointerCapture(pointerId);
    }
    selectingRef.current = false;
    selectionPointerIdRef.current = null;
    setIsSelecting(false);
    syncSelectionState();
    syncSelectionAnchor();
  }, [syncSelectionAnchor, syncSelectionState]);

  const clearSelection = useCallback(() => {
    const instance = readerRef.current;
    if (!instance) return;
    instance.clear_selection();
    setSelectedText(null);
    setSelectionAnchor(null);
    setIsSelecting(false);
    refs.setPositionReference(null);
    rerenderCurrentPage();
  }, [refs, rerenderCurrentPage]);

  const copySelection = useCallback(async () => {
    if (!selectedText) return;
    await navigator.clipboard.writeText(selectedText);
  }, [selectedText]);

  const saveHighlight = useCallback(() => {
    const instance = readerRef.current;
    if (!instance) return;
    const range = instance.add_selection_highlight() as DocumentRange | null;
    if (!range) return;
    persistHighlights();
    syncSelectionAnchor();
  }, [persistHighlights, syncSelectionAnchor]);

  return (
    <main className="min-h-screen bg-background px-4 py-4">
      <div className="mx-auto flex max-w-[1600px] flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={currentPage <= 0 || !reader}
              onClick={() => setCurrentPage((page) => Math.max(0, page - 1))}
            >
              Previous
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={currentPage >= pageCount - 1 || !reader}
              onClick={() =>
                setCurrentPage((page) => Math.min(pageCount - 1, page + 1))
              }
            >
              Next
            </Button>
            <Link
              to="/"
              className="inline-flex h-8 items-center justify-center rounded-md px-3 text-sm font-medium text-foreground transition-colors hover:bg-muted"
            >
              Back to library
            </Link>
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
                    {book.title}
                  </h1>
                  <p className="mt-2 break-words text-xs leading-5 text-muted-foreground">
                    {book.originalFilename}
                  </p>
                </div>
                <dl className="grid gap-2 text-sm">
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-muted-foreground">Pages</dt>
                    <dd className="font-medium">{pageCount || "—"}</dd>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-muted-foreground">Current page</dt>
                    <dd className="font-medium">
                      {pageCount > 0 ? `${currentPage + 1} / ${pageCount}` : "—"}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-4">
                    <dt className="text-muted-foreground">File size</dt>
                    <dd className="font-medium">
                      {new Intl.NumberFormat().format(book.sizeBytes)} bytes
                    </dd>
                  </div>
                </dl>
              </div>
            </div>
          </div>
        </div>
        {selectedText && selectionAnchor && !isSelecting && (
          <div
            ref={refs.setFloating}
            style={floatingStyles}
            className="z-30 flex max-w-xs flex-col gap-3 rounded-xl border bg-popover p-3 text-popover-foreground shadow-lg"
          >
            <span className="text-xs leading-5 text-muted-foreground">
              {selectedText.length > 120
                ? `${selectedText.slice(0, 120)}...`
                : selectedText}
            </span>
            <div className="flex gap-2">
              <Button type="button" size="sm" onClick={saveHighlight}>
                Save Highlight
              </Button>
              <Button type="button" size="sm" variant="outline" onClick={() => void copySelection()}>
                Copy
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={clearSelection}>
                Clear
              </Button>
            </div>
          </div>
        )}
        {tooltip && (
          <div
            ref={noteRefs.setFloating}
            style={noteFloatingStyles}
            className="pointer-events-none z-20 max-w-sm rounded-xl border bg-popover p-3 text-sm leading-6 text-popover-foreground shadow-lg"
          >
            {tooltip}
          </div>
        )}
        {loading && (
          <p className="text-sm text-muted-foreground">Loading EPUB…</p>
        )}

        <div className="h-[calc(100vh-7rem)] min-h-[640px] overflow-hidden rounded-2xl border border-border/60 bg-background">
          <Layout
            model={WORKSPACE_LAYOUT_MODEL}
            persistenceKey={`haddon:web:workspace:${book.id}`}
          >
            <LayoutPanel id="reader">
              {error ? (
                <div className="flex h-full items-start justify-center p-4">
                  <div className="w-full rounded-2xl border border-destructive/20 bg-destructive/5 px-5 py-4 text-sm text-destructive">
                    {error}
                  </div>
                </div>
              ) : (
                <div
                  ref={containerRef}
                  className="flex h-full min-h-0 items-start justify-center overflow-auto bg-[#f7f7f3] p-6"
                >
                  <canvas
                    ref={canvasRef}
                    className="block max-w-full bg-white shadow-[0_18px_50px_rgba(15,23,42,0.12)]"
                    onPointerDown={handleSelectionStart}
                    onPointerMove={handleSelectionMove}
                    onPointerUp={handleSelectionEnd}
                    onPointerLeave={handleMouseLeave}
                  />
                </div>
              )}
            </LayoutPanel>
            <LayoutPanel id="workbench">
              <div className="flex h-full min-h-0 flex-col bg-muted/20">
                <div className="border-b border-border/60 px-4 py-3">
                  <h2 className="text-sm font-semibold text-foreground">
                    Writing Workspace
                  </h2>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    Summaries, notes, and essay tools will live here.
                  </p>
                </div>
                <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4">
                  <div className="rounded-xl border border-dashed border-border bg-background px-4 py-5">
                    <p className="text-sm font-medium text-foreground">
                      No summary selected yet
                    </p>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">
                      Save a highlight or select a passage, then we can attach
                      summaries, annotations, and collapse state here.
                    </p>
                  </div>
                  <div className="rounded-xl border border-border/70 bg-background px-4 py-4">
                    <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                      Book
                    </p>
                    <p className="mt-2 text-sm font-medium text-foreground">
                      {book.title}
                    </p>
                    <p className="mt-2 break-words text-sm leading-6 text-muted-foreground">
                      {book.originalFilename}
                    </p>
                  </div>
                  <div className="rounded-xl border border-border/70 bg-background px-4 py-4">
                    <p className="text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
                      Progress
                    </p>
                    <dl className="mt-3 grid gap-2 text-sm">
                      <div className="flex items-center justify-between gap-4">
                        <dt className="text-muted-foreground">Pages</dt>
                        <dd className="font-medium">{pageCount || "—"}</dd>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <dt className="text-muted-foreground">Current page</dt>
                        <dd className="font-medium">
                          {pageCount > 0 ? `${currentPage + 1} / ${pageCount}` : "—"}
                        </dd>
                      </div>
                      <div className="flex items-center justify-between gap-4">
                        <dt className="text-muted-foreground">Highlights</dt>
                        <dd className="font-medium">{savedHighlightCount}</dd>
                      </div>
                    </dl>
                  </div>
                </div>
              </div>
            </LayoutPanel>
          </Layout>
        </div>
      </div>
    </main>
  );
}
