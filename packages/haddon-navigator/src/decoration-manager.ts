/**
 * HADDON-033: Decoration manager for selection highlights and citations.
 * 
 * Manages decoration identity independent of DOM element instances.
 * Decorations are locator-backed and can be restored after remounting.
 * 
 * Key requirements:
 * 1. Decoration identity keyed by locator (not DOM elements)
 * 2. Apply/unapply via data attributes on semantic DOM
 * 3. Stable across remount and layoutRevision changes
 * 4. Support grouped decorations (active-citation, highlights, search-results, annotations)
 */

import type { PublicationLocatorV1 } from "./types";

/**
 * Decoration group types.
 */
export type DecorationGroup = 
  | "active-citation"
  | "highlights"
  | "search-results"
  | "annotations";

/**
 * A decoration is a locator-backed visual mark on the rendered content.
 */
export interface Decoration {
  /** Unique ID for this decoration. */
  readonly id: string;
  /** The locator this decoration marks. */
  readonly locator: PublicationLocatorV1;
  /** Which visual group this decoration belongs to. */
  readonly group: DecorationGroup;
  /** Optional style hint for rendering. */
  readonly style?: string;
  /** Arbitrary metadata. */
  readonly metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Result of applying decorations to the DOM.
 */
export interface DecorationResult {
  /** Number of decorations successfully applied. */
  readonly applied: number;
  /** Number of decorations that could not be resolved. */
  readonly unresolved: number;
  /** Warnings about decoration application. */
  readonly warnings: readonly string[];
}

/**
 * Manages decoration state and DOM application.
 */
export class DecorationManager {
  private decorations = new Map<string, Decoration>();
  
  /**
   * Add or update a decoration.
   */
  setDecoration(decoration: Decoration): void {
    this.decorations.set(decoration.id, decoration);
  }
  
  /**
   * Remove a decoration by ID.
   */
  removeDecoration(id: string): void {
    this.decorations.delete(id);
  }
  
  /**
   * Remove all decorations in a group.
   */
  clearGroup(group: DecorationGroup): void {
    const toRemove: string[] = [];
    for (const [id, decoration] of this.decorations) {
      if (decoration.group === group) {
        toRemove.push(id);
      }
    }
    for (const id of toRemove) {
      this.decorations.delete(id);
    }
  }
  
  /**
   * Get all decorations.
   */
  getAllDecorations(): readonly Decoration[] {
    return Array.from(this.decorations.values());
  }
  
  /**
   * Get decorations for a specific group.
   */
  getDecorationsByGroup(group: DecorationGroup): readonly Decoration[] {
    return Array.from(this.decorations.values()).filter(d => d.group === group);
  }
  
  /**
   * Apply decorations to the rendered DOM.
   * 
   * This method:
   * 1. Clears previous decoration markers
   * 2. Resolves each decoration's locator to DOM elements
   * 3. Applies data attributes to mark decorated elements
   * 
   * Decorations are applied via:
   * - data-haddon-decoration-{group}="{id}" on target elements
   * - Elements can have multiple decoration groups
   */
  applyDecorations(root: HTMLElement): DecorationResult {
    // Clear all previous decoration markers
    this.clearDecorationMarkers(root);
    
    let applied = 0;
    let unresolved = 0;
    const warnings: string[] = [];
    
    for (const decoration of this.decorations.values()) {
      const result = this.applyDecoration(root, decoration);
      if (result.success) {
        applied++;
      } else {
        unresolved++;
        if (result.warning) {
          warnings.push(result.warning);
        }
      }
    }
    
    return { applied, unresolved, warnings };
  }
  
  /**
   * Clear all decoration markers from the DOM.
   */
  private clearDecorationMarkers(root: HTMLElement): void {
    const groups: DecorationGroup[] = ["active-citation", "highlights", "search-results", "annotations"];
    
    for (const group of groups) {
      const attrName = `data-haddon-decoration-${group}`;
      
      // Remove attributes from elements
      const marked = root.querySelectorAll(`[${attrName}]`);
      marked.forEach(el => {
        el.removeAttribute(attrName);
        
        // If this is a span that was created solely for decoration, unwrap it
        if (el.tagName === "SPAN" && el.attributes.length === 0) {
          const parent = el.parentNode;
          if (parent) {
            while (el.firstChild) {
              parent.insertBefore(el.firstChild, el);
            }
            parent.removeChild(el);
          }
        }
      });
    }
  }
  
  /**
   * Apply a single decoration to the DOM.
   */
  private applyDecoration(
    root: HTMLElement,
    decoration: Decoration
  ): { success: boolean; warning?: string } {
    const locator = decoration.locator;
    
    // Strategy 1: Use normalized block ID if available
    if (locator.locations.normalized) {
      const blockId = locator.locations.normalized.start.blockId;
      const element = root.querySelector(`[data-haddon-id="${CSS.escape(blockId)}"]`);
      
      if (element) {
        // Check if we have text offsets for range-accurate marking
        const start = locator.locations.normalized.start.offset;
        const end = locator.locations.normalized.end?.offset;
        
        if (start && end && start.value !== end.value) {
          // Apply range-accurate decoration
          return this.markRange(element, decoration, start.value, end.value);
        } else {
          // Fall back to block-level marking
          this.markElement(element, decoration);
          return { success: true };
        }
      } else {
        return {
          success: false,
          warning: `Could not find block ${blockId} for decoration ${decoration.id}`,
        };
      }
    }
    
    // Strategy 2: Use fragment ID
    if (locator.locations.fragments && locator.locations.fragments.length > 0) {
      const fragment = locator.locations.fragments[0];
      const element = root.querySelector(`#${CSS.escape(fragment)}`);
      
      if (element) {
        this.markElement(element, decoration);
        return { success: true };
      }
    }
    
    // Strategy 3: Use CSS selector if available
    if (locator.locations.cssSelector) {
      try {
        const element = root.querySelector(locator.locations.cssSelector);
        if (element) {
          this.markElement(element, decoration);
          return { success: true };
        }
      } catch {
        // Invalid selector, fall through
      }
    }
    
    return {
      success: false,
      warning: `No resolvable selector for decoration ${decoration.id} on href ${locator.href}`,
    };
  }
  
  /**
   * Mark a DOM element with a decoration.
   */
  private markElement(element: Element, decoration: Decoration): void {
    const attrName = `data-haddon-decoration-${decoration.group}`;
    element.setAttribute(attrName, decoration.id);
    
    // Also mark inline elements within the block if this is a citation
    if (decoration.group === "active-citation") {
      const inlines = element.querySelectorAll("em, strong, span, a");
      inlines.forEach(inline => inline.setAttribute(attrName, decoration.id));
    }
  }
  
  /**
   * Mark a specific text range within a block element.
   * This wraps the target range in a span with decoration attributes.
   */
  private markRange(
    blockElement: Element,
    decoration: Decoration,
    startOffset: number,
    endOffset: number
  ): { success: boolean; warning?: string } {
    try {
      // Find the text range within the block
      const range = this.createRangeFromOffsets(blockElement, startOffset, endOffset);
      
      if (!range) {
        return {
          success: false,
          warning: `Could not create range for offsets ${startOffset}-${endOffset} in decoration ${decoration.id}`,
        };
      }
      
      // Create a wrapper span
      const span = document.createElement("span");
      const attrName = `data-haddon-decoration-${decoration.group}`;
      span.setAttribute(attrName, decoration.id);
      
      // Wrap the range contents
      range.surroundContents(span);
      
      return { success: true };
    } catch (error) {
      // surroundContents can fail if the range crosses element boundaries
      // Fall back to block-level marking
      this.markElement(blockElement, decoration);
      return { 
        success: true,
        warning: `Range crosses element boundaries, fell back to block marking for decoration ${decoration.id}`,
      };
    }
  }
  
  /**
   * Create a DOM Range from UTF-16 offsets within a block element.
   */
  private createRangeFromOffsets(
    blockElement: Element,
    startOffset: number,
    endOffset: number
  ): Range | null {
    const walker = document.createTreeWalker(
      blockElement,
      NodeFilter.SHOW_TEXT,
      null
    );
    
    let currentOffset = 0;
    let startNode: Text | null = null;
    let startNodeOffset = 0;
    let endNode: Text | null = null;
    let endNodeOffset = 0;
    
    // Walk through all text nodes to find start and end positions
    while (walker.nextNode()) {
      const textNode = walker.currentNode as Text;
      const text = textNode.textContent || "";
      const nodeLength = text.length;
      
      // Check if start position is in this text node
      if (startNode === null && currentOffset + nodeLength > startOffset) {
        startNode = textNode;
        startNodeOffset = startOffset - currentOffset;
      }
      
      // Check if end position is in this text node
      if (currentOffset + nodeLength >= endOffset) {
        endNode = textNode;
        endNodeOffset = endOffset - currentOffset;
        break;
      }
      
      currentOffset += nodeLength;
    }
    
    // Ensure we found both boundaries
    if (!startNode || !endNode) {
      return null;
    }
    
    // Create the range
    const range = document.createRange();
    range.setStart(startNode, startNodeOffset);
    range.setEnd(endNode, endNodeOffset);
    
    return range;
  }
}
