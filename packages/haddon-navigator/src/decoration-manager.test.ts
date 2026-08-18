/**
 * HADDON-033: Tests for decoration manager.
 * 
 * Tests verify that:
 * 1. Decorations can be added, removed, and queried
 * 2. Decorations are applied to DOM via data attributes
 * 3. Decoration identity is stable across remount
 * 4. Multiple decoration groups can coexist
 */

import { describe, it, expect, beforeEach } from "vitest";
import { DecorationManager, type Decoration } from "./decoration-manager";
import type { PublicationLocatorV1 } from "./types";

function createMockLocator(blockId: string, href = "test.xhtml"): PublicationLocatorV1 {
  return {
    schema: "haddon.publication-locator",
    version: 1,
    href,
    mediaType: "application/xhtml+xml",
    locations: {
      normalized: {
        revision: "rev-1",
        start: {
          blockId,
          offset: { value: 0, unit: "utf16-code-unit" },
        },
      },
    },
  };
}

function createMockRoot(html: string): HTMLElement {
  const div = document.createElement("div");
  div.innerHTML = html;
  return div;
}

describe("DecorationManager", () => {
  let manager: DecorationManager;

  beforeEach(() => {
    manager = new DecorationManager();
  });

  describe("decoration storage", () => {
    it("should add and retrieve decorations", () => {
      const decoration: Decoration = {
        id: "dec-1",
        locator: createMockLocator("block-1"),
        group: "active-citation",
      };

      manager.setDecoration(decoration);

      const all = manager.getAllDecorations();
      expect(all).toHaveLength(1);
      expect(all[0]).toBe(decoration);
    });

    it("should update existing decoration with same ID", () => {
      const decoration1: Decoration = {
        id: "dec-1",
        locator: createMockLocator("block-1"),
        group: "active-citation",
      };

      const decoration2: Decoration = {
        id: "dec-1",
        locator: createMockLocator("block-2"),
        group: "highlights",
      };

      manager.setDecoration(decoration1);
      manager.setDecoration(decoration2);

      const all = manager.getAllDecorations();
      expect(all).toHaveLength(1);
      expect(all[0].group).toBe("highlights");
    });

    it("should remove decoration by ID", () => {
      const decoration: Decoration = {
        id: "dec-1",
        locator: createMockLocator("block-1"),
        group: "active-citation",
      };

      manager.setDecoration(decoration);
      manager.removeDecoration("dec-1");

      expect(manager.getAllDecorations()).toHaveLength(0);
    });

    it("should clear all decorations in a group", () => {
      manager.setDecoration({
        id: "dec-1",
        locator: createMockLocator("block-1"),
        group: "highlights",
      });
      manager.setDecoration({
        id: "dec-2",
        locator: createMockLocator("block-2"),
        group: "highlights",
      });
      manager.setDecoration({
        id: "dec-3",
        locator: createMockLocator("block-3"),
        group: "active-citation",
      });

      manager.clearGroup("highlights");

      const all = manager.getAllDecorations();
      expect(all).toHaveLength(1);
      expect(all[0].id).toBe("dec-3");
    });

    it("should get decorations by group", () => {
      manager.setDecoration({
        id: "dec-1",
        locator: createMockLocator("block-1"),
        group: "highlights",
      });
      manager.setDecoration({
        id: "dec-2",
        locator: createMockLocator("block-2"),
        group: "active-citation",
      });

      const highlights = manager.getDecorationsByGroup("highlights");
      expect(highlights).toHaveLength(1);
      expect(highlights[0].id).toBe("dec-1");
    });
  });

  describe("DOM application", () => {
    it("should apply decoration to element with matching block ID", () => {
      const root = createMockRoot(`
        <article>
          <p data-haddon-id="block-1">Test paragraph</p>
        </article>
      `);

      manager.setDecoration({
        id: "dec-1",
        locator: createMockLocator("block-1"),
        group: "active-citation",
      });

      const result = manager.applyDecorations(root);

      expect(result.applied).toBe(1);
      expect(result.unresolved).toBe(0);

      const element = root.querySelector('[data-haddon-id="block-1"]');
      expect(element?.getAttribute("data-haddon-decoration-active-citation")).toBe("dec-1");
    });

    it("should handle unresolved decorations gracefully", () => {
      const root = createMockRoot(`
        <article>
          <p data-haddon-id="block-1">Test paragraph</p>
        </article>
      `);

      manager.setDecoration({
        id: "dec-1",
        locator: createMockLocator("block-nonexistent"),
        group: "highlights",
      });

      const result = manager.applyDecorations(root);

      expect(result.applied).toBe(0);
      expect(result.unresolved).toBe(1);
      expect(result.warnings).toHaveLength(1);
    });

    it("should clear previous decorations before applying new ones", () => {
      const root = createMockRoot(`
        <article>
          <p data-haddon-id="block-1" data-haddon-decoration-highlights="old">Test paragraph</p>
        </article>
      `);

      manager.setDecoration({
        id: "dec-new",
        locator: createMockLocator("block-1"),
        group: "active-citation",
      });

      manager.applyDecorations(root);

      const element = root.querySelector('[data-haddon-id="block-1"]');
      expect(element?.getAttribute("data-haddon-decoration-highlights")).toBeNull();
      expect(element?.getAttribute("data-haddon-decoration-active-citation")).toBe("dec-new");
    });

    it("should support multiple decoration groups on same element", () => {
      const root = createMockRoot(`
        <article>
          <p data-haddon-id="block-1">Test paragraph</p>
        </article>
      `);

      manager.setDecoration({
        id: "dec-1",
        locator: createMockLocator("block-1"),
        group: "highlights",
      });
      manager.setDecoration({
        id: "dec-2",
        locator: createMockLocator("block-1"),
        group: "active-citation",
      });

      const result = manager.applyDecorations(root);

      expect(result.applied).toBe(2);

      const element = root.querySelector('[data-haddon-id="block-1"]');
      expect(element?.getAttribute("data-haddon-decoration-highlights")).toBe("dec-1");
      expect(element?.getAttribute("data-haddon-decoration-active-citation")).toBe("dec-2");
    });

    it("should mark inline elements for active-citation group", () => {
      const root = createMockRoot(`
        <article>
          <p data-haddon-id="block-1">
            Test with <em>emphasis</em> and <strong>bold</strong>
          </p>
        </article>
      `);

      manager.setDecoration({
        id: "dec-1",
        locator: createMockLocator("block-1"),
        group: "active-citation",
      });

      manager.applyDecorations(root);

      const em = root.querySelector("em");
      const strong = root.querySelector("strong");
      expect(em?.getAttribute("data-haddon-decoration-active-citation")).toBe("dec-1");
      expect(strong?.getAttribute("data-haddon-decoration-active-citation")).toBe("dec-1");
    });
  });

  describe("remount stability", () => {
    it("should preserve decoration identity across remount", () => {
      // Initial mount
      const root1 = createMockRoot(`
        <article>
          <p data-haddon-id="block-1">Test paragraph</p>
        </article>
      `);

      const decoration: Decoration = {
        id: "dec-stable",
        locator: createMockLocator("block-1"),
        group: "highlights",
      };

      manager.setDecoration(decoration);
      const result1 = manager.applyDecorations(root1);

      expect(result1.applied).toBe(1);
      const el1 = root1.querySelector('[data-haddon-id="block-1"]');
      expect(el1?.getAttribute("data-haddon-decoration-highlights")).toBe("dec-stable");

      // Simulate remount: new DOM tree with same structure
      const root2 = createMockRoot(`
        <article>
          <p data-haddon-id="block-1">Test paragraph</p>
        </article>
      `);

      // Decorations are preserved in manager
      const result2 = manager.applyDecorations(root2);

      expect(result2.applied).toBe(1);
      const el2 = root2.querySelector('[data-haddon-id="block-1"]');
      expect(el2?.getAttribute("data-haddon-decoration-highlights")).toBe("dec-stable");

      // Verify the decoration is the same object
      const decorations = manager.getAllDecorations();
      expect(decorations).toHaveLength(1);
      expect(decorations[0]).toBe(decoration);
    });

    it("should handle changed block IDs after normalization revision", () => {
      const root = createMockRoot(`
        <article>
          <p data-haddon-id="block-new-id">Test paragraph</p>
        </article>
      `);

      // Decoration with old block ID
      manager.setDecoration({
        id: "dec-1",
        locator: createMockLocator("block-old-id"),
        group: "highlights",
      });

      const result = manager.applyDecorations(root);

      // Should gracefully fail to resolve
      expect(result.applied).toBe(0);
      expect(result.unresolved).toBe(1);
    });
  });

  describe("fallback resolution strategies", () => {
    it("should fall back to fragment ID when normalized selector missing", () => {
      const root = createMockRoot(`
        <article>
          <p id="frag-1">Test paragraph</p>
        </article>
      `);

      const locator: PublicationLocatorV1 = {
        schema: "haddon.publication-locator",
        version: 1,
        href: "test.xhtml",
        mediaType: "application/xhtml+xml",
        locations: {
          fragments: ["frag-1"],
        },
      };

      manager.setDecoration({
        id: "dec-1",
        locator,
        group: "highlights",
      });

      const result = manager.applyDecorations(root);

      expect(result.applied).toBe(1);
      const element = root.querySelector("#frag-1");
      expect(element?.getAttribute("data-haddon-decoration-highlights")).toBe("dec-1");
    });

    it("should fall back to CSS selector", () => {
      const root = createMockRoot(`
        <article>
          <p class="special">Test paragraph</p>
        </article>
      `);

      const locator: PublicationLocatorV1 = {
        schema: "haddon.publication-locator",
        version: 1,
        href: "test.xhtml",
        mediaType: "application/xhtml+xml",
        locations: {
          cssSelector: "p.special",
        },
      };

      manager.setDecoration({
        id: "dec-1",
        locator,
        group: "search-results",
      });

      const result = manager.applyDecorations(root);

      expect(result.applied).toBe(1);
      const element = root.querySelector("p.special");
      expect(element?.getAttribute("data-haddon-decoration-search-results")).toBe("dec-1");
    });
  });
  
  describe("range-accurate decorations", () => {
    it("should mark only the specified text range, not the entire block", () => {
      const root = createMockRoot(`
        <article>
          <p data-haddon-id="block-1">This is a test paragraph with multiple sentences. Only part should be highlighted.</p>
        </article>
      `);

      // Select "test paragraph with multiple sentences."
      const locator: PublicationLocatorV1 = {
        schema: "haddon.publication-locator",
        version: 1,
        href: "test.xhtml",
        mediaType: "application/xhtml+xml",
        locations: {
          normalized: {
            revision: "rev-1",
            start: {
              blockId: "block-1",
              offset: { value: 10, unit: "utf16-code-unit" },
            },
            end: {
              blockId: "block-1",
              offset: { value: 49, unit: "utf16-code-unit" },
            },
          },
        },
        text: {
          exact: "test paragraph with multiple sentences.",
        },
      };

      manager.setDecoration({
        id: "dec-range",
        locator,
        group: "highlights",
      });

      const result = manager.applyDecorations(root);

      expect(result.applied).toBe(1);
      
      // The paragraph should NOT have the decoration attribute
      const paragraph = root.querySelector('[data-haddon-id="block-1"]');
      expect(paragraph?.getAttribute("data-haddon-decoration-highlights")).toBeNull();
      
      // A span inside should have the decoration attribute
      const decoratedSpan = paragraph?.querySelector('[data-haddon-decoration-highlights="dec-range"]');
      expect(decoratedSpan).not.toBeNull();
      expect(decoratedSpan?.textContent).toBe("test paragraph with multiple sentences.");
    });

    it("should mark the entire block when offsets are not provided", () => {
      const root = createMockRoot(`
        <article>
          <p data-haddon-id="block-1">Full paragraph content</p>
        </article>
      `);

      const locator: PublicationLocatorV1 = {
        schema: "haddon.publication-locator",
        version: 1,
        href: "test.xhtml",
        mediaType: "application/xhtml+xml",
        locations: {
          normalized: {
            revision: "rev-1",
            start: {
              blockId: "block-1",
              offset: { value: 0, unit: "utf16-code-unit" },
            },
          },
        },
      };

      manager.setDecoration({
        id: "dec-block",
        locator,
        group: "highlights",
      });

      const result = manager.applyDecorations(root);

      expect(result.applied).toBe(1);
      
      // The paragraph itself should have the decoration
      const paragraph = root.querySelector('[data-haddon-id="block-1"]');
      expect(paragraph?.getAttribute("data-haddon-decoration-highlights")).toBe("dec-block");
    });

    it("should handle range decorations across remount", () => {
      const html = `
        <article>
          <p data-haddon-id="block-1">Identify the three essential ingredients of natural selection. First ingredient here.</p>
        </article>
      `;
      
      const root1 = createMockRoot(html);

      // Select just the first sentence including the period
      const locator: PublicationLocatorV1 = {
        schema: "haddon.publication-locator",
        version: 1,
        href: "test.xhtml",
        mediaType: "application/xhtml+xml",
        locations: {
          normalized: {
            revision: "rev-1",
            start: {
              blockId: "block-1",
              offset: { value: 0, unit: "utf16-code-unit" },
            },
            end: {
              blockId: "block-1",
              offset: { value: 62, unit: "utf16-code-unit" },
            },
          },
        },
        text: {
          exact: "Identify the three essential ingredients of natural selection.",
        },
      };

      manager.setDecoration({
        id: "dec-sentence",
        locator,
        group: "active-citation",
      });

      manager.applyDecorations(root1);
      
      const span1 = root1.querySelector('[data-haddon-decoration-active-citation="dec-sentence"]');
      expect(span1).not.toBeNull();
      expect(span1?.textContent).toBe("Identify the three essential ingredients of natural selection.");

      // Simulate remount
      const root2 = createMockRoot(html);
      manager.applyDecorations(root2);
      
      const span2 = root2.querySelector('[data-haddon-decoration-active-citation="dec-sentence"]');
      expect(span2).not.toBeNull();
      expect(span2?.textContent).toBe("Identify the three essential ingredients of natural selection.");
    });
  });
});
