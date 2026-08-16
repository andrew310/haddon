import { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  type CitationQuery,
  MOON_QUOTE,
  citationHref,
  citationToLocatorJson,
  isSampleHref,
} from "./citationLink";
import { citationFromDomSelection, locatorFromDomSelection } from "./selectionCitation";
import { VisibilityTracker } from "../../../packages/haddon-navigator/src/visibility-tracker";
import { DecorationManager, type Decoration } from "../../../packages/haddon-navigator/src/decoration-manager";
import { WasmLocatorService } from "./LocatorService";
import type { VisibleLocationV1, LocationChangeCause, PublicationLocatorV1 } from "../../../packages/haddon-navigator/src/types";

type WasmModule = typeof import("../../../packages/wasm/pkg/haddon_wasm");
type PublicationSession = InstanceType<WasmModule["PublicationSession"]>;

type ReadingItem = {
  href: string;
  title?: string | null;
  mediaType?: string;
};

type ResolveResult = {
  status: string;
  strategy?: string;
  confidence?: string;
  blockId?: string;
  start?: number;
  end?: number;
  href?: string;
  exact?: string;
  reason?: string;
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

  const showHref = useCallback(
    (nextHref: string, fragment?: string) => {
      try {
        const rendered = session.render_html(nextHref);
        setHref(nextHref);
        setHtml(rendered);
        setError(null);
        requestAnimationFrame(() => {
          const root = rootRef.current;
          if (!root) return;
          rewriteResources(root);
          
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
            root.querySelector(`#${CSS.escape(fragment)}`)?.scrollIntoView({
              behavior: "smooth",
              block: "center",
            });
          }
        });
        setCiteBlockId(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [rewriteResources, session, handleLocationChange],
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
    };
  }, [applyCitation, initialCitation, revokeBlobs, session, showHref]);

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
      event.preventDefault();
      const [path, fragment] = raw.split("#");
      const target = path || href;
      if (!target) return;
      showHref(target, fragment);
    },
    [href, showHref],
  );

  const openQuoteInNewTab = useCallback(() => {
    const citation = activeCitation ?? (allowDeepLinks ? MOON_QUOTE : null);
    if (!citation) return;
    window.open(citationHref(citation), "_blank", "noopener,noreferrer");
  }, [activeCitation, allowDeepLinks]);

  const captureSelection = useCallback(() => {
    const root = rootRef.current;
    const selection = window.getSelection();
    
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
    
    // Get locator for decoration
    const locator = locatorFromDomSelection(root, selection);
    if (locator) {
      setActiveLocator(locator);
      
      // Clear previous active-citation decorations and add the new one
      decorationManager.current.clearGroup("active-citation");
      const decoration: Decoration = {
        id: `selection-${Date.now()}`,
        locator,
        group: "active-citation",
      };
      decorationManager.current.setDecoration(decoration);
      
      // Reapply decorations to the DOM
      if (root) {
        decorationManager.current.applyDecorations(root);
      }
    }
  }, [allowDeepLinks, href]);

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
    target.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [citeBlockId, html]);

  return (
    <div className="semantic-reader">
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
      <ArticleBody
        html={html}
        rootRef={rootRef}
        onClick={handleClick}
        onMouseUp={captureSelection}
      />
    </div>
  );
}

const ArticleBody = memo(function ArticleBody({
  html,
  rootRef,
  onClick,
  onMouseUp,
}: {
  html: string;
  rootRef: React.RefObject<HTMLElement | null>;
  onClick: (event: React.MouseEvent<HTMLElement>) => void;
  onMouseUp: () => void;
}) {
  return (
    <article
      ref={rootRef}
      className="haddon-article"
      onClick={onClick}
      onMouseUp={onMouseUp}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
});
