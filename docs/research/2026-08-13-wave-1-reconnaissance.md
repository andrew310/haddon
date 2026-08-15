# Wave 1 E-Reader Reconnaissance

**Date:** 2026-08-13  
**Scope:** Existing Haddon code and the seven vendored upstream repositories  
**Method:** Three independent read-only reviews covering models/locators, normalization/rendering boundaries, and upstream tests

## Conclusion

The three reviews converged on the same starting point:

> Build and test a durable citation round trip before expanding the renderer.

The first vertical slice should prove:

```text
source href/anchor + exact quote/context
                    |
                    v
          normalized document range
                    |
                    v
             serialize citation
                    |
                    v
        close and reopen publication
                    |
                    v
 resolve the same passage after harmless normalization changes
                    |
                    v
             map back to source
```

This is the smallest experiment that directly validates Haddon's role inside Klemata.

## Decisions Supported by the Evidence

### 1. A publication is not a list of normalized chapters

Haddon's current `EpubDocument` is a useful normalized-reading prototype, but it is too lossy to be the canonical publication:

- It retains only title, author, eager chapters, and extracted notes: `crates/core/src/types.rs:77`.
- Its durable-looking address is actually an ordinal chapter/block/byte offset: `crates/core/src/types.rs:1`.
- OPF parsing collapses the manifest into ordered spine hrefs and then discards the manifest identity: `crates/core/src/epub.rs:228`.
- General resource identity, element IDs, links, lists, figures, tables, language, direction, and many other semantics are not represented.

The canonical model should follow Readium's broad shape:

```text
Publication = Manifest + Resource Container + Optional Services
```

Evidence:

- Readium `Publication`: `repos/readium-kotlin-toolkit/readium/shared/src/main/java/org/readium/r2/shared/publication/Publication.kt:44`
- Readium `Manifest`: `repos/readium-kotlin-toolkit/readium/shared/src/main/java/org/readium/r2/shared/publication/Manifest.kt:28`
- Readium `Link`: `repos/readium-kotlin-toolkit/readium/shared/src/main/java/org/readium/r2/shared/publication/Link.kt:31`
- Lazy resource access: `repos/readium-kotlin-toolkit/readium/shared/src/main/java/org/readium/r2/shared/util/resource/Resource.kt:14`

Foliate supplies the complementary lesson: the contract can remain small and lazy. Its EPUB, PDF, and comic implementations all expose ordered sections, navigation, target resolution, and lifecycle without requiring one giant format hierarchy:

- `repos/foliate-js/epub.js:979`
- `repos/foliate-js/pdf.js:129`
- `repos/foliate-js/comic-book.js:26`
- `repos/foliate-js/view.js:79`

### 2. A citation is an envelope of redundant evidence

No single locator survives every transformation. Haddon should persist several clues:

- Klemata volume and edition identity
- source resource href
- fragment or element identity
- EPUB CFI where available
- normalized block/range plus normalization revision
- exact quote with prefix and suffix context
- progression only as a last-resort fallback

Readium's locator already demonstrates this envelope approach:

- Core locator fields and text context: `repos/readium-kotlin-toolkit/readium/shared/src/main/java/org/readium/r2/shared/publication/Locator.kt:30`
- CSS selector, partial CFI, and DOM range extensions: `repos/readium-kotlin-toolkit/readium/shared/src/main/java/org/readium/r2/shared/publication/html/Locator.kt:15`
- DOM range point representation: `repos/readium-kotlin-toolkit/readium/shared/src/main/java/org/readium/r2/shared/publication/html/DomRange.kt:25`
- Quote-based navigator location behavior: `repos/readium-kotlin-toolkit/readium/navigators/web/reflowable/src/main/kotlin/org/readium/navigator/web/reflowable/ReflowableWebLocations.kt:96`

Foliate demonstrates full CFI-to-DOM-range conversion and conversion of a live selection back into CFI:

- `repos/foliate-js/epubcfi.js:190`
- `repos/foliate-js/view.js:431`

Resolution should return confidence such as `exact`, `structural`, `quote`, or `progression`, plus ambiguity/warnings. It must never silently jump to something merely nearby.

### 3. Serialized offset units must be explicit

Haddon currently uses Rust string byte offsets while browser DOM APIs use UTF-16 code-unit offsets. The public serialized number does not declare its unit:

- `crates/core/src/types.rs:1`
- `packages/wasm/src/lib.rs:662`

Persisted location types must specify their offset space. A likely browser-facing choice is UTF-16, with explicit conversion inside Rust, but this should be settled through contract tests rather than convention.

### 4. Normalization should be semantic, not a text flattening pass

The normalized representation should preserve:

- sections, headings, paragraphs, lists, quotations, code, and tables
- links and explicit note relationships
- figures, images, captions, and media references
- emphasis, importance, sub/sup, and ruby
- language, direction, writing mode, and structural roles
- source hrefs, element IDs, fragments, and ordered source mappings

It should generally constrain publisher fonts, absolute sizes, colors, line height, margins, spacing, indentation, and layout that makes prose difficult to read.

It should not destructively normalize fixed-layout books, comics, spatial diagrams, complex unsupported tables, interactive content, or unsupported MathML/SVG/media. Those require a source-faithful or specialized rendition with explicit capability warnings.

Readium CSS supports treating normalization as a controlled cascade rather than discarding the document:

- User-agent/author/user balance: `repos/readium-css/docs/CSS01-readiumcss_fundamentals.md:7`
- Stylesheet ordering: `repos/readium-css/docs/CSS06-stylesheets_order.md:5`
- Layout-critical ownership: `repos/readium-css/docs/CSS03-injection_and_pagination.md:52`
- Preference variables and flags: `repos/readium-css/docs/CSS12-user_prefs.md:5`
- Conditional rather than unconditional font-size normalization: `repos/readium-css/docs/CSS12-user_prefs.md:316`

### 5. Semantic DOM should be the primary web rendition

For normal reflowable books, Haddon should render a normalized semantic DOM and let the browser provide shaping, selection, accessibility, links, images, tables, ruby, writing modes, and font fallback.

Foliate demonstrates the useful boundary:

- Framework-neutral `View`: `repos/foliate-js/view.js:213`
- Browser DOM inside an iframe: `repos/foliate-js/paginator.js:242`
- Pagination using CSS columns or scrolling: `repos/foliate-js/paginator.js:292`
- DOM ranges and visible locations: `repos/foliate-js/paginator.js:945`
- Separate fixed-layout renderer: `repos/foliate-js/fixed-layout.js:71`

The existing `cosmic-text`/canvas backend remains potentially valuable for native or e-ink clients, deterministic export, constrained text, experiments, and emergency fallback. It should not define the canonical model or primary browser interaction system.

CoolReader proves that owning a complete renderer is possible, but also exposes the scope cost. Its document/view layer owns parsing, styles, layout, rendering, selection, navigation, caches, history, and more:

- Semantic DOM: `repos/coolreader/crengine/include/lvtinydom.h:28`
- Full document state: `repos/coolreader/crengine/include/lvtinydom.h:1285`
- Large view surface: `repos/coolreader/crengine/include/lvdocview.h:278`

### 6. Capabilities and transformations should be services

Not every publication can provide normalization, text search, positions, or the same rendition. These should be discoverable capabilities rather than fake universal methods.

Readium examples include locator, positions, search, content, cover, cache, and protection services:

- `repos/readium-kotlin-toolkit/readium/shared/src/main/java/org/readium/r2/shared/publication/Publication.kt:247`
- `repos/readium-kotlin-toolkit/readium/shared/src/main/java/org/readium/r2/shared/publication/services/LocatorService.kt:12`
- `repos/readium-kotlin-toolkit/readium/shared/src/main/java/org/readium/r2/shared/publication/services/search/SearchService.kt:48`

Haddon should initially consider `NormalizationService`, `LocatorService`, `SearchService`, and `PositionsService`.

### 7. Resources and work should be lazy

Haddon currently parses every spine item and lays out the entire publication eagerly. The future publication API should make resources lazy and normalization, indexing, and preloading incremental and cancellable.

Foliate provides useful load/unload and reference-counted resource URL behavior:

- `repos/foliate-js/epub.js:706`
- `repos/foliate-js/epub.js:903`
- `repos/foliate-js/paginator.js:1004`

Readium makes closing the resource container and attached services explicit:

- `repos/readium-kotlin-toolkit/readium/shared/src/main/java/org/readium/r2/shared/publication/Publication.kt:170`

## Proposed Minimal Contracts

These shapes are a research target, not a committed API:

```ts
type Publication = {
  id: string
  revision?: string
  manifest: Manifest
  capabilities: Set<Capability>
  getResource(href: string): Promise<Resource | null>
  service<T>(kind: ServiceKind<T>): T | null
  close(): Promise<void>
}

type PublicationLocator = {
  href: string
  mediaType?: string
  locations: {
    fragments?: string[]
    progression?: number
    position?: number
    epubCfi?: string
    cssSelector?: string
    domRange?: DomRange
    normalized?: {
      revision: string
      blockId: string
      start: number
      end?: number
      offsetUnit: "utf16"
    }
  }
  text?: {
    before?: string
    highlight?: string
    after?: string
  }
}

type NormalizedResource = {
  href: string
  revision: string
  blocks: NormalizedBlock[]
  mappings: SourceMapSegment[]
  warnings: PublicationWarning[]
}

type ResolvedLocation = {
  locator: PublicationLocator
  readingOrderIndex: number
  normalizedRange?: NormalizedRange
  confidence: "exact" | "structural" | "quote" | "progression"
  warnings: PublicationWarning[]
}
```

Important invariants:

- Persist href, not chapter/spine index, as primary resource identity.
- Normalized blocks have deterministic IDs tied to source identity.
- Every addressable normalized node carries a source mapping.
- Normalized coordinates carry a normalizer revision.
- Serialized offsets declare their unit.
- Missing optional capabilities are explicit.
- Cleanup, cancellation, fatal errors, and recoverable warnings are typed.

## First Test Tranche

The first tranche should contain roughly 15 tests in four fixture families.

### Citation laws

1. CFI parse, serialize, escape, compare, and document-order properties.
2. DOM/source range round trips across comments, entities, nested inline markup, and ignored wrappers.
3. `source locator -> normalized range -> source locator` round trip.
4. Quote/context fallback after a harmless normalizer revision changes structural selectors.
5. Restoration after font, viewport, theme, and presentation-mode changes.

High-value evidence:

- `repos/foliate-js/tests/epubcfi-tests.js:63`
- `repos/calibre/src/calibre/ebooks/epub/cfi/tests.py:11`
- `repos/readium-kotlin-toolkit/readium/shared/src/test/java/org/readium/r2/shared/publication/LocatorTest.kt:26`
- `repos/readium-kotlin-toolkit/readium/shared/src/test/java/org/readium/r2/shared/publication/services/LocatorServiceTest.kt:69`

### One deliberately awkward tiny EPUB

6. Multiple package candidates are handled deterministically.
7. Manifest order differs from spine order.
8. EPUB 3 navigation includes nested markup, landmarks, and a page list.
9. Relative hrefs mix encoded and unencoded components.
10. One nonlinear item and one unsupported item with a valid fallback are represented explicitly.

High-value evidence:

- `repos/epub-tests/tests/ocf-package_multiple/META-INF/container.xml:1`
- `repos/epub-tests/tests/pkg-spine-order/EPUB/package.opf:7`
- `repos/readium-kotlin-toolkit/readium/streamer/src/test/java/org/readium/r2/streamer/parser/epub/NavigationDocumentParserTest.kt:46`
- `repos/readium-kotlin-toolkit/readium/shared/src/test/java/org/readium/r2/shared/util/UrlTest.kt:95`
- `repos/epub-tests/tests/pub-foreign_bad-fallback/EPUB/package.opf:7`

### Normalization fixture

11. Text around nested blocks remains ordered and addressable.
12. Inline emphasis and language changes preserve semantic and source ranges.
13. Relative image sources resolve and `alt` becomes an accessibility label.
14. A table, SVG, or unsupported construct is preserved or warned about rather than silently flattened.

High-value evidence:

- `repos/readium-kotlin-toolkit/readium/shared/src/test/java/org/readium/r2/shared/publication/services/content/iterators/HtmlResourceContentIteratorTest.kt:276`
- `repos/readium-kotlin-toolkit/readium/shared/src/test/java/org/readium/r2/shared/publication/services/content/iterators/HtmlResourceContentIteratorTest.kt:370`
- `repos/calibre/src/calibre/ebooks/oeb/polish/tests/parsing.py:163`

### Security boundary

15. Resource paths cannot escape the virtual publication root.
16. Unlisted resources are not accidentally exposed.
17. Scripts and iframes are inert by default.
18. External links become host events requiring application policy.
19. Compressed bytes, uncompressed bytes, resource counts, and XML depth have explicit limits.

High-value evidence:

- `repos/readium-kotlin-toolkit/readium/shared/src/test/java/org/readium/r2/shared/util/resource/DirectoryContainerTest.kt:42`
- `repos/epub-tests/tests/pkg-manifest-unlisted-resource/EPUB/content_001.xhtml:3`
- `repos/epub-tests/tests/sec-untrusted-consent_scripting/EPUB/content_001.xhtml:3`
- `repos/epub-tests/tests/pub-external-links_consent/EPUB/content_001.xhtml:3`

After these pass, add three browser screenshots: normalized LTR paged, RTL paged, and vertical/CJK. Readium CSS provides the pattern and scenarios at `repos/readium-css/tests/visual.spec.js:3`.

## Immediate Starting Task

Before adding more block types or UI, define and contract-test:

1. `Publication` and `Manifest`;
2. `ResourceLink` and lazy `Resource`;
3. `PublicationLocator` and its serialization rules;
4. `NormalizedResource`, deterministic block identity, and `SourceMapSegment`;
5. `NormalizationService` and `LocatorService`;
6. fatal errors versus accumulated warnings.

Use one tiny EPUB with two spine resources, a nested TOC, a normal fragment link, emphasis, a note, an element ID, and exact quote context. The acceptance test is the citation round trip at the top of this document.

## Next Research Wave

Before researching UI composition in depth, add shallow, squashed subtrees for:

- `readium/ts-toolkit`
- `edrlab/thorium-web`

Then study the current browser Navigator contract and Thorium's host integration against Klemata's Remix 3 model. The core and navigator contracts should remain Web API-shaped and must not depend on Remix internals.

## Provenance Rules

- Foliate is MIT.
- Readium Kotlin and Readium CSS are BSD-3-Clause.
- W3C EPUB Tests use the W3C Software and Document License, with some generated code separately licensed.
- CoolReader is GPLv2.
- Calibre is GPLv3.
- MuPDF is AGPLv3 or commercially licensed.

Direct fixture reuse from Foliate, Readium, or W3C may be possible with attribution and per-asset review. For Calibre, CoolReader, and MuPDF, independently reproduce the behavior in minimal Haddon fixtures unless the project deliberately accepts the corresponding copyleft obligations.
