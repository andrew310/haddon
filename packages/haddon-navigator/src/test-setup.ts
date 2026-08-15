/**
 * Test setup for vitest/jsdom.
 * Polyfills browser APIs not provided by jsdom.
 */

// Polyfill CSS.escape
if (typeof (globalThis as any).CSS === 'undefined') {
  (globalThis as any).CSS = {};
}
if (typeof (globalThis as any).CSS.escape === 'undefined') {
  (globalThis as any).CSS.escape = (str: string): string => {
    return str.replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  };
}

// Polyfill ResizeObserver
global.ResizeObserver = class ResizeObserver {
  private callback: ResizeObserverCallback;
  private observed = new Set<Element>();

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  observe(target: Element): void {
    this.observed.add(target);
    // Trigger initial callback
    const entry: ResizeObserverEntry = {
      target,
      contentRect: target.getBoundingClientRect(),
      borderBoxSize: [],
      contentBoxSize: [],
      devicePixelContentBoxSize: [],
    };
    this.callback([entry], this);
  }

  unobserve(target: Element): void {
    this.observed.delete(target);
  }

  disconnect(): void {
    this.observed.clear();
  }
};

// Polyfill requestAnimationFrame if needed
if (typeof global.requestAnimationFrame === 'undefined') {
  global.requestAnimationFrame = (callback: FrameRequestCallback): number => {
    return setTimeout(callback, 0) as unknown as number;
  };
}

if (typeof global.cancelAnimationFrame === 'undefined') {
  global.cancelAnimationFrame = (id: number): void => {
    clearTimeout(id);
  };
}

// Polyfill Range.getClientRects (jsdom doesn't provide useful dimensions)
if (typeof Range.prototype.getClientRects === 'undefined') {
  Range.prototype.getClientRects = function(): DOMRectList {
    const rects: DOMRect[] = [];
    
    // Create a rect that appears "visible" in our test viewport (800x600)
    // Position it within the viewport bounds
    const rect = new DOMRect(10, 100, 100, 20);
    rects.push(rect);
    
    return Object.assign(rects, {
      item(index: number): DOMRect | null {
        return rects[index] || null;
      },
      length: rects.length,
    }) as DOMRectList;
  };
}

// Override getBoundingClientRect for test elements to return useful dimensions
const originalGetBoundingClientRect = Element.prototype.getBoundingClientRect;
Element.prototype.getBoundingClientRect = function(): DOMRect {
  // For our test root elements, return the dimensions from style
  if (this.getAttribute('data-test-root') === 'true') {
    const width = parseInt(this.style.width) || 800;
    const height = parseInt(this.style.height) || 600;
    return new DOMRect(0, 0, width, height);
  }
  
  // For article elements, make them taller than viewport
  if (this.classList.contains('haddon-resource')) {
    return new DOMRect(0, 0, 800, 2000);
  }
  
  // For block elements with data-haddon-id, return position based on scroll target
  const blockId = this.getAttribute('data-haddon-id');
  if (blockId) {
    // Find the root to check scroll target
    let parent = this.parentElement;
    while (parent && !parent.getAttribute('data-test-root')) {
      parent = parent.parentElement;
    }
    
    const scrollTarget = parent ? (parent as any)._scrollTarget : null;
    const scrollTargetId = scrollTarget ? scrollTarget.getAttribute('data-haddon-id') : null;
    
    // Position based on whether this block is at or after the scroll target
    const blockNum = parseInt(blockId.split('-')[1] || '1');
    const targetNum = scrollTargetId ? parseInt(scrollTargetId.split('-')[1] || '1') : 1;
    
    // Blocks before scroll target are above viewport (negative Y)
    // Scroll target and blocks after are in viewport
    const yPos = scrollTargetId 
      ? (blockNum - targetNum) * 250 + 100  // Relative to scroll target
      : (blockNum - 1) * 300;                // Default positioning
    
    return new DOMRect(10, yPos, 780, 200);
  }
  
  // Fall back to original or return zero rect
  try {
    return originalGetBoundingClientRect.call(this);
  } catch {
    return new DOMRect(0, 0, 0, 0);
  }
};

// Polyfill Element.scrollIntoView (jsdom doesn't provide this)
if (typeof Element.prototype.scrollIntoView === 'undefined') {
  Element.prototype.scrollIntoView = function(_options?: boolean | ScrollIntoViewOptions): void {
    // Mock implementation - mark this element as the "scrolled to" element
    // by adjusting mock positions for getBoundingClientRect
    (this as any)._scrolledIntoView = true;
    
    // Find parent root
    let parent = this.parentElement;
    while (parent && !parent.getAttribute('data-test-root')) {
      parent = parent.parentElement;
    }
    
    if (parent) {
      // Mark the scroll target on the root for visibility calculations
      (parent as any)._scrollTarget = this;
    }
  };
}
