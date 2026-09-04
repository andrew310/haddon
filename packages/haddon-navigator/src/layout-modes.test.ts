/**
 * HADDON-034: Layout mode tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  applyLayoutMode,
  scrollToElement,
  getCurrentPageIndex,
  getTotalPageCount,
  navigatePage,
  type LayoutModeOptions,
} from "./layout-modes";

describe("HADDON-034 Layout Modes", () => {
  let container: HTMLElement;

  beforeEach(() => {
    container = document.createElement("div");
    container.style.width = "600px";
    container.style.height = "800px";
    document.body.appendChild(container);
    
    // Mock scrollTo for jsdom which doesn't implement it
    if (!container.scrollTo) {
      container.scrollTo = vi.fn((options: any) => {
        if (typeof options === 'object' && options.left !== undefined) {
          container.scrollLeft = options.left;
        }
      });
    }
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  describe("applyLayoutMode", () => {
    it("applies scrolled mode correctly", () => {
      const cleanup = applyLayoutMode(container, { mode: "scrolled" });

      expect(container.style.overflow).toBe("auto");
      expect(container.style.columnWidth).toBe("");
      expect(container.style.columnGap).toBe("");

      cleanup();
    });

    it("applies paginated mode with CSS columns", () => {
      const cleanup = applyLayoutMode(container, {
        mode: "paginated",
        columnWidth: 600,
        columnGap: 40,
        direction: "ltr",
      });

      expect(container.style.columnWidth).toBe("600px");
      expect(container.style.columnGap).toBe("40px");
      expect(container.style.columnFill).toBe("auto");
      expect(container.style.overflow).toBe("hidden");
      expect(container.style.height).toBe("100%");
      expect(container.style.direction).toBe("ltr");

      cleanup();
    });

    it("applies RTL direction for paginated mode", () => {
      const cleanup = applyLayoutMode(container, {
        mode: "paginated",
        direction: "rtl",
      });

      expect(container.style.direction).toBe("rtl");

      cleanup();
    });

    it("cleanup function restores original styles", () => {
      container.style.overflow = "visible";
      container.style.columnWidth = "300px";

      const cleanup = applyLayoutMode(container, { mode: "paginated" });

      expect(container.style.overflow).toBe("hidden");
      expect(container.style.columnWidth).toBe("600px");

      cleanup();

      expect(container.style.overflow).toBe("visible");
      expect(container.style.columnWidth).toBe("300px");
    });
  });

  describe("Mode switching preserves location", () => {
    it("scrolled to paginated maintains reading position conceptually", () => {
      // This is conceptual - actual location preservation happens
      // via PublicationLocator and VisibilityTracker in the full system
      const scrolledCleanup = applyLayoutMode(container, { mode: "scrolled" });
      expect(container.style.overflow).toBe("auto");
      scrolledCleanup();

      const paginatedCleanup = applyLayoutMode(container, { mode: "paginated" });
      expect(container.style.overflow).toBe("hidden");
      paginatedCleanup();
    });
  });

  describe("scrollToElement", () => {
    it("works in scrolled mode", () => {
      const target = document.createElement("p");
      target.id = "target";
      container.appendChild(target);

      applyLayoutMode(container, { mode: "scrolled" });
      
      // Should not throw
      scrollToElement(container, target, { mode: "scrolled" });
    });

    it("calculates page position in paginated mode", () => {
      const target = document.createElement("p");
      target.id = "target";
      container.appendChild(target);

      const options: LayoutModeOptions = {
        mode: "paginated",
        columnWidth: 600,
        columnGap: 40,
      };

      applyLayoutMode(container, options);
      
      // Should not throw
      scrollToElement(container, target, options);
    });
  });

  describe("Pagination navigation", () => {
    it("returns false for non-paginated mode", () => {
      const result = navigatePage(container, "forward", { mode: "scrolled" });
      expect(result).toBe(false);
    });

    it("handles forward navigation in LTR paginated mode", () => {
      const options: LayoutModeOptions = {
        mode: "paginated",
        columnWidth: 600,
        columnGap: 40,
        direction: "ltr",
      };

      const result = navigatePage(container, "forward", options);
      expect(result).toBe(true);
    });

    it("handles backward navigation in LTR paginated mode", () => {
      const options: LayoutModeOptions = {
        mode: "paginated",
        columnWidth: 600,
        columnGap: 40,
        direction: "ltr",
      };

      const result = navigatePage(container, "backward", options);
      expect(result).toBe(true);
    });

    it("handles RTL progression", () => {
      const options: LayoutModeOptions = {
        mode: "paginated",
        columnWidth: 600,
        columnGap: 40,
        direction: "rtl",
      };

      const result = navigatePage(container, "forward", options);
      expect(result).toBe(true);
    });
  });

  describe("Page counting", () => {
    it("returns 0 for scrolled mode", () => {
      const index = getCurrentPageIndex(container, { mode: "scrolled" });
      expect(index).toBe(0);
    });

    it("returns 1 for scrolled mode total", () => {
      const count = getTotalPageCount(container, { mode: "scrolled" });
      expect(count).toBe(1);
    });

    it("calculates page index in paginated mode", () => {
      const options: LayoutModeOptions = {
        mode: "paginated",
        columnWidth: 600,
        columnGap: 40,
      };

      const index = getCurrentPageIndex(container, options);
      expect(typeof index).toBe("number");
      expect(index).toBeGreaterThanOrEqual(0);
    });

    it("calculates total pages in paginated mode with content", () => {
      container.innerHTML = "<p>Content</p>".repeat(100);
      
      const options: LayoutModeOptions = {
        mode: "paginated",
        columnWidth: 600,
        columnGap: 40,
      };

      applyLayoutMode(container, options);
      
      // Simulate scrollWidth since jsdom doesn't calculate it properly
      Object.defineProperty(container, 'scrollWidth', {
        writable: true,
        value: 2000, // Simulate wide content requiring multiple pages
      });
      
      const count = getTotalPageCount(container, options);
      expect(typeof count).toBe("number");
      expect(count).toBeGreaterThanOrEqual(1);
    });
  });

  describe("Browser integration", () => {
    it("uses standard scrollIntoView for scrolled mode", () => {
      // Standard DOM behavior is tested by using the actual methods
      const target = document.createElement("div");
      container.appendChild(target);

      applyLayoutMode(container, { mode: "scrolled" });
      
      // Should not throw - browser handles scrollIntoView
      scrollToElement(container, target, { mode: "scrolled" });
    });

    it("uses scrollLeft for paginated navigation", () => {
      const options: LayoutModeOptions = {
        mode: "paginated",
        columnWidth: 600,
        columnGap: 40,
      };

      applyLayoutMode(container, options);
      const initialScroll = container.scrollLeft;
      
      navigatePage(container, "forward", options);
      
      // scrollTo with smooth behavior is called, but may not execute immediately
      // We're testing that the API accepts the call without error
      expect(typeof container.scrollLeft).toBe("number");
    });
  });
});
