# Haddon Upstream Gems Ledger

**Established:** 2026-08-13

**Roadmap ticket:** HADDON-003

**Purpose:** Record the provenance, intended use, and reuse constraints of the best ideas, behaviors, fixtures, and code candidates found in Haddon's vendored e-reader sources.

This is an engineering ledger, not legal advice. A permissive repository license does not prove that every bundled font, image, fixture, generated file, or vendored dependency has the same license.

## Ledger rules

1. Add an entry before an upstream behavior, fixture, or implementation is brought into Haddon. A pull request should cite the gem ID.
2. Cite the exact vendored path and line range that supports the observation. The subtree snapshot, not a moving upstream URL, is the review authority.
3. Use exactly one primary category:
   - **Architectural idea:** a boundary, contract, ownership rule, or system shape.
   - **Behavior/test:** an observable promise or failure mode to reproduce in a Haddon-owned test.
   - **Fixture/data:** upstream publication or data proposed for adapted or direct test use.
   - **Code candidate:** a sufficiently bounded implementation that may merit a code-level comparison.
4. State the reuse mode explicitly:
   - **Concept:** learn from the design; write Haddon-specific code and tests from first principles.
   - **Independent reimplementation:** reproduce documented behavior without translating or copying expression.
   - **Adapted fixture:** derive a smaller Haddon fixture while retaining required notices and provenance.
   - **Potential direct code:** copying may be considered only after file-level authorship, dependency, notice, and compatibility review.
5. GPL- and AGPL-family sources are **concept** or **independent reimplementation** inputs by default. Do not translate, port, or copy their expression into Haddon without an explicit project licensing decision.
6. W3C test documents may be adapted only with the applicable W3C notice and attribution. Prefer a minimal project-owned fixture when it tests the same behavior.
7. Treat fonts, images, audio, video, sample books, dictionaries, hyphenation data, and files under a repository's `vendor` or `thirdparty` directories as separately licensed assets. They require a separate asset review even when the enclosing codebase is permissive.
8. If a subtree moves, update the line citation and record the new upstream snapshot during the same change. Do not leave a citation pointing approximately at a renamed implementation.
9. A gem records evidence, not a decision. Haddon design documents and tickets remain authoritative about what will actually ship.

## Repository and license summary

| Vendored repository | Snapshot | Top-level license | Default Haddon reuse posture | Extra review flags |
| --- | --- | --- | --- | --- |
| `foliate-js` | `78914aef4466eb960965702401634c2cb348e9b1` | MIT | Concepts and independent implementations; bounded direct code is possible after review. | `vendor/`, PDF.js CMaps, fonts, and sample publications are not cleared by the top-level conclusion. |
| `readium-css` | `c2461e495eae19086b4bc1d4a93a39041a6f2e73` | BSD-3-Clause | Concepts and bounded CSS/code candidates may be evaluated with notice retention. | Documentation screenshots, font samples, and internationalization samples require asset review. |
| `epub-tests` | `ec9085b1377668921eb252496163524fdbbb3b42` | W3C Software and Document License for documents; W3C Software Notice and License for the generator | Adapt selected fixtures with notice, or independently reproduce the behavior. | Embedded fonts, images, audio, video, and third-party literary excerpts require per-fixture review. |
| `readium-kotlin-toolkit` | `f8e6f93db81570c7cc0833279b2628f4c65d8efe` | BSD-3-Clause | Concepts and independent implementations; direct Kotlin code is unlikely to cross the Rust/TypeScript boundary cleanly. | Sample apps, test publications, and dependencies require separate review. |
| `readium-ts-toolkit` | `893a5cc362605ad19f1be1d905159c1b7282c68d` | BSD-3-Clause | Concepts, independent implementations, and tightly bounded TypeScript candidates after review. | Injected scripts, bundled Readium CSS, sample assets, and transitive packages retain their own provenance. |
| `thorium-web` | `631253363a3e24cd73abb099f38f272d227cb39e` | BSD-3-Clause | Product/UI concepts and independent host integration. | Icons, fonts, sample content, third-party packages, and branded visual assets require separate review. |
| `coolreader` | `dcc2d4c88b7ee66b8ee1223833c1a72cad3cdbc5` | GPL-2.0-or-later | Concepts and independently specified behavior only. | `thirdparty*`, dictionaries, hyphenation patterns, icons, and bundled resources have mixed licenses. |
| `mupdf` | `59873fbe00ed2d08adc5f8cf09ab4fb5c8536da3` | AGPL-3.0-or-later, with commercial licensing available | Concepts and independently specified behavior only unless Haddon makes an explicit licensing choice. | Generated resources, fonts, third-party components, and commercial-license terms need separate review. |
| `calibre` | `1c3d04ad4a384383c7c246b2ff6a1a3e52bcd729` | GPL-3.0-only | Concepts and independently specified behavior only. | Recipes, icons, fonts, sample books, plugins, and bundled third-party libraries require separate review. |

Snapshot IDs above are the upstream split IDs recorded by the squashed subtrees.

## Foliate JS

| ID | Category | Exact source | Repository / license | Haddon ticket and intended use | Reuse mode | Caveats |
| --- | --- | --- | --- | --- | --- | --- |
| FOL-001 | Architectural idea | `repos/foliate-js/epub.js:968-999` | foliate-js / MIT | HADDON-011, HADDON-015: model reading-order sections as lightweight descriptors with stable href identity and lazy `load`, `unload`, and `createDocument` operations. | Concept | Foliate's section shape omits the richer canonical manifest, services, warning model, and source mapping Haddon needs. |
| FOL-002 | Code candidate | `repos/foliate-js/epubcfi.js:188-314`; `repos/foliate-js/view.js:431-443` | foliate-js / MIT | HADDON-016, HADDON-018: compare its DOM-range-to-CFI and CFI-to-range treatment, especially adjacent/combined text nodes and ID assertions. | Potential direct code | Review the whole CFI module, its test coverage, DOM offset semantics, and upstream dependencies before copying; Haddon still needs redundant quote and normalized selectors. |
| FOL-003 | Architectural idea | `repos/foliate-js/view.js:446-455` | foliate-js / MIT | HADDON-030, HADDON-041: accept a small union of navigation targets and resolve them through one framework-neutral navigator seam. | Concept | Silent `null`/exception recovery is too weak for Haddon; navigation results must expose failure, confidence, ambiguity, and cancellation. |
| FOL-004 | Behavior/test | `repos/foliate-js/view.js:530-577` | foliate-js / MIT | HADDON-025: make whole-publication search incremental, report progress, and return locator-backed matches grouped by resource rather than one eager result array. | Independent reimplementation | The implementation opens every section sequentially and uses CFI-only identity; Haddon needs cancellation, lazy indexing, explicit Unicode rules, and its locator envelope. |

## Readium CSS

| ID | Category | Exact source | Repository / license | Haddon ticket and intended use | Reuse mode | Caveats |
| --- | --- | --- | --- | --- | --- | --- |
| CSS-001 | Code candidate | `repos/readium-css/docs/ReadiumCSS-user_variables.css:8-42`; `repos/readium-css/css/ReadMe.md:137-175` | readium-css / BSD-3-Clause | HADDON-023, HADDON-030: define a typed preference surface for columns, line length, colors, alignment, hyphenation, font, spacing, image treatment, and variable-font controls, with an explicit user-over-publisher cascade. | Potential direct code | The public API should use typed settings rather than expose raw `--USER__*` names; copying CSS requires retaining the BSD notice and reviewing imported modules. |
| CSS-002 | Behavior/test | `repos/readium-css/css/src/modules/ReadiumCSS-pagination-vertical.css:2-81` | readium-css / BSD-3-Clause | HADDON-034, HADDON-052: test vertical CJK and Mongolian progression separately, including `vertical-rl`, `vertical-lr`, and the inability to fake ordinary horizontal spreads. | Independent reimplementation | Browser support changes over time; validate against Haddon's supported browser matrix instead of treating these declarations as timeless compatibility facts. |
| CSS-003 | Architectural idea | `repos/readium-css/css/vars/CSS-Variables.md:80-87`; `repos/readium-css/css/src/modules/ReadiumCSS-html5patch.css:62-89` | readium-css / BSD-3-Clause | HADDON-023, HADDON-053: make preference capability and typographic defaults depend on script/writing mode instead of presenting every control for every book. | Concept | Language tags are imperfect signals for script and writing mode; publication metadata, document attributes, and user override must be reconciled. |

## W3C EPUB Tests

| ID | Category | Exact source | Repository / license | Haddon ticket and intended use | Reuse mode | Caveats |
| --- | --- | --- | --- | --- | --- | --- |
| W3C-001 | Fixture/data | `repos/epub-tests/tests/ocf-package_multiple/META-INF/container.xml:1-8` | epub-tests / W3C Software and Document License | HADDON-020, HADDON-021, HADDON-051: verify deterministic handling of multiple package rootfiles rather than assuming exactly one `rootfile`. | Adapted fixture | Define Haddon policy separately from conformance; retain the W3C notice if adapting these bytes. |
| W3C-002 | Fixture/data | `repos/epub-tests/tests/ocf-url_link-leaking-relative/EPUB/content_001.xhtml:13-18` | epub-tests / W3C Software and Document License | HADDON-020, HADDON-051: distinguish EPUB virtual-root URL resolution from host-filesystem traversal and test a relative URL that climbs beyond its current directory. | Adapted fixture | The referenced monastery image is an asset requiring separate review; a project-owned replacement is preferable. Never use this case to permit escape from the publication container. |
| W3C-003 | Fixture/data | `repos/epub-tests/tests/pkg-spine-nonlinear-activation/EPUB/package.opf:20-28`; `repos/epub-tests/tests/pkg-spine-nonlinear-activation/EPUB/content_001.xhtml:3-7` | epub-tests / W3C Software and Document License | HADDON-021, HADDON-041, HADDON-051: keep `linear="no"` resources addressable through links even when ordinary forward/backward traversal skips them. | Adapted fixture | Nonlinear presentation is navigator policy, not permission to drop the resource from the publication graph. |
| W3C-004 | Fixture/data | `repos/epub-tests/tests/sec-untrusted-consent_scripting/EPUB/content_001.xhtml:3-19` | epub-tests / W3C Software and Document License | HADDON-035, HADDON-054: test inline script, external script, and nested iframe behavior for a side-loaded publication, with scripts inert unless policy explicitly grants consent. | Adapted fixture | Run only in an isolated security-test harness. Do not infer a complete sandbox/CSP policy from this single conformance case. |

## Readium Kotlin Toolkit

| ID | Category | Exact source | Repository / license | Haddon ticket and intended use | Reuse mode | Caveats |
| --- | --- | --- | --- | --- | --- | --- |
| RDK-001 | Architectural idea | `repos/readium-kotlin-toolkit/readium/shared/src/main/java/org/readium/r2/shared/publication/Publication.kt:35-84` | readium-kotlin-toolkit / BSD-3-Clause | HADDON-011, HADDON-015: separate host-assigned publication identity from unreliable publication metadata, and model a publication as manifest plus resource container plus optional services. | Concept | Haddon needs volume/edition semantics and Rust/TypeScript lifetime contracts beyond this mobile model. |
| RDK-002 | Architectural idea | `repos/readium-kotlin-toolkit/readium/shared/src/main/java/org/readium/r2/shared/publication/Locator.kt:30-69`; `repos/readium-kotlin-toolkit/readium/shared/src/main/java/org/readium/r2/shared/publication/Locator.kt:116-138` | readium-kotlin-toolkit / BSD-3-Clause | HADDON-012, HADDON-016, HADDON-040: use an href-anchored locator envelope carrying alternative structural/progression evidence and before/highlight/after quote context. | Concept | Readium's extensible map does not define Haddon's normalization revision, explicit offset units, resolution confidence, or ambiguity result. |
| RDK-003 | Behavior/test | `repos/readium-kotlin-toolkit/readium/shared/src/main/java/org/readium/r2/shared/publication/Locator.kt:89-112` | readium-kotlin-toolkit / BSD-3-Clause | HADDON-016: reject or omit progression outside `[0,1]` and positions below one while preserving recognized extension location data during deserialization. | Independent reimplementation | Decide whether each invalid field invalidates the locator or becomes a warning; never copy Android/`org.json` quirks into the wire contract. |
| RDK-004 | Architectural idea | `repos/readium-kotlin-toolkit/readium/shared/src/main/java/org/readium/r2/shared/util/resource/Resource.kt:14-29`; `repos/readium-kotlin-toolkit/readium/shared/src/main/java/org/readium/r2/shared/util/resource/Resource.kt:48-78` | readium-kotlin-toolkit / BSD-3-Clause | HADDON-014, HADDON-015, HADDON-024: give lazy resources fallible length/range/property access, explicit close semantics, and borrowed non-owning views. | Concept | Rust ownership should make borrowed versus owned handles stronger; the Haddon contract also needs cancellation, limits, and streaming semantics. |

## Readium TypeScript Toolkit

| ID | Category | Exact source | Repository / license | Haddon ticket and intended use | Reuse mode | Caveats |
| --- | --- | --- | --- | --- | --- | --- |
| RDT-001 | Architectural idea | `repos/readium-ts-toolkit/navigator/src/Navigator.ts:43-74`; `repos/readium-ts-toolkit/navigator/src/Navigator.ts:133-158` | readium-ts-toolkit / BSD-3-Clause | HADDON-030: stop the engine boundary at publication/current-location access, locator/link navigation, progression-aware movement, and deterministic destruction. | Concept | Replace boolean callbacks with promises and typed outcomes for boundary reached, cancellation, unresolved target, and degraded recovery. |
| RDT-002 | Architectural idea | `repos/readium-ts-toolkit/navigator/src/epub/frame/FrameBlobBuilder.ts:46-78`; `repos/readium-ts-toolkit/navigator/src/epub/frame/FrameBlobBuilder.ts:159-194` | readium-ts-toolkit / BSD-3-Clause | HADDON-035: parse publication HTML, apply allowlisted transforms, set language/direction/base/CSP, and materialize an owned iframe URL behind the source-faithful rendition. | Concept | The exact CSP, blob URL, direction inference, parser-error handling, and script posture require a security review; normalized DOM should not need this full path. |
| RDT-003 | Code candidate | `repos/readium-ts-toolkit/navigator/src/epub/frame/FrameComms.ts:16-67`; `repos/readium-ts-toolkit/navigator/src/epub/frame/FrameComms.ts:74-140` | readium-ts-toolkit / BSD-3-Clause | HADDON-035: evaluate its channel-scoped request/acknowledgement registry, timeout cleanup, listener buffering, and explicit halt lifecycle as a basis for frame communication. | Independent reimplementation | The handler checks protocol/channel but the shown code does not validate `event.source` or `event.origin`; define an allowlisted versioned protocol and security tests before considering direct reuse. |
| RDT-004 | Architectural idea | `repos/readium-ts-toolkit/navigator/src/epub/EpubNavigator.ts:728-799`; `repos/readium-ts-toolkit/navigator/src/epub/EpubNavigator.ts:857-872` | readium-ts-toolkit / BSD-3-Clause | HADDON-033: make decorations grouped, ID-based, locator-backed replacement sets; diff add/update/remove operations and reapply them when a resource frame remounts. | Concept | Haddon decoration identity cannot retain DOM instances, and geometry must remain ephemeral. Destruction must also revoke all Haddon-owned URLs and cancel work. |

## Thorium Web

| ID | Category | Exact source | Repository / license | Haddon ticket and intended use | Reuse mode | Caveats |
| --- | --- | --- | --- | --- | --- | --- |
| THO-001 | Architectural idea | `repos/thorium-web/src/components/Reader/StatefulReaderWrapper.tsx:40-76`; `repos/thorium-web/src/components/Reader/StatefulReaderWrapper.tsx:79-129` | thorium-web / BSD-3-Clause | HADDON-042, HADDON-043: keep publication, profile, position storage, preferences, plugins, localization, and loading policy in a thin host adapter above the navigator. | Concept | Klemata should not inherit Thorium's Redux, provider stack, Next.js routing, profile registry, or branded component structure. |
| THO-002 | Behavior/test | `repos/thorium-web/src/components/Epub/StatefulReader.tsx:324-361` | thorium-web / BSD-3-Clause | HADDON-043: treat edge-tap navigation, reduced-motion animation, and middle-tap chrome toggling as configurable Klemata interaction policy. | Independent reimplementation | The code reaches into private iframe widths and uses device-pixel calculations; Haddon should emit normalized pointer intent from a public navigator contract. |
| THO-003 | Architectural idea | `repos/thorium-web/src/core/Hooks/Epub/useEpubNavigator.ts:28-91`; `repos/thorium-web/src/core/Hooks/Epub/useEpubNavigator.ts:145-149` | thorium-web / BSD-3-Clause | HADDON-042: use this as a negative boundary test—one mounted reader owns one instance, stores it in component scope, and never exposes private frames. | Concept | Thorium's module singleton and `_cframes` escape hatch are specifically not patterns to copy; test two simultaneous mounts and clean remount on volume changes. |

## CoolReader

| ID | Category | Exact source | Repository / license | Haddon ticket and intended use | Reuse mode | Caveats |
| --- | --- | --- | --- | --- | --- | --- |
| CLR-001 | Architectural idea | `repos/coolreader/crengine/src/epubfmt.cpp:1309-1345`; `repos/coolreader/crengine/src/epubfmt.cpp:1369-1405` | coolreader / GPL-2.0-or-later | HADDON-021, HADDON-022: retain spine/manifest identity and nonlinear flags while constructing a derived reading representation with explicit source-path substitutions. | Concept | CoolReader merges spine documents into one DOM; Haddon should keep lazy source resources and create bidirectional source-map segments instead of adopting that representation. |
| CLR-002 | Behavior/test | `repos/coolreader/crengine/src/epubfmt.cpp:1423-1512`; `repos/coolreader/crengine/src/epubfmt.cpp:1514-1563` | coolreader / GPL-2.0-or-later | HADDON-021: test real-world navigation fallback order—EPUB 3 nav, missing pieces from NCX, and finally a clearly degraded spine-derived TOC. | Independent reimplementation | Some fallbacks intentionally mimic Kobo and may exceed or diverge from EPUB conformance. Emit warnings and preserve provenance for synthesized navigation. |
| CLR-003 | Behavior/test | `repos/coolreader/crengine/src/lvdocview.cpp:3995-4046`; `repos/coolreader/crengine/src/lvdocview.cpp:4065-4073` | coolreader / GPL-2.0-or-later | HADDON-044: persist logical document pointers rather than page numbers, restore them after reopening, and migrate stored bookmarks when the document-address format changes. | Independent reimplementation | Filename/size plus XPointer is not Haddon's volume/edition identity and cannot replace quote-context recovery; do not port GPL implementation details. |

## MuPDF

| ID | Category | Exact source | Repository / license | Haddon ticket and intended use | Reuse mode | Caveats |
| --- | --- | --- | --- | --- | --- | --- |
| MUP-001 | Architectural idea | `repos/mupdf/include/mupdf/fitz/document.h:123-188`; `repos/mupdf/include/mupdf/fitz/document.h:339-403` | MuPDF / AGPL-3.0-or-later | HADDON-011, HADDON-014: use a format-handler boundary with capability operations for open, outline, layout, links, and lifecycle rather than one EPUB-specific reader object. | Concept | Haddon should prefer typed capability/service objects over a C virtual table and must not copy AGPL implementation expression without a licensing decision. |
| MUP-002 | Architectural idea | `repos/mupdf/include/mupdf/fitz/document.h:652-687` | MuPDF / AGPL-3.0-or-later | HADDON-023, HADDON-030, HADDON-037: keep reflowability detection, style policy, and physical layout as distinct operations so a renderer can relayout without changing canonical document identity. | Concept | MuPDF's width/height/em layout is page-oriented and not a browser DOM contract; it is most relevant to the optional canvas/native backend. |
| MUP-003 | Behavior/test | `repos/mupdf/include/mupdf/fitz/structured-text.h:85-143`; `repos/mupdf/include/mupdf/fitz/structured-text.h:163-216`; `repos/mupdf/include/mupdf/fitz/structured-text.h:440-492` | MuPDF / AGPL-3.0-or-later | HADDON-022, HADDON-025, HADDON-036: define extraction tests for ligatures, whitespace, dehyphenation, images, structure, paragraphs, tables, vertical lines, bidi, geometry, and unknown Unicode. | Independent reimplementation | These options target spatial page extraction, especially PDF. They are a scope checklist, not a data model to transplant into normalized EPUB content. |

## Calibre

| ID | Category | Exact source | Repository / license | Haddon ticket and intended use | Reuse mode | Caveats |
| --- | --- | --- | --- | --- | --- | --- |
| CAL-001 | Behavior/test | `repos/calibre/src/calibre/ebooks/oeb/polish/container.py:94-126`; `repos/calibre/src/calibre/ebooks/oeb/polish/container.py:530-567` | calibre / GPL-3.0-only | HADDON-020: test percent-decoding, Unicode NFC normalization, external schemes, empty paths, base-relative paths, Windows drive-like paths, and case-sensitive canonical resource names. | Independent reimplementation | Calibre operates on an extracted filesystem and its helper can represent `..`; Haddon must additionally prove containment in a virtual publication root. Do not port GPL code. |
| CAL-002 | Architectural idea | `repos/calibre/src/calibre/ebooks/oeb/polish/container.py:616-654`; `repos/calibre/src/calibre/ebooks/oeb/polish/container.py:665-668` | calibre / GPL-3.0-only | HADDON-015, HADDON-024: centralize MIME-aware raw/parsed access and cache parsed resources behind the publication container instead of letting consumers open arbitrary files. | Concept | Haddon's normalizer needs immutable/versioned products, bounded caches, async cancellation, and explicit ownership rather than Calibre's mutable dirty-cache workflow. |
| CAL-003 | Behavior/test | `repos/calibre/src/calibre/ebooks/epub/cfi/tests.py:10-92`; `repos/calibre/src/calibre/ebooks/epub/cfi/tests.py:94-131` | calibre / GPL-3.0-only | HADDON-016, HADDON-050: independently specify CFI ordering, escaped assertions, redirects, temporal/spatial/text offsets, partial parse behavior, and ID-assisted recovery. | Independent reimplementation | Test inputs and expected values are copyrightable expression; derive Haddon-owned cases from the EPUB CFI specification and documented behaviors rather than copying the table wholesale. |
| CAL-004 | Behavior/test | `repos/calibre/src/pyj/read_book/anchor_visibility.pyj:8-52` | calibre / GPL-3.0-only | HADDON-032, HADDON-041: invalidate anchor geometry when layout mode or viewport dimensions change, support both `id` and legacy `name`, and handle hidden page-list targets deliberately. | Independent reimplementation | Forcing `display:none` targets visible is invasive product policy. Haddon should resolve the logical locator first, then choose a reversible focus/decorate strategy and report degradation. |

## Immediate use

The first implementation slice should cite a small subset of this ledger rather than attempt to absorb everything:

- HADDON-013 and HADDON-017: FOL-001, RDK-002, CLR-001.
- HADDON-015 and HADDON-020: RDK-004, W3C-001, W3C-002, CAL-001, CAL-002.
- HADDON-016 and HADDON-018: FOL-002, RDK-002, RDK-003, CAL-003.
- HADDON-030 and HADDON-033: RDT-001, RDT-004, THO-003.
- HADDON-035 security spike: W3C-004, RDT-002, RDT-003.
- HADDON-050 test catalog: promote each **Behavior/test** and **Fixture/data** entry into a behavior matrix with Haddon support status and priority.

## Asset review queue

No asset is approved for copying merely because it appears in a vendored subtree. Before any upstream fixture is committed outside `repos/`, record its exact files, copyright/attribution statement, license text, intended modifications, and redistribution path. The current high-priority review queue is:

1. The image referenced by W3C-002, if it is retained rather than replaced.
2. Any fonts or media needed for Readium CSS vertical-writing or visual-regression cases.
3. Any complete EPUB copied from `epub-tests`, Readium samples, Foliate samples, Calibre, or CoolReader.
4. Readium injectables or CSS bundled into a distributable Haddon package.
5. All files beneath upstream `vendor`, `thirdparty`, `thirdparty_unman`, font, dictionary, hyphenation, icon, and sample-content directories.
