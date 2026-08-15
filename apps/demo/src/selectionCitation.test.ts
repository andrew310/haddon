import assert from "node:assert/strict";
import { citationFromBlockText, contextAround } from "./selectionCitation.ts";

const block =
  "Before the signal, the copper astrolabe clicked once; the patient moon answered in blue, and the lesson continued after midnight.";
const exact = "the patient moon answered in blue";

const around = contextAround(block, exact);
assert.ok(around);
assert.equal(around.prefix?.endsWith("clicked once; "), true);
assert.equal(around.suffix?.startsWith(", and the lesson"), true);

const citation = citationFromBlockText({
  blockText: block,
  exact: "  the   patient moon answered in blue\n",
  href: "text/chapter-1.xhtml",
  fragment: "citation-target",
});
assert.ok(citation);
assert.equal(citation.exact, exact);
assert.equal(citation.href, "text/chapter-1.xhtml");
assert.equal(citation.fragment, "citation-target");
assert.ok(citation.prefix);
assert.ok(citation.suffix);

const unmatched = citationFromBlockText({
  blockText: block,
  exact: "not in the paragraph",
});
assert.ok(unmatched);
assert.equal(unmatched.exact, "not in the paragraph");
assert.equal(citationFromBlockText({ blockText: block, exact: "   " }), null);

console.log("selectionCitation tests passed");
