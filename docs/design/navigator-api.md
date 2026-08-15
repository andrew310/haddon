# Haddon Framework-Neutral Web Navigator Contract

**Status:** Proposed design for HADDON-030

**Date:** 2026-08-13

**Scope:** The per-mount browser navigator lifecycle, portable command/state/event API, rendition-backend seam, and the boundary with a thin React/Remix 3 adapter

**Depends on:** HADDON-002, HADDON-011, HADDON-012, HADDON-013, and HADDON-014

**Out of scope:** Semantic DOM implementation (HADDON-031), visible-location algorithms (HADDON-032), decoration rendering (HADDON-033), pagination mechanics (HADDON-034), iframe security implementation (HADDON-035), fixed-layout implementation (HADDON-036), canvas extraction (HADDON-037), and Klemata citation storage/URLs (HADDON-040)

This document turns the [Readium Web UI boundary research](../research/readium-web-ui-boundary.md) into the portable contract consumed by Haddon and Klemata. It uses the canonical `Publication`, `PublicationLocatorV1`, result, capability, warning, and error types already defined in [publication-model.md](publication-model.md), [normalized-document.md](normalized-document.md), and [services-and-errors.md](services-and-errors.md).

## Decision summary

The labels in this section are normative for the first implementation.

- **Decision:** One `PublicationNavigator` is created for one supplied `HTMLElement`. It is neither a module singleton nor a React component.
- **Decision:** The navigator consumes an already-open `Publication`. It borrows that handle for the duration of an open view and never calls `Publication.close()` itself.
- **Decision:** Mount lifetime and publication-view lifetime are separate. A mounted navigator may open, close, and replace publication views before its final `destroy()`.
- **Decision:** `replace()` is an explicit close-then-open operation with no rollback. If the new view fails, the navigator is mounted and idle; the old publication is not silently restored.
- **Decision:** Snapshot, event, and domain-result payloads are plain, immutable, serializable data. The only nonserializable public inputs are deliberate Web/runtime handles: the supplied root, borrowed `Publication`, `AbortSignal`, controller, and callbacks. No DOM node, `Range`, iframe window, canvas context, router object, or framework state crosses the public state/event boundary.
- **Decision:** Durable logical location is a `PublicationLocatorV1`. Viewport pages, spreads, DOM rectangles, and backend page indices are ephemeral rendition facts.
- **Decision:** State is read through a referentially stable snapshot plus an external-store subscription. One separate typed event stream carries occurrences such as selection, link intent, pointer intent, warnings, and decoration activation.
- **Decision:** Commands return the common `AsyncResult<T>` shape. Expected domain outcomes such as publication boundary, ambiguous locator, and unresolved locator are successful typed values, not exceptions.
- **Decision:** Preferences have requested values, effective values, and per-setting support. Application chrome dimensions are expressed as viewport insets, not typography preferences.
- **Decision:** Selections and decorations are locator-backed. Geometry is expressed in root-relative CSS pixels and is invalidated by a monotonically increasing `layoutRevision`.
- **Decision:** Link and pointer interactions produce intent. The navigator never calls `window.open()`, changes a Remix route, toggles Klemata chrome, or invents edge-tap policy.
- **Decision:** Multiple rendition backends implement one private browser SPI. Backend selection may vary by resource, but backend identity never changes publication identity or persisted location.
- **Decision:** The React/Remix 3 layer is an adapter over the controller. Locator, preference, and decoration prop changes call commands; they do not remount the reading surface.

Readium's abstract navigator is the useful starting boundary: publication/current-location access, locator/link movement, progression movement, and deterministic destruction ([`Navigator.ts:43-74`](../../repos/readium-ts-toolkit/navigator/src/Navigator.ts#L43)). Its concrete EPUB navigator already takes a supplied element and an open publication ([`EpubNavigator.ts:124-134`](../../repos/readium-ts-toolkit/navigator/src/epub/EpubNavigator.ts#L124)). Haddon makes that boundary instance-safe, renderer-neutral, cancellable, and explicit about typed outcomes.

## 1. Boundary and ownership

```text
Klemata / Remix 3
  owns route, volume identity, open Publication, persistence, chrome, policy
                              |
                              v
PublicationNavigator (one per mounted root)
  owns command queue, snapshot, subscriptions, active rendition session,
  observer/listener/URL cleanup, and backend coordination
                              |
             +----------------+----------------+
             |                |                |
             v                v                v
    normalized DOM       source iframe    fixed/canvas backend
       session              session              session
                              |
                              v
                  borrowed Publication/services
```

### Host-owned objects

The host owns:

- the root `HTMLElement` and its placement in the document;
- the open `Publication` and the decision to close it;
- the selected volume/edition and Klemata citation envelope;
- durable progress, annotations, preferences, and application state;
- toolbar, note popover, external-link, keyboard, and route policy.

### Navigator-owned objects

The navigator owns:

- exactly one private child mount slot inside the root;
- all rendition sessions created in that slot;
- generated object URLs, workers, frames, canvases, observers, timers, and listeners created on its behalf;
- the current requested/effective preferences, viewport insets, logical decorations, selection, and location snapshot;
- cancellation controllers and operation generations needed to reject late work.

The navigator removes only nodes it created. It must not clear unrelated host children or mutate layout outside its private mount slot.

### Borrowed publication rule

`open()` and `replace()` borrow an already-open `Publication`. The host must keep it usable until the corresponding view is closed, replaced, or destroyed. The navigator may close resource handles and services/sessions it directly acquires, but it does not close the publication.

This keeps ownership unambiguous when Klemata shares one publication with citation resolution, indexing, or metadata UI. It also matches Readium's separation between publication creation and navigator construction ([`EpubNavigator.ts:124-134`](../../repos/readium-ts-toolkit/navigator/src/epub/EpubNavigator.ts#L124)). Foliate independently separates view teardown from publication-specific URL cleanup ([`view.js:297-308`](../../repos/foliate-js/view.js#L297), [`epub.js:1080-1082`](../../repos/foliate-js/epub.js#L1080)).

Safe host replacement order is therefore:

```text
open next Publication
        -> await navigator.replace({ publication: next, ... })
        -> close previous Publication
```

After a failed replacement, the host may close both the previous publication and the failed next publication because no view remains open.

## 2. Package entry point and lifecycle

### Construction

```ts
type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E }

type MountedNavigatorOptions = {
  readonly backends: readonly RenditionBackend[]
  readonly defaults?: Partial<RenditionPreferencesV1>
  readonly insets?: Partial<ViewportInsets>
}

function mountNavigator(
  root: HTMLElement,
  options: MountedNavigatorOptions,
): Result<PublicationNavigator, HaddonError>
```

`mountNavigator()` is synchronous because it only validates the root, claims a private mount slot, installs instance-local bookkeeping, and returns the controller. It performs no publication I/O and mounts no rendition. It fails with `haddon.invalid-argument` when the root belongs to a different live Haddon navigator or when no backend was supplied.

The package may keep a private weak root-claim table. It must not expose or reuse a module-global navigator instance. Thorium's module-scoped `navigatorInstance` prevents two independent mounts and is explicitly a pattern Haddon rejects ([`useEpubNavigator.ts:28-45`](../../repos/thorium-web/src/core/Hooks/Epub/useEpubNavigator.ts#L28)).

### Lifecycle states

```ts
type NavigatorStatus =
  | { readonly state: "idle" }
  | { readonly state: "opening"; readonly operationId: string }
  | { readonly state: "ready" }
  | {
      readonly state: "busy"
      readonly operation:
        | "navigate"
        | "preferences"
        | "decorations"
        | "viewport"
      readonly operationId: string
    }
  | { readonly state: "replacing"; readonly operationId: string }
  | { readonly state: "closing"; readonly operationId: string }
  | { readonly state: "error"; readonly error: HaddonError }
  | { readonly state: "destroyed" }
```

```text
mount -> idle
idle --open----------> opening ----success----> ready
                                  \--failure--> idle
ready --command------> busy -------settle-----> ready
ready --replace------> replacing --success----> ready
                                  \--failure--> idle
ready/error --close-> closing -----settle-----> idle
any non-destroyed --destroy-------------------> destroyed
```

- `error` means an active rendition suffered a fatal runtime failure. The mounted controller remains destroyable/closeable and the borrowed publication remains host-owned.
- Recoverable command errors leave the prior usable snapshot in `ready`; they do not transition to `error`.
- Only one lifecycle mutation is active at a time. Host commands are serialized in call order. Scroll/selection observations may update the snapshot between commands but cannot complete a command with an older operation generation.
- `destroy()` is terminal. A destroyed navigator cannot be reopened or attached to another root.

Readium has useful teardown coverage—it destroys frame resources and clears decoration state ([`EpubNavigator.ts:857-872`](../../repos/readium-ts-toolkit/navigator/src/epub/EpubNavigator.ts#L857))—but construction starts observers and work before `load()` finishes ([`EpubNavigator.ts:219-223`](../../repos/readium-ts-toolkit/navigator/src/epub/EpubNavigator.ts#L219), [`EpubNavigator.ts:251-299`](../../repos/readium-ts-toolkit/navigator/src/epub/EpubNavigator.ts#L251)). Haddon's state machine makes partial construction and teardown observable and testable.

### Open, replace, close, and destroy

```ts
type OperationOptions = {
  readonly signal?: AbortSignal
}

type NavigatorOpenRequest = {
  readonly publication: Publication
  readonly requirements: ReaderRequirements
  readonly initialLocator?: PublicationLocatorV1
  readonly initialLocatorPolicy?: ResolutionPolicy
  readonly preferences?: Partial<RenditionPreferencesV1>
  readonly decorations?: Readonly<Record<string, readonly DecorationV1[]>>
}

type NavigatorOpenResult = {
  readonly publication: PublicationIdentity
  readonly plan: NegotiatedReaderPlan
  readonly initialNavigation?: NavigationResult
  readonly snapshot: NavigatorSnapshotV1
}

interface PublicationNavigator {
  getSnapshot(): NavigatorSnapshotV1
  subscribe(listener: () => void): () => void
  subscribeEvents(listener: (event: NavigatorEventV1) => void): () => void

  open(
    request: NavigatorOpenRequest,
    options?: OperationOptions,
  ): AsyncResult<NavigatorOpenResult>

  replace(
    request: NavigatorOpenRequest,
    options?: OperationOptions,
  ): AsyncResult<NavigatorOpenResult>

  close(): AsyncResult<void>
  destroy(): AsyncResult<void>

  goTo(
    locator: PublicationLocatorV1,
    options?: NavigationOptions,
  ): AsyncResult<NavigationResult>
  goToLink(
    link: ResourceLink,
    options?: NavigationOptions,
  ): AsyncResult<NavigationResult>
  goForward(options?: NavigationOptions): AsyncResult<StepResult>
  goBackward(options?: NavigationOptions): AsyncResult<StepResult>

  setPreferences(
    patch: Partial<RenditionPreferencesV1>,
    options?: OperationOptions,
  ): AsyncResult<PreferenceResult>
  setViewportInsets(
    insets: ViewportInsets,
    options?: OperationOptions,
  ): AsyncResult<ViewportResult>

  setDecorations(
    group: DecorationGroupId,
    decorations: readonly DecorationV1[],
    options?: OperationOptions,
  ): AsyncResult<DecorationSetResult>
  clearDecorations(
    group: DecorationGroupId,
    options?: OperationOptions,
  ): AsyncResult<DecorationSetResult>

  clearSelection(options?: OperationOptions): AsyncResult<void>
  focus(options?: FocusOptions): void
}
```

`AsyncResult<T>` is `Promise<Result<Outcome<T>, HaddonError>>` from [services-and-errors.md](services-and-errors.md). `open()` is valid only from `idle`; `replace()` is valid only while a view is active (`ready` or recoverable `error`). Calling a view command in `idle` is `haddon.invalid-argument` with `details.state = "idle"`. Any new operation after destruction is `haddon.closed`.

`close()` is idempotent and returns only after the active backend session, owned handles, observers, URLs, workers, and listeners for the view have settled. It retains the mounted slot, backend registry, default preferences, and explicit insets. `destroy()` performs `close()`, removes the private slot, releases the root claim, clears subscribers, and becomes terminal. Concurrent `close()`/`destroy()` calls share one teardown; later calls succeed without repeating cleanup.

`replace()` first aborts active view operations, tears down the old session completely, commits an empty `replacing` snapshot, and then opens the new request. It does not close either `Publication`. This close-then-open rule favors deterministic ownership and bounded memory over transactional rollback.

## 3. Snapshot and subscriptions

### Portable snapshot

```ts
type NavigatorSnapshotV1 = {
  readonly schema: "haddon.navigator-snapshot"
  readonly version: 1
  /** Increments for every committed snapshot change. */
  readonly revision: number
  readonly status: NavigatorStatus
  readonly publication?: PublicationIdentity
  readonly location?: VisibleLocationV1
  readonly layout?: RenditionLayout
  readonly readingProgression?: "ltr" | "rtl" | "ttb" | "btt" | "auto"
  readonly navigation: {
    readonly backward: NavigationAvailability
    readonly forward: NavigationAvailability
  }
  readonly preferences: PreferenceSnapshotV1
  readonly capabilities: NavigatorCapabilitiesV1
  readonly viewport: ViewportSnapshot
  readonly selection: ReaderSelectionV1 | null
  readonly activeRenditions: readonly ActiveRendition[]
}

type NavigationAvailability =
  | { readonly status: "available" }
  | { readonly status: "boundary" }
  | { readonly status: "unknown"; readonly reason: string }

type RenditionLayout = "scrolled" | "paginated" | "fixed"

type ActiveRendition = {
  readonly hrefs: readonly string[]
  readonly kind: RenditionKind
  readonly backendId: string
}
```

There are no `Map`, `Set`, functions, class instances, or browser objects in a snapshot. `PublicationIdentity`, locators, warning details, extension payloads, and host data must already satisfy their own JSON contracts. The root and borrowed `Publication` are intentionally absent.

### Snapshot subscription

`getSnapshot()` returns the exact same frozen object reference until a state change is committed. After a commit it returns one new frozen object whose `revision` is the prior revision plus one. `subscribe(listener)` follows the external-store protocol:

1. Adding a listener does not invoke it immediately.
2. Every listener is invoked once after each committed snapshot revision.
3. The new snapshot is installed before listeners run.
4. Unsubscribe is idempotent.
5. Listener exceptions remain the subscribing host's errors; they do not stop other listeners or turn an engine operation into failure.
6. No listener is invoked after `destroy()` settles.

This shape is directly usable with React's external-store mechanism without making React a package dependency.

### Occurrence event subscription

Snapshot state and events serve different purposes. A toolbar reads `NavigatorSnapshotV1`; an annotation popover reacts to one `decoration-activate` event. `subscribeEvents()` does not replay old events and does not replace snapshot observation.

```ts
type NavigatorEventBase = {
  readonly schema: "haddon.navigator-event"
  readonly version: 1
  /** Monotonic within one navigator instance. */
  readonly sequence: number
  /** Snapshot revision already committed when this event is delivered. */
  readonly snapshotRevision: number
}

type NavigatorEventV1 = NavigatorEventBase & (
  | { readonly type: "ready"; readonly snapshot: NavigatorSnapshotV1 }
  | {
      readonly type: "location-change"
      readonly location: VisibleLocationV1
      readonly cause: LocationChangeCause
    }
  | {
      readonly type: "selection-change"
      readonly selection: ReaderSelectionV1 | null
    }
  | { readonly type: "link-intent"; readonly intent: LinkIntentV1 }
  | { readonly type: "pointer-intent"; readonly intent: PointerIntentV1 }
  | {
      readonly type: "decoration-activate"
      readonly group: DecorationGroupId
      readonly decorationId: string
      readonly geometry: ClientGeometryV1
      readonly input: PointerInput
    }
  | {
      readonly type: "decoration-enter"
      readonly group: DecorationGroupId
      readonly decorationId: string
      readonly geometry: ClientGeometryV1
    }
  | {
      readonly type: "decoration-leave"
      readonly group: DecorationGroupId
      readonly decorationId: string
    }
  | { readonly type: "warning"; readonly warning: PublicationWarning }
  | { readonly type: "fatal-error"; readonly error: HaddonError }
)
```

Events are delivered in `sequence` order. When an event corresponds to state, the snapshot is committed and snapshot subscribers run before the event is delivered. A successful command resolves after its final snapshot and command-caused events have been delivered. Event callbacks may enqueue commands; they cannot re-enter the active mutation synchronously.

Readium requires one large listener object with defaults for every callback ([`EpubNavigator.ts:36-69`](../../repos/readium-ts-toolkit/navigator/src/epub/EpubNavigator.ts#L36)). A discriminated stream is easier to compose, validate, record, and test without a stateful-reader monolith.

## 4. Logical and visible location

### Location shape

```ts
type VisibleLocationV1 = {
  /** Durable collapsed locator at the logical reading edge of the viewport. */
  readonly current: PublicationLocatorV1
  /** Ordered visible spans; one span can never cross hrefs. */
  readonly segments: readonly VisibleSegmentV1[]
  readonly rendition: RenditionPositionV1
  readonly layoutRevision: number
}

type VisibleSegmentV1 = {
  readonly href: string
  /** A ranged locator when both boundaries are known; otherwise collapsed. */
  readonly locator: PublicationLocatorV1
  readonly visibility: "partial" | "complete"
}

type RenditionPositionV1 = {
  readonly layout: RenditionLayout
  readonly resourceProgression?: number
  readonly publicationProgression?: number
  readonly viewportPageIndex?: number
  readonly viewportPageCount?: number
  readonly spreadIndex?: number
  readonly spreadCount?: number
}

type LocationChangeCause =
  | "initial"
  | "command"
  | "link"
  | "scroll"
  | "selection"
  | "resize"
  | "insets"
  | "preferences"
  | "backend-switch"
  | "recovery"
```

`current` is the first visible logical reading position, not necessarily the top-left physical point. In RTL or vertical progression, the backend maps physical geometry into logical order before reporting it. It is always a collapsed locator suitable for resume. `segments` preserve the fact that a fixed-layout spread or continuous viewport can show more than one resource; each locator remains resource-scoped as required by [publication-model.md](publication-model.md).

`rendition` is useful for UI labels and animations but is never citation identity. A persisted `viewportPageIndex` is a bug. Foliate computes a live DOM range for the viewport and emits it with a relocation reason ([`paginator.js:945-969`](../../repos/foliate-js/paginator.js#L945)); Readium separately exposes visible hrefs, progression ranges, and positions ([`Navigator.ts:24-35`](../../repos/readium-ts-toolkit/navigator/src/Navigator.ts#L24), [`EpubNavigator.ts:982-1018`](../../repos/readium-ts-toolkit/navigator/src/epub/EpubNavigator.ts#L982)). Haddon combines those ideas while converting every durable edge through `LocatorService`.

### Location rules

1. An open result is not successful until `location.current` exists or the publication is provably empty/inspection-only and the result is partial with a warning.
2. A `location-change` is emitted only when the durable location or meaningful visible rendition facts change; raw scroll events are animation-frame coalesced.
3. Resize, inset, preference, and backend changes first capture the current durable locator, relayout, navigate back to that locator, then publish the resulting visible location.
4. The post-layout locator may contain refreshed evidence and different progression. It must still resolve to the same logical passage or the outcome is partial with a recovery warning.
5. `layoutRevision` increments whenever prior geometry may be invalid: root size, device-pixel ratio used by a backend, insets, fonts, preferences affecting layout, resource content, or backend session.
6. An event from an old backend/session generation is ignored after replacement or resource switch.
7. Location calculation failure after useful content is mounted is a partial capability failure, not permission to persist a page index.

Readium updates `currentLocation` before calling its position listener ([`EpubNavigator.ts:466-477`](../../repos/readium-ts-toolkit/navigator/src/epub/EpubNavigator.ts#L466)). Haddon makes that ordering a general snapshot/event invariant.

## 5. Navigation commands and results

### Options and typed results

```ts
type NavigationOptions = OperationOptions & {
  readonly behavior?: "instant" | "smooth"
  readonly policy?: ResolutionPolicy
  /** Set only by a host following a previously emitted link intent. */
  readonly cause?: "command" | "link"
}

type NavigationResult =
  | {
      readonly status: "moved"
      readonly location: VisibleLocationV1
      readonly resolution: Extract<LocatorResolution, { status: "resolved" }>
    }
  | {
      readonly status: "already-visible"
      readonly location: VisibleLocationV1
      readonly resolution: Extract<LocatorResolution, { status: "resolved" }>
    }
  | {
      readonly status: "ambiguous"
      readonly resolution: Extract<LocatorResolution, { status: "ambiguous" }>
    }
  | {
      readonly status: "unresolved"
      readonly resolution: Extract<LocatorResolution, { status: "unresolved" }>
    }

type StepResult =
  | { readonly status: "moved"; readonly location: VisibleLocationV1 }
  | {
      readonly status: "boundary"
      readonly direction: "backward" | "forward"
      readonly location: VisibleLocationV1
    }
```

Examples:

```ts
const result = await navigator.goTo(citation.locator, {
  policy: "citation",
  signal,
})

if (!result.ok) {
  if (result.error.code === "haddon.cancelled") return
  reportReaderFailure(result.error)
} else if (result.value.value.status === "ambiguous") {
  showCitationCandidates(result.value.value.resolution.candidates)
}
```

```json
{
  "ok": true,
  "value": {
    "value": {
      "status": "boundary",
      "direction": "forward",
      "location": {
        "current": {
          "schema": "haddon.publication-locator",
          "version": 1,
          "href": "text/chapter-03.xhtml",
          "mediaType": "application/xhtml+xml",
          "locations": { "progression": 1 }
        },
        "segments": [],
        "rendition": { "layout": "paginated", "resourceProgression": 1 },
        "layoutRevision": 9
      }
    },
    "completeness": "complete",
    "warnings": []
  }
}
```

### Navigation rules

- `goTo()` asks `LocatorService` to resolve the locator under the chosen policy before handing a renderer-specific target to the active backend.
- `goToLink()` canonicalizes and resolves an owned `ResourceLink`, creates a locator, and delegates to `goTo()`; it never follows external URLs.
- `goForward()` and `goBackward()` move one semantic viewport portion in reading progression. Physical left/right/up/down keyboard or pointer mapping belongs to the host.
- Reaching the start or end is `StepResult.boundary`, not `false`, an exception, or a warning.
- `ambiguous` and `unresolved` leave the existing view and location unchanged.
- A degraded but usable resolver/backend recovery returns `moved` in a partial `Outcome` with warnings.
- Smooth behavior is a request. If reduced motion, backend support, or policy forces instant movement, the operation is partial only when the behavioral difference matters to the caller; otherwise effective behavior is reflected in capabilities.
- A command does not resolve until the target is mounted, focused location is settled, and the new snapshot is visible to subscribers.

Readium's booleans conflate command contention, boundaries, and target failures ([`EpubNavigator.ts:1021-1062`](../../repos/readium-ts-toolkit/navigator/src/epub/EpubNavigator.ts#L1021), [`EpubNavigator.ts:1262-1285`](../../repos/readium-ts-toolkit/navigator/src/epub/EpubNavigator.ts#L1262)). Foliate similarly catches and logs failed navigation without returning a typed failure ([`view.js:446-469`](../../repos/foliate-js/view.js#L446)). The Haddon result union prevents UI from guessing what `false` or `undefined` meant.

## 6. Preferences and effective capabilities

### Preferences

```ts
type RenditionPreferencesV1 = {
  readonly layout?: "auto" | "scrolled" | "paginated"
  readonly theme?: "auto" | "light" | "dark" | "sepia"
  readonly publisherStyles?: "preserve" | "constrain" | "ignore"
  readonly fontFamily?: string
  readonly fontScale?: number
  readonly lineHeight?: number
  readonly letterSpacing?: number
  readonly wordSpacing?: number
  readonly textAlign?: "start" | "justify"
  readonly hyphenation?: "auto" | "none"
  readonly columnCount?: "auto" | 1 | 2
  readonly pageGutterPx?: number
  readonly reducedMotion?: boolean
  readonly extensions?: Readonly<Record<string, JsonValue>>
}

type PreferenceName = Exclude<keyof RenditionPreferencesV1, "extensions">
type PreferenceKey = PreferenceName | `extension:${string}`

type PreferenceSupport = {
  readonly name: PreferenceKey
  readonly status: "effective" | "ineffective" | "unsupported"
  readonly mutable: boolean
  readonly reason?: string
  readonly range?: { readonly min: number; readonly max: number; readonly step?: number }
  readonly choices?: readonly JsonValue[]
}

type PreferenceSnapshotV1 = {
  readonly requested: RenditionPreferencesV1
  /** Fully materialized values that affect the active rendition. */
  readonly effective: RenditionPreferencesV1
  readonly support: readonly PreferenceSupport[]
}

type PreferenceResult = {
  readonly status: "applied" | "unchanged" | "degraded"
  readonly changed: readonly PreferenceKey[]
  readonly rejected: readonly PreferenceKey[]
  readonly locationBefore?: PublicationLocatorV1
  readonly locationAfter?: PublicationLocatorV1
  readonly preferences: PreferenceSnapshotV1
}
```

`setPreferences()` merges the patch into `requested`. `undefined` means “do not change this value”; resetting a value to its host/default policy requires that setting's documented reset value, normally `"auto"`, rather than `null` ambiguity. Unknown extension settings are retained only when a selected backend declares them.

Readium correctly distinguishes requested preferences, effective settings, and whether a control applies—for example, columns and font controls are ineffective for fixed layout ([`EpubPreferencesEditor.ts:106-173`](../../repos/readium-ts-toolkit/navigator/src/epub/preferences/EpubPreferencesEditor.ts#L106)). Haddon serializes that distinction so Klemata can disable or explain controls without reaching into a backend.

### Navigator capabilities

```ts
type NavigatorFeature =
  | "logical-location"
  | "visible-range"
  | "native-selection"
  | "selection-source-mapping"
  | "decorations"
  | "decoration-geometry"
  | "internal-links"
  | "pointer-intents"
  | "scrolling"
  | "pagination"
  | "fixed-layout"
  | `extension:${string}`

type NavigatorFeatureDescriptor = {
  readonly feature: NavigatorFeature
  readonly availability: "available" | "partial" | "unavailable"
  readonly limitations: readonly CapabilityLimitation[]
}

type NavigatorCapabilitiesV1 = {
  readonly acceptedRenditions: readonly RenditionKind[]
  readonly activeFeatures: readonly NavigatorFeatureDescriptor[]
  readonly decorationStyles: readonly string[]
  readonly locatorFeatures: readonly string[]
}
```

Capabilities are the effective intersection of publication/core, transport, selected backend, and host requirements described in [services-and-errors.md](services-and-errors.md). They may change when the active resource selects another backend, so they live in the snapshot. The underlying backend descriptors and negotiated plan remain stable for the view.

No capability may be inferred from method presence. A canvas backend may expose `setDecorations()` through the common interface while declaring native selection unavailable. Readium's decoration API similarly offers a style support query rather than assuming every style renders everywhere ([`styles.ts:41-54`](../../repos/readium-ts-toolkit/decorator/src/styles.ts#L41)).

## 7. Viewport, resize, and insets

```ts
type ViewportInsets = {
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly left: number
}

type ViewportSnapshot = {
  readonly width: number
  readonly height: number
  readonly insets: ViewportInsets
  readonly contentWidth: number
  readonly contentHeight: number
  readonly devicePixelRatio: number
  readonly layoutRevision: number
}

type ViewportResult = {
  readonly status: "applied" | "unchanged" | "degraded"
  readonly viewport: ViewportSnapshot
  readonly locationBefore?: PublicationLocatorV1
  readonly locationAfter?: PublicationLocatorV1
}
```

All dimensions are finite, nonnegative CSS pixels. Insets are logical unavailable space inside the root, typically caused by Klemata overlay chrome. The navigator computes `contentWidth = max(0, width - left - right)` and the corresponding height. Physical toolbar and arrow widths never masquerade as font or line-length settings.

The navigator owns a `ResizeObserver` on the supplied root and reads its content box. It does not assume `window.innerWidth`; Readium observes its container's parent specifically because a reader may sit between docked panels ([`EpubNavigator.ts:219-223`](../../repos/readium-ts-toolkit/navigator/src/epub/EpubNavigator.ts#L219)). Haddon observes the actual root because the host, not the engine, decides the available rectangle.

Resize and inset updates are animation-frame coalesced. The navigator captures the current logical locator before telling the backend to relayout. A zero-sized root is not fatal: the view remains mounted, navigation is temporarily unavailable/unknown, and it resumes when a nonzero content rectangle appears. An open request may wait for the first nonzero rectangle unless cancelled.

## 8. Selection and geometry

### Portable selection

```ts
type PointerInput = "mouse" | "touch" | "pen" | "keyboard" | "unknown"

type ClientRectV1 = {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

type ClientPointV1 = {
  readonly x: number
  readonly y: number
}

type ClientGeometryV1 = {
  /** Union rectangle, relative to the navigator root's content-box origin. */
  readonly bounds: ClientRectV1
  /** Ordered nonempty line/fragment rectangles in the same coordinate space. */
  readonly rects: readonly ClientRectV1[]
  readonly layoutRevision: number
}

type ReaderSelectionV1 =
  | {
      readonly status: "resolved"
      readonly ranges: readonly PublicationLocatorV1[]
      readonly text: string
      readonly direction: "forward" | "backward" | "unknown"
      readonly collapsed: boolean
      readonly input: PointerInput
      readonly geometry: ClientGeometryV1
    }
  | {
      readonly status: "unresolved"
      readonly hrefs: readonly string[]
      readonly text: string
      readonly reason:
        | "mapping-unavailable"
        | "ambiguous"
        | "cross-origin"
        | "unsupported"
      readonly direction: "forward" | "backward" | "unknown"
      readonly collapsed: boolean
      readonly input: PointerInput
      readonly geometry: ClientGeometryV1
    }
```

Rules:

1. `ranges` is nonempty and ordered by publication reading order. Each locator is resource-scoped and includes exact quote context for a noncollapsed text range.
2. Version 1 semantic DOM and iframe backends normally produce one range. The array permits a future continuous view to represent a cross-resource selection without inventing an illegal cross-href locator.
3. A selection is `resolved` only after source/normalized mapping creates durable locator evidence. Text plus a rectangle is not a citation.
4. An unresolved selection is still useful for copy UI, but Klemata must not persist it as a citation.
5. Geometry is in CSS pixels relative to the navigator root's content box after insets. It is valid only while `geometry.layoutRevision === snapshot.viewport.layoutRevision`.
6. Rectangles contain no DOM `Range` or `DOMRect`. Zero-area rects are removed unless the selection is collapsed, where one caret rectangle is allowed.
7. `clearSelection()` clears native/backend selection and commits `selection: null`; it does not delete annotations or decorations.

Readium currently transports only text and one rectangle, then adds an href-level locator without a precise DOM range ([`Peripherals.ts:25-34`](../../repos/readium-ts-toolkit/navigator-html-injectables/src/modules/Peripherals.ts#L25), [`EpubNavigator.ts:479-490`](../../repos/readium-ts-toolkit/navigator/src/epub/EpubNavigator.ts#L479)). Haddon requires durable range mapping before it labels a selection resolved. Foliate's selection code demonstrates why direction and live range handling belong inside the renderer rather than host hit testing ([`paginator.js:577-614`](../../repos/foliate-js/paginator.js#L577)).

## 9. Grouped decorations

```ts
type DecorationGroupId = string

type DecorationV1 = {
  readonly id: string
  readonly locator: PublicationLocatorV1
  readonly style: DecorationStyleV1
  readonly interactive?: boolean
  readonly hostData?: JsonValue
}

type DecorationStyleV1 =
  | { readonly type: "highlight"; readonly token: string }
  | { readonly type: "underline"; readonly token: string }
  | { readonly type: "marker"; readonly token: string }
  | { readonly type: `extension:${string}`; readonly options?: JsonValue }

type DecorationItemResult = {
  readonly id: string
  readonly status: "applied" | "unchanged" | "unresolved" | "unsupported"
  readonly reason?: string
}

type DecorationSetResult = {
  readonly group: DecorationGroupId
  readonly items: readonly DecorationItemResult[]
}
```

`setDecorations(group, next)` atomically replaces the navigator's logical set for that group. IDs must be unique within the group and nonempty; duplicate IDs reject the whole input as `haddon.invalid-argument`. The navigator may diff add/update/remove operations internally, but callers never mutate a live decoration.

The logical group survives resource and backend remounts until explicitly cleared, view close, or replacement. Only decorations for active hrefs are materialized. A backend failure to render some decorations yields a partial outcome and item statuses; it does not discard successfully retained logical decorations. Initial conventional groups are `klemata-citations`, `highlights`, `annotations`, `search-results`, and `active-citation`, but the API does not reserve them.

Decoration activation/hover events report group, stable ID, and transient root-relative geometry. The host looks up `hostData` from its own submitted set; an event does not echo arbitrary data originating in untrusted publication content.

Readium's implementation already diffs grouped IDs, filters operations by visible href, and reapplies them when frames load ([`EpubNavigator.ts:728-815`](../../repos/readium-ts-toolkit/navigator/src/epub/EpubNavigator.ts#L728)). It also maps activation/hover back to stable decoration values and geometry ([`EpubNavigator.ts:818-852`](../../repos/readium-ts-toolkit/navigator/src/epub/EpubNavigator.ts#L818)). Haddon preserves those behaviors while keeping style templates and HTML out of the public contract.

## 10. Link and pointer intent

### Links

```ts
type LinkIntentV1 = {
  readonly id: string
  readonly source: PublicationLocatorV1
  readonly rawHref: string
  readonly target:
    | {
        readonly kind: "publication"
        readonly link: ResourceLink
        readonly locator: PublicationLocatorV1
      }
    | { readonly kind: "external"; readonly url: string }
    | { readonly kind: "unsupported-scheme"; readonly href: string }
    | { readonly kind: "unresolved"; readonly href: string }
  readonly rels: readonly string[]
  readonly geometry?: ClientGeometryV1
  readonly input: PointerInput
}
```

The backend prevents the publication document's default top-level navigation, captures the literal `rawHref`, and asks the navigator to canonicalize/classify it relative to the source resource. The navigator emits `link-intent` and takes no product action. The host may:

- call `goTo()`/`goToLink()` for ordinary internal navigation;
- open a Klemata note or citation panel for a note relation;
- confirm and open an external URL using host policy;
- ignore or explain an unsupported target.

This avoids a synchronous cancelable event protocol and keeps all effects explicit. It also prevents `window.open()` inside the engine. Foliate distinguishes internal and external links but falls back to opening an uncancelled external link ([`view.js:350-365`](../../repos/foliate-js/view.js#L350)); Readium mixes internal navigation and host delegation in its frame event handler ([`EpubNavigator.ts:504-545`](../../repos/readium-ts-toolkit/navigator/src/epub/EpubNavigator.ts#L504)). Haddon retains their useful classification mechanics, not their embedded policy.

### Pointer intent

```ts
type PointerIntentV1 = {
  readonly region: "start" | "center" | "end" | "content"
  readonly point: ClientPointV1
  readonly normalizedPoint: ClientPointV1
  readonly input: Exclude<PointerInput, "keyboard">
  readonly interactive: boolean
  readonly locator?: PublicationLocatorV1
}
```

`normalizedPoint.x` and `.y` are each in `[0, 1]` within the active content rectangle. `start`/`end` are logical reading-progression regions, not hard-coded left/right. `interactive` reports that the target was a link, form control, media control, or other semantic interactive element; pointer-region policy should normally ignore it.

The navigator emits intent only. Klemata decides whether start/end means turn, center means toggle chrome, or the gesture does nothing. Readium contains default quarter-screen behavior ([`EpubNavigator.ts:568-575`](../../repos/readium-ts-toolkit/navigator/src/epub/EpubNavigator.ts#L568)), while Thorium duplicates that behavior by reaching into private iframe widths ([`StatefulReader.tsx:324-351`](../../repos/thorium-web/src/components/Epub/StatefulReader.tsx#L324)). This public intent contract removes both the duplication and private frame access.

## 11. Rendition backend contract

The backend SPI is a browser-internal extension seam. It may use DOM APIs because it implements a web navigator, but all values crossing from a backend into navigator state/events are portable data.

### Backend descriptor and opening

```ts
type RenditionBackendDescriptor = {
  readonly id: string
  readonly version: string
  readonly renditionKinds: readonly RenditionKind[]
  readonly features: readonly NavigatorFeatureDescriptor[]
  readonly decorationStyles: readonly string[]
}

type BackendOpenRequest = {
  /** Private empty slot owned by this navigator; never exposed to the host. */
  readonly host: HTMLElement
  readonly publication: Publication
  readonly plan: NegotiatedReaderPlan
  /** One resource normally; multiple resources for a fixed-layout spread. */
  readonly entries: readonly RenditionEntry[]
  readonly preferences: RenditionPreferencesV1
  readonly viewport: ViewportSnapshot
  readonly initialTarget: ResolvedTarget
  readonly emit: (event: BackendEventV1) => void
}

type RenditionEntry = {
  readonly link: ResourceLink
  readonly source: RenditionSource
}

interface RenditionBackend {
  readonly descriptor: RenditionBackendDescriptor

  assess(
    link: ResourceLink,
    kind: RenditionKind,
  ): SupportAssessment

  open(
    request: BackendOpenRequest,
    options?: OperationOptions,
  ): AsyncResult<RenditionSession>
}
```

`assess()` is synchronous and performs no resource read. Negotiation chooses a backend/rendition kind per href before opening. `open()` may prepare a semantic DOM tree, secure iframe, fixed-layout spread, or canvas surface. The backend must either return a fully owned session or clean up all partial work before returning an error.

### Active session

```ts
interface RenditionSession {
  readonly backendId: string
  readonly renditionKind: RenditionKind
  readonly hrefs: readonly string[]

  navigate(
    target: ResolvedTarget,
    options?: NavigationOptions,
  ): AsyncResult<BackendNavigationResult>
  step(
    direction: "backward" | "forward",
    options?: NavigationOptions,
  ): AsyncResult<BackendStepResult>
  applyPreferences(
    preferences: RenditionPreferencesV1,
    options?: OperationOptions,
  ): AsyncResult<BackendPreferenceResult>
  setViewport(
    viewport: ViewportSnapshot,
    options?: OperationOptions,
  ): AsyncResult<BackendViewportResult>
  setDecorations(
    group: DecorationGroupId,
    decorations: readonly ResolvedDecoration[],
    options?: OperationOptions,
  ): AsyncResult<DecorationSetResult>
  clearSelection(options?: OperationOptions): AsyncResult<void>
  focus(options?: FocusOptions): void
  destroy(): AsyncResult<void>
}
```

The `Backend*Result` types are SPI facts, not public outcomes: they report visible source/normalized ranges, step exhaustion within the mounted entries, effective settings, and backend warnings. The navigator converts them to canonical locators, may switch resources/backends, commits one public snapshot, and returns the public result.

```ts
type BackendEventV1 =
  | { readonly type: "visible-targets"; readonly targets: readonly BackendVisibleTarget[] }
  | { readonly type: "selection"; readonly selection: BackendSelection | null }
  | { readonly type: "link"; readonly link: BackendLinkIntent }
  | { readonly type: "pointer"; readonly pointer: BackendPointerIntent }
  | { readonly type: "decoration-activate"; readonly value: BackendDecorationEvent }
  | { readonly type: "decoration-enter"; readonly value: BackendDecorationEvent }
  | { readonly type: "decoration-leave"; readonly value: BackendDecorationEvent }
  | { readonly type: "warning"; readonly warning: PublicationWarning }
  | { readonly type: "fatal-error"; readonly error: HaddonError }
```

Backend source targets may temporarily contain DOM paths/ranges or normalized node ranges inside the SPI, but the navigator must convert them through source mapping/locator services before public emission. A backend must not make callers inspect its DOM to recover missing information.

Readium proves that an iframe implementation needs versioned, channel-scoped commands, acknowledgement tracking, and deterministic halt ([`FrameComms.ts:18-67`](../../repos/readium-ts-toolkit/navigator/src/epub/frame/FrameComms.ts#L18), [`FrameComms.ts:74-140`](../../repos/readium-ts-toolkit/navigator/src/epub/frame/FrameComms.ts#L74)). Its hidden-frame lifecycle also disables interaction/accessibility and removes resources on destruction ([`FrameManager.ts:104-138`](../../repos/readium-ts-toolkit/navigator/src/epub/frame/FrameManager.ts#L104)). Those requirements belong inside the iframe backend; no message channel or frame escapes the SPI.

### Backend-neutral invariants

Every backend must satisfy the same observable laws:

1. It mounts only under `request.host` and removes everything it owns on `destroy()`.
2. It never closes the borrowed publication.
3. It reports logical source/normalized targets; page indices alone are insufficient.
4. It reports selection/link/pointer/decorations as data, never browser object references.
5. It ignores or rejects untrusted script/navigation according to the prepared rendition policy.
6. It accepts a captured logical target after resize/preference changes and attempts to restore it.
7. Its declared feature/style support is truthful for the active resource.
8. `destroy()` is idempotent and aborts in-flight backend work.
9. Events after destroy are ignored by both the backend and navigator generation gate.
10. Semantic DOM, iframe, fixed-layout, and canvas implementations pass the same controller contract tests.

The current canvas renderer remains valid only as one backend. It cannot cause `NavigatorSnapshotV1`, locators, selections, or decorations to contain canvas page or hit-test types.

## 12. Focus and accessibility boundary

```ts
type FocusOptions = {
  readonly target?: "content" | "start"
  readonly preventScroll?: boolean
}
```

The navigator owns focus transfer into its active rendition and safe return when hidden/destroyed. It does not implement Klemata's focus trap, toolbar order, shortcuts, or announcements. `focus()` is synchronous intent; inability to focus is reflected by the accessibility capability/debug warning rather than an exception from a browser focus race.

Backends must expose one coherent reading subtree. Hidden prefetched resources are `aria-hidden`, inert, and nonfocusable. Semantic DOM is expected to preserve headings, links, lists, tables, figures, notes, language, and direction from `NormalizedResourceV1`; HADDON-031 specifies the actual mapping.

## 13. Cancellation and command concurrency

The general cancellation rules in [services-and-errors.md](services-and-errors.md) apply unchanged.

1. Every asynchronous navigator and backend operation except lifecycle teardown accepts `AbortSignal` through `OperationOptions`.
2. A pre-aborted signal returns `haddon.cancelled` with `details.origin = "request"` before state, DOM, warnings, or resource ownership changes.
3. Host mutation commands are queued in call order. Cancelling one queued command removes only that command and does not close the view.
4. Closing, replacing, or destroying aborts active descendant work with `details.origin = "session-close"`.
5. Request cancellation never closes the mounted navigator or borrowed publication.
6. A cancelled open leaves `idle`; a cancelled replacement leaves `idle` because its old view was already closed.
7. A cancelled navigation/preferences/decorations command restores the last committed `ready` snapshot. If the backend already changed layout, it must restore the captured logical locator before reporting cancellation or return a fatal error if restoration is impossible.
8. Resize observations are coalesced, not queued without bound. A pending resize applies the most recent measured rectangle.
9. Backend events carry an internal session generation. Events and promise completions from an old generation are discarded.
10. Once `close()` or `destroy()` begins, caller cancellation cannot interrupt cleanup. The teardown result reports all cleanup failures after reaching the requested terminal state.
11. Abort listeners are detached after settlement.

The queue provides deterministic behavior without Readium's ambiguous `_isNavigating -> false` result ([`EpubNavigator.ts:1021-1062`](../../repos/readium-ts-toolkit/navigator/src/epub/EpubNavigator.ts#L1021)). It may later gain an explicit superseding navigation option, but Version 1 does not silently cancel earlier commands.

## 14. Error, warning, and failure behavior

Navigator operations use `HaddonError` and `PublicationWarning`. Navigator-specific codes initially use the existing extension escape hatch until the shared diagnostic registry promotes stable names:

```ts
type NavigatorExtensionCode =
  | "extension:haddon.navigator.root-claimed"
  | "extension:haddon.navigator.no-rendition"
  | "extension:haddon.navigator.backend-failed"
  | "extension:haddon.navigator.location-failed"
  | "extension:haddon.navigator.mount-detached"
```

Required failure behavior:

| Condition | Result/state |
| --- | --- |
| Root already claimed | synchronous `haddon.invalid-argument`; no slot added |
| No negotiated safe rendition | `haddon.capability-unavailable`; `open()` returns to `idle` |
| Initial locator ambiguous/unresolved | domain `initialNavigation`; open may show publication start only when request policy permits, with partial warning |
| Backend open failure | typed error; all partial backend resources removed; `idle` |
| Locator ambiguous/unresolved | successful `NavigationResult`; current view unchanged |
| Boundary reached | successful `StepResult.boundary` |
| Recoverable resource/render fallback | successful partial outcome plus warning and effective backend facts |
| Runtime backend fatal error | snapshot becomes `error`; exactly one `fatal-error` event for that failure |
| Selection cannot map durably | `ReaderSelectionV1.unresolved` plus warning; view remains usable |
| Some decorations fail | partial `DecorationSetResult` with per-item status |
| Root temporarily zero-sized | ready but navigation availability may be `unknown`; no fatal error |
| Root permanently detached | commands fail with typed extension error until host destroys the navigator |
| Cleanup failure | `haddon.cleanup-failed`; owner is nevertheless idle/destroyed as requested |

Warnings produced by core services remain unmodified and in deterministic order. The navigator may add a separate rendition-stage warning for a UI-level fallback, but it must not rewrite, swallow, or duplicate the originating warning. No serialized error/event includes publication text, source bytes, a filesystem path, a DOM serialization, arbitrary exception stack, or credentials.

## 15. Thin React and Remix 3 seam

The adapter package may expose a component, hook, or controller provider, but its behavioral seam should stay this small:

```ts
type HaddonReaderSurfaceProps = {
  readonly publication: Publication
  readonly requirements: ReaderRequirements
  readonly locator?: PublicationLocatorV1
  readonly preferences?: Partial<RenditionPreferencesV1>
  readonly insets?: ViewportInsets
  readonly decorations?: Readonly<Record<string, readonly DecorationV1[]>>
  readonly onReady?: (navigator: PublicationNavigator) => void
  readonly onEvent?: (event: NavigatorEventV1) => void
}
```

Adapter rules:

1. One mounted component owns one navigator in component/ref scope.
2. Mount creates the navigator once for that root; unmount awaits or initiates deterministic `destroy()` and reports cleanup failure through the application's error channel.
3. A locator prop change within the same publication calls `goTo()` and does not change the component key.
4. Preference, inset, and decoration prop changes call their corresponding controller methods.
5. A volume/edition/source-revision change opens the next publication in Klemata, calls `replace()`, then closes the old publication after replacement settles.
6. React reads `getSnapshot()` through the external-store subscription. It does not mirror the entire navigator state into a reducer.
7. Remix 3 loaders/actions may authorize and identify a volume, but navigator construction occurs only in a browser effect/client boundary.
8. Haddon imports no React, Remix, route, loader, action, Redux, or Klemata workbench types.

Illustrative adapter lifecycle:

```ts
// Pseudocode: framework adapter, not part of the navigator package.
const navigatorRef = useRef<PublicationNavigator>()

useLayoutEffect(() => {
  const mounted = mountNavigator(rootRef.current!, { backends })
  if (!mounted.ok) return report(mounted.error)
  navigatorRef.current = mounted.value
  const off = mounted.value.subscribeEvents(onEvent)
  void mounted.value.open({ publication, requirements, initialLocator: locator })
  return () => {
    off()
    void mounted.value.destroy()
    navigatorRef.current = undefined
  }
}, [])
```

Actual adapter code must handle changed publications and command races rather than capture initial props forever. Thorium's empty-dependency initialization and module singleton are useful negative examples ([`useReaderInit.ts:102-147`](../../repos/thorium-web/src/components/Epub/Hooks/useReaderInit.ts#L102), [`useEpubNavigator.ts:28-91`](../../repos/thorium-web/src/core/Hooks/Epub/useEpubNavigator.ts#L28)). Its need to expose `_cframes` for application hit regions is another boundary failure Haddon avoids ([`useEpubNavigator.ts:145-149`](../../repos/thorium-web/src/core/Hooks/Epub/useEpubNavigator.ts#L145), [`StatefulReader.tsx:324-351`](../../repos/thorium-web/src/components/Epub/StatefulReader.tsx#L324)).

## 16. End-to-end examples

### Open and follow a Klemata citation

```ts
const mounted = mountNavigator(root, {
  backends: [semanticDomBackend, sourceIframeBackend, canvasBackend],
})
if (!mounted.ok) throw mounted.error

const navigator = mounted.value
const opened = await navigator.open({
  publication,
  requirements: klemataReaderRequirements,
  initialLocator: citation.locator,
  initialLocatorPolicy: "citation",
  preferences: savedPreferences,
}, { signal })

if (opened.ok && opened.value.value.initialNavigation?.status === "ambiguous") {
  showCitationRecovery(opened.value.value.initialNavigation.resolution)
}
```

### Host-owned link policy

```ts
const unsubscribe = navigator.subscribeEvents(event => {
  if (event.type !== "link-intent") return

  switch (event.intent.target.kind) {
    case "publication":
      if (event.intent.target.link.rels.includes("footnote")) {
        showNote(event.intent)
      } else {
        void navigator.goTo(event.intent.target.locator, { cause: "link" })
      }
      break
    case "external":
      requestExternalLinkConfirmation(event.intent.target.url)
      break
  }
})
```

### Group replacement

```ts
await navigator.setDecorations("klemata-citations", citations.map(citation => ({
  id: citation.id,
  locator: citation.locator,
  style: { type: "marker", token: "citation" },
  interactive: true,
  hostData: { citationId: citation.id },
})))
```

## 17. Testable contract invariants

HADDON-030 itself is a design ticket. HADDON-031 onward must share a fake-backend contract suite that verifies these behaviors for every concrete backend.

### Mount and lifecycle

1. Two different roots can host two independent navigator instances simultaneously.
2. A second live navigator cannot claim the same root.
3. Mount performs no publication read and creates only its private empty slot.
4. Open consumes an already-open publication and never calls its `close()`.
5. Closing a view removes all backend nodes/resources but leaves the controller reusable.
6. Replacement destroys the old session before opening the new one and never closes either publication.
7. Failed/cancelled replacement leaves the navigator idle with no old or partial new backend.
8. Destroy releases the root claim and is idempotent.
9. Cleanup failure leaves the requested final state idle/destroyed.
10. Operations after destroy return `haddon.closed`.

### Snapshot and events

11. `getSnapshot()` is referentially stable between revisions.
12. Each committed change increments revision exactly once and notifies each current subscriber once.
13. Snapshot state is installed before its event is delivered.
14. Event sequence is strictly increasing and references an existing snapshot revision.
15. Unsubscribed/destroyed listeners receive nothing further.
16. Every snapshot/event survives structured cloning and JSON round trip except explicitly runtime-only debug hooks.
17. No public value contains a DOM node, `Range`, `DOMRect`, iframe window, canvas object, `Map`, or `Set`.

### Navigation and location

18. Ambiguous/unresolved navigation does not move the current location.
19. Boundary is distinguishable from cancellation, contention, unresolved target, and fatal error.
20. A successful navigation resolves only after the new location snapshot/event.
21. Persisted logical location never contains backend page identity.
22. Multi-resource visibility produces ordered resource-scoped segments.
23. RTL/vertical backends agree on logical `current`, forward, and backward behavior.
24. Late events from a replaced backend cannot change current location.

### Resize and preferences

25. Resize/inset/preference changes capture a durable locator and restore the same passage.
26. Every geometry-invalidating change increments `layoutRevision`.
27. Zero-size then nonzero-size mounting does not lose the initial locator.
28. Requested, effective, ineffective, and unsupported preferences are distinguishable.
29. Fixed layout reports text controls ineffective without discarding requested host preferences.
30. Chrome insets alter content dimensions without changing typography settings.

### Selection and decoration

31. A resolved selection includes resource-scoped locators, exact quote text, direction, and root-relative geometry.
32. A mapping failure cannot be mislabeled as a durable selection.
33. Stale selection/decoration geometry is detectable by `layoutRevision`.
34. Duplicate decoration IDs reject the whole group replacement.
35. Decorations retain logical identity and reapply after resource/backend remount.
36. Partial decoration rendering identifies every unsupported/unresolved item.
37. Clearing native selection does not clear decoration groups.

### Intent and backend neutrality

38. External links emit intent and never call `window.open()`.
39. Internal links emit a canonical target but do not navigate without a host command.
40. Pointer intent uses logical start/center/end and never performs product UI policy.
41. A DOM, iframe, fixed-layout, and canvas fake backend produce equivalent public command outcomes for the same logical fixture.
42. Backend destruction removes every node, listener, observer, worker, timer, message callback, and owned URL.

### Cancellation and failures

43. A pre-aborted operation performs no mutation/read and emits no event or warning.
44. Cancellation affects only its queued/active operation unless close/replace/destroy initiated it.
45. Close/replace/destroy abort descendant work with `session-close` origin.
46. A recoverable backend operation failure returns to the prior ready snapshot.
47. A fatal backend event creates one error snapshot and one fatal event.
48. A partial successful result includes an explanatory warning.

## 18. HADDON-031 and HADDON-032 handoff

### HADDON-031 — normalized semantic DOM backend

HADDON-031 should implement the smallest concrete `RenditionBackend` satisfying this contract:

1. Accept only `normalized-semantic` `RenditionSource` for one textual resource.
2. Render `NormalizedResourceV1` to native semantic elements inside the private host.
3. Preserve node IDs/source evidence in private data attributes sufficient to map DOM positions back to normalized/source targets.
4. Preserve native selectable text and document semantics; do not add a canvas hit-test system.
5. Intercept/classify links into `BackendLinkIntent`; do not open or route them.
6. Report raw backend selection ranges and root-relative rectangle lists for navigator mapping.
7. Emit pointer intent without edge-navigation policy.
8. Implement effective preference/support reporting for the initial safe subset.
9. Make every hidden/prefetched subtree inert and inaccessible.
10. Prove deterministic cleanup and cancellation with the shared fake/public contract suite.

It may initially report visible-location support as partial and return a locator for the mounted resource start. It must not invent progression or page facts to satisfy HADDON-032 prematurely.

### HADDON-032 — visible-location tracking

HADDON-032 should implement the algorithm behind `BackendVisibleTarget -> VisibleLocationV1`:

1. Observe visibility in logical reading order for semantic DOM content.
2. Derive precise first/last DOM or normalized boundaries for each visible resource.
3. Convert boundaries through locator/source-mapping services and refresh redundant evidence.
4. Coalesce scroll observations per animation frame.
5. Preserve a captured locator across root resize, inset change, font completion, and layout-affecting preferences.
6. Increment `layoutRevision` for every geometry-invalidating transition.
7. Distinguish complete, partial, ambiguous, and unavailable visible mapping with typed outcomes/warnings.
8. Add fixtures for hidden anchors, zero-sized roots, long unbroken text, RTL, vertical text where supported, multiple visible resources, and late observer delivery after replacement.

Foliate's recursive DOM visible-range search is a useful behavioral reference, including browser geometry workarounds ([`paginator.js:79-151`](../../repos/foliate-js/paginator.js#L79), [`paginator.js:945-969`](../../repos/foliate-js/paginator.js#L945)). It is not the locator algorithm: Haddon must convert those live boundaries to the durable locator contract.

## 19. Settled decisions versus open questions

### Settled by HADDON-030

1. The navigator is a per-root controller, not a framework component or singleton.
2. The publication is opened below and owned above the navigator.
3. Mount, view close/replacement, publication close, and terminal destroy are separate operations.
4. The snapshot/event/command boundary contains only plain portable values.
5. Logical location is locator-backed; viewport/pages/geometry are ephemeral.
6. Preferences expose requested/effective/support state, and chrome uses explicit insets.
7. Selections and decorations are renderer-neutral and locator-backed.
8. Link/pointer effects are host policy expressed through intent events.
9. Backends are interchangeable behind one SPI and cannot leak their implementation objects.
10. React/Remix 3 integration is a thin package above the controller.

### Open questions for follow-up tickets

1. **Preference registry (HADDON-031/HADDON-034):** Which numeric ranges/defaults and publisher-style cascade are frozen into Version 1 conformance fixtures?
2. **Selection across resources (HADDON-033):** Should Version 1 UI actively support it or only keep the ordered locator-array wire shape?
3. **Intent expiry (HADDON-031):** Should `LinkIntentV1.id` have a bounded lifetime if a future host-response command is introduced? The current host calls ordinary commands and does not consume the ID.
4. **Detached roots (adapter ticket):** Should a temporarily disconnected root pause and recover rather than require destroy? Version 1 treats persistent detachment as a host lifecycle error.
5. **Backend residency (HADDON-034/HADDON-036):** How many adjacent semantic/iframe/fixed-layout sessions may remain prefetched under explicit memory limits?
6. **Iframe protocol (HADDON-035):** Exact versioning, timeout, origin, CSP, sandbox, and allowed-resource policy remain security-design work.
7. **Canvas accessibility (HADDON-037):** Whether the optional canvas renderer can honestly provide an accessible parallel semantic subtree or must declare reduced capabilities.
8. **Navigator diagnostic codes (shared registry):** Promote the stable extension examples into standard codes when their first implementation lands.
