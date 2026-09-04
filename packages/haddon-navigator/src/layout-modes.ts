/**
 * HADDON-034: Layout mode rendering for scrolled and paginated modes.
 * 
 * Supports:
 * - Continuous scrolling (default, vertical flow)
 * - CSS-column pagination with LTR/RTL progression
 * - Mode switching that preserves PublicationLocator
 */

import type { RenditionLayout } from "./types";

export interface LayoutModeOptions {
  readonly mode: RenditionLayout;
  readonly columnGap?: number;
  readonly columnWidth?: number;
  readonly direction?: "ltr" | "rtl";
}

/**
 * Apply layout mode styles to a container element.
 * Returns cleanup function to restore original styles.
 */
export function applyLayoutMode(
  element: HTMLElement,
  options: LayoutModeOptions
): () => void {
  const originalStyles = {
    overflow: element.style.overflow,
    columnWidth: element.style.columnWidth,
    columnGap: element.style.columnGap,
    columnFill: element.style.columnFill,
    height: element.style.height,
    direction: element.style.direction,
  };

  switch (options.mode) {
    case "scrolled":
      applyScrolledMode(element);
      break;
    case "paginated":
      applyPaginatedMode(element, options);
      break;
    case "fixed":
      // Fixed layout is handled by a different backend
      break;
  }

  return () => {
    // Restore original styles
    Object.assign(element.style, originalStyles);
  };
}

function applyScrolledMode(element: HTMLElement): void {
  element.style.overflow = "auto";
  element.style.columnWidth = "";
  element.style.columnGap = "";
  element.style.columnFill = "";
  element.style.height = "";
}

function applyPaginatedMode(
  element: HTMLElement,
  options: LayoutModeOptions
): void {
  const columnWidth = options.columnWidth || 600;
  const columnGap = options.columnGap || 40;
  const direction = options.direction || "ltr";

  // CSS columns for pagination
  element.style.columnWidth = `${columnWidth}px`;
  element.style.columnGap = `${columnGap}px`;
  element.style.columnFill = "auto";
  element.style.overflow = "hidden";
  element.style.height = "100%";
  element.style.direction = direction;
}

/**
 * Navigate to next/previous page in paginated mode.
 */
export function navigatePage(
  element: HTMLElement,
  direction: "forward" | "backward",
  options: LayoutModeOptions
): boolean {
  if (options.mode !== "paginated") {
    return false;
  }

  const columnWidth = options.columnWidth || 600;
  const columnGap = options.columnGap || 40;
  const pageWidth = columnWidth + columnGap;
  const isRtl = options.direction === "rtl";

  const currentScroll = element.scrollLeft;
  let newScroll: number;

  if (isRtl) {
    // RTL scrolling behavior varies by browser
    // Negative values in Firefox/Chrome, positive in Safari
    const isNegativeRtl = currentScroll <= 0;
    
    if (direction === "forward") {
      newScroll = isNegativeRtl 
        ? currentScroll - pageWidth 
        : currentScroll - pageWidth;
    } else {
      newScroll = isNegativeRtl
        ? currentScroll + pageWidth
        : currentScroll + pageWidth;
    }
  } else {
    // LTR is straightforward
    if (direction === "forward") {
      newScroll = currentScroll + pageWidth;
    } else {
      newScroll = currentScroll - pageWidth;
    }
  }

  element.scrollTo({
    left: newScroll,
    behavior: "smooth",
  });

  return true;
}

/**
 * Get current page index in paginated mode.
 */
export function getCurrentPageIndex(
  element: HTMLElement,
  options: LayoutModeOptions
): number {
  if (options.mode !== "paginated") {
    return 0;
  }

  const columnWidth = options.columnWidth || 600;
  const columnGap = options.columnGap || 40;
  const pageWidth = columnWidth + columnGap;
  const scrollLeft = Math.abs(element.scrollLeft);

  return Math.round(scrollLeft / pageWidth);
}

/**
 * Get total page count in paginated mode.
 */
export function getTotalPageCount(
  element: HTMLElement,
  options: LayoutModeOptions
): number {
  if (options.mode !== "paginated") {
    return 1;
  }

  const columnWidth = options.columnWidth || 600;
  const columnGap = options.columnGap || 40;
  const pageWidth = columnWidth + columnGap;
  const totalWidth = element.scrollWidth;

  return Math.ceil(totalWidth / pageWidth);
}

/**
 * Scroll to a specific element, accounting for layout mode.
 */
export function scrollToElement(
  container: HTMLElement,
  target: HTMLElement,
  options: LayoutModeOptions
): void {
  if (options.mode === "scrolled") {
    // Standard scroll behavior
    target.scrollIntoView({ behavior: "smooth", block: "center" });
  } else if (options.mode === "paginated") {
    // In paginated mode, calculate which page the element is on
    // and scroll to that page
    const columnWidth = options.columnWidth || 600;
    const columnGap = options.columnGap || 40;
    const pageWidth = columnWidth + columnGap;

    const targetRect = target.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    
    // Calculate the column/page the target is in
    const relativeLeft = targetRect.left - containerRect.left + container.scrollLeft;
    const pageIndex = Math.floor(relativeLeft / pageWidth);
    const targetScrollLeft = pageIndex * pageWidth;

    container.scrollTo({
      left: targetScrollLeft,
      behavior: "smooth",
    });
  }
}
