import type { CitationQuery } from "./citationLink";

const CONTEXT = 48;

export function contextAround(
  blockText: string,
  exact: string,
  windowSize = CONTEXT,
): { prefix?: string; suffix?: string } | null {
  const haystack = collapseSpace(blockText);
  const needle = collapseSpace(exact);
  if (!needle) return null;
  const index = haystack.indexOf(needle);
  if (index < 0) return null;
  const prefix = haystack.slice(Math.max(0, index - windowSize), index);
  const suffix = haystack.slice(
    index + needle.length,
    index + needle.length + windowSize,
  );
  return {
    ...(prefix ? { prefix } : {}),
    ...(suffix ? { suffix } : {}),
  };
}

export function citationFromBlockText(input: {
  blockText: string;
  exact: string;
  href?: string;
  fragment?: string;
}): CitationQuery | null {
  const exact = collapseSpace(input.exact).trim();
  if (!exact) return null;
  const around = contextAround(input.blockText, exact);
  return {
    exact,
    ...(input.href ? { href: input.href } : {}),
    ...(input.fragment ? { fragment: input.fragment } : {}),
    ...(around ?? {}),
  };
}

export function collapseSpace(value: string): string {
  return value.replace(/\s+/g, " ");
}

export function citationFromDomSelection(
  root: HTMLElement,
  selection: Selection | null,
): CitationQuery | null {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return null;
  }
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) {
    return null;
  }
  const block = closestCitedBlock(range.commonAncestorContainer, root);
  if (!block) return null;
  const href =
    root.querySelector("[data-haddon-href]")?.getAttribute("data-haddon-href") ||
    root.getAttribute("data-haddon-href") ||
    undefined;
  return citationFromBlockText({
    blockText: block.textContent ?? "",
    exact: selection.toString(),
    href,
    fragment: block.id || undefined,
  });
}

const INLINE_TAGS = new Set([
  "A",
  "B",
  "CITE",
  "EM",
  "I",
  "SMALL",
  "SPAN",
  "STRONG",
  "SUB",
  "SUP",
]);

function closestCitedBlock(
  node: Node,
  root: HTMLElement,
): HTMLElement | null {
  let current: Node | null = node.nodeType === Node.TEXT_NODE ? node.parentNode : node;
  let fallback: HTMLElement | null = null;
  while (current && current !== root) {
    if (current instanceof HTMLElement && current.hasAttribute("data-haddon-id")) {
      if (!INLINE_TAGS.has(current.tagName)) {
        return current;
      }
      fallback = current;
    }
    current = current.parentNode;
  }
  return fallback;
}
