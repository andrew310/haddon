import assert from "node:assert/strict";

function isCitationOrFragmentLink(anchor: HTMLAnchorElement): boolean {
  const href = anchor.getAttribute("href");
  if (!href) return false;

  const isCitationLink = 
    anchor.classList.contains("haddon-noteref") ||
    anchor.getAttribute("role") === "doc-noteref" ||
    anchor.getAttribute("epub:type") === "noteref";

  const isInternalFragmentLink = 
    href.startsWith("#") || 
    (!href.startsWith("http://") && !href.startsWith("https://") && href.includes("#"));

  return isCitationLink || isInternalFragmentLink;
}

const citationLink = document.createElement("a");
citationLink.className = "haddon-noteref";
citationLink.href = "notes.xhtml#note-1";
citationLink.textContent = "1";
assert.equal(isCitationOrFragmentLink(citationLink), true, "should identify haddon-noteref as citation link");

const fragmentLink = document.createElement("a");
fragmentLink.href = "#section-2";
assert.equal(isCitationOrFragmentLink(fragmentLink), true, "should identify # fragment link");

const internalFragmentLink = document.createElement("a");
internalFragmentLink.href = "chapter-2.xhtml#intro";
assert.equal(isCitationOrFragmentLink(internalFragmentLink), true, "should identify internal fragment link");

const externalLink = document.createElement("a");
externalLink.href = "https://example.com";
assert.equal(isCitationOrFragmentLink(externalLink), false, "should not identify external http link as citation");

const regularInternalLink = document.createElement("a");
regularInternalLink.href = "chapter-2.xhtml";
assert.equal(isCitationOrFragmentLink(regularInternalLink), false, "should not identify regular internal link without fragment");

const roleNoterefLink = document.createElement("a");
roleNoterefLink.setAttribute("role", "doc-noteref");
roleNoterefLink.href = "notes.xhtml#note-2";
assert.equal(isCitationOrFragmentLink(roleNoterefLink), true, "should identify role=doc-noteref as citation link");

console.log("citationClickHandler tests passed");
