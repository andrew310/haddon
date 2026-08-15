import { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  type CitationQuery,
  MOON_QUOTE,
  citationHref,
  citationToLocatorJson,
  isSampleHref,
} from "./citationLink";
import { citationFromDomSelection } from "./selectionCitation";
import { openCitation } from "../../../packages/haddon-citation-router/open-citation";

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
  const [href, setHref] = useState<string | null>(null);
  const [html, setHtml] = useState("");
  const [chapters, setChapters] = useState<ReadingItem[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [citeBlockId, setCiteBlockId] = useState<string | null>(null);
  const [activeCitation, setActiveCitation] = useState<CitationQuery | null>(
    initialCitation ?? null,
  );
  const [copied, setCopied] = useState(false);
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
    [rewriteResources, session],
  );

  const applyCitation = useCallback(
    (citation: CitationQuery, syncUrl = true) => {
      // Build a minimal envelope for the citation router
      const envelope = {
        schema: "haddon.citation-envelope" as const,
        version: 1 as const,
        volumeId: "demo-volume",
        sourceRevision: "unknown",
        locator: {
          schema: "haddon.publication-locator" as const,
          version: 1 as const,
          href: citation.href || "text/chapter-1.xhtml",
          mediaType: "application/xhtml+xml",
          locations: citation.fragment ? { fragments: [citation.fragment] } : {},
          text: {
            exact: citation.exact,
            ...(citation.prefix ? { prefix: citation.prefix } : {}),
            ...(citation.suffix ? { suffix: citation.suffix } : {}),
          },
        },
        confidence: "exact" as const,
      };

      // Use the new citation router
      const result = openCitation(envelope, session);

      if (result.status === "unresolved") {
        const first = session.first_linear_href();
        if (first) showHref(first);
        setStatus(
          result.reason === "resource-missing"
            ? "That link points at a different book than the one that is open. Drop the original EPUB, or use the sample book for the moon-quote demo."
            : `Could not find that sentence (${result.reason}).`,
        );
        setError(null);
        return;
      }

      if (result.status === "ambiguous") {
        // For now, just use the first candidate
        const target = result.candidates[0];
        showHref(target.href);
        setCiteBlockId(target.blockId || null);
        setStatus(
          `Found multiple matches for "${target.exact ?? citation.exact}". Showing the first one. (ambiguous)`,
        );
        setError(null);
        const resolved: CitationQuery = {
          exact: target.exact || citation.exact,
          href: target.href,
          prefix: citation.prefix,
          suffix: citation.suffix,
          fragment: citation.fragment,
        };
        setActiveCitation(resolved);
        if (syncUrl && allowDeepLinks) {
          const next = citationHref(resolved);
          window.history.replaceState(null, "", next);
        }
        return;
      }

      // Exact or recovered
      const target = result.status === "exact" ? result.target : result.target;
      const resolved: CitationQuery = {
        exact: target.exact || citation.exact,
        href: target.href,
        prefix: citation.prefix,
        suffix: citation.suffix,
        fragment: citation.fragment,
      };

      showHref(target.href);
      setActiveCitation(resolved);
      setCiteBlockId(target.blockId || null);
      setError(null);

      if (result.status === "recovered") {
        setStatus(
          `Landed on "${target.exact ?? "the passage"}" (recovered: ${result.evidence.message}).`,
        );
      } else {
        setStatus(
          `Landed on "${target.exact ?? "the passage"}" (exact match).`,
        );
      }

      if (syncUrl && allowDeepLinks) {
        const next = citationHref(resolved);
        window.history.replaceState(null, "", next);
      }
    },
    [allowDeepLinks, session, showHref],
  );

  const openQuoteInNewTab = useCallback(() => {
    const citation = activeCitation ?? (allowDeepLinks ? MOON_QUOTE : null);
    if (!citation) return;
    window.open(citationHref(citation), "_blank", "noopener,noreferrer");
  }, [activeCitation, allowDeepLinks]);

  const captureSelection = useCallback(() => {
    const root = rootRef.current;
    const citation = citationFromDomSelection(root, window.getSelection());
    if (!citation) return;
    if (href && !citation.href) citation.href = href;
    setActiveCitation(citation);
    setCopied(false);
    setCiteBlockId(null);
    if (allowDeepLinks) {
      window.history.replaceState(null, "", citationHref(citation));
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
