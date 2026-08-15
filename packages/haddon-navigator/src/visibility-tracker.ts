/**
 * HADDON-032: Visible-location tracking for semantic DOM.
 * 
 * Converts viewport visibility and DOM ranges into durable publication locators.
 * 
 * Key requirements from navigator-api.md §18:
 * 1. Observe visibility in logical reading order for semantic DOM content
 * 2. Derive precise first/last DOM or normalized boundaries for each visible resource
 * 3. Convert boundaries through locator/source-mapping services
 * 4. Coalesce scroll observations per animation frame
 * 5. Preserve captured locator across root resize, inset change, font completion
 * 6. Increment layoutRevision for every geometry-invalidating transition
 * 7. Distinguish complete, partial, ambiguous, unavailable with typed outcomes
 */

import type {
  BackendVisibleTarget,
  VisibleLocationV1,
  VisibleSegmentV1,
  ViewportSnapshot,
  LocationChangeCause,
  PublicationLocatorV1,
  RenditionPositionV1,
  VisibilityResult,
} from "./types";

export interface VisibilityTrackerOptions {
  /** Root element containing the rendered content. */
  readonly root: HTMLElement;
  /** Callback when visible location changes. */
  readonly onLocationChange: (location: VisibleLocationV1, cause: LocationChangeCause) => void;
  /** Locator service to convert DOM ranges to durable locators. */
  readonly locatorService: LocatorService;
}

export interface LocatorService {
  /** Convert a normalized block ID + offset to a durable locator. */
  createLocator(
    href: string,
    blockId: string,
    startOffset: number,
    endOffset?: number
  ): Promise<PublicationLocatorV1>;
  
  /** Refresh redundant evidence for an existing locator. */
  refreshLocator(locator: PublicationLocatorV1): Promise<PublicationLocatorV1>;
  
  /** Navigate to a specific locator (restore after layout change). */
  navigateToLocator(locator: PublicationLocatorV1): Promise<void>;
}

export class VisibilityTracker {
  private root: HTMLElement;
  private onLocationChange: (location: VisibleLocationV1, cause: LocationChangeCause) => void;
  private locatorService: LocatorService;
  
  private layoutRevision = 0;
  private currentLocation: VisibleLocationV1 | null = null;
  private capturedLocator: PublicationLocatorV1 | null = null;
  private restoringLocation = false;
  
  private resizeObserver: ResizeObserver | null = null;
  private rafHandle: number | null = null;
  
  private viewport: ViewportSnapshot;
  private insets = { top: 0, right: 0, bottom: 0, left: 0 };
  
  constructor(options: VisibilityTrackerOptions) {
    this.root = options.root;
    this.onLocationChange = options.onLocationChange;
    this.locatorService = options.locatorService;
    
    this.viewport = this.computeViewport();
    this.setupObservers();
  }
  
  /**
   * Increment layoutRevision for geometry-invalidating changes.
   * This invalidates all cached geometry and forces recalculation.
   * 
   * Per navigator-api.md §4: capture current durable locator, relayout,
   * navigate/restore that locator, then publish the new VisibleLocationV1.
   */
  async incrementLayoutRevision(cause: LocationChangeCause): Promise<void> {
    this.layoutRevision++;
    
    // Step 1: Capture current durable locator before layout changes
    this.capturedLocator = this.currentLocation?.current || null;
    
    // Step 2: Recompute viewport after layout change
    this.viewport = this.computeViewport();
    
    // Step 3: If we had a location, restore it after the layout change
    if (this.capturedLocator && !this.restoringLocation) {
      this.restoringLocation = true;
      try {
        await this.locatorService.navigateToLocator(this.capturedLocator);
        // Allow DOM to settle after navigation
        await new Promise(resolve => setTimeout(resolve, 0));
      } catch (error) {
        console.warn("[VisibilityTracker] Failed to restore captured locator:", error);
      } finally {
        this.restoringLocation = false;
      }
    }
    
    // Step 4: Compute and publish the new visible location
    await this.updateVisibleLocation(cause);
  }
  
  /**
   * Set viewport insets (chrome overlays).
   */
  setViewportInsets(insets: { top?: number; right?: number; bottom?: number; left?: number }): void {
    this.insets = {
      top: insets.top ?? this.insets.top,
      right: insets.right ?? this.insets.right,
      bottom: insets.bottom ?? this.insets.bottom,
      left: insets.left ?? this.insets.left,
    };
    this.incrementLayoutRevision("insets");
  }
  
  /**
   * Get current viewport snapshot.
   */
  getViewport(): ViewportSnapshot {
    return this.viewport;
  }
  
  /**
   * Get current visible location (may be null before first observation).
   */
  getCurrentLocation(): VisibleLocationV1 | null {
    return this.currentLocation;
  }
  
  /**
   * Destroy this tracker and clean up observers.
   */
  destroy(): void {
    if (this.rafHandle !== null) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = null;
    }
    
    this.root.removeEventListener("scroll", this.handleScroll);
    
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
  }
  
  private setupObservers(): void {
    // Observe scroll with animation-frame coalescing
    this.root.addEventListener("scroll", this.handleScroll, { passive: true });
    
    // Observe resize to update viewport and increment layoutRevision
    this.resizeObserver = new ResizeObserver(() => {
      const oldViewport = this.viewport;
      this.viewport = this.computeViewport();
      
      if (
        oldViewport.width !== this.viewport.width ||
        oldViewport.height !== this.viewport.height ||
        oldViewport.devicePixelRatio !== this.viewport.devicePixelRatio
      ) {
        this.incrementLayoutRevision("resize");
      }
    });
    this.resizeObserver.observe(this.root);
    
    // Initial visibility calculation
    this.scheduleVisibilityUpdate("initial");
  }
  
  private handleScroll = (): void => {
    this.scheduleVisibilityUpdate("scroll");
  };
  
  private scheduleVisibilityUpdate(cause: LocationChangeCause): void {
    if (this.rafHandle !== null) {
      return; // Already scheduled
    }
    
    this.rafHandle = requestAnimationFrame(async () => {
      this.rafHandle = null;
      await this.updateVisibleLocation(cause);
    });
  }
  
  private async updateVisibleLocation(cause: LocationChangeCause): Promise<void> {
    const result = await this.computeVisibleLocation();
    
    if (result.status === "complete" || result.status === "partial") {
      const newLocation = result.location;
      
      // Check if location actually changed (avoid redundant events)
      if (this.hasLocationChanged(newLocation)) {
        this.currentLocation = newLocation;
        this.onLocationChange(newLocation, cause);
      }
    }
  }
  
  private hasLocationChanged(newLocation: VisibleLocationV1): boolean {
    if (!this.currentLocation) return true;
    
    // Layout revision change always means geometry changed, must emit
    if (this.currentLocation.layoutRevision !== newLocation.layoutRevision) {
      return true;
    }
    
    // Compare current locator href and key evidence
    const oldCurrent = this.currentLocation.current;
    const newCurrent = newLocation.current;
    
    if (oldCurrent.href !== newCurrent.href) return true;
    
    // Compare normalized block positions if available
    const oldNorm = oldCurrent.locations.normalized;
    const newNorm = newCurrent.locations.normalized;
    
    if (oldNorm && newNorm) {
      return (
        oldNorm.start.blockId !== newNorm.start.blockId ||
        oldNorm.start.offset.value !== newNorm.start.offset.value
      );
    }
    
    return true; // Conservative: assume changed if we can't compare precisely
  }
  
  private computeViewport(): ViewportSnapshot {
    const rect = this.root.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    
    return {
      width: rect.width,
      height: rect.height,
      insets: this.insets,
      contentWidth: Math.max(0, rect.width - this.insets.left - this.insets.right),
      contentHeight: Math.max(0, rect.height - this.insets.top - this.insets.bottom),
      devicePixelRatio: dpr,
      layoutRevision: this.layoutRevision,
    };
  }
  
  private async computeVisibleLocation(): Promise<VisibilityResult> {
    // Find the article element (rendered resource)
    const article = this.root.querySelector("article.haddon-resource");
    if (!article) {
      return { status: "unavailable", reason: "no-content-mounted" };
    }
    
    const href = article.getAttribute("data-haddon-href");
    if (!href) {
      return { status: "unavailable", reason: "missing-href-attribute" };
    }
    
    // Compute visible boundaries
    const target = this.findVisibleBoundaries(article as HTMLElement, href);
    if (!target) {
      return { status: "unavailable", reason: "no-visible-content" };
    }
    
    // Convert to locators
    try {
      const currentLocator = await this.createLocatorFromBoundary(
        href,
        target.firstBoundary.blockId,
        target.firstBoundary.offset
      );
      
      const segmentLocator = target.firstBoundary.blockId === target.lastBoundary.blockId &&
                             target.firstBoundary.offset === target.lastBoundary.offset
        ? currentLocator
        : await this.locatorService.createLocator(
            href,
            target.firstBoundary.blockId,
            target.firstBoundary.offset,
            target.lastBoundary.offset
          );
      
      const segment: VisibleSegmentV1 = {
        href,
        locator: segmentLocator,
        visibility: target.complete ? "complete" : "partial",
      };
      
      const rendition: RenditionPositionV1 = {
        layout: "scrolled",
        resourceProgression: this.estimateResourceProgression(article as HTMLElement),
      };
      
      const location: VisibleLocationV1 = {
        current: currentLocator,
        segments: [segment],
        rendition,
        layoutRevision: this.layoutRevision,
      };
      
      // Return honest status based on segment visibility
      const status = target.complete ? "complete" : "partial";
      const warnings = target.complete ? [] : ["Resource is partially visible"];
      
      return status === "complete" 
        ? { status: "complete", location }
        : { status: "partial", location, warnings };
    } catch (error) {
      return {
        status: "unavailable",
        reason: `locator-conversion-failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
  
  private findVisibleBoundaries(
    article: HTMLElement,
    href: string
  ): BackendVisibleTarget | null {
    const rootRect = this.root.getBoundingClientRect();
    const viewportTop = rootRect.top + this.insets.top;
    const viewportBottom = rootRect.bottom - this.insets.bottom;
    
    // Walk the DOM tree in reading order to find first and last visible text
    const walker = document.createTreeWalker(
      article,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode: (node) => {
          // Skip empty text nodes
          if (!node.textContent || node.textContent.trim().length === 0) {
            return NodeFilter.FILTER_SKIP;
          }
          return NodeFilter.FILTER_ACCEPT;
        },
      }
    );
    
    let firstBoundary: { blockId: string; offset: number } | null = null;
    let lastBoundary: { blockId: string; offset: number } | null = null;
    let hasInvisibleContent = false;
    let seenContent = false;
    
    while (walker.nextNode()) {
      const textNode = walker.currentNode as Text;
      const text = textNode.textContent || "";
      
      // Find which character offsets are visible
      const visibleOffsets = this.findVisibleCharacterOffsets(textNode, viewportTop, viewportBottom);
      
      if (visibleOffsets) {
        seenContent = true;
        const boundary = this.getBlockBoundary(textNode, visibleOffsets.firstVisible);
        const lastBound = this.getBlockBoundary(textNode, visibleOffsets.lastVisible);
        
        if (boundary) {
          if (!firstBoundary) {
            firstBoundary = boundary;
          }
          if (lastBound) {
            lastBoundary = lastBound;
          }
        }
      } else if (seenContent && text.trim().length > 0) {
        // Non-visible content after we've seen visible content
        hasInvisibleContent = true;
      }
    }
    
    if (!firstBoundary || !lastBoundary) {
      return null;
    }
    
    return {
      href,
      firstBoundary,
      lastBoundary,
      complete: !hasInvisibleContent,
    };
  }
  
  private findVisibleCharacterOffsets(
    textNode: Text,
    viewportTop: number,
    viewportBottom: number
  ): { firstVisible: number; lastVisible: number } | null {
    const text = textNode.textContent || "";
    if (text.length === 0) return null;
    
    let firstVisible: number | null = null;
    let lastVisible: number | null = null;
    
    // Sample character positions to find visible range
    // For performance, check start, end, and midpoints
    const checkPoints = [0, Math.floor(text.length / 2), text.length - 1];
    
    for (const offset of checkPoints) {
      const range = document.createRange();
      range.setStart(textNode, offset);
      range.setEnd(textNode, Math.min(offset + 1, text.length));
      
      const rects = range.getClientRects();
      for (let i = 0; i < rects.length; i++) {
        const rect = rects[i];
        if (rect.bottom > viewportTop && rect.top < viewportBottom) {
          if (firstVisible === null || offset < firstVisible) {
            firstVisible = offset;
          }
          if (lastVisible === null || offset > lastVisible) {
            lastVisible = offset;
          }
        }
      }
    }
    
    if (firstVisible === null || lastVisible === null) return null;
    
    return { firstVisible, lastVisible };
  }
  
  private getBlockBoundary(textNode: Text, offset: number): { blockId: string; offset: number } | null {
    // Walk up to find the nearest element with data-haddon-id
    let element = textNode.parentElement;
    while (element) {
      const blockId = element.getAttribute("data-haddon-id");
      if (blockId) {
        // Calculate offset within this block's text content
        const blockOffset = this.calculateTextOffset(element, textNode, offset);
        return { blockId, offset: blockOffset };
      }
      element = element.parentElement;
    }
    return null;
  }
  
  private calculateTextOffset(blockElement: HTMLElement, targetTextNode: Text, targetOffset: number): number {
    const walker = document.createTreeWalker(
      blockElement,
      NodeFilter.SHOW_TEXT,
      null
    );
    
    let utf16Offset = 0;
    while (walker.nextNode()) {
      const textNode = walker.currentNode as Text;
      if (textNode === targetTextNode) {
        // Add the offset within this text node
        const text = textNode.textContent || "";
        return utf16Offset + this.utf16Length(text.substring(0, targetOffset));
      }
      // Add this entire text node's length
      utf16Offset += this.utf16Length(textNode.textContent || "");
    }
    
    return utf16Offset;
  }
  
  private utf16Length(text: string): number {
    // Count UTF-16 code units (surrogate pairs count as 2)
    return text.length; // JavaScript strings are UTF-16
  }
  
  private async createLocatorFromBoundary(
    href: string,
    blockId: string,
    offset: number
  ): Promise<PublicationLocatorV1> {
    return this.locatorService.createLocator(href, blockId, offset);
  }
  
  private estimateResourceProgression(article: HTMLElement): number {
    const rootRect = this.root.getBoundingClientRect();
    const articleRect = article.getBoundingClientRect();
    
    const viewportMiddle = rootRect.top + rootRect.height / 2;
    const articleTop = articleRect.top;
    const articleHeight = articleRect.height;
    
    if (articleHeight === 0) return 0;
    
    const scrolled = viewportMiddle - articleTop;
    const progression = scrolled / articleHeight;
    
    return Math.max(0, Math.min(1, progression));
  }
}
