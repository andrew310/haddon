/** Strip archive/vendor suffixes from an uploaded EPUB title for display. */
export function displayBookTitle(title: string, fallback = title): string {
  const withoutArchive = title.replace(/\s*--\s*Anna['’]s Archive.*$/i, "");
  const primary = withoutArchive.split(/\s+--\s+/)[0] ?? withoutArchive;
  const cleaned = primary.replace(/\s*_\s*/g, ": ").replace(/\s+/g, " ").trim();
  return cleaned || fallback;
}
