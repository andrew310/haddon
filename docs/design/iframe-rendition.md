# Iframe Rendition Backend

**Status:** Implementation for HADDON-035

**Date:** 2026-09-04

**Scope:** Source-faithful iframe rendition for content unsuitable for normalization

**Depends on:** HADDON-020 (archive/resource hardening), HADDON-030 (navigator contract)

## Decision Summary

- **Decision:** The iframe backend renders source content unsuitable for normalization using a sandboxed iframe with strict security policies.
- **Decision:** Scripts are inert by default via `sandbox` attribute and CSP. Publishers' JavaScript never executes in Haddon.
- **Decision:** Blob URLs have deterministic lifecycle tied to the rendition session. URLs are created lazily and revoked on session destruction.
- **Decision:** External resources (fonts, stylesheets, images from external domains) are blocked by CSP. Only publication-owned resources are allowed.
- **Decision:** The iframe backend implements the same `RenditionBackend` SPI as semantic DOM, making it a drop-in fallback.
- **Decision:** Content policies (sandbox, CSP, allowed origins) are testable and explicit, not assumed from browser defaults.

## 1. Architecture

The iframe rendition backend coexists with the semantic DOM backend:

```text
Navigator
  |
  +-- assess(link, kind) -> choose backend
  |
  +-- SemanticDomBackend (normalized content)
  |     - safe semantic HTML
  |     - precise locators
  |     - native selection
  |
  +-- IframeBackend (source-faithful fallback)
        - sandboxed source DOM
        - scripts inert
        - external resources blocked
        - best-effort locators via fragment/CFI
```

## 2. Sandbox Policy

The iframe uses the `sandbox` attribute with explicit allowed behaviors:

```typescript
const IFRAME_SANDBOX_POLICY = [
  // NEVER include:
  // - "allow-scripts"
  // - "allow-same-origin" (dangerous with allow-scripts)
  // - "allow-forms"
  // - "allow-popups"
  // - "allow-top-navigation"
  
  // Allow ONLY:
  "allow-popups-to-escape-sandbox", // For external links (handled by intent)
] as const;
```

### Rationale

- **No scripts**: Publisher JavaScript never runs. This prevents tracking, fingerprinting, and malicious behavior.
- **No forms**: Forms without scripts are useless and could confuse users.
- **No same-origin**: Combined with no scripts, this prevents the iframe from accessing parent page.
- **No navigation**: Internal links emit intent events; external links are explicitly handled by the host.

## 3. Content Security Policy

The iframe document includes a strict CSP via meta tag:

```html
<meta http-equiv="Content-Security-Policy" content="
  default-src 'none';
  style-src 'unsafe-inline' blob:;
  img-src blob: data:;
  font-src blob:;
  media-src blob:;
  object-src 'none';
  script-src 'none';
  frame-src 'none';
  base-uri 'none';
  form-action 'none';
">
```

### Rationale

- **default-src 'none'**: Deny everything by default
- **style-src 'unsafe-inline' blob:**: Allow inline styles from source + blob URL stylesheets
- **img-src blob: data:**: Allow images from publication + data URIs
- **font-src blob:**: Allow fonts from publication
- **media-src blob:**: Allow audio/video from publication
- **script-src 'none'**: Redundant with sandbox, but explicit
- **No external origins**: All resources must be publication-owned

## 4. URL Lifecycle

Blob URLs are managed deterministically:

### Creation
```typescript
class IframeSession implements RenditionSession {
  private blobUrls: Map<string, string> = new Map();
  
  private createBlobUrl(href: string, bytes: Uint8Array, mediaType?: string): string {
    // Check if already created
    if (this.blobUrls.has(href)) {
      return this.blobUrls.get(href)!;
    }
    
    // Create new blob URL
    const blob = new Blob([bytes], { type: mediaType });
    const url = URL.createObjectURL(blob);
    
    // Track for cleanup
    this.blobUrls.set(href, url);
    
    return url;
  }
}
```

### Revocation
```typescript
async destroy(): AsyncResult<void> {
  // Revoke all blob URLs
  for (const url of this.blobUrls.values()) {
    URL.revokeObjectURL(url);
  }
  this.blobUrls.clear();
  
  // Remove iframe from DOM
  if (this.iframe.parentNode) {
    this.iframe.parentNode.removeChild(this.iframe);
  }
  
  return { ok: true, value: { value: undefined, completeness: "complete", warnings: [] } };
}
```

### Rules

1. **One URL per resource href**: Deduplicate blob creation
2. **Lazy creation**: Only create URLs for resources actually loaded
3. **Deterministic revocation**: All URLs revoked on session destroy
4. **No leaks**: Track every created URL in a map
5. **No reuse after destroy**: Destroyed sessions cannot create new URLs

## 5. Resource Rewriting

Source HTML/XHTML is rewritten before loading into the iframe:

```typescript
private rewriteDocument(sourceHtml: string, baseHref: string): string {
  const doc = new DOMParser().parseFromString(sourceHtml, "application/xhtml+xml");
  
  // Add CSP meta tag
  const head = doc.querySelector("head") || doc.createElement("head");
  const cspMeta = doc.createElement("meta");
  cspMeta.setAttribute("http-equiv", "Content-Security-Policy");
  cspMeta.setAttribute("content", this.buildCSP());
  head.insertBefore(cspMeta, head.firstChild);
  
  // Rewrite resource URLs to blob URLs
  this.rewriteImages(doc, baseHref);
  this.rewriteStylesheets(doc, baseHref);
  this.rewriteFonts(doc, baseHref); // Inside stylesheets
  this.rewriteMedia(doc, baseHref);
  
  // Remove/neuter scripts
  doc.querySelectorAll("script").forEach(script => script.remove());
  doc.querySelectorAll("[onclick], [onload], [onerror]").forEach(el => {
    Array.from(el.attributes).forEach(attr => {
      if (attr.name.startsWith("on")) {
        el.removeAttribute(attr.name);
      }
    });
  });
  
  return new XMLSerializer().serializeToString(doc);
}
```

## 6. Link Handling

Links in the iframe do not navigate directly:

```typescript
private installLinkCapture(iframeDoc: Document): void {
  iframeDoc.addEventListener("click", (event) => {
    const anchor = (event.target as HTMLElement).closest("a");
    if (!anchor) return;
    
    event.preventDefault();
    
    const href = anchor.getAttribute("href");
    if (!href) return;
    
    // Emit link intent to navigator
    this.emitEvent({
      type: "link",
      link: {
        rawHref: href,
        source: this.currentLocator,
        // ... rest of link intent data
      }
    });
  }, true); // Capture phase to intercept before any publisher handlers
}
```

## 7. Selection Support

Selection in iframe content is supported but with limitations:

```typescript
private captureSelection(): BackendSelection | null {
  const iframeDoc = this.iframe.contentDocument;
  if (!iframeDoc) return null;
  
  const selection = iframeDoc.getSelection();
  if (!selection || selection.isCollapsed) return null;
  
  // Extract ranges and text
  const ranges: SourceDomRange[] = [];
  for (let i = 0; i < selection.rangeCount; i++) {
    const range = selection.getRangeAt(i);
    ranges.push(this.rangeToDomSelector(range));
  }
  
  return {
    status: "resolved", // or "unresolved" if mapping unavailable
    ranges,
    text: selection.toString(),
    direction: this.detectDirection(selection),
    collapsed: false,
    input: "mouse",
    geometry: this.computeGeometry(selection),
  };
}
```

### Limitations

- **No normalized mapping**: Iframe content is not normalized, so locators use fragment/CFI only
- **Source DOM ranges**: Selections map to source DOM, not normalized blocks
- **Best-effort geometry**: Geometry is relative to iframe, translated to root coordinates

## 8. Backend Assessment

The iframe backend assesses suitability:

```typescript
assess(link: ResourceLink, kind: RenditionKind): SupportAssessment {
  // Iframe backend is for source-faithful rendering
  if (kind !== "source-faithful") {
    return { level: "unsupported", reason: "iframe requires source-faithful kind" };
  }
  
  // Check media type
  const mediaType = link.mediaType?.toLowerCase();
  if (!mediaType) {
    return { level: "unsupported", reason: "unknown media type" };
  }
  
  // Support HTML/XHTML
  if (
    mediaType === "application/xhtml+xml" ||
    mediaType === "text/html" ||
    mediaType === "application/html+xml"
  ) {
    // Prefer semantic DOM for normalizable content
    // Iframe is fallback for complex/broken content
    return { level: "supported", reason: "source-faithful HTML/XHTML" };
  }
  
  // SVG could work but needs testing
  if (mediaType === "image/svg+xml") {
    return { level: "partial", reason: "SVG support is experimental" };
  }
  
  return { level: "unsupported", reason: `media type ${mediaType} not supported` };
}
```

## 9. Origin Isolation

The iframe uses blob URL for the main document:

```typescript
private loadDocument(html: string): void {
  // Create blob URL for the rewritten document
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  this.blobUrls.set("__main__", url);
  
  // Set iframe src to blob URL
  // This gives the document a unique opaque origin
  this.iframe.src = url;
}
```

### Security Properties

- **Unique origin**: Each iframe document has a unique opaque origin (blob:)
- **No same-origin access**: iframe cannot access parent page
- **No cross-origin requests**: CSP blocks external resources
- **No data exfiltration**: Scripts don't run, forms don't submit

## 10. Testing Strategy

Tests cover the security and lifecycle properties:

### Unit Tests

1. **Sandbox policy**: Verify sandbox attribute contains only allowed tokens
2. **CSP generation**: Verify CSP string matches policy
3. **Script removal**: Verify all scripts removed from rewritten HTML
4. **Event handler removal**: Verify onclick, onload, etc. removed
5. **URL lifecycle**: Verify blob URLs created and revoked correctly

### Integration Tests

1. **No script execution**: Load HTML with `<script>alert('bad')</script>`, verify alert never fires
2. **External resource blocking**: Load HTML with `<img src="https://evil.com/track.gif">`, verify request blocked
3. **Link interception**: Click link in iframe, verify intent event emitted, no navigation
4. **Selection capture**: Select text in iframe, verify selection event with source ranges
5. **Session cleanup**: Destroy session, verify all blob URLs revoked and iframe removed

### Fixture Tests

1. **Complex HTML**: Load real EPUB HTML with forms, scripts, external fonts
2. **Broken HTML**: Load malformed HTML, verify graceful fallback
3. **Large resources**: Load large images/stylesheets, verify no memory leak

## 11. Feature Detection

The iframe backend declares its capabilities:

```typescript
readonly descriptor: RenditionBackendDescriptor = {
  id: "iframe",
  version: "1.0.0",
  renditionKinds: ["source-faithful"],
  features: [
    {
      feature: "logical-location",
      availability: "partial",
      limitations: [
        { code: "fragment-only", reason: "no normalized mapping" }
      ]
    },
    {
      feature: "native-selection",
      availability: "available",
      limitations: []
    },
    {
      feature: "internal-links",
      availability: "available",
      limitations: []
    },
    {
      feature: "decorations",
      availability: "unavailable",
      limitations: [
        { code: "no-normalized-ast", reason: "cannot map decoration locators" }
      ]
    }
  ],
  decorationStyles: [], // No decoration support
};
```

## 12. Open Questions

1. **SVG documents**: Should SVG be supported, and if so, how to handle script elements and event handlers?
2. **MathML**: Should MathML fallback to iframe or remain unsupported?
3. **CSS @import**: Should external @import be blocked, or rewritten to blob URLs?
4. **Subresource integrity**: Should SRI hashes be preserved/validated?
5. **Fixed layout**: Does fixed-layout EPUB need iframe, or can semantic DOM handle it with metadata?

## 13. Non-Goals

The following are explicitly out of scope for V1 iframe backend:

- **Full fidelity to browser rendering**: The iframe is not trying to replicate a full browser. It's a security-conscious fallback.
- **JavaScript support**: Scripts will never run in Haddon. Period.
- **Form handling**: Forms are removed/disabled.
- **External resources**: No CDN fonts, Google Analytics, external stylesheets, etc.
- **Service workers**: Not supported in sandboxed iframes anyway.
- **Full parity with semantic DOM**: Iframe is best-effort; decorations, search highlights, etc. may not work.

## 14. Relationship to HADDON-030

The iframe backend implements the `RenditionBackend` SPI defined in navigator-api.md:

- ✅ **assess()**: Declares support for source-faithful HTML/XHTML
- ✅ **open()**: Returns `IframeSession` implementing `RenditionSession`
- ✅ **navigate()**: Loads href into iframe, scrolls to fragment
- ✅ **destroy()**: Revokes URLs, removes iframe, reports warnings
- ✅ **Backend events**: Emits link, selection, pointer, warning events
- ✅ **Cleanup**: No leaks, deterministic teardown

## 15. Relationship to HADDON-020

Depends on resource access hardening:

- Uses `Publication.getResource()` for all content
- Respects resource limits (max size, decompression limits)
- Reports missing resources as warnings, not fatal errors
- URL normalization uses publication's canonical href rules
- Never bypasses publication's security/policy layer

## 16. Future Enhancements

Deferred to later tickets:

- **CSS rewriting**: More sophisticated CSS parsing to catch @import, url() in inline styles
- **Font subsetting**: Reduce font blob sizes for performance
- **Caching**: Share blob URLs across sessions for same publication
- **Accessibility**: Ensure ARIA/accessibility features work through iframe boundary
- **Better locators**: Extract structure for better-than-fragment locators without full normalization
