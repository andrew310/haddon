export type TocEntry = {
  href: string;
  title?: string | null;
  children?: TocEntry[];
};

export type ReadingItem = {
  href: string;
  title?: string | null;
  mediaType?: string;
};

function hrefPath(href: string): string {
  return href.split("#")[0] ?? href;
}

export function flattenTocTitles(
  entries: TocEntry[],
  map = new Map<string, string>(),
): Map<string, string> {
  for (const entry of entries) {
    if (entry.href && entry.title) {
      const path = hrefPath(entry.href);
      if (!map.has(path)) {
        map.set(path, entry.title);
      }
    }
    if (entry.children && entry.children.length > 0) {
      flattenTocTitles(entry.children, map);
    }
  }
  return map;
}

export function enrichReadingOrderWithToc(
  items: ReadingItem[],
  toc: TocEntry[],
): ReadingItem[] {
  const tocMap = flattenTocTitles(toc);
  return items.map((item) => {
    if (item.title && item.title !== item.href) {
      return item;
    }
    const tocTitle = tocMap.get(hrefPath(item.href));
    return tocTitle ? { ...item, title: tocTitle } : item;
  });
}
