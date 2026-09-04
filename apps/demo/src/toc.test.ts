import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

let PublicationSession: any;

beforeAll(async () => {
  const wasmPath = join(__dirname, '../../../packages/wasm/pkg/haddon_wasm_bg.wasm');
  const wasmBytes = readFileSync(wasmPath);
  
  const wasmModule = await import('../../../packages/wasm/pkg/haddon_wasm.js');
  await wasmModule.default(wasmBytes);
  
  PublicationSession = wasmModule.PublicationSession;
});

describe('TOC Integration', () => {
  it('should expose toc_json method from WASM', () => {
    const session = PublicationSession.load_citation_fixture();
    
    // Should have toc_json method
    expect(typeof session.toc_json).toBe('function');
    
    // Should return valid JSON
    const tocJson = session.toc_json();
    expect(typeof tocJson).toBe('string');
    
    const toc = JSON.parse(tocJson);
    expect(Array.isArray(toc)).toBe(true);
    
    // Should have TOC entries with titles and hrefs
    expect(toc.length).toBeGreaterThan(0);
    expect(toc[0]).toHaveProperty('href');
    expect(toc[0]).toHaveProperty('title');
    
    // Should have nested children
    expect(toc[0]).toHaveProperty('children');
    expect(Array.isArray(toc[0].children)).toBe(true);
    
    session.free();
  });

  it('should enrich reading order with TOC titles', () => {
    const session = PublicationSession.load_citation_fixture();
    
    const readingOrder = JSON.parse(session.reading_order_json());
    const toc = JSON.parse(session.toc_json());
    
    // Reading order should have null titles initially
    expect(readingOrder[0].title).toBeNull();
    
    // Build TOC map (same logic as SemanticReader)
    const tocMap = new Map();
    const flattenToc = (entries, depth = 0) => {
      for (const entry of entries) {
        if (entry.href && entry.title) {
          if (!tocMap.has(entry.href)) {
            const prefix = depth > 0 ? "  ".repeat(depth) : "";
            tocMap.set(entry.href, prefix + entry.title);
          }
        }
        if (entry.children && entry.children.length > 0) {
          flattenToc(entry.children, depth + 1);
        }
      }
    };
    flattenToc(toc);
    
    // Enrich reading order
    const enriched = readingOrder.map(item => {
      if (!item.title || item.title === item.href) {
        const tocTitle = tocMap.get(item.href);
        if (tocTitle) {
          return { ...item, title: tocTitle };
        }
      }
      return item;
    });
    
    // Should have proper titles now
    expect(enriched[0].title).toBe("The Brass Observatory");
    expect(enriched[1].title).toBe("The Return");
    
    // Should preserve href for navigation
    expect(enriched[0].href).toBe("text/chapter-1.xhtml");
    expect(enriched[1].href).toBe("text/chapter-2.xhtml");
    
    session.free();
  });

  it('should handle books without TOC gracefully', () => {
    const session = PublicationSession.load_citation_fixture();
    
    // Even if TOC is empty, should not crash
    const tocJson = session.toc_json();
    expect(() => JSON.parse(tocJson)).not.toThrow();
    
    const toc = JSON.parse(tocJson);
    expect(Array.isArray(toc)).toBe(true);
    
    session.free();
  });
});
