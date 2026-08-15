# Haddon Services, Capabilities, Errors, and Warnings

**Status:** Proposed design for HADDON-014

**Date:** 2026-08-13

**Depends on:** HADDON-011

**Consumers:** HADDON-015, HADDON-016, HADDON-017, HADDON-020, HADDON-022, HADDON-023, HADDON-024, HADDON-030

**Scope:** Optional publication services, runtime capability discovery and negotiation, partial success, typed failures, recoverable warnings, cancellation, and ownership/cleanup across Rust, WASM, TypeScript, and a browser navigator.

**Out of scope:** The complete publication and locator data model (HADDON-011/012), normalized node vocabulary (HADDON-013), concrete EPUB recovery rules (HADDON-021/022), and navigator UI behavior (HADDON-030 onward).

This document refines section 6 of [publication-model.md](./publication-model.md). It is normative for the first implementation unless a later ticket explicitly supersedes a decision.

## Decision summary

- **Decision:** Manifest and lazy resource access are the only universal publication features. Normalization, locator resolution, search, logical positions, and renditions are optional services.
- **Decision:** Capability discovery returns a descriptor with availability, version, scope, features, and limitations. A flat boolean set is insufficient.
- **Decision:** A service may be `available`, `partial`, or `unavailable` for a particular opened publication. `partial` never masquerades as complete support.
- **Decision:** Every fallible operation returns `Result<Outcome<T>, HaddonError>` in Rust and the equivalent discriminated union in portable TypeScript. `Outcome<T>` carries warnings and completeness alongside the value.
- **Decision:** An error means the requested operation did not produce a valid value. A warning means a valid value exists, but recovery, omission, substitution, or degradation occurred.
- **Decision:** Recover-mode opening may return a usable partial publication. It succeeds only when canonical publication identity, a stable manifest graph, and lazy resource ownership can still be established.
- **Decision:** Missing optional capabilities are data, not exceptions. Calling code must discover and negotiate them before use.
- **Decision:** Every potentially blocking operation accepts cancellation. `AbortSignal` is the portable boundary; Rust uses a cancellation token with identical semantics.
- **Decision:** Publication close aborts in-flight descendant work and then closes sessions, resource handles, services, and the resource container. Close is idempotent even if cleanup reports an error.
- **Decision:** The core, WASM transport, and navigator each declare capabilities. The active reader plan is the explicit intersection of all three layers, including chosen fallbacks and unresolved gaps.
- **Decision:** Stable diagnostic codes and structured context cross the WASM boundary. Rust display strings and arbitrary JavaScript exceptions do not constitute an API.

These decisions borrow Readium Kotlin's service registry and nullable discovery, but make coverage and partial success more explicit. Readium creates services from a manifest/container/context and supports replaceable factories at [Publication.kt:222](../../repos/readium-kotlin-toolkit/readium/shared/src/main/java/org/readium/r2/shared/publication/Publication.kt#L222) and [Publication.kt:247](../../repos/readium-kotlin-toolkit/readium/shared/src/main/java/org/readium/r2/shared/publication/Publication.kt#L247). Haddon also adopts MuPDF's useful distinction between unsupported, unrecoverable format, recoverable syntax, limits, and user abort at [context.h:182](../../repos/mupdf/include/mupdf/fitz/context.h#L182), without adopting MuPDF's C exception mechanism.

## 1. Why the current API cannot express the intended reader

Haddon's current API has one eager path:

```text
EPUB bytes -> parse every spine XHTML -> normalize all text -> layout whole book -> EpubReader
```

The parser opens a ZIP, reads the OPF, scans every spine item for notes, then reads and parses every spine item again before returning ([epub.rs:22-77](../../crates/core/src/epub.rs#L22)). The result retains only title, author, chapters, and extracted notes ([types.rs:77-95](../../crates/core/src/types.rs#L77)). Search is consequently always present, synchronous, and tied to this eager normalized document ([search.rs:9-50](../../crates/core/src/search.rs#L9)). WASM turns every open failure into an untyped string and immediately lays out the whole publication ([lib.rs:67-82](../../packages/wasm/src/lib.rs#L67)).

This has several ambiguities the new contract must remove:

- no search result can mean no match, an unsupported publication, an unreadable resource, or cancelled work;
- parser recovery can disappear silently—for example, malformed note XML terminates a loop without a diagnostic ([epub.rs:161-176](../../crates/core/src/epub.rs#L161));
- every parser problem becomes one fatal `EpubError`, even when a publication remains useful ([epub.rs:8-20](../../crates/core/src/epub.rs#L8));
- the caller cannot ask whether normalization, positions, or a suitable rendition exists before invoking it;
- there is no explicit owner, cancellation path, or deterministic close operation at the WASM boundary.

The service design exists to make those distinctions unavoidable.

## 2. Common operation result

### Portable shape

```ts
type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E }

type Completeness = "complete" | "partial"

type Outcome<T> = {
  readonly value: T
  readonly completeness: Completeness
  /** Warnings emitted by this operation, in deterministic emission order. */
  readonly warnings: readonly PublicationWarning[]
  /** Optional machine-readable bounds on what the value covers. */
  readonly coverage?: Coverage
}

type Coverage = {
  readonly includedHrefs?: readonly string[]
  readonly omittedHrefs?: readonly string[]
  readonly completedUnits?: number
  readonly totalUnits?: number
}

type AsyncResult<T> = Promise<Result<Outcome<T>, HaddonError>>
```

### Semantics

- **Decision:** `ok: false` carries no usable value. It is impossible to return a half-filled value inside an error.
- **Decision:** `ok: true, completeness: "complete"` claims the operation covered its requested scope without known semantic omission. Informational warnings may still exist, but no `caution` or `major` warning may contradict completeness.
- **Decision:** `ok: true, completeness: "partial"` must contain at least one warning that explains the omission, recovery, substitution, or degradation. When the missing scope is enumerable, `coverage` must identify it.
- **Decision:** An empty complete search result means the supported scope was searched and had no matches. An absent search service means search was not attempted. A partial empty result means the searched subset had no matches and the warnings/coverage identify what was skipped.
- **Decision:** A domain result such as `ambiguous` or `unresolved` locator resolution is a successful `Outcome<LocatorResolution>` when the resolver completed normally. It is not converted into a transport or engine error.
- **Decision:** Warnings are immutable values. An operation returns only the warnings it emitted; the publication also maintains an append-only diagnostic ledger for inspection.

Readium Kotlin's `Try<Success, Failure>` proves the value of typed success and failure ([Try.kt:12-44](../../repos/readium-kotlin-toolkit/readium/shared/src/main/java/org/readium/r2/shared/util/Try.kt#L12)), while its warning logger separately accumulates non-fatal issues ([WarningLogger.kt:16-40](../../repos/readium-kotlin-toolkit/readium/shared/src/main/java/org/readium/r2/shared/util/logging/WarningLogger.kt#L16)). Haddon combines those concepts in each successful outcome so a warning cannot be missed merely because no logger was installed.

## 3. Structured warnings

```ts
type WarningSeverity = "info" | "caution" | "major"

type WarningStage =
  | "open"
  | "manifest"
  | "resource"
  | "normalize"
  | "locate"
  | "search"
  | "positions"
  | "rendition"
  | "close"

type PublicationWarning = {
  /** Stable namespaced machine code; never derived from the display message. */
  readonly code: WarningCode
  readonly severity: WarningSeverity
  readonly stage: WarningStage
  /** Safe, non-localized developer text. UI localization keys come from `code`. */
  readonly message: string
  readonly href?: string
  readonly sourceLocation?: {
    readonly line?: number
    readonly column?: number
    readonly byteOffset?: number
  }
  readonly recovery?:
    | "ignored"
    | "defaulted"
    | "repaired"
    | "omitted"
    | "fallback-used"
    | "degraded"
  readonly details?: Readonly<Record<string, JsonValue>>
}

type WarningCode =
  | "haddon.open.multiple-package-candidates"
  | "haddon.manifest.invalid-optional-metadata"
  | "haddon.manifest.missing-referenced-resource"
  | "haddon.manifest.navigation-omitted"
  | "haddon.resource.query-fallback-used"
  | "haddon.resource.media-type-inferred"
  | "haddon.normalize.unsupported-semantics"
  | "haddon.normalize.source-segment-omitted"
  | "haddon.locate.selector-dropped"
  | "haddon.search.resource-skipped"
  | "haddon.positions.resource-skipped"
  | "haddon.rendition.fallback-used"
  | "haddon.rendition.publisher-style-constrained"
  | "haddon.close.cleanup-failed"
  | `extension:${string}`
```

The initial union lists contract examples, not the final exhaustive catalog. A ticket adding recovery behavior must add a stable warning code and tests in the same change.

### Warning rules

1. `code`, `stage`, `severity`, and recovery semantics are API; English `message` wording is not.
2. Warnings never include source bytes, publication text, credentials, filesystem paths, or arbitrary exception stacks in serializable fields.
3. A recovered malformed construct produces one warning at the point the recovery decision is made. Higher layers may add a separate summary warning but must not rewrite the original.
4. The publication diagnostic ledger preserves emission order and assigns a runtime-only monotonic sequence number. Operation outcomes omit that sequence from durable serialization.
5. Repeating the same warning for independent resources is valid. Cache hits must not re-emit a warning that belonged to the original computation; the cached outcome retains its original warnings.
6. `major` still means a usable value exists. If the requested value is invalid or cannot be trusted, return an error instead.

Readium's warning severity describes user impact and explicitly treats warnings as non-fatal ([WarningLogger.kt:57-94](../../repos/readium-kotlin-toolkit/readium/shared/src/main/java/org/readium/r2/shared/util/logging/WarningLogger.kt#L57)). Foliate shows the practical need for this separation: it can finish EPUB initialization even when EPUB 3 navigation or NCX parsing fails, but today only logs to the console ([epub.js:1001-1018](../../repos/foliate-js/epub.js#L1001)). Haddon preserves such recovery as returned data.

## 4. Typed fatal errors

“Fatal” is scoped to one operation. A search failure need not poison the publication; a corrupt container usually does.

```ts
type HaddonError = {
  readonly code: ErrorCode
  readonly stage: WarningStage
  readonly message: string
  readonly href?: string
  readonly retryable: boolean
  readonly publicationState: "usable" | "closing" | "closed" | "unknown"
  readonly details?: Readonly<Record<string, JsonValue>>
  readonly causes?: readonly ErrorCause[]
}

type ErrorCause = {
  readonly code: string
  readonly message: string
}

type ErrorCode =
  | "haddon.cancelled"
  | "haddon.closed"
  | "haddon.invalid-argument"
  | "haddon.capability-unavailable"
  | "haddon.format-unsupported"
  | "haddon.format-invalid"
  | "haddon.container-corrupt"
  | "haddon.required-resource-missing"
  | "haddon.resource-not-found"
  | "haddon.resource-read-failed"
  | "haddon.decode-failed"
  | "haddon.security-policy-violation"
  | "haddon.resource-limit-exceeded"
  | "haddon.service-failed"
  | "haddon.cleanup-failed"
  | "haddon.internal"
  | `extension:${string}`
```

### Error rules

- **Decision:** `message` is diagnostic, never the discriminator. Callers branch only on `code` and structured fields.
- **Decision:** Invalid caller input is `invalid-argument`; malformed untrusted publication input is a format, decoding, policy, or limit error.
- **Decision:** `capability-unavailable` is only returned when a caller bypasses discovery or a capability disappears after negotiation. Ordinary discovery of an unavailable capability is successful data.
- **Decision:** `resource-not-found` means a canonical owned resource was requested but its bytes are unavailable. Asking for an href not owned by the publication returns `Outcome<null>`, not this error.
- **Decision:** `cancelled` contains `details.origin` equal to `request`, `publication-close`, `service-close`, `resource-close`, or `session-close`.
- **Decision:** `closed` applies to an operation started after its owner entered `closing` or `closed`. Work already in flight when close begins returns `cancelled` with the appropriate origin.
- **Decision:** `cleanup-failed` may contain multiple safe `causes`. The object is nevertheless closed; the caller must not retry normal operations.
- **Decision:** Internal Rust/JavaScript stack traces may be attached to a local debug observer but never cross the portable API by default.

MuPDF's taxonomy distinguishes system, library, argument, limit, unsupported, unrecoverable format, recoverable syntax, progressive loading, and abort errors ([context.h:182-199](../../repos/mupdf/include/mupdf/fitz/context.h#L182)). It also demonstrates an explicit downgrade: a stream error can be reported, warned about, and treated as EOF while progressive-loading errors remain fatal to that attempt ([stream.h:405-433](../../repos/mupdf/include/mupdf/fitz/stream.h#L405)). Haddon adopts the explicit recovery decision, but represents it as an `Outcome` warning rather than a process-global callback.

The vendored Readium TypeScript toolkit is not the error model to copy yet: `Resource.read()` returns `undefined`, notes that length should become a typed result, and parsing helpers may throw native exceptions ([Resource.ts:14-36](../../repos/readium-ts-toolkit/shared/src/fetcher/Resource.ts#L14)); its empty fetcher throws a generic `Error` despite documenting resource-level failures ([Fetcher.ts:16-35](../../repos/readium-ts-toolkit/shared/src/fetcher/Fetcher.ts#L16)). The portable Haddon boundary must remove those ambiguities.

## 5. Partial publication open

```ts
type OpenMode = "recover" | "strict"

type OpenPublication = {
  readonly publication: Publication
  readonly openStatus: "complete" | "partial"
}

interface PublicationOpener {
  open(
    input: PublicationInput,
    options?: {
      readonly mode?: OpenMode
      readonly identity?: PublicationIdentityHint
      readonly signal?: AbortSignal
    }
  ): AsyncResult<OpenPublication>
}
```

- **Decision:** `recover` is the default reader mode. `strict` upgrades any `caution` or `major` recovery needed during open into `format-invalid`, primarily for validation and conformance testing.
- **Decision:** A partial open is a success because the returned publication satisfies every universal contract. `Outcome.completeness` and `OpenPublication.openStatus` must agree.
- **Decision:** An opener does not eagerly read every declared resource merely to claim completeness. “Complete open” means the container and canonical manifest were established without a known omission; later lazy reads can still fail.

### Minimum viable partial publication

Open may succeed as partial only when all of these are true:

1. source identity can be computed or validated;
2. one package/manifest is selected deterministically;
3. all retained owned hrefs can be canonicalized beneath the virtual publication root;
4. the immutable manifest graph is internally coherent enough for resource lookup;
5. the lazy resource container is open and has a deterministic close path;
6. every omission or repair is represented by a warning;
7. capability descriptors are recomputed from the recovered publication rather than copied from theoretical format support.

Open is fatal when any of these fail, or when the input format is unsupported, required root/package data is unreadable, a security/size limit is exceeded, or cancellation wins.

Examples of recoverable partial open include malformed optional metadata, a broken TOC with intact reading order, an unresolved non-reading-order resource, an unsupported enhancement with a valid fallback, or an omitted spine entry when other readable entries remain. Examples of fatal open include no safe package candidate, traversal above the virtual root, an unreadable package document, or a manifest whose canonical resource identities cannot be made unambiguous.

**Decision:** A partial publication may be inspectable but not readable. For example, metadata may be available while all renditions are unavailable due to protection. Its capability descriptors must make this truthful; opening itself does not promise a rendition.

Readium passes a warning logger through the parser specifically for non-fatal authoring mistakes ([PublicationParser.kt:23-50](../../repos/readium-kotlin-toolkit/readium/streamer/src/main/java/org/readium/r2/streamer/parser/PublicationParser.kt#L23)) and reserves typed open errors for unreadable or unsupported assets ([PublicationOpener.kt:34-45](../../repos/readium-kotlin-toolkit/readium/streamer/src/main/java/org/readium/r2/streamer/PublicationOpener.kt#L34)). Foliate similarly drops a spine entry whose manifest item is missing and continues initialization ([epub.js:979-999](../../repos/foliate-js/epub.js#L979)). Haddon differs by returning the degraded status and exact omission instead of relying on a console side effect.

## 6. Capability descriptors and service discovery

### Descriptor

```ts
type ServiceKind =
  | "normalization"
  | "locator"
  | "search"
  | "positions"
  | "rendition"

type CapabilityAvailability = "available" | "partial" | "unavailable"

type CapabilityDescriptor = {
  readonly kind: ServiceKind
  /** Semantic contract implemented by the provider, not its package version. */
  readonly version: string
  readonly availability: CapabilityAvailability
  readonly provider: "core" | "wasm" | "navigator" | `extension:${string}`
  readonly scope: CapabilityScope
  readonly features: readonly string[]
  readonly limitations: readonly CapabilityLimitation[]
}

type CapabilityScope = {
  readonly profiles?: readonly PublicationProfile[]
  readonly mediaTypes?: readonly string[]
  readonly includedHrefs?: readonly string[]
  readonly excludedHrefs?: readonly string[]
}

type CapabilityLimitation = {
  readonly code: string
  readonly message: string
  readonly href?: string
}

interface Publication {
  capabilities(): readonly CapabilityDescriptor[]
  capability(kind: ServiceKind): CapabilityDescriptor
  service<K extends ServiceKind>(kind: K): PublicationServices[K] | undefined
  warnings(): readonly PublicationWarning[]
}
```

### Discovery invariants

1. `capability(kind)` returns exactly one descriptor for each standard service kind, including `unavailable`.
2. `service(kind)` is defined if and only if the descriptor is `available` or `partial`.
3. Descriptor arrays, scopes, features, and limitations are immutable for the lifetime of an opened publication. A transient failure does not rewrite capabilities.
4. Availability describes this publication, this provider, and this runtime. It is not a claim that the implementation generally supports EPUB.
5. `partial` requires at least one limitation and a non-empty supported scope or a probe operation that can determine support per target.
6. An available service may still reject invalid input or fail while reading a resource. Capability means the operation is implemented, not guaranteed success.
7. A service never returns a no-op value to simulate absence. In particular, missing positions is not `[]`, missing search is not an empty result page, and missing normalization is not source HTML relabeled as normalized.
8. Standard `features` strings are versioned with the service contract. Unknown strings are ignored during negotiation, never treated as proof of support.

Readium Kotlin offers nullable type-based discovery and multiple implementations of a service ([PublicationServicesHolder.kt:16-44](../../repos/readium-kotlin-toolkit/readium/shared/src/main/java/org/readium/r2/shared/publication/PublicationServicesHolder.kt#L16)). Its search helpers explicitly return `null` when a publication is not searchable ([SearchService.kt:101-125](../../repos/readium-kotlin-toolkit/readium/shared/src/main/java/org/readium/r2/shared/publication/services/search/SearchService.kt#L101)). Haddon keeps nullable service lookup for ergonomics but adds an unavailable descriptor so UI and telemetry can explain why.

## 7. Service contracts

All service operations accept `OperationOptions`, and all service-owned sessions are closeable.

```ts
type OperationOptions = {
  readonly signal?: AbortSignal
}

interface Closeable {
  readonly closed: boolean
  close(): AsyncResult<void>
}
```

### 7.1 Normalization

```ts
interface NormalizationService extends Closeable {
  readonly descriptor: CapabilityDescriptor
  readonly revision: string

  supports(link: ResourceLink): SupportAssessment
  normalize(
    link: ResourceLink,
    options?: NormalizeOptions & OperationOptions
  ): AsyncResult<NormalizedResource>
}

type SupportAssessment =
  | { readonly status: "supported" }
  | { readonly status: "degraded"; readonly limitations: readonly CapabilityLimitation[] }
  | { readonly status: "unsupported"; readonly reason: CapabilityLimitation }
```

- `revision` identifies the deterministic algorithm and semantic configuration used by normalized selectors.
- `supports()` is pure, synchronous, and makes no resource read. A later read/parse failure remains possible.
- A degraded normalized value is partial and must preserve source mappings for every retained addressable node under HADDON-013.
- Unsupported fixed-layout, scripted, spatial, or otherwise unsafe content yields `SupportAssessment.unsupported`; it is not silently flattened.
- Normalization is resource-scoped and lazy. Publication-wide normalization is an orchestration utility over resource operations, not a second canonical document.

### 7.2 Locator

```ts
interface LocatorService extends Closeable {
  readonly descriptor: CapabilityDescriptor

  resolve(
    locator: PublicationLocatorV1,
    options?: ResolutionOptions & OperationOptions
  ): AsyncResult<LocatorResolution>

  locatorFromSource(
    target: SourceTarget,
    options?: OperationOptions
  ): AsyncResult<PublicationLocatorV1>

  locatorFromNormalized(
    target: NormalizedRange,
    options?: OperationOptions
  ): AsyncResult<PublicationLocatorV1>
}
```

- `resolved`, `ambiguous`, and `unresolved` are domain values specified by HADDON-012.
- A service lacking normalized-source mapping may still be partial and resolve hrefs/fragments/progression within its declared evidence features.
- Invalid required locator fields are errors at deserialization. Valid but stale or contradictory evidence produces an `ambiguous`/`unresolved` result with warnings/evidence.

Readium's default locator service is optional and may depend on positions ([LocatorService.kt:21-54](../../repos/readium-kotlin-toolkit/readium/shared/src/main/java/org/readium/r2/shared/publication/services/LocatorService.kt#L21)). Haddon preserves that composition but does not collapse “service missing,” “no match,” and “bad input” into the same `null`.

### 7.3 Search

```ts
interface SearchService extends Closeable {
  readonly descriptor: CapabilityDescriptor
  readonly options: SearchOptionSupport

  start(
    query: string,
    options?: SearchOptions & OperationOptions
  ): AsyncResult<SearchSession>
}

interface SearchSession extends Closeable {
  readonly estimatedResultCount?: number
  next(options?: OperationOptions): AsyncResult<SearchPage | null>
}

type SearchPage = {
  readonly results: readonly SearchResult[]
  readonly searchedCoverage: Coverage
}
```

- `null` from `next()` means the declared search scope was exhausted; an empty `SearchPage` is permitted while work progresses.
- Results carry publication locators, never chapter/block ordinals alone.
- Option support is explicit. An unsupported requested option is `invalid-argument` unless the caller opts into a documented fallback, in which case the outcome is partial with a warning.
- Closing a search session cancels only that query. Closing the publication closes all live search sessions.
- Search over a subset of readable/normalizable resources is partial and reports skipped hrefs. It is not an unavailable service if the useful supported scope is non-empty.

Readium models search as a closeable paged iterator with an unknown count and typed reading/engine failures ([SearchService.kt:133-160](../../repos/readium-kotlin-toolkit/readium/shared/src/main/java/org/readium/r2/shared/publication/services/search/SearchService.kt#L133)). It also declares unsupported search options by absence of a default value ([SearchService.kt:54-98](../../repos/readium-kotlin-toolkit/readium/shared/src/main/java/org/readium/r2/shared/publication/services/search/SearchService.kt#L54)). These are the direct precedents for Haddon search sessions.

### 7.4 Positions

```ts
interface PositionsService extends Closeable {
  readonly descriptor: CapabilityDescriptor

  positions(
    scope?: { readonly href?: string },
    options?: OperationOptions
  ): AsyncResult<PositionList>
}

type PositionList = {
  readonly positions: readonly PublicationLocatorV1[]
  readonly granularity: "resource" | "text-unit" | "page-label" | "time"
}
```

- Positions are logical stable locations, never viewport pages.
- Every position is one-based where it carries a global `position`, matching HADDON-012.
- A per-resource fallback must declare `granularity: "resource"`; it cannot pretend to be text-unit positions.
- A complete empty position list is valid only for an empty requested scope. Otherwise missing generation support is unavailable or partial, not empty complete data.
- Generated positions are deterministic for a source revision, generator version, configuration, and granularity.

Readium separates positions as a publication service ([PositionsService.kt:33-47](../../repos/readium-kotlin-toolkit/readium/shared/src/main/java/org/readium/r2/shared/publication/services/PositionsService.kt#L33)) and provides a deliberately coarse one-position-per-resource implementation ([PositionsService.kt:70-108](../../repos/readium-kotlin-toolkit/readium/shared/src/main/java/org/readium/r2/shared/publication/services/PositionsService.kt#L70)). Haddon surfaces that coarseness rather than hiding it behind the same return shape.

### 7.5 Renditions

A rendition service prepares a framework-neutral source for a navigator. It does not mount DOM, own React state, or choose Klemata chrome.

```ts
type RenditionKind =
  | "normalized-semantic"
  | "source-html"
  | "fixed-layout"
  | "canvas-text"
  | `extension:${string}`

interface RenditionService extends Closeable {
  readonly descriptor: CapabilityDescriptor

  assess(link: ResourceLink, kind: RenditionKind): SupportAssessment
  prepare(
    link: ResourceLink,
    request: RenditionRequest,
    options?: OperationOptions
  ): AsyncResult<RenditionSource>
}

type RenditionSource =
  | { readonly kind: "normalized-semantic"; readonly resource: NormalizedResource }
  | { readonly kind: "source-html"; readonly resource: Resource; readonly sandbox: SandboxPolicy }
  | { readonly kind: "fixed-layout"; readonly resource: Resource; readonly viewport?: ViewportHint }
  | { readonly kind: "canvas-text"; readonly backendHandle: string }
  | { readonly kind: `extension:${string}`; readonly payload: JsonValue }
```

- The core may offer normalized, source, fixed-layout, or canvas preparation. The browser navigator separately declares which sources it can consume.
- `source-html` never grants script/network privileges implicitly; its `SandboxPolicy` is an explicit prepared policy, finalized by HADDON-031.
- A fallback from requested normalized semantic content to source-faithful content is a successful partial outcome with `haddon.rendition.fallback-used`.
- If no safe supported rendition exists, the rendition capability is unavailable for that href. It must not return plain text merely to make the call succeed.
- The current canvas reader is one possible rendition backend, not the universal publication interface.

## 8. Cancellation semantics

### Portable rules

1. Every operation that can read, parse, normalize, index, search, generate positions, render, or wait accepts `AbortSignal`.
2. A signal already aborted at entry returns `haddon.cancelled` with `origin: "request"` before resource acquisition or warning emission.
3. Cancellation is cooperative but mandatory at bounded checkpoints: before and after I/O, between archive entries/resources, and inside long parsing/indexing loops.
4. Once an operation observes cancellation, it emits no further value or result page. Warnings emitted before observation remain in the returned error's diagnostic ledger, but there is no successful partial value unless the service contract explicitly requested a bounded partial operation.
5. Request cancellation does not close the publication, service, resource handle, or session. The caller may start later work.
6. Closing an owner aborts all descendant operations using the owner's private lifecycle signal. The result is `haddon.cancelled` with a close origin, not a generic DOM `AbortError`.
7. A new operation after `closing` begins returns `haddon.closed` synchronously at the semantic boundary.
8. Cancellation races resolve by first observed terminal event. Implementations record one terminal result and ignore later completions.
9. WASM adapters must detach abort listeners when work settles to avoid retaining publications or JavaScript closures.

### Signal composition

```text
caller AbortSignal -------+
                           +--> effective operation token
publication lifecycle ----+
service/session lifecycle -+
resource lifecycle --------+
```

The effective signal is aborted when any applicable parent is aborted. The adapter preserves the winning origin rather than exposing only a boolean.

MuPDF demonstrates why abort belongs in the operation context: its rendering cookie carries abort, progress, error count, and incomplete state ([device.h:470-500](../../repos/mupdf/include/mupdf/fitz/device.h#L470)), and its error taxonomy reserves a distinct user-abort signal ([context.h:195-198](../../repos/mupdf/include/mupdf/fitz/context.h#L195)). Haddon uses standard web cancellation rather than a mutable shared integer, but keeps abort separate from malformed content.

**Open question:** Progress reporting is intentionally not part of HADDON-014. A later ticket may add an `onProgress` observer, but it must use the same cancellation and lifecycle boundaries and must not make progress callbacks a source of engine errors.

## 9. Lazy resource ownership and deterministic close

### Ownership graph

```text
Publication
  owns ResourceContainer
  owns Service instances
  tracks Resource handle leases returned to callers
  tracks Service-owned sessions and rendition handles

Resource handle
  owns one lease on shared underlying state
  never owns Publication or ResourceContainer

Navigator
  owns its DOM/object URLs/listeners
  borrows Publication and owns handles it requested
  closes before Publication in normal host teardown
```

### Resource contract refinement

```ts
interface Resource extends Closeable {
  readonly link: ResourceLink

  length(options?: OperationOptions): AsyncResult<number | undefined>
  read(options?: { readonly range?: ByteRange; readonly signal?: AbortSignal }): AsyncResult<Uint8Array>
  stream?(options?: { readonly range?: ByteRange; readonly signal?: AbortSignal }): AsyncResult<ReadableStream<Uint8Array>>
}
```

- **Decision:** Each `Publication.getResource()` call returns an independently closeable lease, even if implementations share bytes, archive handles, or caches underneath.
- **Decision:** Closing one lease cannot invalidate another live lease. Closing the publication invalidates all descendants.
- **Decision:** A resource may outlive the JavaScript variable that held the publication, but not the publication's semantic lifetime. Correctness never depends on garbage collection or a Rust `Drop` implementation.
- **Decision:** Reads return all requested bytes or an error. Cancellation, EOF before a satisfiable declared range, and decoding failure never return truncated bytes as a successful complete outcome.
- **Decision:** A range that extends beyond known resource length is `invalid-argument`. If length was unknown and EOF reveals the mismatch, return `resource-read-failed` with structured requested/actual bounds.

### Close algorithm

The first call to `Publication.close()` atomically moves the publication from `open` to `closing`, then:

1. aborts the publication lifecycle signal;
2. closes live search/rendition/other service sessions;
3. closes all outstanding resource leases;
4. closes service instances in reverse construction order;
5. closes the resource container;
6. records `closed` regardless of cleanup success;
7. returns an aggregated `cleanup-failed` error when cleanup could not be completed, with the publication state set to `closed`.

Concurrent close callers await the same close operation. Calls after it settles return complete success without repeating cleanup. The same idempotency applies to services, sessions, and resource handles.

Readium closes the container and attached services at publication close ([Publication.kt:170-175](../../repos/readium-kotlin-toolkit/readium/shared/src/main/java/org/readium/r2/shared/publication/Publication.kt#L170)); its service holder attempts to close every service even when one fails ([PublicationServicesHolder.kt:31-44](../../repos/readium-kotlin-toolkit/readium/shared/src/main/java/org/readium/r2/shared/publication/PublicationServicesHolder.kt#L31)). Foliate provides the browser-specific complement: per-section load/unload uses reference-counted object URLs ([epub.js:706-760](../../repos/foliate-js/epub.js#L706)), publication destroy revokes cached URLs ([epub.js:903-908](../../repos/foliate-js/epub.js#L903), [epub.js:1080-1082](../../repos/foliate-js/epub.js#L1080)), and the view separately tears down renderer/session state ([view.js:297-308](../../repos/foliate-js/view.js#L297)). Haddon therefore keeps publication and navigator lifecycles distinct.

MuPDF's explicit `keep`/`drop` document reference contract, including non-throwing release, is a useful ownership model ([document.h:611-626](../../repos/mupdf/include/mupdf/fitz/document.h#L611)). Rust provides safer mechanics, but WASM handles still require an explicit parent/lease protocol.

## 10. Rust API sketch

This is semantic pseudocode. HADDON-015 chooses concrete async/cancellation crates and native versus WASM bounds.

```rust
pub type HaddonResult<T> = Result<Outcome<T>, HaddonError>;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Outcome<T> {
    pub value: T,
    pub completeness: Completeness,
    pub warnings: Vec<PublicationWarning>,
    pub coverage: Option<Coverage>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "code", rename_all = "kebab-case")]
pub enum HaddonError {
    Cancelled {
        stage: Stage,
        origin: CancellationOrigin,
        publication_state: PublicationState,
    },
    Closed { stage: Stage, owner: OwnerKind },
    InvalidArgument { stage: Stage, field: String, message: String },
    CapabilityUnavailable { kind: ServiceKind, reason: String },
    FormatUnsupported { detected_media_type: Option<String> },
    FormatInvalid { stage: Stage, message: String },
    ContainerCorrupt { message: String },
    RequiredResourceMissing { href: PublicationHref },
    ResourceNotFound { href: PublicationHref },
    ResourceReadFailed { href: PublicationHref, retryable: bool, message: String },
    DecodeFailed { href: Option<PublicationHref>, message: String },
    SecurityPolicyViolation { rule: String, href: Option<PublicationHref> },
    ResourceLimitExceeded { limit: String, actual: Option<u64>, maximum: u64 },
    ServiceFailed { kind: ServiceKind, message: String },
    CleanupFailed { causes: Vec<CleanupCause> },
    Internal { stage: Stage, message: String },
}

#[async_trait(?Send)]
pub trait PublicationService {
    fn descriptor(&self) -> &CapabilityDescriptor;
    fn is_closed(&self) -> bool;
    async fn close(&self) -> HaddonResult<()>;
}

pub struct ServiceRegistry {
    descriptors: EnumMap<ServiceKind, CapabilityDescriptor>,
    normalization: Option<Rc<dyn NormalizationService>>,
    locator: Option<Rc<dyn LocatorService>>,
    search: Option<Rc<dyn SearchService>>,
    positions: Option<Rc<dyn PositionsService>>,
    rendition: Option<Rc<dyn RenditionService>>,
}

impl Publication {
    pub fn capabilities(&self) -> &[CapabilityDescriptor];
    pub fn normalization_service(&self) -> Option<Rc<dyn NormalizationService>>;
    pub fn locator_service(&self) -> Option<Rc<dyn LocatorService>>;
    pub fn search_service(&self) -> Option<Rc<dyn SearchService>>;
    pub fn positions_service(&self) -> Option<Rc<dyn PositionsService>>;
    pub fn rendition_service(&self) -> Option<Rc<dyn RenditionService>>;

    pub async fn get_resource(
        &self,
        href: &PublicationHref,
        cancel: &CancellationToken,
    ) -> HaddonResult<Option<Rc<dyn Resource>>>;

    pub async fn close(&self) -> HaddonResult<()>;
}
```

- **Decision:** The standard service registry has explicit typed slots. Extensions may use a namespaced secondary registry, but standard services do not depend on string downcasts.
- **Decision:** Native implementations may replace `Rc`/`?Send` with `Arc + Send + Sync`. That mechanical choice must not change serialized data or lifecycle semantics.
- **Decision:** A service factory returns either an installed service plus descriptor or an unavailable descriptor. Factory failure during open is recoverable only if the service is optional and the warning explains its absence.
- **Decision:** Rust error sources remain available through internal `std::error::Error::source`, but serialization emits only the safe structured contract.

## 11. Portable TypeScript and WASM API sketch

```ts
type PublicationServices = {
  normalization: NormalizationService
  locator: LocatorService
  search: SearchService
  positions: PositionsService
  rendition: RenditionService
}

interface Publication extends Closeable {
  readonly identity: PublicationIdentity
  readonly manifest: Manifest

  capabilities(): readonly CapabilityDescriptor[]
  capability(kind: ServiceKind): CapabilityDescriptor
  service<K extends ServiceKind>(kind: K): PublicationServices[K] | undefined
  warnings(): readonly PublicationWarning[]

  getResource(
    target: string | ResourceLink,
    options?: OperationOptions
  ): AsyncResult<Resource | null>
}

interface WasmPublicationTransport extends Closeable {
  manifest(): Result<Manifest, HaddonError>
  capabilities(): Result<readonly CapabilityDescriptor[], HaddonError>
  call(request: WasmServiceRequest, signal?: AbortSignal): AsyncResult<JsonValue>
  openResource(href: string, signal?: AbortSignal): AsyncResult<WasmResourceHandle | null>
}
```

### WASM boundary decisions

1. Rust serializes the exact `Result` and `Outcome` tags. The portable wrapper does not infer errors from thrown strings.
2. Unexpected wasm-bindgen/runtime traps are caught by the wrapper and converted to `haddon.internal`; known Rust errors do not throw.
3. Resource and session handles have opaque numeric/string IDs plus explicit `close`. A handle table records parent publication ownership and rejects stale generations.
4. JavaScript `AbortSignal` is bridged to a Rust token for each call. Listener removal occurs on success, error, cancellation, and close.
5. Capability descriptors exposed by WASM describe what is actually transported. For example, a native core may support streaming while the first WASM transport reports a `streaming-unavailable` limitation.
6. DOM nodes, `Response`, React state, Remix types, Rust pointers, and borrowed slices never cross this interface.
7. An ergonomic browser adapter may optionally throw a typed `HaddonException` after inspecting `ok: false`, but the base portable contract remains a data union and tests target that union.

## 12. Capability negotiation across core, WASM, and navigator

No one layer may claim the final reading experience by itself.

```text
Publication/core capabilities
            ∩
WASM transport capabilities
            ∩
Navigator consumer capabilities
            ∩
Host requirements/preferences
            =
NegotiatedReaderPlan
```

```ts
type NavigatorCapabilities = {
  readonly acceptedRenditions: readonly RenditionKind[]
  readonly locatorFeatures: readonly string[]
  readonly requiredResourceFeatures: readonly string[]
}

type ReaderRequirements = {
  readonly preferredRenditions: readonly RenditionKind[]
  readonly requiredServices?: readonly ServiceKind[]
  readonly requiredLocatorFeatures?: readonly string[]
  readonly allowPartial?: boolean
}

type NegotiatedReaderPlan = {
  readonly status: "ready" | "degraded" | "blocked"
  readonly renditionByHref: Readonly<Record<string, RenditionKind>>
  readonly serviceProviders: Readonly<Partial<Record<ServiceKind, string>>>
  readonly warnings: readonly PublicationWarning[]
  readonly gaps: readonly CapabilityLimitation[]
}
```

### Negotiation algorithm

1. Read immutable publication/core descriptors.
2. Intersect them with WASM transport descriptors; downgrade availability when transport removes a required feature.
3. Probe rendition support per reading-order resource against navigator-accepted kinds.
4. Choose the first supported kind in host preference order, recording per-resource fallbacks.
5. Verify required service and locator features.
6. Return `ready` when all requested scope has preferred support, `degraded` when allowed fallbacks cover it, or `blocked` with explicit gaps.

- **Decision:** Negotiation is pure and repeatable for fixed descriptors/requirements. It performs no resource I/O.
- **Decision:** A plan may choose normalized semantic rendition for ordinary prose and fixed-layout/source rendition for another resource in the same publication.
- **Decision:** Klemata may require locator resolution and source mapping for citation links even if a standalone Haddon host would allow a simpler reader. Host requirements therefore participate explicitly.
- **Decision:** Navigator-only facilities such as browser DOM selection may satisfy navigator features, but cannot be advertised as core services usable in a server or worker.
- **Decision:** A capability advertised at open remains stable. A later operational failure produces an error or partial outcome, not silent renegotiation. The host may explicitly negotiate a new fallback plan.

## 13. Testable invariants

HADDON-015 and subsequent service tickets must encode these as contract tests shared where possible between Rust and TypeScript/WASM.

### Results and diagnostics

1. Every partial outcome has at least one explanatory warning.
2. An error contains no usable value; a warning exists only alongside a usable value or in the diagnostic ledger from work completed before cancellation.
3. Missing service, complete empty result, partial empty result, and failed operation are four distinguishable states.
4. Warning/error codes survive Rust JSON/WASM/TypeScript round trips unchanged.
5. No serialized diagnostic leaks publication text, source bytes, host paths, credentials, or stack traces.
6. Strict open fails on a fixture that recover open returns as partial with a deterministic warning list.

### Capabilities

7. Each standard service kind has exactly one descriptor.
8. `service(kind)` is present exactly when availability is `available` or `partial`.
9. Partial descriptors include limitations and supported scope/probe behavior.
10. The same fixture and runtime produce byte-equivalent serialized descriptors across repeated opens.
11. Negotiation never selects a rendition absent from any required layer.
12. A mixed reflowable/fixed-layout publication can negotiate different renditions per href.

### Cancellation

13. A pre-aborted signal performs no resource read and emits no warning.
14. Abort during open releases every acquired handle and returns `cancelled: request`.
15. Abort during a search page produces no later results; the search session remains usable unless it was itself closed.
16. Publication close causes in-flight descendant work to return `cancelled: publication-close`.
17. A new operation after close returns `closed`, not `cancelled` or a runtime exception.
18. Abort listeners are removed after every terminal outcome.

### Ownership and close

19. Opening a publication does not read spine content merely to install services or descriptors.
20. Two handles for one href remain independent when either handle closes.
21. Publication close closes all live handles/sessions, all services, and the container exactly once.
22. Concurrent close calls share one close sequence; later close calls succeed without repeated cleanup.
23. Cleanup failure still leaves the owner closed and returns one aggregate typed error.
24. Dropping JavaScript references without close is not required for correctness in the tests; explicit close proves resource release deterministically.

### Service truthfulness

25. Unavailable search cannot return `[]`; complete search with no matches can.
26. A search that skips an unreadable resource is partial and names the omitted href in coverage.
27. Coarse per-resource positions declare their granularity and do not claim text-unit stability.
28. Normalization that omits unsupported semantic content is partial and carries source-scoped warnings.
29. Locator ambiguity is a successful domain result, while malformed locator JSON is a typed error.
30. Rendition fallback is visible in the negotiated plan and operation warning.

## 14. HADDON-015 implementation handoff

HADDON-015 should consume this design narrowly. It does not need to implement normalization, search, positions, locators, or rendition algorithms yet.

### Required skeleton

1. Add the serializable `Outcome`, `Completeness`, `Coverage`, `PublicationWarning`, `HaddonError`, capability descriptor, and lifecycle types.
2. Implement `Publication` as identity + immutable manifest + lazy `ResourceContainer` + typed `ServiceRegistry` + lifecycle/diagnostic ledger.
3. Install one descriptor for every standard service kind. Initially unavailable services must remain genuinely absent.
4. Implement lazy `get_resource`, independent resource leases, half-open ranged reads, and deterministic close.
5. Add cancellation to open, resource length/read, and close plumbing, even if fixture reads complete immediately.
6. Provide a WASM/TypeScript adapter that serializes result tags and structured diagnostics instead of `JsValue::from_str(e.to_string())`.
7. Keep current `EpubDocument`/`EpubReader` available behind a compatibility path until later tickets move normalization and canvas rendition into services.

### Required HADDON-015 tests

- opening the HADDON-010 fixture reads container/package/navigation data but no spine resource bodies;
- the opened manifest and service descriptors are immutable and repeatable;
- every standard optional capability is discoverably unavailable until implemented;
- two ranged resource leases read independently and close independently;
- a missing unowned href returns complete `null`, while a declared-but-missing resource fails lazily with `resource-not-found`;
- partial recover open and strict fatal open are distinguishable on one intentionally damaged derivative fixture;
- pre-aborted and close-aborted resource operations return the specified cancellation origins;
- close order and idempotency are verified with instrumented fake services/container/handles;
- Rust and WASM serialize the same representative success, partial success, fatal error, and cancellation fixtures.

### Do not do in HADDON-015

- do not register placeholder services that return empty values;
- do not read every spine item during open;
- do not expose Rust trait objects or pointers directly through wasm-bindgen;
- do not make `Drop`, JavaScript finalizers, React unmount, or navigator teardown the publication cleanup mechanism;
- do not collapse the structured error back into a string for convenience;
- do not let the current canvas renderer define the rendition capability contract.

## 15. Open questions

These do not block the HADDON-015 skeleton unless noted.

1. **Async implementation:** Which cancellation/async trait primitives support both native and wasm32 without changing public semantics? HADDON-015 must resolve this implementation choice.
2. **Diagnostic retention:** Should the publication ledger be unbounded for one open lifetime, or should repeated runtime warnings be coalesced after a threshold? Operation outcomes must remain lossless either way.
3. **Partial open threshold:** Is a manifest-only protected publication useful enough to return by default, or should open options distinguish `inspect` from `read` intent?
4. **Capability contract versions:** Use a simple major version (`"1"`) initially or a namespaced semantic version (`"haddon.search/1"`)? HADDON-015 should choose one serialized spelling before fixtures are frozen.
5. **Service multiplicity:** Standard slots select one active provider. A later extension may need multiple rendition providers; negotiation can accept provider arrays without changing service result semantics.
6. **Streaming transport:** The first WASM implementation may omit `Resource.stream()`. Its capability descriptor must say so; HADDON-020 can decide whether transferable streams justify the complexity.
7. **Cleanup severity:** Some hosts may want cleanup failures duplicated to telemetry even after receiving `cleanup-failed`. That is a host observer concern, not a second error channel.
8. **Progress:** Search/index/normalization progress is deferred. It should follow MuPDF's useful separation of progress, errors, abort, and incompleteness without introducing mutable cross-layer state.
