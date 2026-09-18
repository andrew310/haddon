import { describe, expect, it, beforeAll } from "vitest";
import { enrichReadingOrderWithToc, flattenTocTitles } from "./toc";

const toc = [
  {
    href: "text/chapter-1.xhtml",
    title: "The Brass Observatory",
    children: [{ href: "text/chapter-1.xhtml#note", title: "A nested heading" }],
  },
  { href: "text/chapter-2.xhtml", title: "The Return" },
];

describe("flattenTocTitles", () => {
  it("maps hrefs to titles and keeps the top-level title on collisions", () => {
    const map = flattenTocTitles(toc);
    expect(map.get("text/chapter-1.xhtml")).toBe("The Brass Observatory");
    expect(map.get("text/chapter-2.xhtml")).toBe("The Return");
  });

  it("strips fragments so TOC entries match spine hrefs", () => {
    const map = flattenTocTitles([
      { href: "text/chapter-1.xhtml#chapter-one", title: "The Brass Observatory" },
    ]);
    expect(map.get("text/chapter-1.xhtml")).toBe("The Brass Observatory");
  });
});

describe("enrichReadingOrderWithToc", () => {
  it("fills missing reading-order titles from the TOC", () => {
    const items = [
      { href: "text/chapter-1.xhtml", title: null },
      { href: "text/chapter-2.xhtml", title: "text/chapter-2.xhtml" },
      { href: "text/notes.xhtml", title: null },
    ];
    const enriched = enrichReadingOrderWithToc(items, toc);
    expect(enriched[0].title).toBe("The Brass Observatory");
    expect(enriched[1].title).toBe("The Return");
    expect(enriched[2].title).toBeNull();
    expect(enriched[0].href).toBe("text/chapter-1.xhtml");
  });

  it("does not overwrite a real spine title", () => {
    const items = [{ href: "text/chapter-1.xhtml", title: "Spine title" }];
    const enriched = enrichReadingOrderWithToc(items, toc);
    expect(enriched[0].title).toBe("Spine title");
  });
});

describe("PublicationSession.toc_json", () => {
  let session: InstanceType<
    typeof import("../../../packages/wasm/pkg/haddon_wasm")["PublicationSession"]
  >;

  beforeAll(async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const wasm = await import("../../../packages/wasm/pkg/haddon_wasm.js");
    const wasmBytes = readFileSync(
      join(__dirname, "../../../packages/wasm/pkg/haddon_wasm_bg.wasm"),
    );
    await wasm.default(wasmBytes);
    session = wasm.PublicationSession.load_citation_fixture();
  });

  it("exposes TOC titles that enrich the fixture reading order", () => {
    const withToc = session as typeof session & { toc_json?: () => string };
    expect(typeof withToc.toc_json).toBe("function");
    const tocJson = JSON.parse(withToc.toc_json?.() ?? "[]");
    const readingOrder = JSON.parse(session.reading_order_json());
    const enriched = enrichReadingOrderWithToc(readingOrder, tocJson);
    expect(enriched[0]?.title).toBe("The Brass Observatory");
    expect(enriched[1]?.title).toBe("The Return");
  });
});
