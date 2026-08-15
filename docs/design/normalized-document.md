# Haddon Normalized Document and Source-Map Contract

**Status:** Proposed design for HADDON-013

**Date:** 2026-08-13

**Scope:** The derived normalized resource AST, deterministic node identity, transformation stamp, source evidence, and bidirectional source mappings

**Out of scope:** Canonical publication/resource identity and locator resolution (HADDON-011/HADDON-012), the final diagnostic taxonomy (HADDON-014), search normalization and ranking (HADDON-018), source security policy (HADDON-020), and Klemata citation storage (HADDON-040)

This document fills the normalized-content gap deliberately left by the [publication and locator contracts](publication-model.md). It defines a portable semantic representation for Haddon without mistaking that representation for the source publication.

## Decision summary

The labels in this section are normative for the first implementation.

- **Decision:** A `NormalizedResource` is a deterministic, immutable, derived view of one canonical publication resource. It never replaces the source `Manifest`, source bytes, or source DOM.
- **Decision:** Normalization is resource-scoped and lazy. Opening a publication does not normalize every reading-order item.
- **Decision:** The AST preserves semantic block and inline structure useful to citations, search, accessible rendition, TTS, and a constrained canvas renderer. It is not a browser DOM and does not attempt to preserve arbitrary CSS layout.
- **Decision:** Every normalized node has a deterministic ID and source evidence. Text locators address an addressable block ID plus an explicit UTF-16 code-unit offset.
- **Decision:** IDs are reproducible for the same source revision, normalizer revision, and configuration. They are not trusted across a changed normalization stamp; quote and source evidence handle recovery.
- **Decision:** Text is projected from inline trees by one normative algorithm. Ranges are zero-based, half-open UTF-16 ranges over that projection.
- **Decision:** Language, direction, semantic roles, links, note relationships, media alternatives, and accessibility labels are data, not styling hints.
- **Decision:** Unknown source elements are either preserved as typed opaque nodes, represented as unsupported nodes, or recorded as explicit omissions. They never disappear without source-map evidence and a warning when user-perceivable content may be lost.
- **Decision:** The normalizer stamp contains an algorithm revision, a fully materialized configuration, and a digest of the canonical configuration. A normalized selector is usable only when the full stamp revision matches.
- **Decision:** `SourceMapSegment`s form a monotonic, non-overlapping mapping between normalized block text and source DOM text. Lossy transforms are represented, not rounded away.
- **Decision:** Mapping APIs return `exact`, `covering`, `ambiguous`, or `unmapped`; they do not silently manufacture a single source point for collapsed, generated, or omitted content.
- **Decision:** Source DOM offsets and normalized text offsets use UTF-16 code units. Optional raw-byte spans are diagnostic evidence only.

## 1. Boundary and purpose

```text
canonical Publication Resource
  href + media type + immutable source bytes
                    |
                    | NormalizationService.normalize(href, config)
                    v
NormalizedResource
  semantic AST + text projection + source map + warnings
                    |
          +---------+----------+----------------+
          |                    |                |
          v                    v                v
   citation/search       semantic DOM       optional canvas
   and indexing          navigator adapter  compatibility adapter
```

The source publication answers “what did the publisher ship?” The normalized resource answers “what semantic reading content can Haddon reason about consistently?” A navigator may use the normalized AST, a sanitized source DOM, or a specialized rendition depending on capability and product policy.

Normalization must therefore be useful but reversible enough to explain a citation. It may repair or simplify wonky books, but it cannot make that repair invisible.

The current Haddon model already proves the value of a small derived representation, but it supports only headings and paragraphs with styled text runs ([`types.rs:91-108`](../../crates/core/src/types.rs#L91)). Its eager `EpubDocument` retains title, author, chapters, and extracted note strings, not publication resources or source identities ([`types.rs:77-89`](../../crates/core/src/types.rs#L77)). This contract evolves that useful derived layer instead of promoting it into the canonical publication.

### Service boundary

```ts
interface NormalizationService {
  normalize(
    href: string,
    options?: {
      config?: Partial<NormalizationConfigV1>
      signal?: AbortSignal
    }
  ): Promise<NormalizationResult>
}

type NormalizationResult =
  | { status: "normalized"; resource: NormalizedResourceV1 }
  | {
      status: "unsupported"
      href: string
      mediaType: string
      fallback?: ResourceLink
      warnings: readonly NormalizationWarning[]
    }
```

- Only owned textual resources with a supported parser produce a `NormalizedResource`.
- Any owned reading-order or auxiliary resource may be normalized on request; `linear="no"` does not make notes semantically nonexistent.
- Manifest fallback selection happens at the publication/profile layer. The normalizer reports an available fallback rather than silently substituting one resource's identity for another.
- Cancellation yields no partial successful resource. Incremental implementations may stream private events, but the portable V1 result is atomic.

## 2. Portable resource shape

The TypeScript definitions in this document are semantic contract pseudocode. `readonly` collections and plain JSON-compatible data are intentional.

```ts
type NormalizedResourceV1 = {
  schema: "haddon.normalized-resource"
  version: 1
  href: string
  mediaType: string
  sourceRevision: string
  normalization: NormalizationStampV1
  root: NormalizedDocumentNode
  sourceMap: SourceMapV1
  warnings: readonly NormalizationWarning[]
}

type NormalizedDocumentNode = NormalizedNodeBase & {
  kind: "document"
  children: readonly BlockNode[]
}
```

### Resource invariants

1. `href` is the same canonical, fragmentless publication-relative href used by `Manifest`, `Resource`, and `PublicationLocator`.
2. `sourceRevision` equals the opened publication's source revision. It is not a hash of normalized output.
3. `mediaType` describes the source resource. It is not changed to `text/plain` merely because normalization produced text.
4. `root` is ordered in logical source reading order, not visual page order.
5. Node arrays preserve semantic document order. Maps and extension objects do not carry order.
6. The AST, map, and warnings are created as one result under one normalization stamp.
7. A successful empty document is distinct from an unsupported resource and carries a warning explaining why no user-perceivable content was found.

## 3. Common node contract and deterministic identity

```ts
type NormalizedNodeBase = {
  id: NormalizedNodeId
  source: NodeSourceEvidence
  language?: string
  direction?: "ltr" | "rtl" | "auto"
  roles: readonly SemanticRole[]
  sourceRoles: readonly string[]
  extensions?: Readonly<Record<string, JsonValue>>
}

type NormalizedNodeId = string

type SemanticRole =
  | "abstract"
  | "acknowledgments"
  | "appendix"
  | "bibliography"
  | "bodymatter"
  | "chapter"
  | "conclusion"
  | "endnote"
  | "endnotes"
  | "epigraph"
  | "footnote"
  | "footnotes"
  | "glossary"
  | "introduction"
  | "landmark"
  | "pagebreak"
  | "part"
  | "preface"
  | "prologue"
  | "pullquote"
  | "sidebar"
  | `extension:${string}`
```

`roles` contains Haddon-understood semantic roles after mapping EPUB structural semantics and applicable ARIA document roles. `sourceRoles` preserves the normalized raw tokens from `epub:type`, `role`, and equivalent source vocabularies in source order. An unknown role becomes `extension:<absolute-vocabulary-or-token>` when its vocabulary is known; otherwise it remains only in `sourceRoles` with a warning when it affected interpretation.

### Effective inheritance

- `language` is the effective BCP 47 language after source inheritance. The lexical source value remains in source evidence/extensions when it differs.
- `direction` is the effective semantic direction from `dir` or a format-equivalent property. It does not include a direction inferred transiently by a layout engine.
- Omitted `language` or `direction` means no value was established, not English or LTR.
- Inline nodes repeat an inherited value only when it changes from their parent in the serialized AST. Readers compute the effective value while walking ancestors.
- Invalid language/direction tokens are preserved as source attributes, ignored semantically, and warned about.

Foliate recursively inherits `lang`/`xml:lang` when preparing TTS ([`tts.js:14-21`](../../repos/foliate-js/tts.js#L14)), while Readium attaches effective language to text segments ([`HtmlResourceContentIterator.kt:380-390`](../../repos/readium-kotlin-toolkit/readium/shared/src/main/java/org/readium/r2/shared/publication/services/content/iterators/HtmlResourceContentIterator.kt#L380), [`HtmlResourceContentIterator.kt:462-483`](../../repos/readium-kotlin-toolkit/readium/shared/src/main/java/org/readium/r2/shared/publication/services/content/iterators/HtmlResourceContentIterator.kt#L462)). Haddon adopts the effective-value behavior but retains the enclosing semantic tree.

### ID construction

IDs are scoped to one `NormalizedResource`; consumers must pair them with `href` and the normalization revision.

1. If one normalized node corresponds one-to-one to a source element with a unique source `id`, its preferred ID is `src:<href>#<source-id>` after percent-normalizing literal `%` and `#` in the two components.
2. If one source element yields multiple normalized nodes, append `~<kind>~<split-ordinal>` to the preferred ID. The zero-based split ordinal follows normalized document order and counts only nodes generated from that element.
3. Otherwise use `n1:<digest>`, where `digest` is the lowercase base64url encoding of the first 128 bits of SHA-256 over a length-prefixed tuple:

   ```text
   canonical href
   primary source structural path
   normalized node kind
   split ordinal
   nearest unique source ancestor id, or empty
   ```

4. The primary structural path is computed from the parsed source tree before normalizer-generated wrappers, ignored-element flattening, or renderer repair. Each element step uses the namespace URI, local name, and one-based index among same-name element siblings. A source text-node primary appends `text()[<textNodeIndex>]` using the source evidence definition in section 9.
5. A source document with duplicate `id` values does not receive duplicate `src:` IDs. The first element in source order may use the source ID; all duplicates use structural `n1:` IDs and produce a duplicate-ID warning.
6. Generated nodes without a source element use their source boundary anchor plus a stable generation reason and generation ordinal in place of the structural path.
7. A collision after construction is a normalization failure, not an invitation to append a process-dependent counter.

The source revision and normalization revision deliberately do not appear inside readable `src:` IDs. The locator envelope already guards both identities, and retaining a publisher ID helps debugging. IDs alone are never cross-revision proof.

CoolReader provides the cautionary precedent: it versions DOM-building behavior specifically because parser/DOM changes can invalidate saved bookmarks ([`lvtinydom.cpp:40-50`](../../repos/coolreader/crengine/src/lvtinydom.cpp#L40)), and its normalized XPointer form explicitly skips renderer-inserted boxing nodes ([`lvtinydom.cpp:10089-10121`](../../repos/coolreader/crengine/src/lvtinydom.cpp#L10089)). Haddon similarly derives identity from the pre-repair source tree and gates normalized IDs by revision.

## 4. Block AST

The V1 block vocabulary is intentionally broader than the current canvas model but smaller than HTML/CSS.

```ts
type BlockNode =
  | SectionBlock
  | TextBlock
  | ListBlock
  | ListItemBlock
  | FigureBlock
  | TableBlock
  | TableSectionBlock
  | TableRowBlock
  | TableCellBlock
  | AsideBlock
  | ThematicBreakBlock
  | PageBreakBlock
  | MediaBlock
  | OpaqueBlock
  | UnsupportedBlock

type SectionBlock = NormalizedNodeBase & {
  kind: "section"
  children: readonly BlockNode[]
}

type TextBlock = NormalizedNodeBase & {
  kind: "textBlock"
  role:
    | { kind: "paragraph" }
    | { kind: "heading"; level: number }
    | { kind: "quote"; cite?: LinkTarget }
    | { kind: "preformatted" }
    | { kind: "code"; languageHint?: string }
    | { kind: "caption" }
    | { kind: "term" }
    | { kind: "definition" }
  inlines: readonly InlineNode[]
  /** Normative projection of inlines; see section 6. */
  text: string
}

type ListBlock = NormalizedNodeBase & {
  kind: "list"
  ordered: boolean
  start?: number
  reversed?: boolean
  children: readonly ListItemBlock[]
}

type ListItemBlock = NormalizedNodeBase & {
  kind: "listItem"
  value?: number
  children: readonly BlockNode[]
}

type FigureBlock = NormalizedNodeBase & {
  kind: "figure"
  content: readonly (MediaBlock | OpaqueBlock | UnsupportedBlock)[]
  caption: readonly BlockNode[]
}

type TableBlock = NormalizedNodeBase & {
  kind: "table"
  caption: readonly BlockNode[]
  children: readonly TableSectionBlock[]
}

type TableSectionBlock = NormalizedNodeBase & {
  kind: "tableSection"
  section: "head" | "body" | "foot"
  children: readonly TableRowBlock[]
}

type TableRowBlock = NormalizedNodeBase & {
  kind: "tableRow"
  children: readonly TableCellBlock[]
}

type TableCellBlock = NormalizedNodeBase & {
  kind: "tableCell"
  header: boolean
  columnSpan: number
  rowSpan: number
  headers: readonly string[]
  children: readonly BlockNode[]
}

type AsideBlock = NormalizedNodeBase & {
  kind: "aside"
  disposition: "note" | "footnote" | "endnote" | "sidebar" | "other"
  children: readonly BlockNode[]
}

type ThematicBreakBlock = NormalizedNodeBase & {
  kind: "thematicBreak"
}

type PageBreakBlock = NormalizedNodeBase & {
  kind: "pageBreak"
  label?: string
}
```

### Block rules

- Sections preserve meaningful hierarchy but do not imply viewport chapters or pages.
- Headings retain source heading level. A skipped level is not renumbered.
- Anonymous mixed inline content is wrapped in a generated paragraph with source-boundary evidence.
- Lists and tables remain structured. Flattening them into newline-delimited paragraphs is an adapter decision, never the canonical normalized form.
- A `PageBreakBlock` is a logical source marker and may have no rendered height. It does not create a viewport page.
- A figure retains media/object content and its caption separately.
- Preformatted/code text uses the same UTF-16 address space but a different whitespace policy.
- Empty semantic elements such as thematic breaks and page breaks remain in the tree even though they contribute no text.

CoolReader's render model distinguishes containers, final text blocks, inline elements, and table structures ([`lvstyles.h:328-345`](../../repos/coolreader/crengine/include/lvstyles.h#L328)). It also contains extensive repair for mixed inline/block children ([`lvtinydom.cpp:6540-6550`](../../repos/coolreader/crengine/src/lvtinydom.cpp#L6540), [`lvtinydom.cpp:6832-6838`](../../repos/coolreader/crengine/src/lvtinydom.cpp#L6832)). Haddon uses a comparable semantic distinction, but generated repair wrappers receive generated IDs and never masquerade as source elements.

## 5. Inline AST, links, notes, and media

```ts
type InlineNode =
  | TextInline
  | ContainerInline
  | LinkInline
  | NoteReferenceInline
  | LineBreakInline
  | MediaInline
  | RubyInline
  | OpaqueInline
  | UnsupportedInline

type TextInline = NormalizedNodeBase & {
  kind: "text"
  text: string
}

type ContainerInline = NormalizedNodeBase & {
  kind:
    | "emphasis"
    | "strong"
    | "code"
    | "subscript"
    | "superscript"
    | "strikethrough"
    | "mark"
    | "span"
  children: readonly InlineNode[]
}

type LinkTarget = {
  href: string
  external: boolean
  mediaType?: string
  title?: string
  rels: readonly string[]
}

type LinkInline = NormalizedNodeBase & {
  kind: "link"
  target: LinkTarget
  children: readonly InlineNode[]
}

type NoteReferenceInline = NormalizedNodeBase & {
  kind: "noteReference"
  target: LinkTarget
  noteKind: "footnote" | "endnote" | "bibliography" | "glossary" | "unknown"
  children: readonly InlineNode[]
}

type LineBreakInline = NormalizedNodeBase & {
  kind: "lineBreak"
}

type MediaSource = {
  href: string
  mediaType?: string
  width?: number
  height?: number
}

type MediaData = {
  mediaKind: "image" | "audio" | "video" | "object"
  primary?: MediaSource
  alternatives: readonly MediaSource[]
  poster?: MediaSource
  alt?: string
  title?: string
  transcriptHref?: string
}

type MediaInline = NormalizedNodeBase & MediaData & {
  kind: "mediaInline"
}

type MediaBlock = NormalizedNodeBase & MediaData & {
  kind: "mediaBlock"
}

type RubyInline = NormalizedNodeBase & {
  kind: "ruby"
  base: readonly InlineNode[]
  annotations: readonly {
    text: readonly InlineNode[]
    position?: "over" | "under" | "inter-character"
  }[]
}
```

### Inline rules

1. Strong/emphasis/code/subscript/superscript are semantics, not computed CSS. Purely visual publisher styling belongs to rendition, not this AST.
2. A generic `span` exists only when it carries language, direction, roles, source identity needed by a mapping, or preserved extension semantics. Meaningless wrappers are flattened and represented through the map.
3. Internal link targets are canonicalized relative to the current resource. They retain fragments in `target.href`; resource lookup separates the fragment according to the publication contract.
4. External links are marked explicitly. The normalizer does not apply navigation policy.
5. A note reference is a specialized link. The note body is normalized in its own source position/resource and is not duplicated inline.
6. Backlinks remain ordinary links unless source semantics identify a more specific role. Note/reference pairing is a derived relation, not an excuse to discard either link.
7. Media source alternatives preserve source order. Missing or invalid primary sources do not erase alt text or captions.
8. `alt` is accessibility data. It is searchable through an accessibility/search projection but does not silently replace the primary citation text.
9. Ruby base text contributes to primary text. Ruby annotations are retained structurally but excluded from primary text in V1 to avoid duplicate reading; an alternate TTS/accessibility projection may include them.

Readium's content abstraction usefully distinguishes textual and embedded elements, including image captions/accessibility labels and audio/video resources ([`Content.kt:33-80`](../../repos/readium-kotlin-toolkit/readium/shared/src/main/java/org/readium/r2/shared/publication/services/content/Content.kt#L33)). Its text elements contain ranged segments with attributes such as language ([`Content.kt:82-142`](../../repos/readium-kotlin-toolkit/readium/shared/src/main/java/org/readium/r2/shared/publication/services/content/Content.kt#L82)). Haddon retains those useful concepts but adds nested semantics and a durable source map; a flat stream alone cannot represent lists, note bodies, tables, or source-to-normalized range laws.

## 6. Normative text projection and offsets

Every `TextBlock.text` must equal the deterministic projection of its `inlines`. Writers store `text` for portability and indexing; readers validate it in strict/test mode.

### Primary citation projection

Walk inline children in logical order:

| Inline kind | Contribution |
|---|---|
| `text` | its exact normalized `text` |
| semantic container, link, note reference, generic span | recursive child projection |
| `lineBreak` | LF (`U+000A`) |
| inline media | one object replacement character (`U+FFFC`) |
| ruby | base projection only |
| opaque | recursive children, or `U+FFFC` when it has no text but is user-perceivable |
| unsupported | fallback child projection, accessibility label, or `U+FFFC`, in that order |

Block boundaries do not contribute characters. A selection can span blocks by using distinct start/end block IDs in a `NormalizedRangeSelector`, but one block's offsets never count a separator synthesized by search or display.

### Text normalization

- XML/HTML character references are decoded before source DOM offsets are measured.
- Source parser line-ending normalization is accepted as part of the source DOM contract. Raw-byte evidence records the original encoding when available.
- In ordinary text, HTML collapsible whitespace runs become one ASCII space. Leading/trailing collapsible whitespace at a block boundary is removed.
- Non-breaking spaces and other non-collapsible Unicode spaces are preserved. Readium makes this same deliberate exception so downstream matching does not lose NBSPs ([`HtmlResourceContentIterator.kt:521-556`](../../repos/readium-kotlin-toolkit/readium/shared/src/main/java/org/readium/r2/shared/publication/services/content/iterators/HtmlResourceContentIterator.kt#L521)).
- Preformatted/code blocks preserve source DOM characters after line-ending normalization.
- No Unicode NFC/NFKC normalization, case folding, smart punctuation replacement, hyphenation, or ligature expansion occurs in primary text.
- CSS-generated content, list marker glyphs, discretionary hyphens introduced by layout, and viewport line breaks are excluded.
- Source soft hyphens are preserved as source characters in V1. Search may use a separately revisioned folded projection.

### Offset contract

```ts
type TextOffset = {
  value: number
  unit: "utf16-code-unit"
}

type NormalizedTextPoint = {
  blockId: NormalizedNodeId
  offset: TextOffset
}

type NormalizedTextRange = {
  start: NormalizedTextPoint
  end: NormalizedTextPoint
}
```

- Ranges are half-open: start inclusive, end exclusive.
- Points may lie on any UTF-16 boundary that does not split a surrogate pair.
- Offsets are measured from `TextBlock.text` start, never from an inline node, UTF-8 bytes, Unicode scalar values, grapheme clusters, or rendered glyphs.
- Block order is the preorder of addressable `TextBlock`s within `root`. `start` must not follow `end` in that order.
- Non-text nodes are addressed structurally by node ID/source selectors, not by pretending they have a zero-length text block.

This fixes the current ambiguity: `DocumentPoint.offset` is an unlabeled `usize` ordered by chapter/block ordinals ([`types.rs:1-15`](../../crates/core/src/types.rs#L1)), and search fills it with lowercased UTF-8 byte indices ([`search.rs:21-40`](../../crates/core/src/search.rs#L21)). Those points remain valid only inside the legacy eager adapter.

## 7. Opaque, unsupported, omitted, and generated content

Normalization uses four distinct mechanisms. They must not be conflated.

```ts
type PreservedSourceDescriptor = {
  namespace?: string
  localName: string
  attributes: Readonly<Record<string, string>>
  markupDigest?: string
}

type OpaqueBlock = NormalizedNodeBase & {
  kind: "opaqueBlock"
  sourceElement: PreservedSourceDescriptor
  children: readonly BlockNode[]
}

type OpaqueInline = NormalizedNodeBase & {
  kind: "opaqueInline"
  sourceElement: PreservedSourceDescriptor
  children: readonly InlineNode[]
}

type UnsupportedData = {
  feature: string
  sourceElement: PreservedSourceDescriptor
  fallbackLabel?: string
}

type UnsupportedBlock = NormalizedNodeBase & UnsupportedData & {
  kind: "unsupportedBlock"
  fallback: readonly BlockNode[]
}

type UnsupportedInline = NormalizedNodeBase & UnsupportedData & {
  kind: "unsupportedInline"
  fallback: readonly InlineNode[]
}
```

- **Typed preservation:** Known constructs use the typed AST even if a particular renderer cannot display them. Renderer limitations are not normalization loss.
- **Opaque preservation:** Unknown/non-core elements with intelligible child flow retain their qualified name, safe declarative attributes, source evidence, and normalized children. Event handlers, script bodies, executable URLs, and active runtime state are never embedded in portable extensions.
- **Unsupported representation:** A user-perceivable construct whose semantics cannot safely be normalized receives an `Unsupported` node with any accessible/source fallback and a warning. MathML, canvas, scripted widgets, or embedded objects may begin here until dedicated profiles exist.
- **Omission:** Non-content such as scripts, styles, metadata containers, and comments can be excluded from the AST. The source map records a zero-width `omitted` segment when omission intersects content traversal or could affect a source range; meaningful omissions warn.
- **Generation:** Repair introduced by Haddon—anonymous paragraphs, a missing table wrapper, or an object replacement character—uses generated nodes/segments anchored to source boundaries. Generated content never claims an identity mapping.

The original source remains available through `Publication.getResource()`. Portable ASTs keep safe descriptors and hashes, not a second unsanitized copy of executable markup.

Foliate demonstrates the complementary source-faithful strategy: each EPUB section retains its href and can lazily load a rendition or create the original parsed document ([`epub.js:979-998`](../../repos/foliate-js/epub.js#L979)). Its text walker filters scripts/styles while retaining live DOM `Range`s into accepted text nodes ([`text-walker.js:18-42`](../../repos/foliate-js/text-walker.js#L18)). Haddon should preserve that source route alongside normalization, not force every book feature through the normalized vocabulary.

## 8. Normalization revision and configuration

```ts
type NormalizationStampV1 = {
  algorithm: "haddon-normalizer"
  algorithmRevision: string
  configSchema: "haddon.normalization-config"
  configVersion: 1
  config: NormalizationConfigV1
  configDigest: string
  /** Serialized into PublicationLocator.locations.normalized.revision. */
  revision: string
}

type NormalizationConfigV1 = {
  whitespace: "html-and-preserve-pre"
  unicodeNormalization: "none"
  hiddenContent: "source-semantic"
  unknownElements: "opaque-with-children"
  unsupportedContent: "fallback-or-placeholder"
  rubyProjection: "base-only"
  mediaProjection: "object-replacement"
  noteBodies: "in-source-position"
  generatedCssContent: "exclude"
}
```

### Stamp rules

1. Every field is materialized; no omitted defaults participate in hashing.
2. `configDigest` is lowercase base64url SHA-256 of RFC 8785 canonical JSON for `{configSchema, configVersion, config}`.
3. `revision` is `<algorithm>/<algorithmRevision>+<configDigest>`. It is treated as an opaque exact-match string by locators.
4. `algorithmRevision` changes for any behavior capable of changing AST shape, node IDs, primary text, source maps, role interpretation, or warning-relevant loss.
5. Configuration changes create a new `revision` even when the algorithm code is unchanged.
6. Parser library upgrades that can change source DOM structure or error recovery require either an algorithm revision or a separately pinned parser revision incorporated into `algorithmRevision`.
7. Cosmetic serializer changes that preserve semantic JSON need not change the revision.
8. Cached normalized resources are keyed by source revision, href, media type, and full normalization revision.

`hiddenContent: "source-semantic"` excludes explicit source semantics such as `hidden`, `aria-hidden="true"`, script/style/template content, and profile-equivalent constructs. V1 does not run arbitrary publisher CSS to decide whether prose exists. Whether a safe, deterministic stylesheet-aware mode is worth another configuration is an open question.

CoolReader's explicit DOM version history records seemingly small HTML/default-display changes because they can invalidate paths ([`lvtinydom.cpp:52-107`](../../repos/coolreader/crengine/src/lvtinydom.cpp#L52)). The normalizer stamp applies the same discipline to Haddon rather than relying on package versions or build dates.

## 9. Source evidence

Source evidence is structural and redundant. It supports debugging, mapping, and fresh locator generation; no single selector is assumed immortal.

```ts
type SourceElementRef = {
  href: string
  fragment?: string
  cssSelector?: string
  domPath: readonly SourcePathStep[]
  byteRange?: SourceByteRange
}

type SourcePathStep = {
  namespace?: string
  localName: string
  sameNameIndex: number
}

type SourceTextNodeRef = {
  container: SourceElementRef
  /** Descendant text-node ordinal in preorder, before normalization filters. */
  textNodeIndex: number
}

type SourceNodeRef = SourceElementRef | SourceTextNodeRef

type SourceDomPoint = {
  node: SourceTextNodeRef
  offset: TextOffset
}

type SourceDomRange = {
  start: SourceDomPoint
  end: SourceDomPoint
}

type SourceTextSpan = {
  /** Ordered, non-overlapping ranges, each confined to one source text node. */
  parts: readonly SourceDomRange[]
}

type SourceByteRange = {
  start: number
  endExclusive: number
  encoding?: string
}

type NodeSourceEvidence =
  | {
      origin: "source"
      primary: SourceNodeRef
      contributors: readonly SourceNodeRef[]
    }
  | {
      origin: "generated"
      reason: string
      before?: SourceDomPoint
      after?: SourceDomPoint
      contributors: readonly SourceNodeRef[]
    }
```

### Evidence rules

- `domPath` is required because a CSS selector can be unavailable or ambiguous. It is scoped to `href` and rooted at the source document element.
- `fragment` is present only for a unique source ID. Duplicate IDs remain observable but are not emitted as unique fragment evidence.
- `cssSelector`, when present, selects the same source element under the parser/version named by the normalization revision.
- `textNodeIndex` counts descendant DOM text nodes in preorder before ignored wrappers are flattened and before whitespace normalization. Script/style text nodes still count if present in the source DOM, which prevents filtering changes from renumbering later accepted nodes within the same algorithm revision.
- Source DOM text offsets use decoded DOM strings and UTF-16 units, matching browser range conventions.
- Byte ranges are optional and parser-specific. They aid diagnostics and exact source display but cannot replace DOM evidence because entities, encodings, and parser recovery break a simple byte-to-character law.
- `contributors` are deduplicated and sorted in source order. The first is not automatically primary; `primary` is chosen by the node-ID algorithm. Text inline leaves use their `SourceTextNodeRef` as primary, so they cannot collide with an enclosing element's readable `src:` ID.

## 10. Bidirectional source map

```ts
type SourceMapV1 = {
  schema: "haddon.source-map"
  version: 1
  offsetUnit: "utf16-code-unit"
  segments: readonly SourceMapSegment[]
}

type SourceMapSegment =
  | TextSourceMapSegment
  | ObjectSourceMapSegment
  | OmittedSourceMapSegment
  | GeneratedSourceMapSegment

type TextSourceMapSegment = {
  kind: "text"
  normalized: NormalizedTextRange
  source: SourceTextSpan
  transform: "identity" | "whitespace-collapse" | "replacement"
  /** Required for replacement; source is relative to concatenated span parts. */
  alignment?: readonly AlignmentPoint[]
}

type AlignmentPoint = {
  normalized: TextOffset
  source: TextOffset
}

type ObjectSourceMapSegment = {
  kind: "object"
  nodeId: NormalizedNodeId
  normalized?: NormalizedTextRange
  source: SourceElementRef
  projection: "none" | "object-replacement"
}

type OmittedSourceMapSegment = {
  kind: "omitted"
  normalizedAt: NormalizedTextPoint
  source: SourceTextSpan | SourceElementRef
  reason: string
}

type GeneratedSourceMapSegment = {
  kind: "generated"
  normalized: NormalizedTextRange
  sourceAnchor: SourceDomPoint | SourceElementRef
  reason: string
}
```

### Segment invariants

1. Segments are serialized in source document order. Because V1 normalization cannot reorder user-perceivable content, their non-empty normalized ranges are also monotonic in normalized block order.
2. At a shared boundary, order is `omitted`, `generated`, `object`, then `text`; ties within a kind use source order and node ID.
3. Non-empty normalized ranges never overlap. Every code unit in every `TextBlock.text` is covered exactly once by a `text`, projected `object`, or `generated` segment.
4. Every accepted source DOM text code unit is covered by a `text` segment or an `omitted` segment. Structural elements without text receive node evidence and, when addressable, an object or omission segment.
5. Every `SourceTextSpan` has at least one part. Parts are source-ordered and non-overlapping, and each part's endpoints refer to the same source text node. Relative source offsets count the concatenation of part texts; markup and gaps between parts contribute no units.
6. An `identity` segment has exactly one source part and equal normalized/source UTF-16 lengths. Each boundary maps by the same relative delta.
7. A `whitespace-collapse` segment maps one or more non-empty source whitespace parts to exactly one normalized ASCII space. Its two outer boundaries are exact; its interior source boundaries map to a covering normalized range. Multiple parts handle whitespace split by inline element boundaries without overlapping normalized segments.
8. A `replacement` segment has an `alignment` containing `(0,0)` and both relative end offsets. Pairs are strictly increasing on at least one axis and nondecreasing on both. Adjacent pairs describe the smallest irreducibly lossy region.
9. A generated segment has no inverse source range, only an anchor. An omitted segment has no normalized range, only a boundary.
10. Object replacement ranges have length one and contain `U+FFFC`. Non-projected block media omit `normalized` and are addressed by `nodeId`.
11. No segment crosses a normalized block or source resource boundary.
12. Source and normalized range endpoints are valid, ordered UTF-16 boundaries and never split surrogate pairs.
13. Reordering content, duplicating source prose without distinct generated evidence, or merging text from multiple source resources is invalid in V1.

These restrictions intentionally make the map somewhat verbose. Compression is an encoding concern; a precise map is the basis of citation confidence.

### Mapping result

```ts
type MappingResult<T> =
  | { status: "exact"; value: T; segments: readonly number[] }
  | {
      status: "covering"
      value: T
      reason: "collapsed" | "replacement" | "generated" | "omitted"
      segments: readonly number[]
    }
  | { status: "ambiguous"; candidates: readonly T[]; segments: readonly number[] }
  | { status: "unmapped"; reason: "outside" | "unsupported" | "invalid" }
```

`segments` contains zero-based indices into `SourceMapV1.segments` for provenance. Mapping warnings are returned alongside this result by the service-level API.

### Normalized to source

1. Validate the href, source revision, normalization revision, block ID, range ordering, and UTF-16 boundaries.
2. Find all segments touching the normalized start/end. Use a block/range index built from the ordered segment array.
3. For `identity`, translate the relative offset directly within its sole source part.
4. For `whitespace-collapse`, map its start/end boundaries exactly. An interior/collapsed cursor maps to the whole source whitespace run as `covering: collapsed`; range start uses `before` affinity and range end uses `after` affinity.
5. For `replacement`, interpolate only exact stored alignment boundaries. A point between alignment pairs maps to the corresponding source interval as `covering: replacement`.
6. For `object`, return the source element. A text API may additionally return the enclosing source boundary; it must not invent a text-node offset.
7. For `generated`, return its source anchor as `covering: generated`.
8. Combine endpoints into the smallest source DOM range that preserves half-open affinity. If the result would reverse order or cross resources, return `ambiguous`/`unmapped`.
9. Generate redundant fragment/CSS/DOM-range/quote evidence from the resolved source and normalized text for a fresh `PublicationLocator`.

### Source to normalized

1. Resolve and validate the source selector against the parser/version named by the normalization revision.
2. Find source-ordered segments whose source-span parts intersect the source point/range.
3. Invert identity and explicit alignment boundaries exactly.
4. Any interior point in source whitespace collapsed to one space returns that space's normalized range as `covering: collapsed`.
5. An omitted source range maps to its `normalizedAt` boundary as `covering: omitted`; citation policy must validate quote evidence before using it.
6. A source element represented by an object maps to its node ID and optional `U+FFFC` range.
7. Multiple equal source selectors, overlapping malformed DOM evidence, or duplicate quotes unresolved by context return `ambiguous`, never the first candidate.
8. After mapping, re-extract normalized text and compare any exact/prefix/suffix evidence before declaring citation resolution strong.

### Indexing and complexity

The serialized segment array is canonical. Runtime adapters may derive:

- block ID -> normalized interval tree,
- source text-node key -> source interval tree,
- node ID -> AST node/source evidence,
- source fragment -> candidate node IDs.

Construction validates all invariants in one linear pass after sorting. Point lookup is `O(log n + k)` with an index; range lookup is `O(log n + k)`, where `k` is the number of intersected segments. An implementation may delta-encode segments in cache storage, but exported JSON uses the explicit shape above.

## 11. Warnings and partial fidelity

HADDON-014 owns the final shared diagnostic schema and stable code registry. The normalizer requires at least this provisional payload:

```ts
type NormalizationWarning = {
  code: string
  severity: "info" | "warning" | "error"
  message: string
  href: string
  source?: SourceElementRef | SourceDomRange
  nodeIds: readonly NormalizedNodeId[]
  recoverable: true
  detail?: Readonly<Record<string, JsonValue>>
}
```

Candidate code families, to be finalized by HADDON-014:

- `normalization.duplicate-source-id`
- `normalization.invalid-language`
- `normalization.invalid-direction`
- `normalization.invalid-link`
- `normalization.opaque-element`
- `normalization.unsupported-element`
- `normalization.user-content-omitted`
- `normalization.generated-wrapper`
- `normalization.lossy-text-mapping`
- `normalization.media-missing-alternative`
- `normalization.empty-resource`
- `normalization.limit-exceeded`

Rules:

- A warning accompanies successful recovery. Failure to build an internally valid AST/map is a typed normalization error, not a successful resource with `severity: error` alone.
- Routine flattening of a semantically empty wrapper does not warn if complete source evidence/mapping remains.
- Opaque elements may be informational when all child content and accessibility data survive; unsupported or omitted user-perceivable content is at least a warning.
- Warnings are deterministically ordered by source position, code, then node ID.
- Warning messages are for humans; callers branch on codes only.
- Limits and truncation never return a deceptively complete source map. Either the result explicitly represents the unsupported remainder or normalization fails with a limit error.

## 12. Citation fixture acceptance examples

The project-owned fixture deliberately contains publisher IDs, emphasis, language change, note relationships, links, a page break, media, a nonlinear notes resource, and a foreign fallback ([fixture contract](../../crates/core/tests/fixtures/citation-roundtrip/README.md#fixture-contract)). HADDON-013 is accepted only when the following examples pass in both Rust and portable TypeScript JSON fixtures.

### 12.1 Citation paragraph

Source: [`chapter-1.xhtml:12`](../../crates/core/tests/fixtures/citation-roundtrip/EPUB/text/chapter-1.xhtml#L12).

Expected normalized facts:

```text
block id: src:text/chapter-1.xhtml#citation-target
kind/role: textBlock / paragraph
text: Before the signal, the copper astrolabe clicked once; the patient moon answered in blue, and the lesson continued after midnight.
quote range: [54, 87) utf16-code-unit
block length: 129 utf16-code-unit
```

- The `<em>` becomes an `emphasis` inline whose projected range is `[54, 87)` and whose text is exactly `the patient moon answered in blue`.
- Three source DOM text nodes map in order: paragraph prefix -> normalized `[0,54)`, emphasis text -> `[54,87)`, and paragraph suffix -> `[87,129)`.
- All three are identity segments after DOM entity/line-ending processing; element wrapper boundaries do not add characters.
- A locator produced for the quote contains the normalized block/range, `fragment: citation-target`, a source DOM range, and exact/prefix/suffix text from the fixture constants ([`citation_fixture.rs:6-9`](../../crates/core/tests/citation_fixture.rs#L6)).
- Reopening and normalizing with the same stamp produces byte-for-byte equal semantic JSON after canonical key ordering.

### 12.2 Language and note reference

Source: [`chapter-1.xhtml:13`](../../crates/core/tests/fixtures/citation-roundtrip/EPUB/text/chapter-1.xhtml#L13).

- The paragraph ID is `src:text/chapter-1.xhtml#language-and-note`.
- The Greek `span` has effective language `el`; its projected range is `[24,30)` and contains `κόσμος` without Unicode normalization.
- The note marker is a `noteReference`, not merely superscript styling. Its target is `text/notes.xhtml#note-1`, its kind is `footnote`, its visible child text is `1`, and the source `id="noteref-1"` is preserved in evidence.
- No space is synthesized before the marker because the source has none. The primary block text ends `later.1`.
- The note body is normalized when `text/notes.xhtml` is requested even though that resource is `linear="no"` in the package ([`package.opf:20-24`](../../crates/core/tests/fixtures/citation-roundtrip/EPUB/package.opf#L20)). Its containing aside/section carries `footnotes`; its note node carries `footnote`; the backlink remains `text/chapter-1.xhtml#noteref-1` ([`notes.xhtml:9-11`](../../crates/core/tests/fixtures/citation-roundtrip/EPUB/text/notes.xhtml#L9)).

The existing parser recognizes explicit EPUB/ARIA noteref tokens and matching backlinks ([`epub.rs:407-468`](../../crates/core/src/epub.rs#L407)), but then reduces the relationship to `Span.noteref_id` and a separate note string. The new AST preserves the navigable graph while a legacy adapter can still derive that field.

### 12.3 Page break, figure, and links

Source: [`chapter-1.xhtml:9-18`](../../crates/core/tests/fixtures/citation-roundtrip/EPUB/text/chapter-1.xhtml#L9).

- `page-1` becomes a `pageBreak` with label `1`, source roles containing `pagebreak` and `doc-pagebreak`, and ID `src:text/chapter-1.xhtml#page-1`.
- `compass-figure` becomes a figure containing an image media node with canonical source `images/compass.svg`, alt text `A blue compass rose pointing north`, and caption text block `An orientation aid.`
- The image contributes no primary block text because it is block media in a figure; it remains addressable by node ID and source element.
- `forward-link` retains an internal link target `text/chapter-2.xhtml#return-point`; the backlink in chapter 2 retains `text/chapter-1.xhtml#citation-target` ([`chapter-2.xhtml:12-13`](../../crates/core/tests/fixtures/citation-roundtrip/EPUB/text/chapter-2.xhtml#L12)).
- No typed construct above produces an unsupported/omission warning.

### 12.4 Unsupported resource and fallback

The package declares `data/dial.haddon` with `images/dial-fallback.svg` as its fallback ([`package.opf:15-18`](../../crates/core/tests/fixtures/citation-roundtrip/EPUB/package.opf#L15)). Requesting normalization of the foreign resource returns `status: unsupported`, retains its original href/media type, reports the fallback link, and does not produce an invented normalized text document under the fallback's identity.

### 12.5 Contract laws

1. Every fixture normalized node ID is unique and deterministic across repeated runs.
2. Every projected UTF-16 unit has exactly one covering segment.
3. `source quote -> normalized [54,87) -> source quote` is exact in both directions.
4. Mapping any source point inside a collapsed whitespace run yields `covering`, not a fabricated exact point.
5. Rust -> JSON -> TypeScript -> JSON -> Rust preserves AST order, stamp, source evidence, mappings, and warnings semantically.
6. Astral characters added by a test mutation reject offsets that split surrogate pairs.
7. Changing only viewport, font, theme, or pagination does not change the normalized resource.
8. Changing a normalization configuration changes `normalization.revision` and prevents stale normalized selectors from being trusted.

## 13. Upstream comparison and extracted lessons

### Current Haddon

Haddon parses every spine href eagerly into a `Chapter` ([`epub.rs:54-76`](../../crates/core/src/epub.rs#L54)), then recognizes only paragraph/heading blocks and a small style stack ([`epub.rs:356-405`](../../crates/core/src/epub.rs#L356)). It discards ordinary link targets, IDs, language, figures, and most structural roles; only a specialized footnote path survives. The current fixture test documents exactly those gaps ([`README.md:15-19`](../../crates/core/tests/fixtures/citation-roundtrip/README.md#intentional-current-model-gaps)).

What to keep:

- Small immutable text runs are easy for layout and tests.
- Explicit note detection is better than guessing solely from marker typography.
- An eager adapter remains useful while the lazy publication/service model lands.

What must change:

- Ordinal chapter/block identity becomes transient.
- `Span` style flags become semantic inline nodes or a legacy projection.
- Parsing must emit source evidence while it still knows source element/text boundaries.
- Search must consume normalized IDs/UTF-16 ranges instead of lowercased byte offsets.

### Readium content iterators

Readium defines an asynchronous stream of semantic `Element`s, including images/audio/video and text elements with roles/segments ([`Content.kt:20-30`](../../repos/readium-kotlin-toolkit/readium/shared/src/main/java/org/readium/r2/shared/publication/services/content/Content.kt#L20), [`Content.kt:49-93`](../../repos/readium-kotlin-toolkit/readium/shared/src/main/java/org/readium/r2/shared/publication/services/content/Content.kt#L49)). Its HTML iterator:

- parses a resource lazily and walks its body ([`HtmlResourceContentIterator.kt:154-183`](../../repos/readium-kotlin-toolkit/readium/shared/src/main/java/org/readium/r2/shared/publication/services/content/iterators/HtmlResourceContentIterator.kt#L154)),
- uses CSS selectors and quote context on emitted locators ([`HtmlResourceContentIterator.kt:294-303`](../../repos/readium-kotlin-toolkit/readium/shared/src/main/java/org/readium/r2/shared/publication/services/content/iterators/HtmlResourceContentIterator.kt#L294), [`HtmlResourceContentIterator.kt:422-439`](../../repos/readium-kotlin-toolkit/readium/shared/src/main/java/org/readium/r2/shared/publication/services/content/iterators/HtmlResourceContentIterator.kt#L422)),
- emits images with alt labels but still has an explicit caption TODO ([`HtmlResourceContentIterator.kt:311-327`](../../repos/readium-kotlin-toolkit/readium/shared/src/main/java/org/readium/r2/shared/publication/services/content/iterators/HtmlResourceContentIterator.kt#L311)), and
- currently emits parsed text with `Role.Body`, leaving richer structural roles unused in this iterator ([`HtmlResourceContentIterator.kt:422-439`](../../repos/readium-kotlin-toolkit/readium/shared/src/main/java/org/readium/r2/shared/publication/services/content/iterators/HtmlResourceContentIterator.kt#L422)).

Lesson: adopt lazy per-resource work, language-bearing text segments, embedded-resource elements, locators, and quote context. Add an explicit tree and source map because Klemata needs structure and explainable range round trips, not only a forward iterator.

### Foliate

Foliate largely keeps the browser DOM as its rich rendition model. It parses invalid XHTML with an observable HTML recovery fallback ([`epub.js:813-822`](../../repos/foliate-js/epub.js#L813)), rewrites publication-owned resource URLs while preserving the document ([`epub.js:839-863`](../../repos/foliate-js/epub.js#L839)), and resolves href fragments back to live DOM anchors ([`epub.js:1048-1054`](../../repos/foliate-js/epub.js#L1048)). Its TTS layer defines a pragmatic set of block boundaries and uses DOM ranges rather than replacing source identity ([`tts.js:6-17`](../../repos/foliate-js/tts.js#L6), [`tts.js:123-142`](../../repos/foliate-js/tts.js#L123)).

Lesson: source-faithful DOM is a first-class rendition/citation fallback. Haddon normalization should coexist with it. Foliate also shows that normalization consumers may want different projections—TTS preserves emphasis/language in SSML ([`tts.js:47-96`](../../repos/foliate-js/tts.js#L47))—so primary citation text must not be the only possible projection.

### CoolReader

CoolReader has a large persistent DOM and layout engine. Its block/final/inline/table render methods cover far more broken-document cases than Haddon's current two block variants ([`lvstyles.h:328-345`](../../repos/coolreader/crengine/include/lvstyles.h#L328)). It treats hidden content, objects, mixed content, tables, and generated boxing explicitly; for example, it detects text/images/line breaks as meaningful inline content and ignores invisible subtrees ([`lvtinydom.cpp:6091-6119`](../../repos/coolreader/crengine/src/lvtinydom.cpp#L6091)). Most importantly, it versions DOM behavior and migrates saved bookmark XPointers between versions ([`hist.cpp:487-515`](../../repos/coolreader/crengine/src/hist.cpp#L487)).

Lesson: malformed-book repair and layout-generated wrappers must be explicit, versioned, and excluded from durable source identity. Haddon should mine CoolReader for fixture ideas and recovery behavior, not copy its renderer-specific DOM into the portable contract.

## 14. Rust sketch

This sketch emphasizes domain boundaries; concrete serde tagging, arena storage, async traits, and small-string choices remain implementation details.

```rust
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct NormalizedResource {
    pub href: PublicationHref,
    pub media_type: MediaType,
    pub source_revision: SourceRevision,
    pub normalization: NormalizationStamp,
    pub root: DocumentNode,
    pub source_map: SourceMap,
    pub warnings: Vec<NormalizationWarning>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct NodeBase {
    pub id: NormalizedNodeId,
    pub source: NodeSourceEvidence,
    pub language: Option<LanguageTag>,
    pub direction: Option<TextDirection>,
    pub roles: Vec<SemanticRole>,
    pub source_roles: Vec<String>,
    pub extensions: BTreeMap<String, JsonValue>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum BlockNode {
    Section { base: NodeBase, children: Vec<BlockNode> },
    Text(TextBlock),
    List(ListBlock),
    ListItem { base: NodeBase, value: Option<i64>, children: Vec<BlockNode> },
    Figure(FigureBlock),
    Table(TableBlock),
    Aside(AsideBlock),
    ThematicBreak { base: NodeBase },
    PageBreak { base: NodeBase, label: Option<String> },
    Media(MediaNode),
    Opaque(OpaqueBlock),
    Unsupported(UnsupportedBlock),
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TextBlock {
    pub base: NodeBase,
    pub role: TextBlockRole,
    pub inlines: Vec<InlineNode>,
    pub text: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum InlineNode {
    Text { base: NodeBase, text: String },
    Container { base: NodeBase, kind: InlineKind, children: Vec<InlineNode> },
    Link { base: NodeBase, target: LinkTarget, children: Vec<InlineNode> },
    NoteReference { base: NodeBase, target: LinkTarget, note_kind: NoteKind, children: Vec<InlineNode> },
    LineBreak { base: NodeBase },
    Media(MediaNode),
    Ruby(RubyNode),
    Opaque(OpaqueInline),
    Unsupported(UnsupportedInline),
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
pub struct Utf16Offset(pub u64);

#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum SourceMapSegment {
    Text(TextSegment),
    Object(ObjectSegment),
    Omitted(OmittedSegment),
    Generated(GeneratedSegment),
}

pub enum MappingResult<T> {
    Exact { value: T, segments: Vec<usize> },
    Covering { value: T, reason: LossReason, segments: Vec<usize> },
    Ambiguous { candidates: Vec<T>, segments: Vec<usize> },
    Unmapped { reason: UnmappedReason },
}
```

Internal parsers may use UTF-8 byte indices while building strings, but conversion to `Utf16Offset` happens at a checked boundary. Plain `usize` must not appear in serialized points, ranges, or map segments.

## 15. Portable TypeScript adapter

The JSON types above are the portable data contract. Runtime behavior can remain small:

```ts
interface NormalizedResourceView {
  readonly data: NormalizedResourceV1

  getNode(id: NormalizedNodeId): BlockNode | InlineNode | undefined

  mapNormalizedRange(
    range: NormalizedTextRange,
    options?: { signal?: AbortSignal }
  ): Promise<MappingResult<SourceDomRange | SourceElementRef | SourceDomPoint>>

  mapSourceRange(
    range: SourceDomRange,
    options?: { signal?: AbortSignal }
  ): Promise<MappingResult<NormalizedTextRange>>

  projectText(options?: {
    projection?: "citation" | "search" | "accessibility" | "tts"
    signal?: AbortSignal
  }): Promise<readonly ProjectedTextBlock[]>
}
```

The adapter may be backed by Rust/WASM or pure TypeScript. It exposes no Rust allocation handles, framework component, Remix route object, live DOM node, or browser layout coordinate. A browser navigator owns conversion from the AST to semantic DOM and can retain a separate source DOM for higher-fidelity rendition.

## 16. Cross-language conformance laws

Rust and TypeScript implementations must consume the same fixture JSON and pass these laws:

1. **Determinism:** same source revision + href + media type + stamp yields the same semantic AST, IDs, mappings, and ordered warnings.
2. **ID uniqueness:** node IDs are unique within one resource; a duplicate source ID cannot violate this.
3. **Projection agreement:** stored `TextBlock.text` equals the normative inline projection.
4. **Offset agreement:** Rust and JavaScript select identical substrings for ASCII, combining marks, BMP non-ASCII, variation selectors, and astral characters.
5. **Surrogate safety:** no accepted point splits a surrogate pair.
6. **Complete normalized coverage:** every normalized UTF-16 code unit has exactly one mapping segment.
7. **Source accounting:** every traversed source text unit is mapped or explicitly omitted.
8. **Monotonicity:** source order and normalized order never cross.
9. **Exact identity round trip:** points and ranges entirely within identity segments map source -> normalized -> source exactly and vice versa.
10. **Loss honesty:** whitespace collapse, replacement, generated, and omitted content never report an invented exact round trip.
11. **Range convention:** all ranges are half-open; block boundaries add no hidden separator.
12. **Revision safety:** no mapping or normalized locator is used under a mismatched normalization revision or source revision.
13. **Semantic retention:** fixture language, direction, roles, links, note pairs, media alt text, captions, list/table structure, and page breaks survive typed normalization.
14. **Unknown-content visibility:** user-perceivable unsupported content yields a node/warning or a typed normalization failure.
15. **No layout coupling:** viewport, font, pagination, theme, and React/Remix lifecycle changes cannot change normalized output.
16. **Cancellation:** cancellation never returns a partial resource marked successful.
17. **JSON round trip:** unknown extension keys are preserved where allowed; unknown node kinds reject V1 unless negotiated through a version/extension mechanism.

## 17. Incremental migration from current Haddon

| Step | Change | Compatibility |
|---|---|---|
| 1 | Add the normalization stamp, UTF-16 boundary types, source evidence, AST, and source-map serde types beside current `EpubDocument`. | No renderer behavior changes. |
| 2 | Make the XHTML parser build a source tree/event model that retains element IDs, paths, text-node ordinals, language, direction, roles, hrefs, and optional byte spans. | `parse_epub` can still call the old reduction. |
| 3 | Implement paragraphs, headings, semantic inline containers, links, notes, page breaks, figures/images, and mappings needed by the citation fixture. | Derive legacy `Chapter/Block/Span` from the new AST for canvas. |
| 4 | Add mapping validation and shared JSON conformance tests, including whitespace collapse and Unicode boundary cases. | Existing tests stay; new citations use normalized IDs only after laws pass. |
| 5 | Make `NormalizationService` lazy over publication resources; cache by source/stamp identity. | Keep eager `parse_epub` as `open -> normalize reading order -> legacy adapter`. |
| 6 | Move search output to normalized ranges and convert to `PublicationLocatorV1`; retain byte-index search only inside the legacy adapter. | Legacy session points require the migration in `publication-model.md`. |
| 7 | Add lists, tables, ruby, media alternatives, opaque/unsupported nodes, and failure/warning policies against mined upstream fixtures. | Renderers feature-detect node kinds and fall back explicitly. |
| 8 | Build semantic DOM and constrained canvas adapters from the same AST; keep source-faithful DOM available for publications outside normalized fidelity. | Klemata integrates through publication/locator/navigator contracts, not AST internals. |

The parser must emit mapping evidence during normalization. Reconstructing exact source mappings after reducing source markup to the current `Span { text, flags }` is impossible.

## 18. Decisions versus open questions

### Settled by HADDON-013

- The normalized AST is derived and resource-scoped, never canonical publication state.
- Source href plus normalization revision scopes normalized node identity.
- Every node has deterministic identity and source evidence.
- Primary text and offsets are explicit, UTF-16, and half-open.
- The portable AST retains semantic structure, links, notes, media, language, direction, roles, and accessibility labels.
- Arbitrary layout CSS is not part of normalized semantics.
- Unknown and unsupported constructs remain observable.
- Source maps are monotonic, bidirectional, and loss-aware.
- Renderer-generated wrappers and viewport pages never become durable citation identity.

### Open questions for follow-up tickets

1. **Diagnostic registry (HADDON-014):** final code names, shared warning/error shape, localization, and serialization stability.
2. **Quote/search projection (HADDON-018):** case folding, Unicode folding, hyphen handling, context window, and fuzzy recovery policy. These must not mutate primary citation text.
3. **Security limits (HADDON-020):** safe opaque attributes, URL schemes, DOM depth, node/text/map limits, CSS inspection, and parser recovery budgets.
4. **CSS-hidden prose:** whether a safe stylesheet-aware normalization configuration is necessary, and how its CSS engine/version enters the stamp.
5. **MathML:** typed semantic subtree, source-faithful DOM only, generated accessible text, or unsupported V1 node.
6. **Ruby projections:** exact TTS/accessibility ordering for complex ruby and whether annotations need their own address space.
7. **Bidirectional text controls:** whether normalization materializes semantic isolation controls in an alternate text projection or leaves all behavior to structured direction fields.
8. **Table citation text:** row/cell separator rules for search/export projections; block-local citation offsets remain separator-free.
9. **Multi-source generated nodes:** whether future format adapters may combine resources; V1 explicitly forbids it.
10. **Binary source spans:** which parsers can produce reliable byte evidence without sacrificing streaming or recovery.
11. **Serialization size:** delta/binary cache encoding for large source maps after the explicit JSON contract is validated.

None of these questions changes the central boundary: Haddon may normalize ugly books aggressively enough to create a coherent learning surface, but every normalized passage must retain deterministic identity, source evidence, and an honest account of what changed.
