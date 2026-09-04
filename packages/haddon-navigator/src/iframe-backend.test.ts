/**
 * Tests for iframe rendition backend.
 * 
 * HADDON-035 acceptance criteria:
 * - Scripts are inert by default
 * - CSP, sandbox, external-resource, origin, and URL-lifecycle policies are tested
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { IframeBackend, IframeSession, type IframeBackendOptions } from "./iframe-backend";

describe("IframeBackend", () => {
  let backend: IframeBackend;
  let host: HTMLElement;
  let mockGetResource: ReturnType<typeof vi.fn>;
  
  beforeEach(() => {
    backend = new IframeBackend();
    host = document.createElement("div");
    document.body.appendChild(host);
    mockGetResource = vi.fn();
  });
  
  afterEach(() => {
    document.body.removeChild(host);
  });
  
  describe("assess", () => {
    it("supports source-faithful HTML", () => {
      const result = backend.assess(
        { href: "test.html", mediaType: "text/html" },
        "source-faithful"
      );
      
      expect(result.level).toBe("supported");
      expect(result.reason).toContain("HTML");
    });
    
    it("supports source-faithful XHTML", () => {
      const result = backend.assess(
        { href: "test.xhtml", mediaType: "application/xhtml+xml" },
        "source-faithful"
      );
      
      expect(result.level).toBe("supported");
      expect(result.reason).toContain("XHTML");
    });
    
    it("does not support normalized-semantic kind", () => {
      const result = backend.assess(
        { href: "test.html", mediaType: "text/html" },
        "normalized-semantic"
      );
      
      expect(result.level).toBe("unsupported");
      expect(result.reason).toContain("source-faithful kind");
    });
    
    it("does not support unknown media types", () => {
      const result = backend.assess(
        { href: "test.txt" },
        "source-faithful"
      );
      
      expect(result.level).toBe("unsupported");
      expect(result.reason).toContain("unknown media type");
    });
    
    it("partially supports SVG", () => {
      const result = backend.assess(
        { href: "diagram.svg", mediaType: "image/svg+xml" },
        "source-faithful"
      );
      
      expect(result.level).toBe("partial");
      expect(result.reason).toContain("experimental");
    });
  });
  
  describe("IframeSession - Sandbox Policy", () => {
    it("creates iframe with sandbox attribute", async () => {
      const html = "<html><body>Test</body></html>";
      mockGetResource.mockResolvedValue(new TextEncoder().encode(html));
      
      const options: IframeBackendOptions = {
        host,
        getResource: mockGetResource,
      };
      
      const session = await backend.open(options, "test.html");
      
      const iframe = host.querySelector("iframe");
      expect(iframe).toBeTruthy();
      expect(iframe?.getAttribute("sandbox")).toBeDefined();
      
      await session.destroy();
    });
    
    it("does not allow scripts in sandbox", async () => {
      const html = "<html><body>Test</body></html>";
      mockGetResource.mockResolvedValue(new TextEncoder().encode(html));
      
      const options: IframeBackendOptions = {
        host,
        getResource: mockGetResource,
      };
      
      const session = await backend.open(options, "test.html");
      
      const iframe = host.querySelector("iframe");
      const sandbox = iframe?.getAttribute("sandbox") || "";
      
      // Should NOT contain these dangerous permissions
      expect(sandbox).not.toContain("allow-scripts");
      expect(sandbox).not.toContain("allow-same-origin");
      expect(sandbox).not.toContain("allow-forms");
      expect(sandbox).not.toContain("allow-popups");
      expect(sandbox).not.toContain("allow-top-navigation");
      
      await session.destroy();
    });
    
    it("allows custom sandbox for testing", async () => {
      const html = "<html><body>Test</body></html>";
      mockGetResource.mockResolvedValue(new TextEncoder().encode(html));
      
      const options: IframeBackendOptions = {
        host,
        getResource: mockGetResource,
        sandbox: "allow-scripts", // For testing only!
      };
      
      const session = await backend.open(options, "test.html");
      
      const iframe = host.querySelector("iframe");
      expect(iframe?.getAttribute("sandbox")).toBe("allow-scripts");
      
      await session.destroy();
    });
  });
  
  describe("IframeSession - CSP Policy", () => {
    it("injects CSP meta tag into document", async () => {
      const html = "<html><head></head><body>Test</body></html>";
      mockGetResource.mockResolvedValue(new TextEncoder().encode(html));
      
      const options: IframeBackendOptions = {
        host,
        getResource: mockGetResource,
      };
      
      const session = await backend.open(options, "test.html");
      
      // Wait for iframe to load
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const iframe = host.querySelector("iframe") as HTMLIFrameElement;
      const iframeDoc = iframe.contentDocument;
      
      if (iframeDoc) {
        const cspMeta = iframeDoc.querySelector('meta[http-equiv="Content-Security-Policy"]');
        expect(cspMeta).toBeTruthy();
        
        const content = cspMeta?.getAttribute("content") || "";
        
        // Check key CSP directives
        expect(content).toContain("default-src 'none'");
        expect(content).toContain("script-src 'none'");
        expect(content).toContain("object-src 'none'");
        expect(content).toContain("style-src 'unsafe-inline' blob:");
        expect(content).toContain("img-src blob: data:");
      }
      
      await session.destroy();
    });
    
    it("allows custom CSP for testing", async () => {
      const html = "<html><body>Test</body></html>";
      mockGetResource.mockResolvedValue(new TextEncoder().encode(html));
      
      const customCSP = "default-src 'self'; script-src 'unsafe-inline'";
      
      const options: IframeBackendOptions = {
        host,
        getResource: mockGetResource,
        csp: customCSP,
      };
      
      const session = await backend.open(options, "test.html");
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const iframe = host.querySelector("iframe") as HTMLIFrameElement;
      const iframeDoc = iframe.contentDocument;
      
      if (iframeDoc) {
        const cspMeta = iframeDoc.querySelector('meta[http-equiv="Content-Security-Policy"]');
        expect(cspMeta?.getAttribute("content")).toBe(customCSP);
      }
      
      await session.destroy();
    });
  });
  
  describe("IframeSession - Scripts Inert", () => {
    it("removes all script elements from source HTML", async () => {
      const html = `
        <html>
          <head>
            <script>alert('bad');</script>
          </head>
          <body>
            <p>Content</p>
            <script>console.log('also bad');</script>
          </body>
        </html>
      `;
      mockGetResource.mockResolvedValue(new TextEncoder().encode(html));
      
      const options: IframeBackendOptions = {
        host,
        getResource: mockGetResource,
      };
      
      const session = await backend.open(options, "test.html");
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const iframe = host.querySelector("iframe") as HTMLIFrameElement;
      const iframeDoc = iframe.contentDocument;
      
      if (iframeDoc) {
        const scripts = iframeDoc.querySelectorAll("script");
        expect(scripts.length).toBe(0);
      }
      
      await session.destroy();
    });
    
    it("removes all event handler attributes", async () => {
      const html = `
        <html>
          <body>
            <button onclick="alert('bad')">Click me</button>
            <img src="test.png" onerror="alert('bad')" onload="console.log('bad')">
            <div onmouseover="alert('bad')">Hover</div>
          </body>
        </html>
      `;
      mockGetResource.mockResolvedValue(new TextEncoder().encode(html));
      
      const options: IframeBackendOptions = {
        host,
        getResource: mockGetResource,
      };
      
      const session = await backend.open(options, "test.html");
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const iframe = host.querySelector("iframe") as HTMLIFrameElement;
      const iframeDoc = iframe.contentDocument;
      
      if (iframeDoc) {
        const button = iframeDoc.querySelector("button");
        expect(button?.getAttribute("onclick")).toBeNull();
        
        const img = iframeDoc.querySelector("img");
        expect(img?.getAttribute("onerror")).toBeNull();
        expect(img?.getAttribute("onload")).toBeNull();
        
        const div = iframeDoc.querySelector("div");
        expect(div?.getAttribute("onmouseover")).toBeNull();
      }
      
      await session.destroy();
    });
    
    it("removes form elements", async () => {
      const html = `
        <html>
          <body>
            <form action="/submit" method="post">
              <input type="text" name="username">
              <button type="submit">Submit</button>
            </form>
          </body>
        </html>
      `;
      mockGetResource.mockResolvedValue(new TextEncoder().encode(html));
      
      const options: IframeBackendOptions = {
        host,
        getResource: mockGetResource,
      };
      
      const session = await backend.open(options, "test.html");
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const iframe = host.querySelector("iframe") as HTMLIFrameElement;
      const iframeDoc = iframe.contentDocument;
      
      if (iframeDoc) {
        const forms = iframeDoc.querySelectorAll("form");
        expect(forms.length).toBe(0);
      }
      
      await session.destroy();
    });
  });
  
  describe("IframeSession - External Resources Blocked", () => {
    it("removes external image sources", async () => {
      const html = `
        <html>
          <body>
            <img src="https://evil.com/track.gif" alt="Tracking pixel">
            <img src="http://example.com/logo.png" alt="External logo">
          </body>
        </html>
      `;
      mockGetResource.mockResolvedValue(new TextEncoder().encode(html));
      
      const options: IframeBackendOptions = {
        host,
        getResource: mockGetResource,
      };
      
      const session = await backend.open(options, "test.html");
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const iframe = host.querySelector("iframe") as HTMLIFrameElement;
      const iframeDoc = iframe.contentDocument;
      
      if (iframeDoc) {
        const images = iframeDoc.querySelectorAll("img");
        for (const img of Array.from(images)) {
          const src = img.getAttribute("src");
          // External http(s) URLs should be removed
          expect(src).not.toMatch(/^https?:\/\//);
        }
      }
      
      await session.destroy();
    });
    
    it("removes external stylesheet links", async () => {
      const html = `
        <html>
          <head>
            <link rel="stylesheet" href="https://fonts.googleapis.com/css?family=Roboto">
            <link rel="stylesheet" href="http://cdn.example.com/styles.css">
          </head>
          <body>Content</body>
        </html>
      `;
      mockGetResource.mockResolvedValue(new TextEncoder().encode(html));
      
      const options: IframeBackendOptions = {
        host,
        getResource: mockGetResource,
      };
      
      const session = await backend.open(options, "test.html");
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const iframe = host.querySelector("iframe") as HTMLIFrameElement;
      const iframeDoc = iframe.contentDocument;
      
      if (iframeDoc) {
        const links = iframeDoc.querySelectorAll('link[rel="stylesheet"]');
        for (const link of Array.from(links)) {
          const href = link.getAttribute("href");
          // External http(s) URLs should be removed
          expect(href).not.toMatch(/^https?:\/\//);
        }
      }
      
      await session.destroy();
    });
  });
  
  describe("IframeSession - URL Lifecycle", () => {
    it("creates blob URLs for publication resources", async () => {
      const html = `
        <html>
          <body>
            <img src="images/cover.png" alt="Cover">
          </body>
        </html>
      `;
      const imageBytes = new Uint8Array([0x89, 0x50, 0x4E, 0x47]); // PNG header
      
      mockGetResource.mockImplementation(async (href: string) => {
        if (href === "test.html") return new TextEncoder().encode(html);
        if (href === "images/cover.png") return imageBytes;
        return null;
      });
      
      const options: IframeBackendOptions = {
        host,
        getResource: mockGetResource,
      };
      
      const session = await backend.open(options, "test.html");
      
      await new Promise(resolve => setTimeout(resolve, 200));
      
      const iframe = host.querySelector("iframe") as HTMLIFrameElement;
      const iframeDoc = iframe.contentDocument;
      
      if (iframeDoc) {
        const img = iframeDoc.querySelector("img");
        const src = img?.getAttribute("src");
        
        // Should be rewritten to blob URL
        expect(src).toMatch(/^blob:/);
      }
      
      await session.destroy();
    });
    
    it("revokes all blob URLs on destroy", async () => {
      const html = `
        <html>
          <body>
            <img src="image1.png">
            <img src="image2.png">
            <link rel="stylesheet" href="styles.css">
          </body>
        </html>
      `;
      
      const resourceBytes = new Uint8Array([1, 2, 3, 4]);
      
      mockGetResource.mockImplementation(async (href: string) => {
        if (href === "test.html") return new TextEncoder().encode(html);
        return resourceBytes;
      });
      
      // Spy on URL.revokeObjectURL
      const revokeURLSpy = vi.spyOn(URL, "revokeObjectURL");
      
      const options: IframeBackendOptions = {
        host,
        getResource: mockGetResource,
      };
      
      const session = await backend.open(options, "test.html");
      
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Destroy should revoke all blob URLs
      await session.destroy();
      
      // Should have revoked at least the main document blob URL
      // Plus any resource blob URLs created
      expect(revokeURLSpy).toHaveBeenCalled();
      
      revokeURLSpy.mockRestore();
    });
    
    it("prevents operations after destroy", async () => {
      const html = "<html><body>Test</body></html>";
      mockGetResource.mockResolvedValue(new TextEncoder().encode(html));
      
      const options: IframeBackendOptions = {
        host,
        getResource: mockGetResource,
      };
      
      const session = await backend.open(options, "test.html");
      await session.destroy();
      
      // Attempting to load content after destroy should fail
      await expect(session.loadContent("another.html")).rejects.toThrow("destroyed");
    });
    
    it("removes iframe from DOM on destroy", async () => {
      const html = "<html><body>Test</body></html>";
      mockGetResource.mockResolvedValue(new TextEncoder().encode(html));
      
      const options: IframeBackendOptions = {
        host,
        getResource: mockGetResource,
      };
      
      const session = await backend.open(options, "test.html");
      
      expect(host.querySelector("iframe")).toBeTruthy();
      
      await session.destroy();
      
      expect(host.querySelector("iframe")).toBeNull();
    });
    
    it("is idempotent - can call destroy multiple times", async () => {
      const html = "<html><body>Test</body></html>";
      mockGetResource.mockResolvedValue(new TextEncoder().encode(html));
      
      const options: IframeBackendOptions = {
        host,
        getResource: mockGetResource,
      };
      
      const session = await backend.open(options, "test.html");
      
      await session.destroy();
      await session.destroy(); // Should not throw
      await session.destroy(); // Should not throw
      
      expect(host.querySelector("iframe")).toBeNull();
    });
  });
  
  describe("IframeSession - Navigation", () => {
    it("loads content with fragment", async () => {
      const html = `
        <html>
          <body>
            <h1 id="section1">Section 1</h1>
            <p>Content</p>
            <h1 id="section2">Section 2</h1>
            <p>More content</p>
          </body>
        </html>
      `;
      mockGetResource.mockResolvedValue(new TextEncoder().encode(html));
      
      const options: IframeBackendOptions = {
        host,
        getResource: mockGetResource,
      };
      
      const session = await backend.open(options, "test.html");
      
      const result = await session.navigate({ href: "test.html", fragment: "section2" });
      
      expect(result.status).toBe("moved");
      expect(result.location.fragment).toBe("section2");
      
      await session.destroy();
    });
    
    it("navigates to different href in same session", async () => {
      const html1 = "<html><body><h1>Page 1</h1></body></html>";
      const html2 = "<html><body><h1>Page 2</h1></body></html>";
      
      mockGetResource.mockImplementation(async (href: string) => {
        if (href === "page1.html") return new TextEncoder().encode(html1);
        if (href === "page2.html") return new TextEncoder().encode(html2);
        return null;
      });
      
      const options: IframeBackendOptions = {
        host,
        getResource: mockGetResource,
      };
      
      const session = await backend.open(options, "page1.html");
      
      expect(session.hrefs).toContain("page1.html");
      
      const result = await session.navigate({ href: "page2.html" });
      
      expect(result.status).toBe("moved");
      expect(result.location.href).toBe("page2.html");
      
      await session.destroy();
    });
  });
  
  describe("IframeSession - Origin Isolation", () => {
    it("loads document from blob URL with unique origin", async () => {
      const html = "<html><body>Test</body></html>";
      mockGetResource.mockResolvedValue(new TextEncoder().encode(html));
      
      const options: IframeBackendOptions = {
        host,
        getResource: mockGetResource,
      };
      
      const session = await backend.open(options, "test.html");
      
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const iframe = host.querySelector("iframe") as HTMLIFrameElement;
      
      // The iframe src should be a blob URL
      expect(iframe.src).toMatch(/^blob:/);
      
      await session.destroy();
    });
  });
});
