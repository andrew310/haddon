/**
 * Iframe rendition backend for source-faithful content rendering.
 * 
 * HADDON-035: Implements sandboxed iframe with scripts inert by default,
 * deterministic blob URL lifecycle, and strict security policies.
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
}

export type RenditionKind = "normalized-semantic" | "source-faithful" | "fixed-layout";

export interface BackendNavigationResult {
  status: "moved" | "already-visible" | "boundary";
  location: {
    href: string;
    fragment?: string;
  };
}

export interface BackendSession {
  readonly backendId: string;
  readonly renditionKind: RenditionKind;
  readonly hrefs: readonly string[];
  
  destroy(): Promise<void>;
}

// CSP policy for iframe documents
const CSP_POLICY = [
  "default-src 'none'",
  "style-src 'unsafe-inline' blob:",
  "img-src blob: data:",
  "font-src blob:",
  "media-src blob:",
  "object-src 'none'",
  "script-src 'none'",
  "frame-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

// Sandbox policy - scripts are inert by default
const SANDBOX_POLICY = [
  // Explicitly NO:
  // - "allow-scripts"
  // - "allow-same-origin" 
  // - "allow-forms"
  // - "allow-popups"
  // - "allow-top-navigation"
].join(" ");

export interface IframeBackendOptions {
  /**
   * Root element where iframe will be mounted.
   * The backend owns a child slot within this root.
   */
  host: HTMLElement;
  
  /**
   * Function to fetch resource bytes by href.
   */
  getResource: (href: string) => Promise<Uint8Array | null>;
  
  /**
   * Optional CSP override for testing.
   */
  csp?: string;
  
  /**
   * Optional sandbox override for testing.
   */
  sandbox?: string;
}

export interface NavigateOptions {
  href: string;
  fragment?: string;
}

/**
 * Iframe rendition session.
 * 
 * Lifecycle:
 * 1. Created by IframeBackend.open()
 * 2. Loads source HTML into sandboxed iframe
 * 3. Rewrites resources to blob URLs
 * 4. Intercepts links and selection
 * 5. On destroy: revokes all blob URLs and removes iframe
 */
export class IframeSession implements BackendSession {
  readonly backendId = "iframe";
  readonly renditionKind: RenditionKind = "source-faithful";
  readonly hrefs: readonly string[];
  
  private iframe: HTMLIFrameElement;
  private blobUrls: Map<string, string> = new Map();
  private destroyed = false;
  private options: IframeBackendOptions;
  private currentHref: string;
  
  constructor(options: IframeBackendOptions, initialHref: string) {
    this.options = options;
    this.currentHref = initialHref;
    this.hrefs = [initialHref];
    
    // Create sandboxed iframe
    this.iframe = document.createElement("iframe");
    this.iframe.setAttribute("sandbox", options.sandbox ?? SANDBOX_POLICY);
    this.iframe.style.width = "100%";
    this.iframe.style.height = "100%";
    this.iframe.style.border = "none";
    
    // Mount in host
    options.host.appendChild(this.iframe);
  }
  
  /**
   * Load content into the iframe.
   */
  async loadContent(href: string, fragment?: string): Promise<BackendNavigationResult> {
    if (this.destroyed) {
      throw new Error("Session destroyed");
    }
    
    // Fetch source HTML
    const bytes = await this.options.getResource(href);
    if (!bytes) {
      throw new Error(`Resource not found: ${href}`);
    }
    
    // Decode HTML
    const decoder = new TextDecoder("utf-8");
    const sourceHtml = decoder.decode(bytes);
    
    // Rewrite document with security policies and blob URLs
    const rewrittenHtml = await this.rewriteDocument(sourceHtml, href);
    
    // Load into iframe via blob URL
    const blob = new Blob([rewrittenHtml], { type: "text/html" });
    const docUrl = URL.createObjectURL(blob);
    this.blobUrls.set("__main__", docUrl);
    
    // Set iframe src
    this.iframe.src = fragment ? `${docUrl}#${fragment}` : docUrl;
    
    // Wait for load
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.iframe.removeEventListener("load", onLoad);
        this.iframe.removeEventListener("error", onError);
        reject(new Error("Iframe load timeout"));
      }, 5000);
      
      const onLoad = () => {
        clearTimeout(timeout);
        this.iframe.removeEventListener("error", onError);
        resolve();
      };
      
      const onError = () => {
        clearTimeout(timeout);
        this.iframe.removeEventListener("load", onLoad);
        reject(new Error("Iframe load failed"));
      };
      
      this.iframe.addEventListener("load", onLoad, { once: true });
      this.iframe.addEventListener("error", onError, { once: true });
    });
    
    this.currentHref = href;
    
    return {
      status: "moved",
      location: { href, fragment },
    };
  }
  
  /**
   * Rewrite source HTML to enforce security and load resources.
   */
  private async rewriteDocument(sourceHtml: string, baseHref: string): Promise<string> {
    const parser = new DOMParser();
    const doc = parser.parseFromString(sourceHtml, "text/html");
    
    // Add CSP meta tag at the start of <head>
    let head = doc.querySelector("head");
    if (!head) {
      head = doc.createElement("head");
      doc.documentElement.insertBefore(head, doc.body);
    }
    
    const cspMeta = doc.createElement("meta");
    cspMeta.setAttribute("http-equiv", "Content-Security-Policy");
    cspMeta.setAttribute("content", this.options.csp ?? CSP_POLICY);
    head.insertBefore(cspMeta, head.firstChild);
    
    // Remove all scripts - scripts are INERT
    doc.querySelectorAll("script").forEach(script => script.remove());
    
    // Remove all event handlers - scripts are INERT
    doc.querySelectorAll("*").forEach(el => {
      Array.from(el.attributes).forEach(attr => {
        if (attr.name.startsWith("on")) {
          el.removeAttribute(attr.name);
        }
      });
    });
    
    // Remove forms - not supported
    doc.querySelectorAll("form").forEach(form => form.remove());
    
    // Rewrite resource URLs to blob URLs
    await this.rewriteImages(doc, baseHref);
    await this.rewriteStylesheets(doc, baseHref);
    await this.rewriteMedia(doc, baseHref);
    
    // Serialize
    return new XMLSerializer().serializeToString(doc);
  }
  
  /**
   * Rewrite <img> src to blob URLs.
   */
  private async rewriteImages(doc: Document, baseHref: string): Promise<void> {
    const images = doc.querySelectorAll("img[src]");
    
    for (const img of Array.from(images)) {
      const src = img.getAttribute("src");
      if (!src) continue;
      
      // Skip data URLs and already-rewritten blob URLs
      if (src.startsWith("data:") || src.startsWith("blob:")) continue;
      
      // Skip external URLs
      if (src.startsWith("http://") || src.startsWith("https://")) {
        // External resources are blocked by CSP
        img.removeAttribute("src");
        continue;
      }
      
      // Resolve relative URL
      const resourceHref = this.resolveHref(baseHref, src);
      
      // Get or create blob URL
      const blobUrl = await this.getBlobUrl(resourceHref);
      if (blobUrl) {
        img.setAttribute("src", blobUrl);
      } else {
        img.removeAttribute("src");
      }
    }
  }
  
  /**
   * Rewrite <link rel="stylesheet"> and <style> to use blob URLs.
   */
  private async rewriteStylesheets(doc: Document, baseHref: string): Promise<void> {
    // Rewrite <link rel="stylesheet">
    const links = doc.querySelectorAll('link[rel="stylesheet"][href]');
    
    for (const link of Array.from(links)) {
      const href = link.getAttribute("href");
      if (!href) continue;
      
      // Skip external URLs
      if (href.startsWith("http://") || href.startsWith("https://")) {
        link.remove();
        continue;
      }
      
      // Resolve relative URL
      const resourceHref = this.resolveHref(baseHref, href);
      
      // Get or create blob URL
      const blobUrl = await this.getBlobUrl(resourceHref);
      if (blobUrl) {
        link.setAttribute("href", blobUrl);
      } else {
        link.remove();
      }
    }
    
    // Note: Inline <style> elements are allowed by CSP 'unsafe-inline'
    // No rewriting needed for inline styles
  }
  
  /**
   * Rewrite <audio>, <video>, <source> to use blob URLs.
   */
  private async rewriteMedia(doc: Document, baseHref: string): Promise<void> {
    const mediaTags = doc.querySelectorAll("audio[src], video[src], source[src]");
    
    for (const media of Array.from(mediaTags)) {
      const src = media.getAttribute("src");
      if (!src) continue;
      
      // Skip external URLs
      if (src.startsWith("http://") || src.startsWith("https://")) {
        media.removeAttribute("src");
        continue;
      }
      
      // Resolve relative URL
      const resourceHref = this.resolveHref(baseHref, src);
      
      // Get or create blob URL
      const blobUrl = await this.getBlobUrl(resourceHref);
      if (blobUrl) {
        media.setAttribute("src", blobUrl);
      } else {
        media.removeAttribute("src");
      }
    }
  }
  
  /**
   * Get or create a blob URL for a resource href.
   * Returns null if resource cannot be loaded.
   */
  private async getBlobUrl(href: string): Promise<string | null> {
    // Check if already created
    if (this.blobUrls.has(href)) {
      return this.blobUrls.get(href)!;
    }
    
    // Fetch resource
    const bytes = await this.options.getResource(href);
    if (!bytes) {
      return null;
    }
    
    // Create blob URL
    // Media type is inferred from extension for now
    const mediaType = this.inferMediaType(href);
    const blob = new Blob([bytes], { type: mediaType });
    const url = URL.createObjectURL(blob);
    
    // Track for cleanup
    this.blobUrls.set(href, url);
    
    return url;
  }
  
  /**
   * Resolve a relative href against a base href.
   */
  private resolveHref(base: string, reference: string): string {
    // Strip fragment from reference
    const [refPath] = reference.split("#");
    
    // Already absolute or fragment-only
    if (!refPath || refPath.startsWith("#")) {
      return base;
    }
    
    if (refPath.startsWith("/")) {
      return refPath.substring(1);
    }
    
    // Resolve relative to base
    const baseDir = base.includes("/") 
      ? base.substring(0, base.lastIndexOf("/"))
      : "";
    
    if (!baseDir) {
      return refPath;
    }
    
    return `${baseDir}/${refPath}`;
  }
  
  /**
   * Infer media type from href extension.
   */
  private inferMediaType(href: string): string {
    const ext = href.substring(href.lastIndexOf(".") + 1).toLowerCase();
    
    const typeMap: Record<string, string> = {
      "png": "image/png",
      "jpg": "image/jpeg",
      "jpeg": "image/jpeg",
      "gif": "image/gif",
      "svg": "image/svg+xml",
      "webp": "image/webp",
      "css": "text/css",
      "woff": "font/woff",
      "woff2": "font/woff2",
      "ttf": "font/ttf",
      "otf": "font/otf",
      "mp3": "audio/mpeg",
      "mp4": "video/mp4",
      "webm": "video/webm",
    };
    
    return typeMap[ext] || "application/octet-stream";
  }
  
  /**
   * Navigate to a different href within the same session.
   */
  async navigate(options: NavigateOptions): Promise<BackendNavigationResult> {
    return this.loadContent(options.href, options.fragment);
  }
  
  /**
   * Destroy the session and clean up resources.
   * 
   * - Revokes all blob URLs (deterministic cleanup)
   * - Removes iframe from DOM
   * - Marks session as destroyed
   */
  async destroy(): Promise<void> {
    if (this.destroyed) {
      return;
    }
    
    this.destroyed = true;
    
    // Revoke all blob URLs
    for (const url of this.blobUrls.values()) {
      URL.revokeObjectURL(url);
    }
    this.blobUrls.clear();
    
    // Remove iframe
    if (this.iframe.parentNode) {
      this.iframe.parentNode.removeChild(this.iframe);
    }
  }
}

/**
 * Iframe backend descriptor and factory.
 */
export class IframeBackend {
  readonly id = "iframe";
  readonly version = "1.0.0";
  
  /**
   * Assess whether this backend can render a given resource.
   */
  assess(link: ResourceLink, kind: RenditionKind): SupportAssessment {
    // Iframe backend is for source-faithful rendering
    if (kind !== "source-faithful") {
      return { 
        level: "unsupported", 
        reason: "iframe requires source-faithful kind" 
      };
    }
    
    const mediaType = link.mediaType?.toLowerCase();
    if (!mediaType) {
      return { 
        level: "unsupported", 
        reason: "unknown media type" 
      };
    }
    
    // Support HTML/XHTML
    if (
      mediaType === "application/xhtml+xml" ||
      mediaType === "text/html" ||
      mediaType === "application/html+xml"
    ) {
      return { 
        level: "supported", 
        reason: "source-faithful HTML/XHTML" 
      };
    }
    
    // SVG could work but needs more testing
    if (mediaType === "image/svg+xml") {
      return { 
        level: "partial", 
        reason: "SVG support is experimental" 
      };
    }
    
    return { 
      level: "unsupported", 
      reason: `media type ${mediaType} not supported by iframe backend` 
    };
  }
  
  /**
   * Open a new iframe session.
   */
  async open(options: IframeBackendOptions, href: string): Promise<IframeSession> {
    const session = new IframeSession(options, href);
    await session.loadContent(href);
    return session;
  }
}
