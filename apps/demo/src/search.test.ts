import { describe, it, expect, beforeAll } from "vitest";

describe("Search functionality", () => {
  let wasmModule: typeof import("../../../packages/wasm/pkg/haddon_wasm");
  let session: InstanceType<
    (typeof wasmModule)["PublicationSession"]
  >;

  beforeAll(async () => {
    wasmModule = await import("../../../packages/wasm/pkg/haddon_wasm");
    await wasmModule.default();
    session = wasmModule.PublicationSession.load_citation_fixture();
  });

  it("finds a phrase that appears once in the fixture", () => {
    const resultsJson = session.search_json("patient moon", 50);
    const results = JSON.parse(resultsJson);

    expect(results).toHaveLength(1);
    expect(results[0].exact).toBe("patient moon");
    expect(results[0].snippet).toContain("patient moon");
    expect(results[0].href).toBe("text/chapter-1.xhtml");
    expect(results[0].blockId).toBeTruthy();
    expect(results[0].start).toBeGreaterThanOrEqual(0);
    expect(results[0].end).toBeGreaterThan(results[0].start);
  });

  it("finds a phrase that appears in multiple resources", () => {
    const resultsJson = session.search_json("north", 50);
    const results = JSON.parse(resultsJson);

    expect(results.length).toBeGreaterThanOrEqual(2);
    
    const hrefs = new Set(results.map((r: { href: string }) => r.href));
    expect(hrefs.size).toBeGreaterThanOrEqual(2);
    
    const chapter1Hits = results.filter((r: { href: string }) => 
      r.href === "text/chapter-1.xhtml"
    );
    const chapter2Hits = results.filter((r: { href: string }) => 
      r.href === "text/chapter-2.xhtml"
    );
    
    expect(chapter1Hits.length).toBeGreaterThanOrEqual(1);
    expect(chapter2Hits.length).toBeGreaterThanOrEqual(1);
  });

  it("returns results with valid locator offsets", () => {
    const resultsJson = session.search_json("the", 10);
    const results = JSON.parse(resultsJson);

    expect(results.length).toBeGreaterThan(0);

    for (const hit of results) {
      expect(hit.blockId).toBeTruthy();
      expect(typeof hit.start).toBe("number");
      expect(typeof hit.end).toBe("number");
      expect(hit.end).toBeGreaterThan(hit.start);
      expect(hit.exact).toBeTruthy();
      expect(hit.snippet).toBeTruthy();
      expect(hit.href).toBeTruthy();
    }
  });

  it("returns empty results for empty query", () => {
    const resultsJson = session.search_json("", 50);
    const results = JSON.parse(resultsJson);

    expect(results).toEqual([]);
  });

  it("returns empty results for query not in the book", () => {
    const resultsJson = session.search_json("xyznotfound", 50);
    const results = JSON.parse(resultsJson);

    expect(results).toEqual([]);
  });

  it("respects the limit parameter", () => {
    const resultsJson = session.search_json("the", 3);
    const results = JSON.parse(resultsJson);

    expect(results.length).toBeLessThanOrEqual(3);
  });

  it("performs case-insensitive search", () => {
    const lowerJson = session.search_json("moon", 50);
    const upperJson = session.search_json("MOON", 50);
    const mixedJson = session.search_json("MoOn", 50);

    const lowerResults = JSON.parse(lowerJson);
    const upperResults = JSON.parse(upperJson);
    const mixedResults = JSON.parse(mixedJson);

    expect(lowerResults.length).toBeGreaterThan(0);
    expect(upperResults.length).toBe(lowerResults.length);
    expect(mixedResults.length).toBe(lowerResults.length);
  });

  it("produces results that can be converted to locators", () => {
    const resultsJson = session.search_json("patient moon", 50);
    const results = JSON.parse(resultsJson);

    expect(results).toHaveLength(1);
    const hit = results[0];

    const locator = {
      schema: "haddon.publication-locator",
      version: 1,
      href: hit.href,
      locations: {
        normalized: {
          start: {
            blockId: hit.blockId,
            offset: {
              value: hit.start,
              unit: "utf-16-code-unit",
            },
          },
          end: {
            blockId: hit.blockId,
            offset: {
              value: hit.end,
              unit: "utf-16-code-unit",
            },
          },
        },
      },
      text: {
        exact: hit.exact,
      },
    };

    expect(locator.href).toBe("text/chapter-1.xhtml");
    expect(locator.locations.normalized.start.blockId).toBeTruthy();
    expect(locator.locations.normalized.start.offset.value).toBeGreaterThanOrEqual(0);
    expect(locator.locations.normalized.end.offset.value).toBeGreaterThan(
      locator.locations.normalized.start.offset.value
    );
  });

  it("includes contextual snippets with the match", () => {
    const resultsJson = session.search_json("Brass Observatory", 50);
    const results = JSON.parse(resultsJson);

    expect(results.length).toBeGreaterThan(0);
    const hit = results[0];

    expect(hit.snippet).toContain("Brass Observatory");
    expect(hit.snippet.length).toBeGreaterThan("Brass Observatory".length);
  });
});
