import { useCallback, useRef, useState } from "react";
import "./App.css";

// Will be initialized on first use
let wasmModule: typeof import("../../packages/wasm/pkg/haddon_wasm") | null = null;
type EpubReaderType = InstanceType<NonNullable<typeof wasmModule>["EpubReader"]>;

async function getWasm() {
  if (!wasmModule) {
    const mod = await import("../../packages/wasm/pkg/haddon_wasm");
    await mod.default();
    wasmModule = mod;
  }
  return wasmModule;
}

export default function App() {
  const [reader, setReader] = useState<EpubReaderType | null>(null);
  const [page, setPage] = useState(0);
  const [pageCount, setPageCount] = useState(0);
  const [title, setTitle] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scale = 2.0;

  const renderPage = useCallback(
    (r: EpubReaderType, pageIdx: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      r.render_page(canvas, pageIdx, scale);
    },
    []
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
        const count = r.page_count();
        setReader(r);
        setPageCount(count);
        setPage(0);
        setTitle(r.title() || file.name);
        renderPage(r, 0);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [renderPage]
  );

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

  const goTo = useCallback(
    (p: number) => {
      if (!reader || p < 0 || p >= pageCount) return;
      setPage(p);
      renderPage(reader, p);
    },
    [reader, pageCount, renderPage]
  );

  return (
    <div className="app">
      <header>
        <h1>{title || "Haddon"}</h1>
        {reader && (
          <div className="nav">
            <button onClick={() => goTo(page - 1)} disabled={page === 0}>
              Prev
            </button>
            <span>
              {page + 1} / {pageCount}
            </span>
            <button
              onClick={() => goTo(page + 1)}
              disabled={page >= pageCount - 1}
            >
              Next
            </button>
          </div>
        )}
      </header>

      <div
        className={`canvas-container ${reader ? "" : "drop-zone"}`}
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
      >
        {!reader && !loading && (
          <div className="drop-prompt">Drop an .epub file here</div>
        )}
        {loading && <div className="drop-prompt">Loading...</div>}
        {error && <div className="error">{error}</div>}
        <canvas
          ref={canvasRef}
          style={{ display: reader ? "block" : "none" }}
        />
      </div>
    </div>
  );
}
