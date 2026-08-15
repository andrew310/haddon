# Haddon Publication and Locator Contracts

**Status:** Proposed design for HADDON-011 and HADDON-012

**Date:** 2026-08-13

**Scope:** Canonical publication graph, lazy resources, lifecycle, capability boundary, and durable publication locators

**Out of scope:** The normalized node vocabulary and source-map segment format (HADDON-013), the complete error taxonomy (HADDON-014), and the Klemata storage/URL wrapper (HADDON-040)

This document turns the [north-star brief](../research/2026-08-13-e-reader-north-star.md) and [Wave 1 reconnaissance](../research/2026-08-13-wave-1-reconnaissance.md) into contracts that can be implemented in Rust and exposed to a Web host without changing their meaning.

## Decision summary

The labels in this section are normative for the first implementation.

- **Decision:** `Publication` is an opened, closeable runtime object composed of immutable identity, an immutable `Manifest`, a lazy resource container, and optional services.
- **Decision:** The manifest is a serializable description. It never contains open file handles, DOM nodes, object URLs, readers, or framework state.
- **Decision:** A canonical resource is identified by its publication-relative `href`, not by a spine/chapter index. Indices are transient ordering information.
- **Decision:** `ResourceLink` describes a target; `Resource` is a lazy, closeable byte-access handle for a target owned by the publication.
- **Decision:** The minimum universal surface is manifest inspection, resource lookup/read, capability discovery, and deterministic close. Normalization, locating, positions, search, and specialized renditions are services.
- **Decision:** `PublicationLocator` is internal to one publication. A Klemata citation must wrap it with volume/edition identity; the locator does not pretend that an `href` identifies a volume globally.
- **Decision:** A locator is a versioned envelope of redundant source, normalized, structural, textual, and progression evidence. Only `href` and `mediaType` are required at the publication-locator level.
- **Decision:** Persisted text offsets use UTF-16 code units and half-open ranges. The unit and normalizer revision are serialized explicitly.
- **Decision:** Resolution returns `resolved`, `ambiguous`, or `unresolved`; it never silently returns the nearest nullable target.
- **Decision:** Closing publications and resources is idempotent. Any new operation after close fails with a typed closed error.

These decisions adapt Readium's `Manifest + container + services` split—the Kotlin entry point makes those three responsibilities explicit at [Publication.kt:44](../../repos/readium-kotlin-toolkit/readium/shared/src/main/java/org/readium/r2/shared/publication/Publication.kt#L44)—while retaining Foliate's small, lazy section contract at [epub.js:979](../../repos/foliate-js/epub.js#L979).

## 1. Conceptual boundaries

```text
Klemata CitationTarget
  volumeId + editionId/sourceRevision + PublicationLocator
                              |
                              v
Publication (opened runtime)
  identity + Manifest + ResourceContainer + optional Services
                              |
              +---------------+----------------+
              |                                |
              v                                v
    source Resource bytes             NormalizationService
                                      NormalizedResource
                                      + source mappings
```

`Publication` is canonical for source identity, metadata, reading order, navigation, and resource access. A `NormalizedResource` is a derived view and must not replace or mutate the source graph. A navigator consumes either normalized content or a specialized source-faithful rendition, but viewport pages never enter these contracts.

Readium exposes manifest fields through its publication while keeping the fetcher/container separate ([TypeScript `Publication.ts:18-47`](../../repos/readium-ts-toolkit/shared/src/publication/Publication.ts#L18), [Kotlin `Publication.kt:54-84`](../../repos/readium-kotlin-toolkit/readium/shared/src/main/java/org/readium/r2/shared/publication/Publication.kt#L54)). Foliate independently shows why the runtime contract should be format-neutral: PDF and comic books expose the same lazy `sections` idea despite unrelated storage and rendering ([pdf.js:129-178](../../repos/foliate-js/pdf.js#L129), [comic-book.js:26-43](../../repos/foliate-js/comic-book.js#L26)).

### Layer ownership

| Concern | Owner | Persisted? |
|---|---|---:|
| Volume, edition, source fingerprint | `PublicationIdentity` supplied/confirmed by host | yes |
| Metadata, reading order, resources, navigation | `Manifest` | yes/cacheable |
| Archive/network/file handles | `ResourceContainer` | no |
| Resource bytes and byte ranges | `Resource` | no |
| Normalize, locate, search, positions | optional publication services | results only |
| Current location, selection, layout | navigator/session | session state only |
| Klemata lesson/citation context | Klemata | yes |

## 2. Publication identity

```ts
type PublicationIdentity = {
  /** Klemata's stable identity for the conceptual volume. */
  volumeId: string
  /** Stable identity for the edition when Klemata has one. */
  editionId?: string
  /** Fingerprint or immutable revision of the opened source bytes. */
  sourceRevision: string
}

type PublicationIdentityHint = {
  volumeId?: string
  editionId?: string
  sourceRevision?: string
}
```

- **Decision:** `volumeId` and `sourceRevision` are required on every opened `Publication`. `editionId` remains optional until Klemata's edition model is finalized by HADDON-040. Klemata's store of record is a pinned EPUB in blob storage (`klemata/docs/sources/editions.md`); `sourceRevision` is the SHA-256 of those bytes.
- **Decision:** OPF/Web Publication metadata identifiers are descriptive metadata, not runtime identity. Readium makes the same distinction because a publication metadata identifier can be absent or non-unique ([Publication.kt:35-42](../../repos/readium-kotlin-toolkit/readium/shared/src/main/java/org/readium/r2/shared/publication/Publication.kt#L35)).
- **Decision:** A persisted Klemata citation must contain `volumeId`, and must contain at least one of `editionId` or `sourceRevision`. The HADDON-040 schema may require both.
- **Decision:** `sourceRevision` identifies source content, not a normalization build. A normalizer revision belongs only on normalized selectors.
- **Decision:** The opener accepts an optional `PublicationIdentityHint`, computes or validates the missing revision, and always returns a complete `PublicationIdentity`. Standalone Haddon may derive a namespaced `volumeId` and `sourceRevision` from a content fingerprint, but must mark the volume identity as locally derived when exporting it to a host.

**Open question:** Which digest and canonical input define `sourceRevision` for exploded directories, streamed publications, and archives whose non-content ZIP metadata changes? This blocks persistence policy, not the type boundary.

## 3. Manifest

The manifest is an immutable, serialization-friendly graph. Its initial semantic shape is:

```ts
type Manifest = {
  metadata: PublicationMetadata
  profile: PublicationProfile
  links: readonly ResourceLink[]
  readingOrder: readonly ResourceLink[]
  resources: readonly ResourceLink[]
  navigation: {
    toc: readonly ResourceLink[]
    landmarks: readonly ResourceLink[]
    pageList: readonly ResourceLink[]
    other: Readonly<Record<string, readonly ResourceLink[]>>
  }
  rendition: RenditionHints
  extensions: Readonly<Record<string, JsonValue>>
}

type PublicationProfile =
  | "epub"
  | "web-publication"
  | "pdf"
  | "visual-narrative"
  | "audiobook"
  | `extension:${string}`

type PublicationMetadata = {
  identifier?: string
  title?: LocalizedString
  contributors: readonly Contributor[]
  languages: readonly string[]
  readingProgression?: "ltr" | "rtl" | "ttb" | "btt" | "auto"
  conformsTo: readonly string[]
  extensions: Readonly<Record<string, JsonValue>>
}
```

Readium's serializable manifest separates top-level links, reading order, resources, TOC, and subcollections ([TypeScript `Manifest.ts:17-50`](../../repos/readium-ts-toolkit/shared/src/publication/Manifest.ts#L17)); its Kotlin model uses the same split ([Manifest.kt:28-39](../../repos/readium-kotlin-toolkit/readium/shared/src/main/java/org/readium/r2/shared/publication/Manifest.kt#L28)). Haddon groups navigation collections only to make TOC, landmarks, and page list equally visible. The JSON adapter may still read and write Readium Web Publication Manifest field names.

### Manifest invariants

1. `readingOrder` preserves source spine order exactly, including nonlinear entries. A `linear` property expresses whether default sequential navigation includes the entry; the entry is not discarded.
2. `resources` preserves the source manifest independently from `readingOrder`. The same `href` may be described in both collections but must resolve to one canonical resource key.
3. `links` describes publication-level relations such as `self`, `cover`, or alternate manifests. It may include external targets.
4. Navigation is hierarchical through `ResourceLink.children`. Navigation order and hierarchy are preserved even if a target cannot be rendered.
5. Source-format IDs, fallback chains, media-overlay relationships, EPUB properties, and rendition hints are retained in typed properties or `extensions`; they are not made into resource identity.
6. Manifest collections are immutable after open. Parser recovery is reported through `OpenPublication.warnings`, not by later mutating the graph.
7. An empty collection means the publication declared or yielded no entries. A missing optional capability is not represented by an empty collection or no-op service.

The current parser does not satisfy these invariants: it reduces the OPF manifest to an ID-to-href map and returns only ordered spine hrefs ([`epub.rs:228-238`](../../crates/core/src/epub.rs#L228)), then eagerly parses each href into a chapter ([`epub.rs:54-76`](../../crates/core/src/epub.rs#L54)).

## 4. ResourceLink and canonical hrefs

```ts
type ResourceLink = {
  /** Canonical publication-relative URI reference. */
  href: string
  mediaType?: string
  title?: LocalizedString
  rels: readonly string[]
  properties: Readonly<Record<string, JsonValue>>
  sourceId?: string
  size?: number
  duration?: number
  width?: number
  height?: number
  languages: readonly string[]
  alternates: readonly ResourceLink[]
  children: readonly ResourceLink[]
}
```

This retains the useful shape shared by Readium TypeScript ([`Link.ts:16-61`](../../repos/readium-ts-toolkit/shared/src/publication/Link.ts#L16)) and Kotlin ([`Link.kt:31-63`](../../repos/readium-kotlin-toolkit/readium/shared/src/main/java/org/readium/r2/shared/publication/Link.kt#L31)).

### Href rules

- **Decision:** The canonical identity of an owned resource is a normalized, publication-relative URI reference without a fragment. `PublicationLocator.href` uses the same representation.
- **Decision:** Fragments are stored separately in locator `locations.fragments`. A link presented to the API may contain a fragment; lookup strips it before resource access, as Readium does ([Publication.kt:155-168](../../repos/readium-kotlin-toolkit/readium/shared/src/main/java/org/readium/r2/shared/publication/Publication.kt#L155)).
- **Decision:** Canonicalization resolves dot segments, rejects traversal above the virtual publication root, and applies one documented percent-encoding normalization. It never compares only basenames. Exact security and URL algorithms belong to HADDON-020.
- **Decision:** Queries are preserved for link identity but resource containers may map an otherwise unmatched owned link to the same href without its query. The fallback must be observable as a warning.
- **Decision:** Fragment strings omit the leading `#` and preserve their URI encoding. An HTML resolver percent-decodes once when interpreting an ID.
- **Decision:** Every `readingOrder` and owned `resources` entry has a known media type after parsing or sniffing. Unknown but owned resources use `application/octet-stream` and a warning rather than disappearing.

Readium recursively searches reading order, resources, links, alternates, and children and retries without fragment/query ([Manifest.kt:61-94](../../repos/readium-kotlin-toolkit/readium/shared/src/main/java/org/readium/r2/shared/publication/Manifest.kt#L61)). Foliate resolves each EPUB section by its manifest href and keeps the href as the section ID ([epub.js:979-998](../../repos/foliate-js/epub.js#L979)). Haddon adopts both ideas but makes canonicalization and fallback diagnostics part of the contract.

**Open question:** Should query-bearing ZIP resource hrefs be rejected at parse time, or preserved for source fidelity and resolved through the observable query-stripping fallback?

## 5. Lazy Resource contract

A resource is a handle, not its bytes. Opening a publication must not read every spine item.

```ts
type ByteRange = {
  start: number
  endExclusive: number
}

interface Resource {
  readonly link: ResourceLink
  readonly closed: boolean

  length(options?: { signal?: AbortSignal }): Promise<number | undefined>
  read(options?: {
    range?: ByteRange
    signal?: AbortSignal
  }): Promise<Uint8Array>
  stream?(options?: {
    range?: ByteRange
    signal?: AbortSignal
  }): ReadableStream<Uint8Array>
  close(): Promise<void>
}
```

- **Decision:** `Publication.getResource()` is lazy. It returns a handle or `null` when the target is not owned; read failures reject with a typed error rather than being conflated with absence.
- **Decision:** Byte ranges are zero-based and half-open: `[start, endExclusive)`. Values must be nonnegative safe integers and `endExclusive >= start`.
- **Decision:** `length()` may be unknown without reading. `read()` with no range returns all decoded resource bytes, subject to explicit limits.
- **Decision:** Resource transformations such as decryption, font de-obfuscation, decompression, or policy filtering occur behind the handle and are reflected in diagnostics/properties. Callers do not bypass them by reaching into an archive.
- **Decision:** `AbortSignal` is the portable cancellation boundary. Rust adapters translate it to their cancellation primitive.
- **Decision:** `stream()` is optional in the first WASM implementation. Its absence is discoverable through the handle shape/capability and must not force eager publication loading.

Readium TypeScript's resource already keeps `length`, ranged `read`, conversion helpers, and `close` behind a lazy abstraction ([`Resource.ts:14-36`](../../repos/readium-ts-toolkit/shared/src/fetcher/Resource.ts#L14)). The Kotlin abstraction similarly separates resource properties and byte access and has an explicit borrowed handle that does not own close ([`Resource.kt:14-45`](../../repos/readium-kotlin-toolkit/readium/shared/src/main/java/org/readium/r2/shared/util/resource/Resource.kt#L14), [`Resource.kt:63-78`](../../repos/readium-kotlin-toolkit/readium/shared/src/main/java/org/readium/r2/shared/util/resource/Resource.kt#L63)). Foliate demonstrates real lazy load/unload methods for each spine section ([epub.js:986-998](../../repos/foliate-js/epub.js#L986)) and reference-counted object URL cleanup ([epub.js:706-750](../../repos/foliate-js/epub.js#L706)).

### Ownership and lifecycle

```text
open publication -> open zero or more resource handles -> close handles -> close publication
       |                                                        |
       +---------------- publication owns all handles ----------+
```

1. `Publication.close()` is asynchronous and idempotent.
2. Closing a publication aborts in-flight publication/service work, closes all handles it owns, closes services, and releases the container.
3. Closing a resource releases that handle's claim. Implementations may share caches and underlying bytes, but one handle closing cannot invalidate another live handle.
4. Starting any operation after the owning object is closed fails with `Closed`.
5. An in-flight operation interrupted by close fails with `Cancelled` or `Closed`, never partial bytes presented as success.
6. Dropping a Rust value is a last-resort leak guard; correctness must not depend on finalizers, JavaScript garbage collection, or component unmount behavior.

Readium Kotlin closes both its container and attached services ([Publication.kt:170-175](../../repos/readium-kotlin-toolkit/readium/shared/src/main/java/org/readium/r2/shared/publication/Publication.kt#L170)). Foliate separately destroys the navigator state ([view.js:297-308](../../repos/foliate-js/view.js#L297)) and revokes publication-created URLs ([epub.js:1080-1082](../../repos/foliate-js/epub.js#L1080)); Haddon must keep these two lifecycles separate as well.

## 6. Publication runtime and capabilities

```ts
type Capability =
  | "locate"
  | "normalize"
  | "positions"
  | "search"
  | "source-mapping"
  | "stream-resources"

type PublicationServices = {
  locate: LocatorService
  normalize: NormalizationService
  positions: PositionsService
  search: SearchService
  "source-mapping": SourceMappingService
}

interface Publication {
  readonly identity: PublicationIdentity
  readonly manifest: Manifest
  readonly capabilities: ReadonlySet<Capability>
  readonly closed: boolean

  getResource(
    target: string | ResourceLink,
    options?: { signal?: AbortSignal }
  ): Promise<Resource | null>

  service<K extends keyof PublicationServices>(
    kind: K
  ): PublicationServices[K] | undefined

  close(): Promise<void>
}

type OpenPublication = {
  publication: Publication
  warnings: readonly PublicationWarning[]
}
```

- **Decision:** Manifest/resource access is universal. The other capabilities are optional services.
- **Decision:** `capabilities` describes runtime support in this opened instance, not theoretical format support. `service(kind)` and the capability set must agree.
- **Decision:** A service being present does not claim every resource is supported. Service results must distinguish supported, unsupported-with-reason, and failed.
- **Decision:** Missing search or positions services return `undefined`, not an empty result that falsely means “searched successfully; no matches.”
- **Decision:** Diagnostics produced while opening accumulate in `OpenPublication.warnings`. Later operations return their own warnings with successful values where recovery was possible. Fatal errors use typed failures.
- **Decision:** Services share the publication lifecycle and may depend on the immutable manifest/container, but services must not depend on one another through untyped global state.

Readium Kotlin attaches services to a publication context and explicitly lists cache, content, protection, cover, locator, positions, and search factories ([Publication.kt:222-270](../../repos/readium-kotlin-toolkit/readium/shared/src/main/java/org/readium/r2/shared/publication/Publication.kt#L222)). Its locator service is independently discoverable and nullable ([LocatorService.kt:21-36](../../repos/readium-kotlin-toolkit/readium/shared/src/main/java/org/readium/r2/shared/publication/services/LocatorService.kt#L21)); positions likewise form a separate capability ([PositionsService.kt:33-47](../../repos/readium-kotlin-toolkit/readium/shared/src/main/java/org/readium/r2/shared/publication/services/PositionsService.kt#L33)).

**Open question:** HADDON-014 must decide the concrete service result and warning/error types, stable diagnostic codes, and whether service registration is compile-time generic, runtime keyed, or both.

## 7. PublicationLocator

### Scope and identity

- **Decision:** A `PublicationLocator` identifies a location only after a particular `Publication` has been selected.
- **Decision:** Klemata persists a separate `CitationTarget { volumeId, editionId?, sourceRevision?, locator }`. This wrapper is finalized in HADDON-040.
- **Decision:** `href` is the required primary resource identity. Reading-order index may be returned in a resolved result for convenience, but it is never serialized as canonical evidence.
- **Decision:** A single locator range cannot cross resources. A multi-resource selection is represented by an ordered list of locators at the annotation/citation layer.

Readium locators deliberately combine an href, media type, multiple location expressions, and text context ([TypeScript `Locator.ts:149-175`](../../repos/readium-ts-toolkit/shared/src/publication/Locator.ts#L149)). Haddon retains that envelope but makes its own normalized selector and offset rules explicit.

### Version 1 JSON shape

```ts
type PublicationLocatorV1 = {
  schema: "haddon.publication-locator"
  version: 1
  href: string
  mediaType: string
  title?: string
  locations: {
    /** URI fragment tokens without '#', in strongest-first order. */
    fragments?: readonly string[]
    /** Full EPUB CFI. Treated as opaque by non-EPUB code. */
    epubCfi?: string
    /** Source-document selectors, scoped to href. */
    cssSelector?: string
    domRange?: DomRangeSelector
    /** Derived-document selector, valid for one normalizer revision. */
    normalized?: NormalizedRangeSelector
    /** Approximate fallback within href, in [0, 1]. */
    progression?: number
    /** Approximate fallback within the whole publication, in [0, 1]. */
    totalProgression?: number
    /** One-based logical position; never a viewport page. */
    position?: number
  }
  text?: {
    exact: string
    prefix?: string
    suffix?: string
  }
  extensions?: Readonly<Record<string, JsonValue>>
}

type TextOffset = {
  value: number
  unit: "utf16-code-unit"
}

type DomPointSelector = {
  cssSelector: string
  textNodeIndex: number
  offset?: TextOffset
}

type DomRangeSelector = {
  start: DomPointSelector
  /** Omitted means a collapsed range at start. */
  end?: DomPointSelector
}

type NormalizedPointSelector = {
  blockId: string
  offset: TextOffset
}

type NormalizedRangeSelector = {
  revision: string
  start: NormalizedPointSelector
  /** Omitted means a collapsed range at start. */
  end?: NormalizedPointSelector
}
```

Example:

```json
{
  "schema": "haddon.publication-locator",
  "version": 1,
  "href": "text/chapter-03.xhtml",
  "mediaType": "application/xhtml+xml",
  "locations": {
    "fragments": ["para-17"],
    "epubCfi": "epubcfi(/6/8!/4/10/2:12)",
    "normalized": {
      "revision": "haddon-normalizer/1",
      "start": {
        "blockId": "src:chapter-03.xhtml#para-17",
        "offset": { "value": 12, "unit": "utf16-code-unit" }
      },
      "end": {
        "blockId": "src:chapter-03.xhtml#para-17",
        "offset": { "value": 35, "unit": "utf16-code-unit" }
      }
    },
    "progression": 0.38
  },
  "text": {
    "exact": "Knowledge is not a copy of reality.",
    "prefix": "As the experiment shows, ",
    "suffix": " Instead, the learner constructs it."
  }
}
```

### Why each selector exists

| Evidence | Strength | Invalidated by | Purpose |
|---|---|---|---|
| `href` | required identity | resource rename/repack | scope every other selector |
| normalized range | precise | normalizer revision or source change | normal Haddon round trip |
| EPUB CFI | precise source structure | source DOM rewrite | interoperable EPUB location |
| fragment | durable when publisher IDs are good | ID removal/change | ordinary deep links and landmarks |
| DOM range/CSS selector | precise but DOM-sensitive | source DOM rewrite | browser selection/source rendition |
| exact quote + context | content-sensitive recovery | textual edit/duplicate quote | recovery and validation |
| progression/position | approximate | reading-order/content changes | bookmarks/resume, last resort only |

Readium stores fragments, resource/publication progression, and one-based positions as alternative locations ([`Locator.ts:8-43`](../../repos/readium-ts-toolkit/shared/src/publication/Locator.ts#L8)), and stores before/highlight/after text context ([`Locator.ts:111-145`](../../repos/readium-ts-toolkit/shared/src/publication/Locator.ts#L111)). Its HTML extension demonstrates CSS selector, partial CFI, and DOM range additions ([`Locations.ts:5-18`](../../repos/readium-ts-toolkit/shared/src/publication/html/Locations.ts#L5)). Foliate proves both directions of CFI conversion: source CFI to a DOM range ([epub.js:688-702](../../repos/foliate-js/epub.js#L688)) and a live DOM range back to CFI ([view.js:431-443](../../repos/foliate-js/view.js#L431)).

### Serialization rules

1. `schema` and `version` are required and compared before interpretation.
2. `href` has no fragment and follows the canonical href rules in section 4.
3. `mediaType` is required, lowercase in its type/subtype, and may retain normalized parameters.
4. Arrays preserve order. Sets are serialized as lexically sorted arrays. Object keys have no semantic order.
5. All integer values are nonnegative JSON safe integers. `position >= 1`; progressions are finite and within `[0, 1]`.
6. Ranges are half-open. `start` is inclusive and `end` is exclusive. Missing `end` is collapsed at `start`; an explicit equal end round-trips but writers omit it.
7. Persisted character offsets are UTF-16 code-unit counts from the start of the referenced text node or normalized block. They never count UTF-8 bytes, Unicode scalar values, or grapheme clusters.
8. Rust validates conversion boundaries. A UTF-16 offset splitting a surrogate pair is invalid; an internal UTF-8 byte index must lie on a Rust `str` character boundary before conversion.
9. `epubCfi` is opaque in generic code. Its own grammar defines its character offsets; adapters must not reinterpret them as `TextOffset`.
10. `text.exact` is the exact selected normalized text before quote-search folding. Prefix and suffix are adjacent context, not arbitrary snippets. Empty `exact` is invalid for a ranged citation but text may be absent for a collapsed bookmark.
11. `normalized.revision` identifies the deterministic normalizer algorithm/configuration, not the source edition. It must match exactly before normalized coordinates are trusted.
12. Unknown top-level keys are ignored with a warning. Namespaced experimental data belongs in `extensions`; recognized extensions must be preserved during a read/write round trip.
13. Deserializers validate all supplied selectors. An invalid optional selector is dropped with a warning if other valid evidence remains; invalid required fields reject the locator.
14. Serialization is semantically stable, not byte-canonical. A separate canonical-JSON rule can be added if citations are signed or content-addressed.

This fixes an existing interoperability hazard. `DocumentPoint.offset` is currently an unlabelled `usize` ([`types.rs:1-15`](../../crates/core/src/types.rs#L1)); selection code treats it as a UTF-8 byte index ([`packages/wasm/src/lib.rs:644-651`](../../packages/wasm/src/lib.rs#L644)) and then exports the number to JavaScript without its unit ([`packages/wasm/src/lib.rs:662-678`](../../packages/wasm/src/lib.rs#L662)). Browser DOM ranges instead define offsets in DOM string/code-unit terms; Readium's serializable DOM model shows the node/character distinction but does not annotate an offset unit ([Kotlin `DomRange.kt:51-70`](../../repos/readium-kotlin-toolkit/readium/shared/src/main/java/org/readium/r2/shared/publication/html/DomRange.kt#L51)).

**Open question:** Should persisted locators also accept a future `unicode-scalar` unit for native-only clients? Version 1 writers emit UTF-16 only; adding another unit requires conformance tests across Rust, WASM, and browsers.

## 8. Deterministic resolution

### Result type

```ts
type ResolutionStrategy =
  | "normalized"
  | "epub-cfi"
  | "fragment"
  | "dom-range"
  | "css-selector"
  | "quote"
  | "position"
  | "progression"

type ResolutionConfidence = "exact" | "strong" | "weak"

type ResolutionEvidence = {
  selector: ResolutionStrategy | "href"
  outcome: "matched" | "contradicted" | "unavailable" | "invalid"
  detail?: string
}

type LocatorResolution =
  | {
      status: "resolved"
      target: ResolvedTarget
      locator: PublicationLocatorV1
      strategy: ResolutionStrategy
      confidence: ResolutionConfidence
      evidence: readonly ResolutionEvidence[]
      warnings: readonly PublicationWarning[]
    }
  | {
      status: "ambiguous"
      candidates: readonly ResolutionCandidate[]
      totalCandidateCount: number
      evidence: readonly ResolutionEvidence[]
      reason: "multiple-matches" | "conflicting-selectors" | "edition-mismatch"
      warnings: readonly PublicationWarning[]
    }
  | {
      status: "unresolved"
      evidence: readonly ResolutionEvidence[]
      reason: "resource-missing" | "no-match" | "invalid-locator" | "unsupported"
      warnings: readonly PublicationWarning[]
    }
```

`ResolvedTarget` contains the canonical source location and, when available, the normalized range and transient reading-order index. The returned `locator` is freshly generated from the resolved target; callers can persist it to refresh stale selectors.

### Resolution order

Resolution is deterministic and resource-scoped:

1. Select and verify the publication outside this resolver. Reject a known edition/source mismatch before evaluating internal selectors.
2. Resolve `href` to an owned resource. Do not search another resource merely because its title or ordinal is similar.
3. If `normalized.revision` exactly matches the active normalizer, try the normalized range.
4. Try full EPUB CFI when the profile and service support it.
5. Try source structural selectors in order: fragment, DOM range, CSS selector.
6. Search `text.exact` within `href`; use prefix/suffix to disambiguate. Cross-resource quote search is disabled by default and requires an explicit recovery policy.
7. Try one-based logical `position`, then resource/publication progression.

At every tier, validate a candidate against all usable evidence instead of returning immediately:

- A precise candidate whose extracted text equals `text.exact` and whose context agrees is `exact`.
- A unique precise selector with no contradictory evidence, or a unique exact quote plus matching context, is at least `strong`.
- A fragment without text validation, position, or progression is `weak`.
- Two equal-best candidates produce `ambiguous`, ordered by reading order then source offset.
- Two precise selectors pointing at different passages produce `ambiguous: conflicting-selectors`, even if one appeared earlier in the ladder.
- A candidate contradicted by the exact quote cannot be `exact`. For citation policy it is not auto-focused; bookmark/resume policy may accept a weak structural or progression result.
- Approximate evidence never silently upgrades itself because it is the only evidence available.

This is intentionally stricter than Readium's default locator service, whose baseline implementation accepts a locator if its href is in reading order and otherwise returns null ([LocatorService.kt:43-55](../../repos/readium-kotlin-toolkit/readium/shared/src/main/java/org/readium/r2/shared/publication/services/LocatorService.kt#L43)). Haddon needs a result that Klemata can explain to a learner.

### Resolution policies

```ts
type ResolutionPolicy = "citation" | "navigation" | "resume"
```

- `citation` requires `exact` or `strong`; weak candidates are returned as ambiguous/unresolved recovery information and are not auto-highlighted.
- `navigation` may navigate to a unique weak structural candidate while surfacing the confidence.
- `resume` may use progression when no stronger selector works because approximate continuation is preferable to opening at the beginning.

**Open question:** Version 1 uses exact quote matching plus explicitly versioned search normalization; fuzzy/edit-distance recovery is deferred. Before adding it, HADDON-018 must define a confidence threshold and adversarial duplicate-quote tests.

## 9. Rust contract sketch

This is semantic pseudocode, not a commitment to a particular async-trait or service-registry crate.

```rust
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PublicationIdentity {
    pub volume_id: String,
    pub edition_id: Option<String>,
    pub source_revision: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Manifest {
    pub metadata: PublicationMetadata,
    pub profile: PublicationProfile,
    pub links: Vec<ResourceLink>,
    pub reading_order: Vec<ResourceLink>,
    pub resources: Vec<ResourceLink>,
    pub navigation: Navigation,
    pub rendition: RenditionHints,
    pub extensions: BTreeMap<String, JsonValue>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ResourceLink {
    pub href: PublicationHref,
    pub media_type: Option<MediaType>,
    pub title: Option<LocalizedString>,
    pub rels: BTreeSet<String>,
    pub properties: BTreeMap<String, JsonValue>,
    pub source_id: Option<String>,
    pub alternates: Vec<ResourceLink>,
    pub children: Vec<ResourceLink>,
    // size/duration/dimensions/languages omitted here for brevity
}

#[derive(Clone, Copy, Debug)]
pub struct ByteRange {
    pub start: u64,
    pub end_exclusive: u64,
}

#[async_trait]
pub trait Resource: Send + Sync {
    fn link(&self) -> &ResourceLink;
    fn is_closed(&self) -> bool;
    async fn length(&self, cancel: &CancellationToken) -> Result<Option<u64>, ResourceError>;
    async fn read(
        &self,
        range: Option<ByteRange>,
        cancel: &CancellationToken,
    ) -> Result<Bytes, ResourceError>;
    async fn close(&self) -> Result<(), CloseError>;
}

#[async_trait]
pub trait ResourceContainer: Send + Sync {
    async fn get(
        &self,
        href: &PublicationHref,
        cancel: &CancellationToken,
    ) -> Result<Option<Arc<dyn Resource>>, ResourceError>;
    async fn close(&self) -> Result<(), CloseError>;
}

pub struct Publication {
    identity: PublicationIdentity,
    manifest: Arc<Manifest>,
    container: Arc<dyn ResourceContainer>,
    services: ServiceRegistry,
    lifecycle: Arc<Lifecycle>,
}

impl Publication {
    pub fn identity(&self) -> &PublicationIdentity;
    pub fn manifest(&self) -> &Manifest;
    pub fn capabilities(&self) -> &CapabilitySet;
    pub fn service<T: PublicationService>(&self) -> Option<Arc<T>>;
    pub async fn get_resource(
        &self,
        target: &PublicationHref,
        cancel: &CancellationToken,
    ) -> Result<Option<Arc<dyn Resource>>, ResourceError>;
    pub async fn close(&self) -> Result<(), CloseError>;
}
```

The serialized Rust locator should mirror `PublicationLocatorV1` field-for-field. Internal normalized text may retain UTF-8 byte indices for efficient slicing, but a boundary type must convert them to `TextOffset { unit: Utf16CodeUnit }`; plain `usize` cannot cross serde/WASM.

**Open question:** Native and WASM implementations may need different `Send + Sync` bounds. Keep that variation below the public data model and verify it before choosing the trait crate.

## 10. Portable TypeScript contract sketch

The TypeScript types in sections 2-8 are the portable data/runtime contract. They use plain objects plus standard Web APIs: `Uint8Array`, `ReadableStream`, `AbortSignal`, and `Promise`. They do not expose Rust allocation handles, DOM nodes, React components, Remix runtime types, or Node-only streams.

An adapter created from WASM should look like this:

```ts
export interface PublicationOpener {
  open(
    input: Blob | Uint8Array | ReadableStream<Uint8Array>,
    options: {
      identity?: PublicationIdentityHint
      signal?: AbortSignal
    }
  ): Promise<OpenPublication>
}

export interface LocatorService {
  resolve(
    locator: PublicationLocatorV1,
    options: {
      policy: ResolutionPolicy
      signal?: AbortSignal
    }
  ): Promise<LocatorResolution>
}
```

The adapter owns conversion and handle tables. Callers should not know whether a resource is backed by Rust, a browser `File`, an exploded test directory, or an HTTP range source.

## 11. Cross-language invariants

The Rust and TypeScript implementations must pass the same contract fixtures for these laws:

1. **Manifest identity:** parse/serialize does not reorder reading order or lose resource/navigation hrefs.
2. **Href identity:** every owned link and locator resolves through the same canonical href function; fragment removal does not change the resource key.
3. **No canonical ordinals:** inserting a new earlier spine item does not change persisted locators for unchanged hrefs.
4. **Lazy open:** inspecting identity, metadata, and navigation reads no spine resource body.
5. **Range equivalence:** `read([a,b))` equals `read()[a..b]` for decoded bytes and valid bounds.
6. **Independent handles:** closing one resource handle does not break another handle to the same resource.
7. **Idempotent close:** repeated close succeeds; operations after close return `Closed`.
8. **Cancellation:** cancelled reads/normalization never return partial success.
9. **Capability truth:** `capabilities.has(k)` if and only if `service(k)` is present.
10. **Locator round trip:** every valid V1 locator is semantically equal after Rust -> JSON -> TypeScript -> JSON -> Rust.
11. **Offset agreement:** ASCII, combining marks, BMP non-ASCII, and astral characters resolve to the same substring in Rust and DOM/TypeScript.
12. **Range convention:** start is inclusive, end is exclusive, and a missing end is collapsed.
13. **Revision safety:** a normalized selector is never used when its normalizer revision differs.
14. **Ambiguity safety:** duplicate exact quotes without distinguishing context never produce `resolved` under citation policy.
15. **Evidence conflict:** disagreeing precise selectors never silently resolve according to whichever was tried first.
16. **No cross-resource drift:** quote recovery remains within `href` unless the caller explicitly enables broader recovery.
17. **Fresh locator:** a successful resolution emits a canonical locator that resolves to the same target on immediate retry.

## 12. Incremental migration from current Haddon types

The current model can remain usable while the canonical layer is introduced.

| Step | Change | Compatibility |
|---|---|---|
| 1 | Add `PublicationIdentity`, `Manifest`, `ResourceLink`, href/media types, and locator serde types alongside `EpubDocument`. | No existing behavior changes. |
| 2 | Introduce an EPUB `ResourceContainer` over the ZIP and build the full manifest before reading spine bodies. | Keep `parse_epub(data)` as an eager adapter. |
| 3 | Make `parse_epub(data)` call `open_epub`, then normalize every reading-order resource to construct the legacy `EpubDocument`. | Existing layout/search tests continue to use legacy types. |
| 4 | Add stable `href` and deterministic block identity/source mappings to derived chapters/blocks. | `chapter_index` remains a transient adapter field. |
| 5 | Add `PublicationLocatorV1` and explicit UTF-16 conversion at the WASM boundary. | Continue accepting legacy `{chapterIndex, blockIndex, offset}` only in an explicitly versioned session-state migration. |
| 6 | Move search and annotations to locator-backed normalized ranges; generate legacy `DocumentRange` only for the canvas backend. | Canvas remains functional but cannot mint durable citations from ordinal points. |
| 7 | Expose lazy publication/resources/services through a portable TypeScript adapter. | Remix 3/Klemata integrates with the new API, not `EpubReader` internals. |
| 8 | Remove the eager adapter only after semantic DOM and optional canvas backends consume canonical publication/locator contracts. | Persisted legacy state is migrated or retained as unresolved evidence. |

Specific current constraints motivating this sequence:

- `EpubDocument` contains only title, author, eager chapters, and extracted note text ([`types.rs:77-89`](../../crates/core/src/types.rs#L77)). It should become an adapter result/normalized artifact, not be renamed into `Publication`.
- `Block` contains only headings and paragraphs ([`types.rs:91-108`](../../crates/core/src/types.rs#L91)); HADDON-013 can expand the normalized model without bloating the source manifest.
- `DocumentPoint` orders by chapter/block ordinal ([`types.rs:1-21`](../../crates/core/src/types.rs#L1)); this remains useful for one loaded canvas snapshot but is unsuitable for durable identity.
- Search currently emits byte-indexed `DocumentPoint`s ([`search.rs:21-36`](../../crates/core/src/search.rs#L21)). It should convert through normalized block IDs and explicit offset units before returning to a host.
- The WASM boundary currently accepts and emits unversioned ordinal points ([`packages/wasm/src/lib.rs:662-700`](../../packages/wasm/src/lib.rs#L662)). The migration reader must identify these as legacy data rather than guessing that an unlabelled `offset` is UTF-16.

### Legacy locator migration

For persisted prototype state shaped like `{ chapterIndex, blockIndex, offset }`:

1. Require the exact source revision and legacy normalizer/layout revision that created it.
2. Rebuild the corresponding legacy eager document.
3. Validate the ordinal and UTF-8 byte boundary.
4. Map the point to a source href plus normalized block ID.
5. Convert the byte index to UTF-16 code units.
6. Add quote/context if the point represents a selection.
7. Emit a V1 locator and retain a migration warning.

If any prerequisite is missing, preserve the old payload as unresolved migration evidence. Do not reinterpret its number as UTF-16 or fall back to the same chapter ordinal in a different source revision.

## 13. Deferred decisions

These are deliberately not hidden behind vague implementation freedom:

1. **Source fingerprint:** archive bytes, canonical extracted graph, remote validator, or a layered revision scheme.
2. **Edition identity:** whether Klemata requires `editionId` for every persisted citation or permits source-fingerprint-only editions.
3. **Query-bearing archive hrefs:** reject, preserve with warning, or support as distinct virtual resources.
4. **Quote recovery:** exact normalization algorithm, context window, candidate limit, and whether cross-resource/fuzzy recovery is ever enabled for citations.
5. **CFI production:** whether Haddon writes full EPUB CFI in the first milestone or only preserves/resolves CFI supplied by source tools.
6. **Streaming:** whether V1 WASM resources expose `ReadableStream` or only bounded ranged reads.
7. **Service registry:** concrete Rust typing/dynamic registration and WASM capability projection.
8. **Cross-resource selections:** annotation-layer representation and UI behavior; a single publication locator remains resource-scoped.
9. **Diagnostic schema:** stable codes, severity, source spans, and serialization are finalized in HADDON-014.

None of these questions changes the central decision: source href is canonical resource identity, normalized coordinates are revisioned, offsets are explicit, and resolution must report uncertainty.
