import type { CitationQuery } from "./citationLink";
import type { PublicationLocatorV1 } from "../../../packages/haddon-navigator/src/types";

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

/**
 * Convert a DOM selection to a PublicationLocatorV1.
 * 
 * This extends citationFromDomSelection to produce a full locator object
 * with normalized block selectors suitable for decoration identity.
 */
export function locatorFromDomSelection(
  root: HTMLElement,
  selection: Selection | null,
): PublicationLocatorV1 | null {
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
    return null;
  }
  
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) {
    return null;
  }
  
  const block = closestCitedBlock(range.commonAncestorContainer, root);
  if (!block) return null;
  
  const blockId = block.getAttribute("data-haddon-id");
  if (!blockId) return null;
  
  const href =
    root.querySelector("[data-haddon-href]")?.getAttribute("data-haddon-href") ||
    root.getAttribute("data-haddon-href") ||
    "unknown.xhtml";
  
  // Calculate text offsets within the block
  const blockText = block.textContent ?? "";
  const selectedText = selection.toString();
  const { prefix, suffix } = contextAround(blockText, selectedText) ?? {};
  
  // Calculate UTF-16 offset of the selection start within the block
  const startOffset = calculateSelectionOffset(block, range.startContainer, range.startOffset);
  const endOffset = calculateSelectionOffset(block, range.endContainer, range.endOffset);
  
  return {
    schema: "haddon.publication-locator",
    version: 1,
    href,
    mediaType: "application/xhtml+xml",
    locations: {
      normalized: {
        revision: "v1", // TODO: Get actual revision from session
        start: {
          blockId,
          offset: {
            value: startOffset,
            unit: "utf16-code-unit",
          },
        },
        end: endOffset !== startOffset ? {
          blockId,
          offset: {
            value: endOffset,
            unit: "utf16-code-unit",
          },
        } : undefined,
      },
      fragments: block.id ? [block.id] : undefined,
    },
    text: {
      exact: selectedText,
      prefix,
      suffix,
    },
  };
}

/**
 * Calculate the UTF-16 text offset of a DOM position within a block element.
 */
function calculateSelectionOffset(
  blockElement: HTMLElement,
  targetNode: Node,
  targetOffset: number
): number {
  const walker = document.createTreeWalker(
    blockElement,
    NodeFilter.SHOW_TEXT,
    null
  );
  
  let utf16Offset = 0;
  while (walker.nextNode()) {
    const textNode = walker.currentNode as Text;
    if (textNode === targetNode) {
      // Found the target text node, add the offset within it
      const text = textNode.textContent || "";
      return utf16Offset + text.substring(0, targetOffset).length;
    }
    // Add this entire text node's length
    utf16Offset += (textNode.textContent || "").length;
  }
  
  return utf16Offset;
}
