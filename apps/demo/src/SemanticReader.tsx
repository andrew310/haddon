import { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  autoUpdate,
  flip,
  offset,
  shift,
  useFloating,
} from "@floating-ui/react";
import {
  type CitationQuery,
  MOON_QUOTE,
  citationHref,
  isSampleHref,
} from "./citationLink";
import { citationFromDomSelection, locatorFromDomSelection } from "./selectionCitation";
import { openCitation } from "../../../packages/haddon-citation-router/open-citation";
import { VisibilityTracker } from "../../../packages/haddon-navigator/src/visibility-tracker";
import { DecorationManager, type Decoration } from "../../../packages/haddon-navigator/src/decoration-manager";
import { applyLayoutMode, scrollToElement, type LayoutModeOptions } from "../../../packages/haddon-navigator/src/layout-modes";
import { WasmLocatorService } from "./LocatorService";
import type { VisibleLocationV1, LocationChangeCause, PublicationLocatorV1, RenditionLayout } from "../../../packages/haddon-navigator/src/types";
import { SourceDrawer } from "./SourceDrawer";
import { SelectionChip, type HighlightColor } from "./SelectionChip";
import { MarginNote } from "./MarginNote";

type SearchHit = {
  href: string;
  blockId: string;
  start: number;
  end: number;
  exact: string;
  snippet: string;
};

function highlightSnippet(snippet: string, query: string): JSX.Element {
  if (!query.trim()) {
    return <>{snippet}</>;
  }
  
  const queryLower = query.toLowerCase();
  const snippetLower = snippet.toLowerCase();
  const index = snippetLower.indexOf(queryLower);
  
  if (index === -1) {
    return <>{snippet}</>;
  }
  
  const before = snippet.slice(0, index);
  const match = snippet.slice(index, index + query.length);
  const after = snippet.slice(index + query.length);
  
  return (
    <>
      {before}
      <mark className="search-snippet-highlight">{match}</mark>
      {after}
    </>
  );
}

type WasmModule = typeof import("../../../packages/wasm/pkg/haddon_wasm");
type PublicationSession = InstanceType<WasmModule["PublicationSession"]>;

type ReadingItem = {
  href: string;
  title?: string | null;
  mediaType?: string;
};

type Props = {
  session: PublicationSession;
  initialCitation?: CitationQuery | null;
  allowDeepLinks?: boolean;
};

export default function SemanticReader({
  session,
  initialCitation,
  allowDeepLinks = false,
}: Props) {
  const rootRef = useRef<HTMLElement | null>(null);
  const blobUrls = useRef<string[]>([]);
  const visibilityTracker = useRef<VisibilityTracker | null>(null);
  const decorationManager = useRef<DecorationManager>(new DecorationManager());
  const layoutCleanup = useRef<(() => void) | null>(null);
  const [href, setHref] = useState<string | null>(null);
  const [html, setHtml] = useState("");
  const [chapters, setChapters] = useState<ReadingItem[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [citeBlockId, setCiteBlockId] = useState<string | null>(null);
  const [activeCitation, setActiveCitation] = useState<CitationQuery | null>(
    initialCitation ?? null,
  );
  const [activeLocator, setActiveLocator] = useState<PublicationLocatorV1 | null>(null);
  const [copied, setCopied] = useState(false);
  const [visibleLocation, setVisibleLocation] = useState<VisibleLocationV1 | null>(null);
  const openedCitation = useRef(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [drawerData, setDrawerData] = useState<{
    linkText: string;
    href: string;
    resolvedContent?: string | null;
    error?: string | null;
  } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchHit[]>([]);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [layoutMode, setLayoutMode] = useState<RenditionLayout>("scrolled");
  const capturedLocationBeforeSwitch = useRef<PublicationLocatorV1 | null>(null);
  const [showSelectionChip, setShowSelectionChip] = useState(false);
  const [marginNotes, setMarginNotes] = useState<Array<{
    id: string;
    locator: PublicationLocatorV1;
    quote: string;
    content: string;
  }>>([]);

  const { refs: selectionChipRefs, floatingStyles: selectionChipStyles } = useFloating({
    placement: "top",
    whileElementsMounted: autoUpdate,
    middleware: [offset(8), flip(), shift({ padding: 12 })],
    strategy: "fixed",
  });

  const revokeBlobs = useCallback(() => {
    for (const url of blobUrls.current) {
      URL.revokeObjectURL(url);
    }
    blobUrls.current = [];
  }, []);

  const rewriteResources = useCallback(
    (root: HTMLElement) => {
      revokeBlobs();
      const images = root.querySelectorAll<HTMLImageElement>("img[data-haddon-src]");
      images.forEach((img) => {
        const resourceHref = img.getAttribute("data-haddon-src");
        if (!resourceHref) return;
        try {
          const bytes = session.resource_bytes(resourceHref);
          const blob = new Blob([bytes], {
            type: resourceHref.endsWith(".svg") ? "image/svg+xml" : undefined,
          });
          const url = URL.createObjectURL(blob);
          blobUrls.current.push(url);
          img.src = url;
        } catch {
          img.replaceWith(
            Object.assign(document.createElement("span"), {
              className: "haddon-missing-media",
              textContent: img.alt || resourceHref,
            }),
          );
        }
      });
    },
    [revokeBlobs, session],
  );

  const handleLocationChange = useCallback((location: VisibleLocationV1, cause: LocationChangeCause) => {
    setVisibleLocation(location);
    console.log("[VisibilityTracker] Location changed:", {
      cause,
      href: location.current.href,
      blockId: location.current.locations.normalized?.start.blockId,
      offset: location.current.locations.normalized?.start.offset.value,
      layoutRevision: location.layoutRevision,
    });
  }, []);

  const applyCurrentLayoutMode = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;

    // Clean up previous layout mode
    if (layoutCleanup.current) {
      layoutCleanup.current();
      layoutCleanup.current = null;
    }

    const layoutOptions: LayoutModeOptions = {
      mode: layoutMode,
      columnWidth: 600,
      columnGap: 40,
      direction: "ltr",
    };

    layoutCleanup.current = applyLayoutMode(root, layoutOptions);
  }, [layoutMode]);

  const showHref = useCallback(
    (nextHref: string, fragment?: string) => {
      // Update href immediately so the UI reflects which resource we're attempting to show
      setHref(nextHref);
      
      try {
        const rendered = session.render_html(nextHref);
        setHtml(rendered);
        setError(null);
        requestAnimationFrame(() => {
          const root = rootRef.current;
          if (!root) return;
          rewriteResources(root);
          
          // Apply current layout mode
          applyCurrentLayoutMode();
          
          // Initialize or recreate visibility tracker for new content
          if (visibilityTracker.current) {
            visibilityTracker.current.destroy();
          }
          
          const locatorService = new WasmLocatorService(session);
          visibilityTracker.current = new VisibilityTracker({
            root,
            onLocationChange: handleLocationChange,
            locatorService,
          });
          
          // Apply decorations to the new DOM
          const result = decorationManager.current.applyDecorations(root);
          if (result.warnings.length > 0) {
            console.warn("[DecorationManager] Warnings:", result.warnings);
          }
          
          if (fragment) {
            const target = root.querySelector(`#${CSS.escape(fragment)}`);
            if (target instanceof HTMLElement) {
              const layoutOptions: LayoutModeOptions = {
                mode: layoutMode,
                columnWidth: 600,
                columnGap: 40,
                direction: "ltr",
              };
              scrollToElement(root, target, layoutOptions);
            }
          }
        });
        setCiteBlockId(null);
      } catch (err) {
        // Keep the failed href in state so the select shows which resource failed
        setError(err instanceof Error ? err.message : String(err));
        // Clear the old HTML so we don't show stale content with the wrong href
        setHtml("");
      }
    },
    [rewriteResources, session, handleLocationChange, layoutMode, applyCurrentLayoutMode],
  );

  const applyCitation = useCallback(
    (citation: CitationQuery, syncUrl = true) => {
      let raw: string;
      try {
        raw = session.resolve_json(citationToLocatorJson(citation), "citation");
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return;
      }
      const result = JSON.parse(raw) as ResolveResult;
      if (result.status !== "resolved" || !result.href || !result.blockId) {
        const first = session.first_linear_href();
        if (first) showHref(first);
        setStatus(
          result.reason === "resource-missing"
            ? "That link points at a different book than the one that’s open. Drop the original EPUB, or use the sample book for the moon-quote demo."
            : `Could not find that sentence (${result.reason ?? result.status}).`,
        );
        return;
      }
      const resolved: CitationQuery = {
        exact: result.exact || citation.exact,
        href: result.href,
        prefix: citation.prefix,
        suffix: citation.suffix,
        fragment: citation.fragment,
      };
      showHref(result.href);
      setActiveCitation(resolved);
      setCiteBlockId(result.blockId);
      setStatus(
        `Landed on “${result.exact ?? "the passage"}” (${result.confidence}, ${result.strategy}).`,
      );
      if (syncUrl && allowDeepLinks) {
        const next = citationHref(resolved);
        window.history.replaceState(null, "", next);
      }
    },
    [allowDeepLinks, session, showHref],
  );

  useEffect(() => {
    try {
      const items = JSON.parse(session.reading_order_json()) as ReadingItem[];
      setChapters(items);
    } catch {
      setChapters([]);
    }
    if (initialCitation) {
      if (!openedCitation.current) {
        openedCitation.current = true;
        applyCitation(initialCitation, true);
      }
    } else {
      const first = session.first_linear_href();
      if (first) showHref(first);
    }
    return () => {
      openedCitation.current = false;
      revokeBlobs();
      if (visibilityTracker.current) {
        visibilityTracker.current.destroy();
        visibilityTracker.current = null;
      }
      if (layoutCleanup.current) {
        layoutCleanup.current();
        layoutCleanup.current = null;
      }
    };
  }, [applyCitation, initialCitation, revokeBlobs, session, showHref]);

  const resolveRelativeHref = useCallback(
    (currentHref: string, reference: string): string => {
      const [refPath] = reference.split("#");
      
      if (!refPath || refPath.startsWith("#")) {
        return currentHref;
      }
      
      if (refPath.startsWith("/") || refPath.includes(":")) {
        return refPath;
      }
      
      const currentDir = currentHref.includes("/")
        ? currentHref.substring(0, currentHref.lastIndexOf("/"))
        : "";
      
      if (!currentDir) {
        return refPath;
      }
      
      return `${currentDir}/${refPath}`;
    },
    [],
  );

  const extractFragmentContent = useCallback(
    (html: string, fragmentId: string): string | null => {
      const tempDiv = document.createElement("div");
      tempDiv.innerHTML = html;
      
      let targetElement = tempDiv.querySelector(`#${CSS.escape(fragmentId)}`);
      
      if (!targetElement) {
        targetElement = tempDiv.querySelector(`[name="${CSS.escape(fragmentId)}"]`);
      }
      
      if (!targetElement) {
        const allElements = tempDiv.querySelectorAll("[id]");
        for (const el of Array.from(allElements)) {
          const id = el.getAttribute("id");
          if (id && id.includes(fragmentId)) {
            targetElement = el;
            break;
          }
        }
      }
      
      return targetElement ? targetElement.innerHTML : null;
    },
    [],
  );

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed) {
        return;
      }
      const anchor = (event.target as HTMLElement).closest("a");
      if (!anchor || !rootRef.current?.contains(anchor)) return;
      const raw = anchor.getAttribute("href");
      if (!raw) return;

      const isCitationLink = 
        anchor.classList.contains("haddon-noteref") ||
        anchor.getAttribute("role") === "doc-noteref" ||
        anchor.getAttribute("epub:type") === "noteref";

      const isInternalFragmentLink = 
        raw.startsWith("#") || 
        (!raw.startsWith("http://") && !raw.startsWith("https://") && raw.includes("#"));

      if (isCitationLink || isInternalFragmentLink) {
        event.preventDefault();
        const linkText = anchor.textContent || raw;
        const [path, fragment] = raw.split("#");
        
        const resolvedHref = path ? resolveRelativeHref(href || "", raw) : href;

        if (!resolvedHref) {
          setDrawerData({
            linkText,
            href: raw,
            error: "Could not resolve the link target.",
          });
          setDrawerOpen(true);
          return;
        }

        let resolvedContent: string | null = null;
        let lastError: string | null = null;

        try {
          const targetHtml = session.render_html(resolvedHref);
          if (fragment) {
            resolvedContent = extractFragmentContent(targetHtml, fragment);
          } else {
            resolvedContent = targetHtml;
          }
        } catch (normalizeErr) {
          try {
            const bytes = session.resource_bytes(resolvedHref);
            const decoder = new TextDecoder("utf-8");
            const rawHtml = decoder.decode(bytes);
            
            if (fragment) {
              resolvedContent = extractFragmentContent(rawHtml, fragment);
            } else {
              resolvedContent = rawHtml;
            }
          } catch (rawErr) {
            lastError = rawErr instanceof Error ? rawErr.message : "Failed to load the target.";
          }
        }

        setDrawerData({
          linkText,
          href: raw,
          resolvedContent,
          error: resolvedContent ? null : (lastError || "Couldn't load the note content."),
        });
        setDrawerOpen(true);
        return;
      }

      event.preventDefault();
      const [path, fragment] = raw.split("#");
      const target = path || href;
      if (!target) return;
      showHref(target, fragment);
    },
    [href, session, showHref, resolveRelativeHref, extractFragmentContent],
  );

  const openQuoteInNewTab = useCallback(() => {
    const citation = activeCitation ?? (allowDeepLinks ? MOON_QUOTE : null);
    if (!citation) return;
    window.open(citationHref(citation), "_blank", "noopener,noreferrer");
  }, [activeCitation, allowDeepLinks]);

  const captureSelection = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    
    const selection = window.getSelection();
    
    // Check if there's actual text selected
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      setShowSelectionChip(false);
      setActiveLocator(null);
      return;
    }
    
    // Get citation for URL/display
    const citation = citationFromDomSelection(root, selection);
    if (citation) {
      if (href && !citation.href) citation.href = href;
      setActiveCitation(citation);
      setCopied(false);
      setCiteBlockId(null);
      if (allowDeepLinks) {
        window.history.replaceState(null, "", citationHref(citation));
      }
    }
    
    // Get locator for decoration and chip positioning
    const locator = locatorFromDomSelection(root, selection);
    if (locator) {
      setActiveLocator(locator);
      
      // Position the selection chip using the native selection range
      const range = selection.getRangeAt(0);
      const rects = range.getClientRects();
      if (rects.length > 0) {
        const lastRect = rects[rects.length - 1];
        const virtualReference = {
          getBoundingClientRect: () => lastRect,
        };
        selectionChipRefs.setPositionReference(virtualReference);
        setShowSelectionChip(true);
      }
      
      // Clear previous active-citation decorations (don't apply yet - chip will handle it)
      decorationManager.current.clearGroup("active-citation");
    }
  }, [allowDeepLinks, href, selectionChipRefs]);

  const copyCitationLink = useCallback(async () => {
    if (!activeCitation) return;
    await navigator.clipboard.writeText(citationHref(activeCitation));
    setCopied(true);
  }, [activeCitation]);

  const copySelectedWords = useCallback(async () => {
    const text = activeCitation?.exact;
    if (!text) return;
    await navigator.clipboard.writeText(text);
  }, [activeCitation]);

  const handleColorSelect = useCallback((color: HighlightColor) => {
    const root = rootRef.current;
    const locator = activeLocator;
    if (!root || !locator) return;

    // Clear the native selection (visually)
    window.getSelection()?.removeAllRanges();
    
    // Hide the chip
    setShowSelectionChip(false);
    
    // Apply the decoration with the selected color
    const decoration: Decoration = {
      id: `highlight-${color}-${Date.now()}`,
      locator,
      group: "highlights",
      style: color,
    };
    decorationManager.current.setDecoration(decoration);
    decorationManager.current.applyDecorations(root);
    
    // Clear the active locator
    setActiveLocator(null);
  }, [activeLocator]);

  const handleAskAI = useCallback(() => {
    const locator = activeLocator;
    const quote = activeCitation?.exact;
    if (!locator || !quote) return;

    // Clear the native selection
    window.getSelection()?.removeAllRanges();
    
    // Hide the chip
    setShowSelectionChip(false);
    
    // Create a margin note with placeholder content
    const noteId = `note-${Date.now()}`;
    const newNote = {
      id: noteId,
      locator,
      quote,
      content: "AI explanation coming soon... This is a placeholder for the full Grok integration.",
    };
    
    setMarginNotes(prev => [...prev, newNote]);
    
    // Clear the active locator
    setActiveLocator(null);
  }, [activeLocator, activeCitation]);

  const handleRemoveNote = useCallback((noteId: string) => {
    setMarginNotes(prev => prev.filter(note => note.id !== noteId));
  }, []);

  const performSearch = useCallback(() => {
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      setSearchResults([]);
      return;
    }

    try {
      const resultsJson = session.search_json(trimmed, 50);
      const hits = JSON.parse(resultsJson) as SearchHit[];
      setSearchResults(hits);
    } catch (err) {
      console.error("Search failed:", err);
      setSearchResults([]);
    }
  }, [searchQuery, session]);

  const navigateToHit = useCallback((hit: SearchHit) => {
    showHref(hit.href);
    
    requestAnimationFrame(() => {
      const root = rootRef.current;
      if (!root) return;

      decorationManager.current.clearGroup("search-hit");
      const locator: PublicationLocatorV1 = {
        schema: "haddon.publication-locator",
        version: 1,
        href: hit.href,
        locations: {
          normalized: {
            start: {
              blockId: hit.blockId,
              offset: {
                value: hit.start,
                unit: "utf-16-code-unit",
              },
            },
            end: {
              blockId: hit.blockId,
              offset: {
                value: hit.end,
                unit: "utf-16-code-unit",
              },
            },
          },
        },
        text: {
          exact: hit.exact,
        },
      };

      const decoration: Decoration = {
        id: `search-hit-${Date.now()}`,
        locator,
        group: "search-hit",
      };
      decorationManager.current.setDecoration(decoration);

      requestAnimationFrame(() => {
        const result = decorationManager.current.applyDecorations(root);
        if (result.warnings.length > 0) {
          console.warn("[Search] Decoration warnings:", result.warnings);
        }

        const block = root.querySelector(`[data-haddon-id="${CSS.escape(hit.blockId)}"]`);
        if (block instanceof HTMLElement) {
          const layoutOptions: LayoutModeOptions = {
            mode: layoutMode,
            columnWidth: 600,
            columnGap: 40,
            direction: "ltr",
          };
          scrollToElement(root, block, layoutOptions);
        }
      });
    });
  }, [showHref, layoutMode]);

  useEffect(() => {
    if (!citeBlockId || !html) return;
    const root = rootRef.current;
    if (!root) return;
    root
      .querySelectorAll(".haddon-cited")
      .forEach((node) => node.classList.remove("haddon-cited"));
    const target = root.querySelector(
      `[data-haddon-id="${CSS.escape(citeBlockId)}"]`,
    );
    if (!target) return;
    target.classList.add("haddon-cited");
    target.querySelector("em")?.classList.add("haddon-cited");
    
    if (target instanceof HTMLElement) {
      const layoutOptions: LayoutModeOptions = {
        mode: layoutMode,
        columnWidth: 600,
        columnGap: 40,
        direction: "ltr",
      };
      scrollToElement(root, target, layoutOptions);
    }
  }, [citeBlockId, html, layoutMode]);

  const switchLayoutMode = useCallback(
    async (newMode: RenditionLayout) => {
      if (newMode === layoutMode) return;

      // Capture current location before switching
      if (visibleLocation) {
        capturedLocationBeforeSwitch.current = visibleLocation.current;
      }

      setLayoutMode(newMode);

      // Wait for layout to apply
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Restore location after mode switch
      if (capturedLocationBeforeSwitch.current && visibilityTracker.current) {
        try {
          await visibilityTracker.current.incrementLayoutRevision("preferences");
          console.log("[LayoutMode] Switched to", newMode, "and preserved location");
        } catch (err) {
          console.warn("[LayoutMode] Failed to restore location after mode switch:", err);
        }
      }

      capturedLocationBeforeSwitch.current = null;
    },
    [layoutMode, visibleLocation],
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "f") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Apply layout mode when it changes
  useEffect(() => {
    if (html && rootRef.current) {
      applyCurrentLayoutMode();
    }
  }, [layoutMode, html, applyCurrentLayoutMode]);

  return (
    <div className="semantic-reader">
      <SourceDrawer
        isOpen={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        linkText={drawerData?.linkText || ""}
        href={drawerData?.href || ""}
        resolvedContent={drawerData?.resolvedContent}
        error={drawerData?.error}
      />
      {showSelectionChip && activeLocator && (
        <SelectionChip
          floatingRef={selectionChipRefs.setFloating}
          floatingStyles={selectionChipStyles}
          onColorSelect={handleColorSelect}
          onAskAI={handleAskAI}
        />
      )}
      <div className="reader-controls">
        <div className="layout-mode-toggle">
          <button
            type="button"
            className={layoutMode === "scrolled" ? "active" : ""}
            onClick={() => void switchLayoutMode("scrolled")}
          >
            Scroll
          </button>
          <button
            type="button"
            className={layoutMode === "paginated" ? "active" : ""}
            onClick={() => void switchLayoutMode("paginated")}
          >
            Pages
          </button>
        </div>
      </div>
      <div className="search-bar">
        <input
          ref={searchInputRef}
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              performSearch();
            }
          }}
          placeholder="Search in this book (Cmd/Ctrl-F)"
          className="search-input"
        />
        <button type="button" onClick={performSearch} className="search-button">
          Search
        </button>
        {searchResults.length > 0 && (
          <span className="search-count">
            {searchResults.length} {searchResults.length === 1 ? "result" : "results"}
          </span>
        )}
      </div>
      {searchResults.length > 0 && (
        <div className="search-results">
          {searchResults.map((hit, index) => (
            <button
              key={`${hit.href}-${hit.blockId}-${hit.start}-${index}`}
              type="button"
              className="search-result-item"
              onClick={() => navigateToHit(hit)}
            >
              <div className="search-result-href">{hit.href}</div>
              <div className="search-result-snippet">{highlightSnippet(hit.snippet, searchQuery)}</div>
            </button>
          ))}
        </div>
      )}
      <div className="semantic-toolbar">
        {allowDeepLinks && (
          <button type="button" onClick={() => applyCitation(MOON_QUOTE)}>
            Find the moon quote
          </button>
        )}

        {chapters.length > 8 ? (
          <select
            className="chapter-select"
            value={href ?? ""}
            onChange={(event) => showHref(event.target.value)}
          >
            {chapters.map((chapter) => (
              <option key={chapter.href} value={chapter.href}>
                {chapter.title || chapter.href}
              </option>
            ))}
          </select>
        ) : (
          chapters.map((chapter) => (
            <button
              key={chapter.href}
              type="button"
              className={chapter.href === href ? "active" : ""}
              onClick={() => showHref(chapter.href)}
            >
              {chapter.title || chapter.href}
            </button>
          ))
        )}
      </div>
      {activeCitation && (
        <div className="citation-bar">
          <p>
            You selected “{activeCitation.exact.length > 160
              ? `${activeCitation.exact.slice(0, 160)}…`
              : activeCitation.exact}
            ”
          </p>
          <div className="citation-bar-actions">
            <button type="button" onClick={() => void copySelectedWords()}>
              Copy the words
            </button>
            <button type="button" onClick={() => void copyCitationLink()}>
              {copied ? "Copied link" : "Copy a link to this sentence"}
            </button>
            {allowDeepLinks && isSampleHref(activeCitation.href) && (
              <button type="button" onClick={openQuoteInNewTab}>
                Open that link in a new tab
              </button>
            )}
          </div>
        </div>
      )}
      {status && <p className="semantic-status">{status}</p>}
      {error && <p className="error">{error}</p>}
      {visibleLocation && (
        <div className="visibility-debug" style={{ 
          position: "fixed", 
          bottom: "10px", 
          right: "10px", 
          padding: "8px", 
          background: "rgba(0,0,0,0.8)", 
          color: "#fff", 
          fontSize: "11px",
          borderRadius: "4px",
          maxWidth: "300px",
          zIndex: 1000,
        }}>
          <div>📍 Location: {visibleLocation.current.href}</div>
          {visibleLocation.current.locations.normalized && (
            <div>
              Block: {visibleLocation.current.locations.normalized.start.blockId.substring(0, 20)}...
              @ {visibleLocation.current.locations.normalized.start.offset.value}
            </div>
          )}
          <div>Layout Rev: {visibleLocation.layoutRevision}</div>
          <div>Segments: {visibleLocation.segments.length}</div>
        </div>
      )}
      <div className="reader-with-margin">
        <ArticleBody
          html={html}
          rootRef={rootRef}
          onClick={handleClick}
          onMouseUp={captureSelection}
          layoutMode={layoutMode}
        />
        <div className="margin-notes-container">
          {marginNotes.map(note => (
            <MarginNote
              key={note.id}
              articleRoot={rootRef.current}
              locator={note.locator}
              quote={note.quote}
              content={note.content}
              onClose={() => handleRemoveNote(note.id)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

const ArticleBody = memo(function ArticleBody({
  html,
  rootRef,
  onClick,
  onMouseUp,
  layoutMode,
}: {
  html: string;
  rootRef: React.RefObject<HTMLElement | null>;
  onClick: (event: React.MouseEvent<HTMLElement>) => void;
  onMouseUp: () => void;
  layoutMode: RenditionLayout;
}) {
  return (
    <article
      ref={rootRef}
      className="haddon-article"
      data-layout-mode={layoutMode}
      onClick={onClick}
      onMouseUp={onMouseUp}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
});
