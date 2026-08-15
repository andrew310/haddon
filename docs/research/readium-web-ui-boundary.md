# Readium Web UI Boundary

**Ticket:** HADDON-002

**Date:** 2026-08-13

**Status:** Research complete; proposed seams remain design input for HADDON-030

## Conclusion

Haddon should borrow Readium's division between a publication model and a mounted navigator, but it should not adopt Thorium's full reader component as its boundary with Klemata.

The useful boundary is:

```text
Rust/WASM core
  publication, normalization, citation resolution, resources
                         |
                         v
Framework-neutral web navigator
  mount, semantic DOM/iframe rendition, navigation, selection,
  visible location, preferences, decorations, typed events
                         |
                         v
Thin React adapter
  owns one navigator instance and translates events into React
                         |
                         v
Klemata / Remix 3
  routes, volume loading, citation intent, educational workspace,
  reader chrome, storage, external-link policy, responsive layout
```

Readium's TypeScript navigator already approximates the middle layer. Thorium Web demonstrates the application features that can be built above it, but its singleton navigator, Redux store, Next.js shell, plugin system, and direct iframe access should be treated as implementation evidence rather than dependencies.

## Scope and terminology

This document labels findings as either:

- **Observation:** behavior present in the vendored Readium or Thorium source, or in Haddon today.
- **Recommendation:** a proposed boundary for Haddon and Klemata.

“Engine” below means the framework-neutral browser navigator. It does not include Haddon's Rust publication and normalization core, and it does not include Klemata's application chrome.

## Observed Readium stack

| Layer | Observed responsibility | Evidence |
| --- | --- | --- |
| `@readium/shared` | Serializable manifest, publication links, resource fetching, locators, and timeline | `repos/readium-ts-toolkit/shared/src/publication/Publication.ts:18`, `repos/readium-ts-toolkit/shared/src/publication/Manifest.ts:13`, `repos/readium-ts-toolkit/shared/src/publication/Locator.ts:149` |
| `@readium/navigator` | Mounts a publication into a supplied element and owns rendition mechanics | `repos/readium-ts-toolkit/navigator/src/Navigator.ts:43`, `repos/readium-ts-toolkit/navigator/src/epub/EpubNavigator.ts:124` |
| HTML injectables | Runs layout, selection, pointer, locator, and decoration behavior inside publication frames | `repos/readium-ts-toolkit/navigator/src/injection/epubInjectables.ts:10`, `repos/readium-ts-toolkit/navigator/src/epub/frame/FrameComms.ts:109` |
| Thorium navigator hook | Constructs and wraps a Readium navigator for React | `repos/thorium-web/src/core/Hooks/Epub/useEpubNavigator.ts:28`, `repos/thorium-web/src/core/Hooks/Epub/useEpubNavigator.ts:57` |
| Thorium stateful reader | Translates navigator events into product state and renders reader chrome | `repos/thorium-web/src/components/Epub/StatefulReader.tsx:137`, `repos/thorium-web/src/components/Epub/StatefulReader.tsx:410`, `repos/thorium-web/src/components/Epub/StatefulReader.tsx:619` |
| Thorium host application | Provides Next.js routes, global stores, preferences, and publication loading | `repos/thorium-web/src/app/layout.tsx:18`, `repos/thorium-web/src/app/read/[identifier]/page.tsx:18` |

This layering is real, but the boundary is not perfectly clean. Thorium sometimes reaches through its navigator wrapper into Readium internals, while Readium sometimes contains default UI policy such as edge-tap navigation.

## 1. Shared publication and locator model

### Observations

Readium models a publication as a manifest plus a fetcher. The manifest holds metadata, reading order, resources, TOC, links, and subcollections; `Publication.get()` supplies lazy resource access (`repos/readium-ts-toolkit/shared/src/publication/Publication.ts:18-47`, `repos/readium-ts-toolkit/shared/src/publication/Publication.ts:181-187`). This agrees with the Wave 1 conclusion that a publication is not merely a list of normalized chapters.

A locator is a serializable envelope, not a page number. Its core identity is `href` plus media type, with optional fragment, resource progression, publication progression, position, extension locations, and text context (`repos/readium-ts-toolkit/shared/src/publication/Locator.ts:8-42`, `repos/readium-ts-toolkit/shared/src/publication/Locator.ts:111-175`). HTML extensions include CSS selector, partial CFI, and DOM range (`repos/readium-ts-toolkit/shared/src/publication/html/Locations.ts:5-18`). DOM range points store a CSS selector, text-node index, and character offset (`repos/readium-ts-toolkit/shared/src/publication/html/DomRangePoint.ts:3-33`).

The navigator receives an already-open `Publication`; opening bytes and parsing the package are outside its contract (`repos/readium-ts-toolkit/navigator/src/epub/EpubNavigator.ts:124-134`).

### Recommendations

Haddon's navigator should also receive an already-open publication handle. Archive I/O, normalization, source mapping, and citation recovery belong below the navigator.

Haddon should keep its richer proposed citation envelope rather than copying Readium's locator verbatim. In particular, normalized node/range identity, a normalization revision, explicit offset units, and resolution confidence remain Haddon requirements. Readium's extensible location and text-context shape is a good wire-format precedent.

No public navigator state should use a canvas page index as durable identity. Page/spread indexes may be exposed as ephemeral rendition information only.

## 2. The Readium navigator boundary

### Observations

The abstract navigator exposes publication, current locator, timeline, locator/link navigation, forward/backward movement, and destruction. Visual navigation adds direction-aware left/right movement (`repos/readium-ts-toolkit/navigator/src/Navigator.ts:43-74`, `repos/readium-ts-toolkit/navigator/src/Navigator.ts:133-158`).

`EpubNavigator` is constructed with a host element, publication, listeners, positions, initial locator, preferences/defaults, injectables, content protection, keyboard peripherals, and decoration configuration (`repos/readium-ts-toolkit/navigator/src/epub/EpubNavigator.ts:27-50`, `repos/readium-ts-toolkit/navigator/src/epub/EpubNavigator.ts:124-183`). Its `load()` method resolves positions, constructs the injector and appropriate reflowable/fixed-layout frame pool, then applies the initial position (`repos/readium-ts-toolkit/navigator/src/epub/EpubNavigator.ts:251-299`). Its `destroy()` method removes global listeners, destroys frame resources, and clears decoration state (`repos/readium-ts-toolkit/navigator/src/epub/EpubNavigator.ts:857-872`).

The listener interface covers frame readiness, position and timeline changes, tap/click, zoom, scrolling, external or otherwise unhandled locators, text selection, context menus, protection signals, and keyboard peripherals (`repos/readium-ts-toolkit/navigator/src/epub/EpubNavigator.ts:36-68`). Frame events update `currentLocation` before emitting `positionChanged`; link activation is either handled internally or delegated to the host (`repos/readium-ts-toolkit/navigator/src/epub/EpubNavigator.ts:451-490`, `repos/readium-ts-toolkit/navigator/src/epub/EpubNavigator.ts:504-576`).

Preferences are input values merged into effective settings. Submitting preferences can update CSS or switch between scrolled and paginated layout (`repos/readium-ts-toolkit/navigator/src/epub/EpubNavigator.ts:301-340`, `repos/readium-ts-toolkit/navigator/src/epub/EpubNavigator.ts:370-395`). The preferences editor also reports whether a setting is meaningful for the current layout, such as disabling columns and font controls for fixed layout (`repos/readium-ts-toolkit/navigator/src/epub/preferences/EpubPreferencesEditor.ts:106-173`).

Readium observes the navigator's parent element rather than assuming the viewport equals the window. This explicitly supports readers embedded beside docked panels (`repos/readium-ts-toolkit/navigator/src/epub/EpubNavigator.ts:219-223`).

### Recommendations

The engine boundary should stop after it can:

- Mount and unmount a rendition in a caller-supplied element.
- Navigate by publication locator or resource link.
- Move forward/backward and report whether those commands succeeded.
- Report a stable logical current locator plus ephemeral viewport information.
- Apply rendition preferences and report their effective values and capabilities.
- Emit selection, internal/external link, pointer intent, decoration activation, warning, and fatal-error events.
- Apply grouped decorations independent of live DOM nodes.
- Respond to container resizing and own all frame/blob/listener cleanup.

It should not decide how toolbars look, where notes appear, what an external link does, where state is stored, or what a citation means to Klemata.

The public API should use promises and typed results rather than Readium's `(ok: boolean) => void` callbacks. Navigation results need enough information to distinguish success, boundary reached, cancellation, unresolved target, and degraded recovery.

## 3. HTML injectables and iframe mechanics

### Observations

Readium parses each HTML resource, injects selected scripts/styles, applies CSS variables, adds a base URL and CSP, serializes the result to a blob URL, and loads it into an iframe (`repos/readium-ts-toolkit/navigator/src/epub/frame/FrameBlobBuilder.ts:46-78`, `repos/readium-ts-toolkit/navigator/src/epub/frame/FrameBlobBuilder.ts:99-194`). Injection rules can match exact hrefs or patterns and prepend/append script or link resources (`repos/readium-ts-toolkit/navigator/src/injection/Injectable.ts:42-66`). The injector validates external origins, owns generated blob URLs, and revokes them on disposal (`repos/readium-ts-toolkit/navigator/src/injection/Injector.ts:100-155`, `repos/readium-ts-toolkit/navigator/src/injection/Injector.ts:220-229`).

Default EPUB rules inject Readium CSS for reflowable content, a CSS-selector generator, and publisher-script prevention/cleanup; script-specific CSS is selected for RTL and CJK modes (`repos/readium-ts-toolkit/navigator/src/injection/epubInjectables.ts:15-55`, `repos/readium-ts-toolkit/navigator/src/injection/epubInjectables.ts:57-145`).

Frame-to-host communication uses versioned, channel-scoped `postMessage` commands with acknowledgements and timeout cleanup (`repos/readium-ts-toolkit/navigator/src/epub/frame/FrameComms.ts:18-58`, `repos/readium-ts-toolkit/navigator/src/epub/frame/FrameComms.ts:74-139`). Frames are created with `allow-same-origin allow-scripts`; hidden frames have interaction and accessibility disabled, their message channels are halted, and resources are removed on destruction (`repos/readium-ts-toolkit/navigator/src/epub/frame/FrameManager.ts:21-40`, `repos/readium-ts-toolkit/navigator/src/epub/frame/FrameManager.ts:104-138`).

### Recommendations

Injectables are engine internals. Klemata should configure capabilities, preferences, and host policy; it should never send arbitrary scripts into a publication frame.

Haddon should reuse the architectural pattern—small injected modules plus a versioned message protocol—but define its own allowlisted command/event schema. Protocol messages must be serializable, origin/channel checked, cancellable where work is asynchronous, and independently testable.

Readium's exact sandbox/CSP combination should not be copied without a security review. `allow-same-origin` plus `allow-scripts`, blob documents, inline scripts, publisher content, base URL rewriting, and allowed external domains form one security boundary. HADDON-035 must test this combination explicitly and default publisher scripting to inert.

Normalized semantic DOM and source-faithful iframe rendition should implement the same public navigator contract even if only the latter needs cross-frame messaging.

## 4. Decorations and selections

### Observations

Readium decorations are grouped and locator-backed. Applying a group diffs IDs into add, update, and remove operations, filters them by visible href, and reapplies them when frames load (`repos/readium-ts-toolkit/navigator/src/epub/EpubNavigator.ts:728-799`). Observers receive activation, pointer-enter, and pointer-leave events with the resolved decoration and geometry (`repos/readium-ts-toolkit/decorator/src/Decoration.ts:4-15`, `repos/readium-ts-toolkit/navigator/src/epub/EpubNavigator.ts:818-852`). Built-in and named custom decoration styles share a capability query (`repos/readium-ts-toolkit/decorator/src/styles.ts:24-54`).

The injected selection event contains text and one bounding rectangle. The navigator adds an href-level locator with highlighted text, but this code path does not add a precise DOM range (`repos/readium-ts-toolkit/navigator-html-injectables/src/modules/Peripherals.ts:25-34`, `repos/readium-ts-toolkit/navigator/src/epub/EpubNavigator.ts:479-490`).

### Recommendations

Haddon should adopt grouped replacement as the primary decoration operation:

```ts
setDecorations(group: string, decorations: readonly Decoration[]): void
```

Useful initial groups are `klemata-citations`, `highlights`, `annotations`, `search-results`, and `active-citation`. A decoration must be restorable from its ID, publication locator, style token, and opaque host data; it must not retain a DOM `Range` or element reference.

Selection events need more precision than Thorium currently consumes. They should contain:

- A durable Haddon locator/range with exact quote context.
- The selected text.
- One or more client rectangles in the navigator root's coordinate space.
- Direction and collapsed state.
- The initiating input type when known.

Geometry is transient popover-placement data, never persisted citation identity. Klemata decides which selection actions to show and whether a selected passage becomes a citation, highlight, note, or copy operation.

## 5. Thorium's React and application layers

### Observations

Thorium wraps Readium in `useEpubNavigator`, but the actual `EpubNavigator` is a module-scoped singleton rather than an instance owned by a mounted component (`repos/thorium-web/src/core/Hooks/Epub/useEpubNavigator.ts:26-45`). The hook exposes navigation and settings commands, but also exposes `_cframes`, explicitly marked as an internal API that will become private (`repos/thorium-web/src/core/Hooks/Epub/useEpubNavigator.ts:93-149`).

`useEpubReaderInit` translates Thorium preferences, injectables, keyboard behavior, and storage into the navigator constructor. It initializes only once with an empty dependency array and destroys the singleton during cleanup (`repos/thorium-web/src/components/Epub/Hooks/useReaderInit.ts:70-99`, `repos/thorium-web/src/components/Epub/Hooks/useReaderInit.ts:102-147`).

The stateful EPUB reader is application orchestration. It reads many Redux slices, builds caches, tracks responsive and immersive UI, persists position, derives progress/TOC state, translates every navigator event, and renders header, arrows, iframe container, footer, and docking UI (`repos/thorium-web/src/components/Epub/StatefulReader.tsx:137-227`, `repos/thorium-web/src/components/Epub/StatefulReader.tsx:241-277`, `repos/thorium-web/src/components/Epub/StatefulReader.tsx:410-524`, `repos/thorium-web/src/components/Epub/StatefulReader.tsx:619-702`).

Thorium deliberately overrides Readium's default tap behavior. It reaches into current iframe widths to divide the screen into quarters and uses middle taps/clicks to toggle immersive chrome (`repos/thorium-web/src/components/Epub/StatefulReader.tsx:324-361`). This is product interaction policy, even though a similar default also exists in `EpubNavigator.eventListener()` (`repos/readium-ts-toolkit/navigator/src/epub/EpubNavigator.ts:568-575`).

The wrapper exposes publication, profile, plugins, preference adapters, position storage, i18n, and loading state (`repos/thorium-web/src/components/Reader/StatefulReaderWrapper.tsx:40-77`). It selects a reader profile and surrounds it with Thorium preference/i18n providers (`repos/thorium-web/src/components/Reader/StatefulReaderWrapper.tsx:79-129`). Its responsive behavior combines window and container breakpoints into shell classes (`repos/thorium-web/src/components/Helpers/getReaderClassNames.ts:5-43`) and updates those values through the theming wrapper (`repos/thorium-web/src/components/Reader/StatefulReaderWrapper.tsx:194-234`).

Thorium's store contains separate reader, settings, theming, actions, publication, preferences, WebPub, audio, and player slices; it persists most UI slices to `localStorage` (`repos/thorium-web/src/lib/store.ts:23-38`, `repos/thorium-web/src/lib/store.ts:218-245`, `repos/thorium-web/src/lib/store.ts:248-299`). Its Next.js layout installs the store and global-preferences provider, while client routes verify and load publication manifests before rendering the wrapper (`repos/thorium-web/src/app/layout.tsx:18-31`, `repos/thorium-web/src/app/read/[identifier]/page.tsx:18-75`).

### Recommendations

Thorium's visual design and interaction inventory are valuable reference material, but Klemata should own the equivalent chrome. Do not make Thorium's Redux store, providers, plugin registry, action/docking schema, CSS module names, or Next.js routing part of Haddon.

The React adapter should be intentionally thin:

- One mounted surface owns exactly one navigator instance.
- The instance is stored in a component ref, not a module global.
- Changing a locator calls `goTo`; it does not remount the reader.
- Changing a volume explicitly closes the old publication and mounts the new one.
- React props map to serializable engine inputs; engine events map to callbacks or an external-store subscription.
- No React context is required to use the engine itself.

Responsive application chrome belongs to Klemata. Container size still belongs to the navigator because pagination and visible-location calculation depend on it. The navigator should expose rendition facts such as layout mode, progression direction, and navigation availability, not breakpoint names or toolbar layout.

## 6. Haddon today

### Observations

The current standalone web prototype is a TanStack Start route, while Klemata's target host is Remix 3 (`apps/web/src/routes/books.$bookId.tsx:1-4`). That makes a router-independent package boundary necessary rather than optional.

Haddon's current book route directly imports the WASM `EpubReader` and stores its instance beside page, selection, highlight, loading, and error UI state (`apps/web/src/routes/books.$bookId.tsx:21-55`, `apps/web/src/routes/books.$bookId.tsx:90-114`). It fetches bytes, constructs the reader, performs eager relayout, and renders page zero inside the route (`apps/web/src/routes/books.$bookId.tsx:231-295`).

The route also owns canvas coordinate transforms, selection hit testing, note hit testing, selection popover geometry, highlight persistence, keyboard behavior, resize handling, and page rendering (`apps/web/src/routes/books.$bookId.tsx:131-229`, `apps/web/src/routes/books.$bookId.tsx:306-485`). Finally, it renders navigation chrome, book metadata, a canvas, and the educational workbench in one component (`apps/web/src/routes/books.$bookId.tsx:487-678`).

Current durable highlights are ordinal `chapterIndex` / `blockIndex` / `offset` ranges stored directly in browser local storage (`apps/web/src/routes/books.$bookId.tsx:21-40`, `apps/web/src/routes/books.$bookId.tsx:210-229`). Current progress is an ephemeral canvas page number (`apps/web/src/routes/books.$bookId.tsx:492-510`, `apps/web/src/routes/books.$bookId.tsx:657-670`).

### Recommendations

The current route is an excellent prototype but the wrong long-term seam. It should eventually be split into:

1. A volume loader/open-publication adapter.
2. A framework-neutral navigator instance.
3. A small React surface that mounts the navigator.
4. Klemata-owned reader chrome and workbench.
5. Klemata-owned citation/session persistence using durable publication locators.

The canvas backend should satisfy the same navigator contract as semantic DOM if retained. Its private page, coordinate, and hit-test methods should not leak into Remix components.

## Engine mechanics versus Klemata policy

| Concern | Haddon engine owns | Klemata / Remix 3 owns |
| --- | --- | --- |
| Publication | Mounted open handle; requested rendition capability | Volume/edition selection, auth, loading intent, signed access |
| Location | Resolve/navigate, current logical locator, viewport facts | Citation URL/schema, history, session storage, recovery UX |
| Layout | Semantic DOM or iframe/canvas backend, scroll/pagination mechanics, container resize | Workspace panels, toolbar placement, responsive chrome |
| Preferences | Supported keys, validation, effective rendition values | Settings UI, defaults by user/course, persistence and sync |
| Selection | Durable range, text, transient geometry | Copy/cite/highlight/note menu and educational actions |
| Decorations | Render grouped locator-backed decorations and emit activation | Decoration records, colors/meaning, popovers, editing workflow |
| Links | Resolve internal target and emit link intent | External URL consent, opening target, cross-volume/course links |
| Keyboard/pointer | Normalize low-level intent and preserve content interaction | Command bindings, edge-tap policy, immersive-toolbar behavior |
| Errors | Typed rendition errors, warnings, unsupported capabilities | Notifications, recovery choices, telemetry, lesson fallback |
| Lifecycle | Own DOM, blobs, frames, observers, listeners, cancellation | Decide when a volume opens/closes and keep the surface stable |

Footnotes are deliberately split: the engine resolves and identifies the note target; Klemata chooses popover, side panel, inline expansion, or navigation.

## Proposed framework-neutral seams

These are recommendations for HADDON-030, not committed APIs.

```ts
type NavigatorMountOptions = {
  root: HTMLElement
  publication: PublicationHandle
  initialLocator?: PublicationLocator
  rendition?: "auto" | "normalized" | "source-faithful" | "canvas"
  preferences?: RenditionPreferences
  signal?: AbortSignal
}

type NavigatorSnapshot = {
  status: "opening" | "ready" | "navigating" | "error" | "closed"
  currentLocator?: PublicationLocator
  visibleRange?: { first: PublicationLocator; last?: PublicationLocator }
  layout: "scrolled" | "paginated" | "fixed"
  progression: "ltr" | "rtl" | "ttb"
  canGoBackward: boolean
  canGoForward: boolean
  effectivePreferences: RenditionPreferences
  capabilities: NavigatorCapabilities
}

interface PublicationNavigator {
  getSnapshot(): NavigatorSnapshot
  subscribe(listener: (event: NavigatorEvent) => void): () => void

  goTo(locator: PublicationLocator, options?: NavigationOptions): Promise<NavigationResult>
  goToLink(link: ResourceLink, options?: NavigationOptions): Promise<NavigationResult>
  goForward(options?: NavigationOptions): Promise<NavigationResult>
  goBackward(options?: NavigationOptions): Promise<NavigationResult>

  setPreferences(patch: Partial<RenditionPreferences>): Promise<PreferenceResult>
  setDecorations(group: string, decorations: readonly Decoration[]): void
  clearDecorations(group: string): void
  focus(): void
  destroy(): Promise<void>
}
```

The event union should be discriminated and serializable:

```ts
type NavigatorEvent =
  | { type: "ready"; snapshot: NavigatorSnapshot }
  | { type: "location-change"; locator: PublicationLocator; cause: NavigationCause }
  | { type: "selection-change"; selection: ReaderSelection | null }
  | { type: "link-activate"; link: ResourceLink; locator?: PublicationLocator }
  | { type: "decoration-activate"; group: string; id: string; geometry: ClientGeometry }
  | { type: "pointer-intent"; region: "start" | "center" | "end"; input: "mouse" | "touch" | "pen" }
  | { type: "warning"; warning: PublicationWarning }
  | { type: "fatal-error"; error: NavigatorError }
```

Important contract details:

- `location-change` reports a logical locator and a cause such as `initial`, `command`, `scroll`, `resize`, `preferences`, or `recovery`.
- Resizing and preference changes may alter viewport facts but must preserve the logical passage.
- Link activation is data, not an implicit `window.open()`.
- Preference support and effective values are queryable, so Klemata can disable irrelevant controls without importing navigator internals.
- Event geometry is expressed relative to the navigator root and is valid only until the next layout.
- `destroy()` is idempotent and finishes only after URLs, frames, workers, observers, and event listeners are released.
- Every asynchronous command accepts or inherits cancellation and resolves to a typed result.

## Remix 3 host adapter

### Recommendation

The Remix 3 adapter should be a package above the navigator, not code inside it. Its minimal responsibilities are:

1. Turn Klemata's route data and authenticated volume reference into an `OpenPublicationRequest`.
2. Keep a reader surface mounted for the active volume.
3. Turn citation URL/state changes into `navigator.goTo(locator)` calls.
4. Translate navigator events into Klemata state, persistence, and educational UI.
5. Close the publication when the volume genuinely changes or the surface unmounts.

A likely React-facing shape is:

```ts
type HaddonReaderSurfaceProps = {
  publication: PublicationHandle
  locator?: PublicationLocator
  preferences?: RenditionPreferences
  decorations?: ReadonlyMap<string, readonly Decoration[]>
  onReady?(controller: PublicationNavigator): void
  onEvent?(event: NavigatorEvent): void
}
```

The server/route layer can load volume metadata, authorize resource access, and deserialize the citation envelope. The publication navigator itself must mount only in the browser. A citation change within the same volume should not change the component key; a volume/edition change should explicitly replace the publication.

The adapter should not introduce a second authoritative store for navigator state. The navigator snapshot is the source of rendition state; Klemata stores durable user/application state. React may mirror the small snapshot needed to render controls.

## Coupling traps to avoid

1. **Module-global navigator instances.** Thorium's singleton prevents safe simultaneous readers, tests, nested mounts, or gradual replacement (`repos/thorium-web/src/core/Hooks/Epub/useEpubNavigator.ts:28-30`).
2. **Direct frame access.** Thorium reads `_cframes` for hit regions despite marking it private (`repos/thorium-web/src/core/Hooks/Epub/useEpubNavigator.ts:145-149`, `repos/thorium-web/src/components/Epub/StatefulReader.tsx:324-351`). Expose pointer regions and geometry as public events instead.
3. **Duplicated interaction policy.** Edge taps are handled in both Readium and Thorium (`repos/readium-ts-toolkit/navigator/src/epub/EpubNavigator.ts:568-575`, `repos/thorium-web/src/components/Epub/StatefulReader.tsx:326-350`). The engine should emit intent; Klemata should bind policy.
4. **Chrome dimensions hidden in typography preferences.** Thorium feeds arrow width into navigator constraint and toolbar layout into scroll padding (`repos/thorium-web/src/components/Epub/Hooks/usePreferencesConfig.ts:122-170`, `repos/thorium-web/src/components/Epub/Hooks/usePreferencesConfig.ts:202-220`). Haddon should instead mount into the actual available rectangle; overlay insets, if needed, should be an explicit viewport-insets input.
5. **App storage as an engine default.** Thorium persists a large Redux tree to `localStorage` (`repos/thorium-web/src/lib/store.ts:218-245`). Haddon should accept Klemata persistence adapters and versioned records.
6. **React/Next/Remix types in core APIs.** Thorium's wrapper and provider composition are useful app code, not a portable navigator (`repos/thorium-web/src/components/Reader/StatefulReaderWrapper.tsx:61-77`, `repos/thorium-web/src/app/layout.tsx:18-31`).
7. **One giant listener object.** Requiring every callback encourages a stateful-reader monolith (`repos/readium-ts-toolkit/navigator/src/epub/EpubNavigator.ts:36-68`). A typed event subscription is easier to compose and test.
8. **Cold-storage class instances.** Thorium must remember to deserialize stored locator JSON before use (`repos/thorium-web/src/components/Epub/StatefulReader.tsx:526-532`). Haddon wire types should be plain data, with validation at boundaries.
9. **Mount-once effects with captured configuration.** Thorium's empty-dependency initialization effect assumes a stable publication (`repos/thorium-web/src/components/Epub/Hooks/useReaderInit.ts:102-147`). Haddon should make replacement and incremental updates explicit.
10. **Pages as persisted identity.** Haddon's current page number changes under relayout (`apps/web/src/routes/books.$bookId.tsx:231-238`). Persist locators and derive pages.
11. **Canvas-specific selection in host UI.** Haddon currently exposes manual coordinate conversion and hit testing to the route (`apps/web/src/routes/books.$bookId.tsx:131-208`, `apps/web/src/routes/books.$bookId.tsx:414-460`). The navigator should emit a renderer-independent selection contract.
12. **Copying the iframe security recipe without threat modeling.** The Readium combination is functional, but Haddon needs its own tested origin, script, CSP, sandbox, and resource policy (`repos/readium-ts-toolkit/navigator/src/epub/frame/FrameBlobBuilder.ts:5-20`, `repos/readium-ts-toolkit/navigator/src/epub/frame/FrameManager.ts:27-35`).

## Reusable interaction contracts

The following Readium/Thorium ideas are worth independently implementing:

- Locator-based navigation with a current-location event.
- Direction-aware forward/backward commands, with left/right treated as host input mapping.
- A supplied mount element and container-aware resizing.
- Preference patches separated from effective settings and capability checks.
- Grouped, locator-backed decoration replacement and activation events.
- Selection events carrying text, locator, and geometry.
- Internal links handled mechanically; external/unhandled links delegated to the host.
- Versioned frame communication with acknowledged commands and deterministic cleanup.
- Position-storage and preference-storage adapters supplied by the host.
- Responsive chrome driven by container facts without coupling the engine to breakpoints.

## Decisions for HADDON-030

HADDON-030 can now proceed with these decisions as its starting constraints:

1. The navigator is a per-mount object with no framework dependency or global instance.
2. It consumes an open Haddon publication handle and durable Haddon locators.
3. It supports multiple rendition backends behind one command/event contract.
4. Its public state is a small snapshot; its output is a typed event stream.
5. Selection and decorations are locator-backed and renderer-independent.
6. Preferences describe book rendition only; application chrome and persistence stay above the seam.
7. Klemata owns citation intent, workbench UI, routes, external policy, and durable user state.
8. The Remix 3 adapter is thin, client-mounted, and keeps the surface alive across locator changes.
9. Security and resource ownership are explicit engine responsibilities with their own acceptance tests.
10. No internal iframe, DOM node, canvas page, React store, or router object crosses the public boundary.
