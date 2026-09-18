/**
 * Fixed-layout rendition backend for pre-paginated EPUB content.
 * 
 * HADDON-036: Implements fixed-layout rendering with viewport, spread,
 * direction, scaling, and letterboxing support.
 * 
 * Depends on:
 * - HADDON-021: Package graph with rendition metadata
 * - HADDON-030: Navigator contract
 * - HADDON-035: Iframe backend for source-faithful rendering
 */

export type SupportLevel = "supported" | "partial" | "unsupported";

export interface SupportAssessment {
  level: SupportLevel;
  reason: string;
}

export interface ResourceLink {
  href: string;
  mediaType?: string;
  title?: string;
  width?: number;
  height?: number;
  properties?: Record<string, string>;
}

export interface RenditionHints {
  layout?: string;
  orientation?: string;
  spread?: string;
  flow?: string;
}

export type RenditionKind = "normalized-semantic" | "source-faithful" | "fixed-layout";

export interface BackendNavigationResult {
  status: "moved" | "already-visible" | "boundary";
  location: {
    href: string;
    spreadIndex?: number;
    pageIndex?: number;
  };
}

export interface BackendSession {
  readonly backendId: string;
  readonly renditionKind: RenditionKind;
  readonly hrefs: readonly string[];
  
  destroy(): Promise<void>;
}

export interface FixedLayoutBackendOptions {
  /**
   * Root element where fixed-layout content will be rendered.
   */
  host: HTMLElement;
  
  /**
   * Rendition hints from package metadata.
   */
  rendition: RenditionHints;
  
  /**
   * Ordered spine resources for fixed-layout.
   */
  spine: readonly ResourceLink[];
  
  /**
   * Function to fetch resource bytes by href.
   */
  getResource: (href: string) => Promise<Uint8Array | null>;
}

export interface NavigateOptions {
  href?: string;
  spreadIndex?: number;
  pageIndex?: number;
  direction?: "forward" | "backward";
}

export type SpreadMode = "none" | "auto" | "both" | "landscape";
export type OrientationLock = "auto" | "portrait" | "landscape";
export type PageDirection = "ltr" | "rtl";

/**
 * Fixed-layout rendition session.
 * 
 * Lifecycle:
 * 1. Created by FixedLayoutBackend.open()
 * 2. Renders fixed-layout pages with viewport scaling
 * 3. Handles spread layout based on orientation
 * 4. Manages page navigation (previous/next, goto)
 * 5. On destroy: cleans up DOM and blob URLs
 */
export class FixedLayoutSession implements BackendSession {
  readonly backendId = "fixed-layout";
  readonly renditionKind: RenditionKind = "fixed-layout";
  readonly hrefs: readonly string[];
  
  private container: HTMLElement;
  private viewport: HTMLElement;
  private blobUrls: Map<string, string> = new Map();
  private destroyed = false;
  private options: FixedLayoutBackendOptions;
  private currentSpreadIndex = 0;
  
  private spreadMode: SpreadMode;
  private orientation: OrientationLock;
  private direction: PageDirection;
  
  constructor(options: FixedLayoutBackendOptions) {
    this.options = options;
    this.hrefs = options.spine.map(link => link.href);
    
    // Parse rendition hints
    this.spreadMode = this.parseSpreadMode(options.rendition.spread);
    this.orientation = this.parseOrientation(options.rendition.orientation);
    this.direction = this.parseDirection();
    
    // Create container
    this.container = document.createElement("div");
    this.container.className = "haddon-fixed-layout-container";
    this.container.style.width = "100%";
    this.container.style.height = "100%";
    this.container.style.overflow = "hidden";
    this.container.style.display = "flex";
    this.container.style.justifyContent = "center";
    this.container.style.alignItems = "center";
    this.container.style.backgroundColor = "#333";
    
    // Create viewport
    this.viewport = document.createElement("div");
    this.viewport.className = "haddon-fixed-layout-viewport";
    this.viewport.style.position = "relative";
    this.viewport.style.display = "flex";
    this.viewport.style.flexDirection = this.direction === "rtl" ? "row-reverse" : "row";
    this.viewport.style.gap = "16px";
    
    this.container.appendChild(this.viewport);
    options.host.appendChild(this.container);
    
    // Listen for resize to adjust scaling
    window.addEventListener("resize", this.handleResize);
  }
  
  private parseSpreadMode(spread?: string): SpreadMode {
    switch (spread?.toLowerCase()) {
      case "none":
        return "none";
      case "auto":
        return "auto";
      case "both":
        return "both";
      case "landscape":
        return "landscape";
      default:
        return "auto";
    }
  }
  
  private parseOrientation(orientation?: string): OrientationLock {
    switch (orientation?.toLowerCase()) {
      case "portrait":
        return "portrait";
      case "landscape":
        return "landscape";
      case "auto":
      default:
        return "auto";
    }
  }
  
  private parseDirection(): PageDirection {
    // Check metadata reading progression for RTL
    // For now default to LTR
    return "ltr";
  }
  
  /**
   * Navigate to a specific page or spread.
   */
  async navigate(opts: NavigateOptions): Promise<BackendNavigationResult> {
    if (this.destroyed) {
      throw new Error("Session destroyed");
    }
    
    let targetSpreadIndex = this.currentSpreadIndex;
    
    if (opts.href) {
      // Find the spine index for this href
      const pageIndex = this.hrefs.indexOf(opts.href);
      if (pageIndex === -1) {
        throw new Error(`Resource not found in spine: ${opts.href}`);
      }
      targetSpreadIndex = this.pageIndexToSpreadIndex(pageIndex);
    } else if (opts.spreadIndex !== undefined) {
      targetSpreadIndex = opts.spreadIndex;
    } else if (opts.pageIndex !== undefined) {
      targetSpreadIndex = this.pageIndexToSpreadIndex(opts.pageIndex);
    } else if (opts.direction) {
      targetSpreadIndex = opts.direction === "forward"
        ? this.currentSpreadIndex + 1
        : this.currentSpreadIndex - 1;
    }
    
    // Clamp to valid range
    const maxSpreadIndex = this.getSpreadCount() - 1;
    targetSpreadIndex = Math.max(0, Math.min(targetSpreadIndex, maxSpreadIndex));
    
    if (targetSpreadIndex === this.currentSpreadIndex) {
      return {
        status: "already-visible",
        location: this.getCurrentLocation(),
      };
    }
    
    this.currentSpreadIndex = targetSpreadIndex;
    await this.renderCurrentSpread();
    
    return {
      status: "moved",
      location: this.getCurrentLocation(),
    };
  }
  
  private pageIndexToSpreadIndex(pageIndex: number): number {
    if (this.spreadMode === "none") {
      return pageIndex;
    }
    
    // For spreads, two pages per spread (accounting for single page at start if needed)
    return Math.floor(pageIndex / 2);
  }
  
  private getSpreadCount(): number {
    const pageCount = this.hrefs.length;
    if (this.spreadMode === "none") {
      return pageCount;
    }
    
    // Two pages per spread
    return Math.ceil(pageCount / 2);
  }
  
  private getCurrentLocation(): { href: string; spreadIndex: number; pageIndex: number } {
    const pageIndices = this.getPageIndicesForSpread(this.currentSpreadIndex);
    const primaryPageIndex = pageIndices[0];
    
    return {
      href: this.hrefs[primaryPageIndex],
      spreadIndex: this.currentSpreadIndex,
      pageIndex: primaryPageIndex,
    };
  }
  
  private getPageIndicesForSpread(spreadIndex: number): number[] {
    if (this.spreadMode === "none") {
      return [spreadIndex];
    }
    
    const pageCount = this.hrefs.length;
    const leftPage = spreadIndex * 2;
    const rightPage = leftPage + 1;
    
    const pages: number[] = [];
    if (leftPage < pageCount) {
      pages.push(leftPage);
    }
    if (rightPage < pageCount && this.shouldShowSpread()) {
      pages.push(rightPage);
    }
    
    return pages;
  }
  
  private shouldShowSpread(): boolean {
    if (this.spreadMode === "none") {
      return false;
    }
    if (this.spreadMode === "both") {
      return true;
    }
    if (this.spreadMode === "landscape") {
      return this.isLandscape();
    }
    if (this.spreadMode === "auto") {
      // Auto: show spread in landscape, single page in portrait
      return this.isLandscape();
    }
    return false;
  }
  
  private isLandscape(): boolean {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    return width > height;
  }
  
  private async renderCurrentSpread(): Promise<void> {
    // Clear viewport
    this.viewport.innerHTML = "";
    
    const pageIndices = this.getPageIndicesForSpread(this.currentSpreadIndex);
    const pages = await Promise.all(
      pageIndices.map(idx => this.renderPage(idx))
    );
    
    // Add pages to viewport
    for (const pageElement of pages) {
      this.viewport.appendChild(pageElement);
    }
    
    // Apply scaling and letterboxing
    this.applyScaling();
  }
  
  private async renderPage(pageIndex: number): Promise<HTMLElement> {
    const href = this.hrefs[pageIndex];
    const link = this.options.spine.find(l => l.href === href);
    
    if (!link) {
      throw new Error(`Resource link not found: ${href}`);
    }
    
    const page = document.createElement("div");
    page.className = "haddon-fixed-layout-page";
    page.setAttribute("data-href", href);
    page.setAttribute("data-page-index", String(pageIndex));
    page.style.position = "relative";
    page.style.backgroundColor = "#fff";
    page.style.boxShadow = "0 2px 8px rgba(0, 0, 0, 0.3)";
    
    // Set intrinsic dimensions if available
    const pageWidth = link.width || 800;
    const pageHeight = link.height || 1200;
    page.style.width = `${pageWidth}px`;
    page.style.height = `${pageHeight}px`;
    page.setAttribute("data-width", String(pageWidth));
    page.setAttribute("data-height", String(pageHeight));
    
    // Determine content type and render accordingly
    const mediaType = link.mediaType?.toLowerCase() || "";
    
    if (mediaType.startsWith("image/")) {
      await this.renderImagePage(page, href);
    } else if (
      mediaType === "application/xhtml+xml" ||
      mediaType === "text/html"
    ) {
      await this.renderXhtmlPage(page, href);
    } else {
      page.textContent = `Unsupported media type: ${mediaType}`;
    }
    
    return page;
  }
  
  private async renderImagePage(page: HTMLElement, href: string): Promise<void> {
    const bytes = await this.options.getResource(href);
    if (!bytes) {
      page.textContent = `Image not found: ${href}`;
      return;
    }
    
    // Create blob URL
    const blobUrl = this.getOrCreateBlobUrl(href, bytes, "image/jpeg");
    
    const img = document.createElement("img");
    img.src = blobUrl;
    img.style.width = "100%";
    img.style.height = "100%";
    img.style.objectFit = "contain";
    img.alt = href;
    
    page.appendChild(img);
  }
  
  private async renderXhtmlPage(page: HTMLElement, href: string): Promise<void> {
    const bytes = await this.options.getResource(href);
    if (!bytes) {
      page.textContent = `XHTML not found: ${href}`;
      return;
    }
    
    // Use iframe for XHTML (leveraging iframe backend security)
    const iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", ""); // No scripts, no same-origin
    iframe.style.width = "100%";
    iframe.style.height = "100%";
    iframe.style.border = "none";
    
    page.appendChild(iframe);
    
    // Load XHTML into iframe
    const decoder = new TextDecoder("utf-8");
    const html = decoder.decode(bytes);
    
    // Create blob URL for iframe
    const blob = new Blob([html], { type: "text/html" });
    const blobUrl = URL.createObjectURL(blob);
    this.blobUrls.set(`__iframe_${href}`, blobUrl);
    
    iframe.src = blobUrl;
  }
  
  private getOrCreateBlobUrl(
    href: string,
    bytes: Uint8Array,
    mediaType: string
  ): string {
    const existing = this.blobUrls.get(href);
    if (existing) {
      return existing;
    }
    
    const blob = new Blob([bytes], { type: mediaType });
    const url = URL.createObjectURL(blob);
    this.blobUrls.set(href, url);
    return url;
  }
  
  private applyScaling(): void {
    // Get container dimensions
    const containerWidth = this.container.clientWidth;
    const containerHeight = this.container.clientHeight;
    
    // Get page(s) dimensions
    const pages = this.viewport.querySelectorAll<HTMLElement>(".haddon-fixed-layout-page");
    if (pages.length === 0) return;
    
    let totalWidth = 0;
    let maxHeight = 0;
    
    pages.forEach((page, index) => {
      const pageWidth = parseInt(page.getAttribute("data-width") || "800", 10);
      const pageHeight = parseInt(page.getAttribute("data-height") || "1200", 10);
      
      totalWidth += pageWidth;
      if (index > 0) {
        totalWidth += 16; // Gap between pages
      }
      maxHeight = Math.max(maxHeight, pageHeight);
    });
    
    // Calculate scale to fit
    const scaleX = containerWidth / totalWidth;
    const scaleY = containerHeight / maxHeight;
    const scale = Math.min(scaleX, scaleY, 1); // Don't scale up
    
    // Apply transform
    this.viewport.style.transform = `scale(${scale})`;
    this.viewport.style.transformOrigin = "center center";
  }
  
  private handleResize = (): void => {
    if (!this.destroyed) {
      this.applyScaling();
    }
  };
  
  async destroy(): Promise<void> {
    if (this.destroyed) return;
    
    this.destroyed = true;
    
    // Remove resize listener
    window.removeEventListener("resize", this.handleResize);
    
    // Revoke all blob URLs
    for (const url of this.blobUrls.values()) {
      URL.revokeObjectURL(url);
    }
    this.blobUrls.clear();
    
    // Remove container from DOM
    if (this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
  }
}

/**
 * Fixed-layout backend factory.
 */
export class FixedLayoutBackend {
  readonly id = "fixed-layout";
  readonly version = "1.0.0";
  
  /**
   * Assess whether this backend can handle the given resource.
   */
  assess(
    link: ResourceLink,
    rendition: RenditionHints
  ): SupportAssessment {
    // Fixed-layout backend requires rendition:layout="pre-paginated"
    if (rendition.layout === "pre-paginated") {
      return {
        level: "supported",
        reason: "rendition:layout=pre-paginated",
      };
    }
    
    // If resource has explicit width/height, might be fixed-layout
    if (link.width && link.height) {
      return {
        level: "partial",
        reason: "resource has fixed dimensions but no explicit rendition:layout",
      };
    }
    
    return {
      level: "unsupported",
      reason: "not a fixed-layout resource",
    };
  }
  
  /**
   * Open a fixed-layout session.
   */
  async open(options: FixedLayoutBackendOptions): Promise<FixedLayoutSession> {
    const session = new FixedLayoutSession(options);
    
    // Navigate to first spread
    await session.navigate({ spreadIndex: 0 });
    
    return session;
  }
}
