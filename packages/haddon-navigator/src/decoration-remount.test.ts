/**
 * HADDON-033: Integration tests for decoration remount stability.
 * 
 * These tests verify that decorations maintain their identity across:
 * 1. DOM remount (HTML content replaced)
 * 2. LayoutRevision changes (geometry invalidation)
 * 3. Re-application of decoration set after visibility changes
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

function simulateRemount(manager: DecorationManager, originalHtml: string): HTMLElement {
  // Create a new DOM tree with identical structure
  // This simulates what happens when React remounts or content is reloaded
  const newRoot = createMockRoot(originalHtml);
  
  // Re-apply decorations to the new DOM
  manager.applyDecorations(newRoot);
  
  return newRoot;
}

describe("Decoration remount and layoutRevision stability", () => {
  let manager: DecorationManager;

  beforeEach(() => {
    manager = new DecorationManager();
  });

  describe("DOM remount scenarios", () => {
    it("should maintain decoration identity after full DOM remount", () => {
      const html = `
        <article>
          <p data-haddon-id="block-1">First paragraph</p>
          <p data-haddon-id="block-2">Second paragraph</p>
        </article>
      `;
      
      // Initial mount
      const root1 = createMockRoot(html);
      
      const decoration: Decoration = {
        id: "stable-dec-1",
        locator: createMockLocator("block-2"),
        group: "highlights",
      };
      
      manager.setDecoration(decoration);
      const result1 = manager.applyDecorations(root1);
      
      expect(result1.applied).toBe(1);
      const marked1 = root1.querySelector('[data-haddon-id="block-2"]');
      expect(marked1?.getAttribute("data-haddon-decoration-highlights")).toBe("stable-dec-1");
      
      // Simulate remount: destroy first DOM, create new one
      const root2 = simulateRemount(manager, html);
      
      // Verify decoration is still applied with same ID
      const result2 = manager.applyDecorations(root2);
      expect(result2.applied).toBe(1);
      
      const marked2 = root2.querySelector('[data-haddon-id="block-2"]');
      expect(marked2?.getAttribute("data-haddon-decoration-highlights")).toBe("stable-dec-1");
      
      // Verify it's not the same DOM element (remount happened)
      expect(marked2).not.toBe(marked1);
      
      // Verify the decoration object is unchanged
      const decorations = manager.getAllDecorations();
      expect(decorations).toHaveLength(1);
      expect(decorations[0]).toBe(decoration);
    });

    it("should maintain multiple decorations across remount", () => {
      const html = `
        <article>
          <p data-haddon-id="block-1">First paragraph</p>
          <p data-haddon-id="block-2">Second paragraph</p>
          <p data-haddon-id="block-3">Third paragraph</p>
        </article>
      `;
      
      const root1 = createMockRoot(html);
      
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
      manager.setDecoration({
        id: "dec-3",
        locator: createMockLocator("block-3"),
        group: "highlights",
      });
      
      manager.applyDecorations(root1);
      
      // Remount
      const root2 = simulateRemount(manager, html);
      
      // All decorations should be reapplied
      expect(root2.querySelector('[data-haddon-id="block-1"]')
        ?.getAttribute("data-haddon-decoration-highlights")).toBe("dec-1");
      expect(root2.querySelector('[data-haddon-id="block-2"]')
        ?.getAttribute("data-haddon-decoration-active-citation")).toBe("dec-2");
      expect(root2.querySelector('[data-haddon-id="block-3"]')
        ?.getAttribute("data-haddon-decoration-highlights")).toBe("dec-3");
      
      // All decoration objects should be preserved
      expect(manager.getAllDecorations()).toHaveLength(3);
    });

    it("should handle partial content changes (some blocks remain)", () => {
      const html1 = `
        <article>
          <p data-haddon-id="block-1">Stable block</p>
          <p data-haddon-id="block-2">Will be removed</p>
        </article>
      `;
      
      const html2 = `
        <article>
          <p data-haddon-id="block-1">Stable block</p>
          <p data-haddon-id="block-3">New block</p>
        </article>
      `;
      
      const root1 = createMockRoot(html1);
      
      manager.setDecoration({
        id: "dec-stable",
        locator: createMockLocator("block-1"),
        group: "highlights",
      });
      manager.setDecoration({
        id: "dec-removed",
        locator: createMockLocator("block-2"),
        group: "highlights",
      });
      
      manager.applyDecorations(root1);
      
      // Content changes
      const root2 = createMockRoot(html2);
      const result = manager.applyDecorations(root2);
      
      // Stable decoration still applies
      expect(result.applied).toBe(1);
      expect(root2.querySelector('[data-haddon-id="block-1"]')
        ?.getAttribute("data-haddon-decoration-highlights")).toBe("dec-stable");
      
      // Removed block's decoration becomes unresolved
      expect(result.unresolved).toBe(1);
    });
  });

  describe("layoutRevision simulation", () => {
    it("should preserve decorations through simulated layout changes", () => {
      const html = `
        <article>
          <p data-haddon-id="block-1">Content that might reflow</p>
        </article>
      `;
      
      const root = createMockRoot(html);
      
      const decoration: Decoration = {
        id: "layout-stable",
        locator: createMockLocator("block-1"),
        group: "active-citation",
      };
      
      manager.setDecoration(decoration);
      
      // Initial application
      manager.applyDecorations(root);
      
      // Simulate layout change (e.g., font load, resize)
      // In real code, visibility tracker would increment layoutRevision
      // and re-apply decorations. Here we just re-apply.
      manager.applyDecorations(root);
      
      // Decoration should still be present
      const element = root.querySelector('[data-haddon-id="block-1"]');
      expect(element?.getAttribute("data-haddon-decoration-active-citation")).toBe("layout-stable");
    });

    it("should handle decoration update during layout change", () => {
      const html = `
        <article>
          <p data-haddon-id="block-1">First block</p>
          <p data-haddon-id="block-2">Second block</p>
        </article>
      `;
      
      const root = createMockRoot(html);
      
      // Initial decoration on block-1
      manager.setDecoration({
        id: "moving-citation",
        locator: createMockLocator("block-1"),
        group: "active-citation",
      });
      
      manager.applyDecorations(root);
      
      // User makes a new selection during layout (e.g., after font change)
      // This updates the decoration to point to block-2
      manager.setDecoration({
        id: "moving-citation",
        locator: createMockLocator("block-2"),
        group: "active-citation",
      });
      
      // Re-apply after layout change
      manager.applyDecorations(root);
      
      // Should now mark block-2, not block-1
      expect(root.querySelector('[data-haddon-id="block-1"]')
        ?.getAttribute("data-haddon-decoration-active-citation")).toBeNull();
      expect(root.querySelector('[data-haddon-id="block-2"]')
        ?.getAttribute("data-haddon-decoration-active-citation")).toBe("moving-citation");
    });
  });

  describe("decoration persistence across navigation", () => {
    it("should maintain decoration set when switching between resources", () => {
      const html1 = '<article><p data-haddon-id="ch1-block">Chapter 1 content</p></article>';
      const html2 = '<article><p data-haddon-id="ch2-block">Chapter 2 content</p></article>';
      
      // Navigate to chapter 1
      const root1 = createMockRoot(html1);
      
      manager.setDecoration({
        id: "ch1-highlight",
        locator: createMockLocator("ch1-block", "chapter1.xhtml"),
        group: "highlights",
      });
      
      manager.applyDecorations(root1);
      
      // Navigate to chapter 2
      const root2 = createMockRoot(html2);
      
      manager.setDecoration({
        id: "ch2-highlight",
        locator: createMockLocator("ch2-block", "chapter2.xhtml"),
        group: "highlights",
      });
      
      manager.applyDecorations(root2);
      
      // Both decorations should still exist in the manager
      expect(manager.getAllDecorations()).toHaveLength(2);
      
      // Only ch2 decoration is applied to current DOM
      expect(root2.querySelector('[data-haddon-id="ch2-block"]')
        ?.getAttribute("data-haddon-decoration-highlights")).toBe("ch2-highlight");
      
      // Navigate back to chapter 1
      const root1Again = createMockRoot(html1);
      manager.applyDecorations(root1Again);
      
      // Ch1 decoration should be reapplied
      expect(root1Again.querySelector('[data-haddon-id="ch1-block"]')
        ?.getAttribute("data-haddon-decoration-highlights")).toBe("ch1-highlight");
    });
  });

  describe("decoration conflict resolution", () => {
    it("should allow multiple decoration groups on the same element", () => {
      const html = '<article><p data-haddon-id="block-1">Content</p></article>';
      const root = createMockRoot(html);
      
      manager.setDecoration({
        id: "highlight-1",
        locator: createMockLocator("block-1"),
        group: "highlights",
      });
      
      manager.setDecoration({
        id: "citation-1",
        locator: createMockLocator("block-1"),
        group: "active-citation",
      });
      
      manager.applyDecorations(root);
      
      const element = root.querySelector('[data-haddon-id="block-1"]');
      expect(element?.getAttribute("data-haddon-decoration-highlights")).toBe("highlight-1");
      expect(element?.getAttribute("data-haddon-decoration-active-citation")).toBe("citation-1");
    });

    it("should replace decoration within same group on remount", () => {
      const html = '<article><p data-haddon-id="block-1">Content</p></article>';
      
      const root1 = createMockRoot(html);
      
      manager.setDecoration({
        id: "old-highlight",
        locator: createMockLocator("block-1"),
        group: "highlights",
      });
      
      manager.applyDecorations(root1);
      
      // Update to new decoration
      manager.removeDecoration("old-highlight");
      manager.setDecoration({
        id: "new-highlight",
        locator: createMockLocator("block-1"),
        group: "highlights",
      });
      
      // Remount
      const root2 = simulateRemount(manager, html);
      
      const element = root2.querySelector('[data-haddon-id="block-1"]');
      expect(element?.getAttribute("data-haddon-decoration-highlights")).toBe("new-highlight");
    });
  });
});
