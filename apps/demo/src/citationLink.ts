export type CitationQuery = {
  href?: string;
  exact: string;
  prefix?: string;
  suffix?: string;
  fragment?: string;
};

const DEFAULT_HREF = "text/chapter-1.xhtml";
const DEFAULT_MEDIA_TYPE = "application/xhtml+xml";

export function isSampleHref(href: string | undefined): boolean {
  if (!href) return false;
  return (
    href.startsWith("text/chapter-") ||
    href.startsWith("text/notes") ||
    href === "text/chapter-1.xhtml"
  );
}

export function searchToCitation(params: URLSearchParams): CitationQuery | null {
  const exact = params.get("exact")?.trim();
  if (!exact) return null;
  const citation: CitationQuery = { exact };
  const href = params.get("href");
  const prefix = params.get("prefix");
  const suffix = params.get("suffix");
  const fragment = params.get("fragment");
  if (href) citation.href = href;
  if (prefix) citation.prefix = prefix;
  if (suffix) citation.suffix = suffix;
  if (fragment) citation.fragment = fragment;
  return citation;
}

export function citationToSearch(citation: CitationQuery): URLSearchParams {
  const params = new URLSearchParams();
  params.set("exact", citation.exact);
  if (citation.href) params.set("href", citation.href);
  if (citation.prefix) params.set("prefix", citation.prefix);
  if (citation.suffix) params.set("suffix", citation.suffix);
  if (citation.fragment) params.set("fragment", citation.fragment);
  if (isSampleHref(citation.href)) params.set("book", "sample");
  return params;
}

export function citationHref(
  citation: CitationQuery,
  base = `${window.location.origin}${window.location.pathname}`,
): string {
  return `${base}?${citationToSearch(citation).toString()}`;
}

export function citationToLocatorJson(citation: CitationQuery): string {
  const locations: { fragments?: string[] } = {};
  if (citation.fragment) {
    locations.fragments = [citation.fragment];
  }
  return JSON.stringify({
    schema: "haddon.publication-locator",
    version: 1,
    href: citation.href || DEFAULT_HREF,
    mediaType: DEFAULT_MEDIA_TYPE,
    locations,
    text: {
      exact: citation.exact,
      ...(citation.prefix ? { prefix: citation.prefix } : {}),
      ...(citation.suffix ? { suffix: citation.suffix } : {}),
    },
  });
}

export const MOON_QUOTE: CitationQuery = {
  href: "text/chapter-1.xhtml",
  fragment: "citation-target",
  exact: "the patient moon answered in blue",
  prefix: "Before the signal, the copper astrolabe clicked once; ",
  suffix: ", and the lesson continued after midnight.",
};
