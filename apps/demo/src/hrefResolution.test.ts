import assert from "node:assert/strict";

function resolveRelativeHref(currentHref: string, reference: string): string {
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
}

assert.equal(
  resolveRelativeHref("text/ch5.xhtml", "reference.xhtml#ref696"),
  "text/reference.xhtml",
  "should resolve relative href from same directory"
);

assert.equal(
  resolveRelativeHref("text/chapter-1.xhtml", "notes.xhtml#note-1"),
  "text/notes.xhtml",
  "should resolve relative href with fragment"
);

assert.equal(
  resolveRelativeHref("text/chapter-1.xhtml", "#section-2"),
  "text/chapter-1.xhtml",
  "should return current href for same-page fragment"
);

assert.equal(
  resolveRelativeHref("chapter-1.xhtml", "chapter-2.xhtml#intro"),
  "chapter-2.xhtml",
  "should resolve relative href without directory"
);

assert.equal(
  resolveRelativeHref("text/part1/ch1.xhtml", "../notes.xhtml#note1"),
  "text/part1/../notes.xhtml",
  "should preserve relative path segments (canonicalization happens in Rust)"
);

assert.equal(
  resolveRelativeHref("text/chapter.xhtml", "/absolute/path.xhtml"),
  "/absolute/path.xhtml",
  "should pass through absolute paths"
);

assert.equal(
  resolveRelativeHref("text/chapter.xhtml", "http://example.com"),
  "http://example.com",
  "should pass through external URLs"
);

console.log("hrefResolution tests passed");
