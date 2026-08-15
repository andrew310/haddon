import assert from "node:assert/strict";
import {
  MOON_QUOTE,
  citationToLocatorJson,
  citationToSearch,
  searchToCitation,
} from "./citationLink.ts";

const params = citationToSearch(MOON_QUOTE);
assert.equal(params.get("exact"), MOON_QUOTE.exact);
assert.equal(params.get("href"), MOON_QUOTE.href);
assert.equal(params.get("fragment"), "citation-target");

const parsed = searchToCitation(params);
assert.deepEqual(parsed, MOON_QUOTE);

assert.equal(searchToCitation(new URLSearchParams("foo=bar")), null);

const locator = JSON.parse(citationToLocatorJson(MOON_QUOTE));
assert.equal(locator.schema, "haddon.publication-locator");
assert.equal(locator.href, "text/chapter-1.xhtml");
assert.equal(locator.text.exact, MOON_QUOTE.exact);
assert.deepEqual(locator.locations.fragments, ["citation-target"]);

const quoteOnly = searchToCitation(new URLSearchParams("exact=hello+world"));
assert.deepEqual(quoteOnly, { exact: "hello world" });

console.log("citationLink tests passed");
