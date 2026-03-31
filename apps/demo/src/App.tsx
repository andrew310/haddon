import { useCallback, useEffect, useRef, useState } from "react";
import {
  autoUpdate,
  flip,
  offset,
  shift,
  useFloating,
} from "@floating-ui/react";
import "./App.css";

let wasmModule: typeof import("../../../packages/wasm/pkg/haddon_wasm") | null =
  null;
type EpubReaderType = InstanceType<
  NonNullable<typeof wasmModule>["EpubReader"]
>;

async function getWasm() {
  if (!wasmModule) {
    const mod = await import("../../../packages/wasm/pkg/haddon_wasm");
    await mod.default();
    wasmModule = mod;
  }
  return wasmModule;
}

const DPR = window.devicePixelRatio || 2;
const PAGE_HEIGHT = 800;
const PAGE_GAP = 32;
type ViewMode = "scroll" | "page";
type SearchResult = {
  chapterIndex: number;
  blockIndex: number;
  pageIndex: number;
  snippet: string;
};
type SelectionAnchor = {
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
};
type NoteAnchor = {
  pageIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export default function App() {
  const [reader, setReader] = useState<EpubReaderType | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>("scroll");
  const [title, setTitle] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedText, setSelectedText] = useState<string | null>(null);
  const [selectionAnchor, setSelectionAnchor] = useState<SelectionAnchor | null>(
    null
  );
  const [tooltip, setTooltip] = useState<{
    text: string;
    pageIndex: number;
  } | null>(null);
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const singleCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const readerRef = useRef<EpubReaderType | null>(null);
  const selectingRef = useRef<number | null>(null);
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

  const getCanvasForPage = useCallback(
    (pageIndex: number) =>
      viewMode === "page" ? singleCanvasRef.current : canvasRefs.current[pageIndex],
    [viewMode]
  );

  const getCanvasPoint = useCallback(
    (canvas: HTMLCanvasElement, clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      const scaleX = (canvas.width / DPR) / rect.width;
      const scaleY = (canvas.height / DPR) / rect.height;
      return {
        x: (clientX - rect.left) * scaleX,
        y: (clientY - rect.top) * scaleY,
        localX: clientX - rect.left,
        localY: clientY - rect.top,
      };
    },
    []
  );

  const syncSelectionState = useCallback(() => {
    const r = readerRef.current;
    if (!r) return;
    const text = r.selected_text();
    setSelectedText(text && text.length > 0 ? text : null);
    if (!text) {
      setSelectionAnchor(null);
      selectionReferenceRef.current = null;
    }
  }, []);

  const syncSelectionAnchor = useCallback(
    (pageIndex: number) => {
      const r = readerRef.current;
      const canvas = getCanvasForPage(pageIndex);
      if (!r || !canvas) return;
      const raw = r.selection_anchor_rect(pageIndex) as
        | { x: number; y: number; width: number; height: number }
        | null;
      if (!raw) {
        setSelectionAnchor(null);
        selectionReferenceRef.current = null;
        refs.setPositionReference(null);
        return;
      }

      const rect = canvas.getBoundingClientRect();
      const scaleX = rect.width / (canvas.width / DPR);
      const scaleY = rect.height / (canvas.height / DPR);
      const anchor = {
        pageIndex,
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
    },
    [getCanvasForPage, refs]
  );

  const getPageWidth = useCallback(() => {
    const container = containerRef.current;
    if (!container) return 600;
    return Math.min(container.clientWidth - 32, 800);
  }, []);

  const renderPage = useCallback(
    (r: EpubReaderType, pageIdx: number, canvas: HTMLCanvasElement | null) => {
      if (!canvas) return;
      r.render_page(canvas, pageIdx, DPR);
      canvas.style.width = `${canvas.width / DPR}px`;
      canvas.style.height = `${canvas.height / DPR}px`;
    },
    []
  );

  const doLayout = useCallback(
    (r: EpubReaderType) => {
      const width = getPageWidth();
      r.relayout(width, PAGE_HEIGHT);
      const count = r.page_count();
      setPageCount(count);
      setCurrentPage((prev) => Math.min(prev, Math.max(count - 1, 0)));
      canvasRefs.current = canvasRefs.current.slice(0, count);
    },
    [getPageWidth]
  );

  const loadFile = useCallback(
    async (file: File) => {
      setLoading(true);
      setError(null);
      try {
        const wasm = await getWasm();
        const buf = await file.arrayBuffer();
        const data = new Uint8Array(buf);
        const r = wasm.EpubReader.load(data);
        readerRef.current = r;
        setReader(r);
        setTitle(r.title() || file.name);
        setCurrentPage(0);
        setQuery("");
        setResults([]);
        setSelectedText(null);
        setSelectionAnchor(null);
        doLayout(r);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [doLayout]
  );

  // Re-layout on window resize
  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;
    const handleResize = () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        const r = readerRef.current;
        if (r) doLayout(r);
      }, 50);
    };
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
      clearTimeout(timeout);
    };
  }, [doLayout]);

  useEffect(() => {
    const r = readerRef.current;
    if (!r || pageCount === 0) return;
    if (viewMode !== "scroll") return;
    for (let pageIdx = 0; pageIdx < pageCount; pageIdx += 1) {
      renderPage(r, pageIdx, canvasRefs.current[pageIdx] ?? null);
    }
  }, [pageCount, renderPage, viewMode]);

  useEffect(() => {
    const r = readerRef.current;
    if (!r || viewMode !== "page") return;
    renderPage(r, currentPage, singleCanvasRef.current);
    if (selectedText) {
      syncSelectionAnchor(currentPage);
    }
  }, [currentPage, renderPage, selectedText, syncSelectionAnchor, viewMode]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file && file.name.endsWith(".epub")) {
        loadFile(file);
      }
    },
    [loadFile]
  );

  const handleScroll = useCallback(() => {
    const scroller = scrollRef.current;
    if (!scroller || pageCount === 0 || viewMode !== "scroll") return;
    const pageSpan = PAGE_HEIGHT + PAGE_GAP;
    const midpoint = scroller.scrollTop + scroller.clientHeight / 2;
    const nextPage = Math.max(
      0,
      Math.min(pageCount - 1, Math.floor(midpoint / pageSpan))
    );
    setCurrentPage(nextPage);
    if (selectedText && selectionAnchor) {
      syncSelectionAnchor(selectionAnchor.pageIndex);
    }
  }, [pageCount, selectedText, selectionAnchor, syncSelectionAnchor, viewMode]);

  const goToPage = useCallback(
    (pageIndex: number) => {
      const r = readerRef.current;
      if (!r || pageIndex < 0 || pageIndex >= pageCount) return;
      setCurrentPage(pageIndex);
      if (viewMode === "page") {
        renderPage(r, pageIndex, singleCanvasRef.current);
      } else {
        const scroller = scrollRef.current;
        if (scroller) {
          scroller.scrollTo({
            top: pageIndex * (PAGE_HEIGHT + PAGE_GAP),
            behavior: "smooth",
          });
        }
      }
    },
    [pageCount, renderPage, viewMode]
  );

  const runSearch = useCallback(() => {
    const r = readerRef.current;
    const trimmed = query.trim();
    if (!r || !trimmed) {
      setResults([]);
      return;
    }

    const raw = r.search(trimmed) as ArrayLike<SearchResult>;
    setResults(Array.from(raw));
  }, [query]);

  // Handle mousemove for footnote tooltips
  const handleMouseMove = useCallback(
    (pageIndex: number, e: React.MouseEvent<HTMLCanvasElement>) => {
      const r = readerRef.current;
      const canvas = getCanvasForPage(pageIndex);
      if (!r || !canvas) return;
      if (selectingRef.current !== null) return;

      const { x, y } = getCanvasPoint(canvas, e.clientX, e.clientY);

      const raw = r.noteref_anchor_rect(pageIndex, x, y) as
        | { id: string; x: number; y: number; width: number; height: number }
        | null;

      if (raw) {
        const noteText = r.get_note(raw.id);
        if (noteText) {
          canvas.style.cursor = "pointer";
          const rect = canvas.getBoundingClientRect();
          const scaleX = rect.width / (canvas.width / DPR);
          const scaleY = rect.height / (canvas.height / DPR);
          const anchor: NoteAnchor = {
            pageIndex,
            x: rect.left + raw.x * scaleX,
            y: rect.top + raw.y * scaleY,
            width: raw.width * scaleX,
            height: raw.height * scaleY,
          };
          const virtualReference = {
            getBoundingClientRect: () =>
              new DOMRect(anchor.x, anchor.y, anchor.width, anchor.height),
          };
          noteReferenceRef.current = virtualReference;
          noteRefs.setPositionReference(virtualReference);
          setTooltip({ text: noteText, pageIndex });
          return;
        }
      }
      canvas.style.cursor = "default";
      noteReferenceRef.current = null;
      noteRefs.setPositionReference(null);
      setTooltip(null);
    },
    [getCanvasForPage, getCanvasPoint, noteRefs]
  );

  const handleMouseLeave = useCallback(() => {
    setTooltip(null);
    noteReferenceRef.current = null;
    noteRefs.setPositionReference(null);
    for (const canvas of canvasRefs.current) {
      if (canvas) canvas.style.cursor = "default";
    }
    if (singleCanvasRef.current) singleCanvasRef.current.style.cursor = "default";
  }, [noteRefs]);

  const rerenderSelectionPage = useCallback(
    (pageIndex: number) => {
      const r = readerRef.current;
      const canvas = getCanvasForPage(pageIndex);
      if (!r || !canvas) return;
      renderPage(r, pageIndex, canvas);
    },
    [getCanvasForPage, renderPage]
  );

  const handleSelectionStart = useCallback(
    (pageIndex: number, e: React.MouseEvent<HTMLCanvasElement>) => {
      const r = readerRef.current;
      const canvas = getCanvasForPage(pageIndex);
      if (!r || !canvas) return;
      const { x, y } = getCanvasPoint(canvas, e.clientX, e.clientY);
      selectingRef.current = pageIndex;
      setTooltip(null);
      r.begin_selection(pageIndex, x, y);
      syncSelectionState();
      syncSelectionAnchor(pageIndex);
      rerenderSelectionPage(pageIndex);
    },
    [
      getCanvasForPage,
      getCanvasPoint,
      rerenderSelectionPage,
      syncSelectionAnchor,
      syncSelectionState,
    ]
  );

  const handleSelectionMove = useCallback(
    (pageIndex: number, e: React.MouseEvent<HTMLCanvasElement>) => {
      if (selectingRef.current !== pageIndex) {
        handleMouseMove(pageIndex, e);
        return;
      }
      const r = readerRef.current;
      const canvas = getCanvasForPage(pageIndex);
      if (!r || !canvas) return;
      const { x, y } = getCanvasPoint(canvas, e.clientX, e.clientY);
      r.update_selection(pageIndex, x, y);
      syncSelectionState();
      syncSelectionAnchor(pageIndex);
      rerenderSelectionPage(pageIndex);
    },
    [
      getCanvasForPage,
      getCanvasPoint,
      handleMouseMove,
      rerenderSelectionPage,
      syncSelectionAnchor,
      syncSelectionState,
    ]
  );

  const handleSelectionEnd = useCallback(() => {
    selectingRef.current = null;
    syncSelectionState();
    if (viewMode === "page") {
      syncSelectionAnchor(currentPage);
    }
  }, [currentPage, syncSelectionAnchor, syncSelectionState, viewMode]);

  const clearSelection = useCallback(() => {
    const r = readerRef.current;
    if (!r) return;
    r.clear_selection();
    setSelectedText(null);
    setSelectionAnchor(null);
    setTooltip(null);
    selectionReferenceRef.current = null;
    refs.setPositionReference(null);
    if (viewMode === "page") {
      rerenderSelectionPage(currentPage);
    } else {
      for (let pageIdx = 0; pageIdx < pageCount; pageIdx += 1) {
        rerenderSelectionPage(pageIdx);
      }
    }
  }, [currentPage, pageCount, refs, rerenderSelectionPage, viewMode]);

  const copySelection = useCallback(async () => {
    if (!selectedText) return;
    await navigator.clipboard.writeText(selectedText);
  }, [selectedText]);

  useEffect(() => {
    const onMouseUp = () => {
      if (selectingRef.current !== null) {
        handleSelectionEnd();
      }
    };
    window.addEventListener("mouseup", onMouseUp);
    return () => window.removeEventListener("mouseup", onMouseUp);
  }, [handleSelectionEnd]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "c" && selectedText) {
        e.preventDefault();
        navigator.clipboard.writeText(selectedText);
      }
      if (e.key === "Escape" && selectedText) {
        clearSelection();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [clearSelection, selectedText]);

  return (
    <div className="app">
      <header>
        <h1>{title || "Haddon"}</h1>
        {reader && (
          <div className="nav">
            <div className="view-toggle">
              <button
                className={viewMode === "scroll" ? "active" : ""}
                onClick={() => setViewMode("scroll")}
              >
                Scroll
              </button>
              <button
                className={viewMode === "page" ? "active" : ""}
                onClick={() => setViewMode("page")}
              >
                Page
              </button>
            </div>
            {viewMode === "page" && (
              <>
                <button
                  onClick={() => goToPage(currentPage - 1)}
                  disabled={currentPage === 0}
                >
                  Prev
                </button>
                <button
                  onClick={() => goToPage(currentPage + 1)}
                  disabled={currentPage >= pageCount - 1}
                >
                  Next
                </button>
              </>
            )}
            <span>
              Page {currentPage + 1} of {pageCount}
            </span>
          </div>
        )}
      </header>

      {reader && (
        <div className="search-bar">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") runSearch();
            }}
            placeholder="Search text..."
          />
          <button onClick={runSearch}>Search</button>
          {results.length > 0 && (
            <span className="search-count">{results.length} results</span>
          )}
        </div>
      )}

      {reader && selectedText && selectionAnchor && (
        <div
          ref={refs.setFloating}
          className="selection-popover"
          style={floatingStyles}
        >
          <span className="selection-label">
            {selectedText.length > 120
              ? `${selectedText.slice(0, 120)}...`
              : selectedText}
          </span>
          <div className="selection-actions">
            <button onClick={() => void copySelection()}>Copy</button>
            <button onClick={clearSelection}>Clear</button>
          </div>
        </div>
      )}

      {reader && tooltip && (
        <div
          ref={noteRefs.setFloating}
          className="footnote-popover"
          style={noteFloatingStyles}
        >
          {tooltip.text}
        </div>
      )}

      {reader && results.length > 0 && (
        <div className="search-results">
          {results.map((result, index) => (
            <button
              key={`${result.chapterIndex}-${result.blockIndex}-${index}`}
              className="search-result"
              onClick={() => goToPage(result.pageIndex)}
            >
              <span className="search-result-page">
                Page {result.pageIndex + 1}
              </span>
              <span>{result.snippet}</span>
            </button>
          ))}
        </div>
      )}

      <div
        ref={containerRef}
        className={`canvas-container ${reader ? "" : "drop-zone"}`}
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
      >
        {!reader && !loading && (
          <div className="drop-prompt">Drop an .epub file here</div>
        )}
        {loading && <div className="drop-prompt">Loading...</div>}
        {error && <div className="error">{error}</div>}
        <div
          ref={scrollRef}
          className="scroll-stack"
          style={{ display: reader && viewMode === "scroll" ? "flex" : "none" }}
          onScroll={handleScroll}
        >
          {Array.from({ length: pageCount }, (_, pageIndex) => (
            <div className="canvas-wrapper" key={pageIndex}>
              <canvas
                ref={(node) => {
                  canvasRefs.current[pageIndex] = node;
                }}
                onMouseDown={(e) => handleSelectionStart(pageIndex, e)}
                onMouseMove={(e) => handleSelectionMove(pageIndex, e)}
                onMouseLeave={handleMouseLeave}
              />
            </div>
          ))}
        </div>
        <div
          className="canvas-wrapper single-page-wrapper"
          style={{ display: reader && viewMode === "page" ? "block" : "none" }}
        >
          <canvas
            ref={singleCanvasRef}
            onMouseDown={(e) => handleSelectionStart(currentPage, e)}
            onMouseMove={(e) => handleSelectionMove(currentPage, e)}
            onMouseLeave={handleMouseLeave}
          />
        </div>
      </div>
    </div>
  );
}
