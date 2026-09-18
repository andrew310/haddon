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
import { VisibilityTracker } from "../../../packages/haddon-navigator/src/visibility-tracker";
import { DecorationManager, type Decoration } from "../../../packages/haddon-navigator/src/decoration-manager";
import { applyLayoutMode, scrollToElement, type LayoutModeOptions } from "../../../packages/haddon-navigator/src/layout-modes";
import { WasmLocatorService } from "./LocatorService";
import type { VisibleLocationV1, LocationChangeCause, PublicationLocatorV1, RenditionLayout } from "../../../packages/haddon-navigator/src/types";
import { SourceDrawer } from "./SourceDrawer";
import { SelectionChip, type HighlightColor } from "./SelectionChip";
import { MarginNote } from "./MarginNote";
import { enrichReadingOrderWithToc, type ReadingItem, type TocEntry } from "./toc";
import {
  emptyAnnotations,
  loadAnnotations,
  saveAnnotations,
  type AnnotationStoreV1,
  type MarginNoteRecord,
} from "./annotations";
import { ReaderTypography } from "./ReaderTypography";
import {
  loadReaderPrefs,
  readerPrefsCssVars,
  readerPrefsSignature,
  saveReaderPrefs,
  subscribeReaderPrefs,
  type ReaderPrefsV1,
} from "./reader-prefs";
import "./SemanticReader.css";

type SearchHit = {
  href: string;
  blockId: string;
  start: number;
  end: number;
  exact: string;
  snippet: string;
};

function highlightSnippet(snippet: string, exact: string): JSX.Element {
  if (!exact) {
    return <>{snippet}</>;
  }

  const index = snippet.indexOf(exact);
  if (index === -1) {
    return <>{snippet}</>;
  }

  const before = snippet.slice(0, index);
  const match = snippet.slice(index, index + exact.length);
  const after = snippet.slice(index + exact.length);

  return (
    <>
      {before}
      <mark className="search-snippet-highlight">{match}</mark>
      {after}
    </>
  );
}

type SearchPayload = { cancelled: true } | { cancelled: false; hits: SearchHit[] };

function parseSearchPayload(json: string): SearchPayload {
  const parsed: unknown = JSON.parse(json);
  if (
    parsed !== null &&
    typeof parsed === "object" &&
    !Array.isArray(parsed) &&
    "cancelled" in parsed &&
    (parsed as { cancelled?: unknown }).cancelled === true
  ) {
    return { cancelled: true };
  }
  if (!Array.isArray(parsed)) {
    return { cancelled: false, hits: [] };
  }
  return { cancelled: false, hits: parsed as SearchHit[] };
}

type WasmModule = typeof import("../../../packages/wasm/pkg/haddon_wasm");
type PublicationSession = InstanceType<WasmModule["PublicationSession"]>;

type Props = {
  session: PublicationSession;
  initialCitation?: CitationQuery | null;
  allowDeepLinks?: boolean;
  storageKey?: string;
  onAnnotationsChange?: (store: AnnotationStoreV1) => void;
  debugLocation?: boolean;
  showMarginNotes?: boolean;
};

export default function SemanticReader({
  session,
  initialCitation,
  allowDeepLinks = false,
  storageKey,
  onAnnotationsChange,
  debugLocation = false,
  showMarginNotes = true,
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
  const [searching, setSearching] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchGenRef = useRef(0);
  const [layoutMode, setLayoutMode] = useState<RenditionLayout>("scrolled");
  const capturedLocationBeforeSwitch = useRef<PublicationLocatorV1 | null>(null);
  const [prefs, setPrefs] = useState<ReaderPrefsV1>(() => loadReaderPrefs());
  const skipPrefsRevision = useRef(true);
  const prefsSignature = readerPrefsSignature(prefs);
  const articleStyle = readerPrefsCssVars(prefs) as React.CSSProperties;
  const [showSelectionChip, setShowSelectionChip] = useState(false);
  const [marginNotes, setMarginNotes] = useState<MarginNoteRecord[]>([]);
  const onAnnotationsChangeRef = useRef(onAnnotationsChange);
  onAnnotationsChangeRef.current = onAnnotationsChange;
  const persistAnnotations = useCallback(
    (notes: MarginNoteRecord[], currentHref: string | null) => {
      const store: AnnotationStoreV1 = {
        schema: "haddon.annotations",
        version: 1,
        href: currentHref,
        highlights: [...decorationManager.current.getDecorationsByGroup("highlights")],
        notes,
      };
      if (storageKey) {
        saveAnnotations(storageKey, store);
      }
      onAnnotationsChangeRef.current?.(store);
    },
    [storageKey],
  );

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

  const layoutOptionsFor = useCallback(
    (root?: HTMLElement | null): LayoutModeOptions => ({
      mode: layoutMode,
      columnWidth: Math.max(320, root?.clientWidth || 600),
      columnGap: 40,
      direction: "ltr",
    }),
    [layoutMode],
  );

  const applyCurrentLayoutMode = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;

    // Clean up previous layout mode
    if (layoutCleanup.current) {
      layoutCleanup.current();
      layoutCleanup.current = null;
    }

    layoutCleanup.current = applyLayoutMode(root, layoutOptionsFor(root));
  }, [layoutOptionsFor]);

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
              scrollToElement(root, target, layoutOptionsFor(root));
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
    [rewriteResources, session, handleLocationChange, applyCurrentLayoutMode, layoutOptionsFor],
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

  const showHrefRef = useRef(showHref);
  showHrefRef.current = showHref;
  const applyCitationRef = useRef(applyCitation);
  applyCitationRef.current = applyCitation;

  useEffect(() => {
    decorationManager.current = new DecorationManager();
    try {
      const items = JSON.parse(session.reading_order_json()) as ReadingItem[];
      let toc: TocEntry[] = [];
      try {
        const withToc = session as PublicationSession & { toc_json?: () => string };
        toc = JSON.parse(withToc.toc_json?.() ?? "[]") as TocEntry[];
      } catch {
        toc = [];
      }
      setChapters(enrichReadingOrderWithToc(items, toc));
    } catch {
      setChapters([]);
    }

    const stored = storageKey ? loadAnnotations(storageKey) : emptyAnnotations();
    for (const decoration of stored.highlights) {
      decorationManager.current.setDecoration(decoration);
    }
    setMarginNotes(stored.notes);
    onAnnotationsChangeRef.current?.(stored);

    if (initialCitation) {
      if (!openedCitation.current) {
        openedCitation.current = true;
        applyCitationRef.current(initialCitation, true);
      }
    } else {
      try {
        const first = stored.href || session.first_linear_href();
        if (first) showHrefRef.current(first);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
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
  }, [
    initialCitation,
    revokeBlobs,
    session,
    storageKey,
  ]);

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
      const fallback = range.getBoundingClientRect();
      const lastRect = rects.length > 0 ? rects[rects.length - 1] : fallback;
      if (lastRect && lastRect.width + lastRect.height > 0) {
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

    // Find overlapping highlights
    const overlapping = decorationManager.current.findOverlappingDecorations(locator, "highlights");
    
    // Get IDs of highlights that have margin notes (should be preserved)
    const highlightsWithNotes = new Set(
      marginNotes.map(note => note.highlightId).filter(Boolean)
    );
    
    // Remove overlapping highlights that don't have margin notes
    for (const overlap of overlapping) {
      if (!highlightsWithNotes.has(overlap.id)) {
        decorationManager.current.removeDecoration(overlap.id);
      }
    }

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
    persistAnnotations(marginNotes, href);
  }, [activeLocator, href, marginNotes, persistAnnotations]);

  const handleAskAI = useCallback(() => {
    const root = rootRef.current;
    const locator = activeLocator;
    const quote = activeCitation?.exact;
    if (!root || !locator || !quote) return;

    // Find overlapping highlights without notes and remove them
    const overlapping = decorationManager.current.findOverlappingDecorations(locator, "highlights");
    const highlightsWithNotes = new Set(
      marginNotes.map(note => note.highlightId).filter(Boolean)
    );
    
    for (const overlap of overlapping) {
      if (!highlightsWithNotes.has(overlap.id)) {
        decorationManager.current.removeDecoration(overlap.id);
      }
    }

    // Clear the native selection
    window.getSelection()?.removeAllRanges();
    
    // Hide the chip
    setShowSelectionChip(false);
    
    // Create a highlight decoration for the Ask AI note (default to yellow)
    const highlightId = `highlight-note-${Date.now()}`;
    const decoration: Decoration = {
      id: highlightId,
      locator,
      group: "highlights",
      style: "yellow",
    };
    decorationManager.current.setDecoration(decoration);
    decorationManager.current.applyDecorations(root);
    
    // Create a margin note linked to the highlight
    const noteId = `note-${Date.now()}`;
    const newNote = {
      id: noteId,
      locator,
      quote,
      content: "AI explanation coming soon... This is a placeholder for the full Grok integration.",
      highlightId,
    };
    
    const nextNotes = [...marginNotes, newNote];
    setMarginNotes(nextNotes);
    
    // Clear the active locator
    setActiveLocator(null);
    persistAnnotations(nextNotes, href);
  }, [activeLocator, activeCitation, href, marginNotes, persistAnnotations]);

  const handleRemoveNote = useCallback((noteId: string) => {
    const root = rootRef.current;
    
    // Find the note to get its associated highlight ID
    const note = marginNotes.find(n => n.id === noteId);
    
    const nextNotes = marginNotes.filter((n) => n.id !== noteId);
    setMarginNotes(nextNotes);
    
    // Remove the associated highlight decoration if it exists
    if (note?.highlightId && root) {
      decorationManager.current.removeDecoration(note.highlightId);
      decorationManager.current.applyDecorations(root);
    }
    persistAnnotations(nextNotes, href);
  }, [href, marginNotes, persistAnnotations]);

  const runSearch = useCallback(
    async (query: string, gen: number, wasmGen: number) => {
      const trimmed = query.trim();
      if (!trimmed) {
        setSearchResults([]);
        setSearching(false);
        return;
      }

      setSearching(true);
      try {
        const items = JSON.parse(session.reading_order_json()) as { href: string }[];
        const hits: SearchHit[] = [];
        for (const item of items) {
          if (gen !== searchGenRef.current) {
            return;
          }
          const remaining = 50 - hits.length;
          if (remaining <= 0) {
            break;
          }
          const json = session.search_resource_json(item.href, trimmed, remaining, wasmGen);
          const payload = parseSearchPayload(json);
          if (payload.cancelled) {
            return;
          }
          hits.push(...payload.hits);
          await new Promise((resolve) => setTimeout(resolve, 0));
        }
        if (gen !== searchGenRef.current) {
          return;
        }
        setSearchResults(hits);
      } catch (err) {
        if (gen !== searchGenRef.current) {
          return;
        }
        console.error("Search failed:", err);
        setSearchResults([]);
      } finally {
        if (gen === searchGenRef.current) {
          setSearching(false);
        }
      }
    },
    [session],
  );

  const startSearch = useCallback(
    (query: string) => {
      const gen = ++searchGenRef.current;
      session.cancel_search();
      const wasmGen = session.begin_search();
      return runSearch(query, gen, wasmGen);
    },
    [runSearch, session],
  );

  const performSearch = useCallback(() => {
    void startSearch(searchQuery);
  }, [searchQuery, startSearch]);

  const cancelSearch = useCallback(() => {
    searchGenRef.current += 1;
    session.cancel_search();
    setSearching(false);
  }, [session]);

  useEffect(() => {
    const gen = ++searchGenRef.current;
    session.cancel_search();
    const trimmed = searchQuery.trim();
    if (!trimmed) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    const wasmGen = session.begin_search();
    const timer = window.setTimeout(() => {
      void runSearch(searchQuery, gen, wasmGen);
    }, 180);
    return () => {
      window.clearTimeout(timer);
      session.cancel_search();
    };
  }, [runSearch, searchQuery, session]);

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
          scrollToElement(root, block, layoutOptionsFor(root));
        }
      });
    });
  }, [showHref, layoutOptionsFor]);

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
      scrollToElement(root, target, layoutOptionsFor(root));
    }
  }, [citeBlockId, html, layoutOptionsFor]);

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

  // Apply layout and locator-backed decorations after React commits HTML.
  useEffect(() => {
    const root = rootRef.current;
    if (!html || !root) return;
    rewriteResources(root);
    applyCurrentLayoutMode();
    const result = decorationManager.current.applyDecorations(root);
    if (result.warnings.length > 0) {
      console.warn("[DecorationManager] Warnings:", result.warnings);
    }
  }, [layoutMode, html, applyCurrentLayoutMode, rewriteResources]);

  useEffect(() => {
    if (!href || !storageKey) return;
    persistAnnotations(marginNotes, href);
  }, [href, marginNotes, persistAnnotations, storageKey]);

  useEffect(() => subscribeReaderPrefs(setPrefs), []);

  // Keyed on prefs signature only; layout-mode switches restore location themselves.
  useEffect(() => {
    applyCurrentLayoutMode();
    if (skipPrefsRevision.current) {
      skipPrefsRevision.current = false;
      return;
    }
    const tracker = visibilityTracker.current;
    if (!tracker) return;
    void tracker.incrementLayoutRevision("preferences");
  }, [prefsSignature]);

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
        <ReaderTypography
          prefs={prefs}
          onChange={(next) => setPrefs(saveReaderPrefs(next))}
        />
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
        {searching && (
          <>
            <span className="search-status">Searching…</span>
            <button type="button" onClick={cancelSearch} className="search-cancel">
              Cancel
            </button>
          </>
        )}
        {!searching && searchResults.length > 0 && (
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
              <div className="search-result-snippet">{highlightSnippet(hit.snippet, hit.exact)}</div>
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
      {debugLocation && visibleLocation && (
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
          <div>Location: {visibleLocation.current.href}</div>
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
      <div className={`reader-with-margin${showMarginNotes && marginNotes.length > 0 ? ' has-notes' : ''}`}>
        <ArticleBody
          html={html}
          rootRef={rootRef}
          onClick={handleClick}
          onMouseUp={captureSelection}
          layoutMode={layoutMode}
          theme={prefs.theme}
          font={prefs.font}
          articleStyle={articleStyle}
        />
        {showMarginNotes ? (
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
        ) : null}
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
  theme,
  font,
  articleStyle,
}: {
  html: string;
  rootRef: React.RefObject<HTMLElement | null>;
  onClick: (event: React.MouseEvent<HTMLElement>) => void;
  onMouseUp: () => void;
  layoutMode: RenditionLayout;
  theme: ReaderPrefsV1["theme"];
  font: ReaderPrefsV1["font"];
  articleStyle: React.CSSProperties;
}) {
  return (
    <article
      ref={rootRef}
      className="haddon-article"
      data-layout-mode={layoutMode}
      data-reader-theme={theme}
      data-reader-font={font}
      style={articleStyle}
      onClick={onClick}
      onMouseUp={onMouseUp}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
});
