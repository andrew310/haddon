import assert from "node:assert/strict";

function extractFragmentContent(html: string, fragmentId: string): string | null {
  const tempDiv = document.createElement("div");
  tempDiv.innerHTML = html;
  
  let targetElement = tempDiv.querySelector(`#${CSS.escape(fragmentId)}`);
  
  if (!targetElement) {
    targetElement = tempDiv.querySelector(`[name="${CSS.escape(fragmentId)}"]`);
  }
  
  if (!targetElement) {
    const allElements = tempDiv.querySelectorAll("[id]");
    for (const el of Array.from(allElements)) {
      const id = el.getAttribute("id");
      if (id && id.includes(fragmentId)) {
        targetElement = el;
        break;
      }
    }
  }
  
  return targetElement ? targetElement.innerHTML : null;
}

const htmlWithId = '<div><p id="ref696">Hill & Hurtado, 1996. <em>Ache Life History</em>.</p></div>';
const result1 = extractFragmentContent(htmlWithId, "ref696");
assert.ok(result1?.includes("Hill & Hurtado"), "should find element by exact id");

const htmlWithName = '<div><a name="note-1"></a><p>This is the note content.</p></div>';
const result2 = extractFragmentContent(htmlWithName, "note-1");
assert.ok(result2 === "", "should find element by name attribute");

const htmlWithPartialId = '<div><p id="chapter-ref-696">Partial match content.</p></div>';
const result3 = extractFragmentContent(htmlWithPartialId, "ref-696");
assert.ok(result3?.includes("Partial match"), "should find element by partial id match as fallback");

const htmlNoMatch = '<div><p id="other">No match.</p></div>';
const result4 = extractFragmentContent(htmlNoMatch, "ref696");
assert.equal(result4, null, "should return null when no match found");

console.log("fragmentExtraction tests passed");
