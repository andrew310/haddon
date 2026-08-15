# @haddon/navigator

Framework-neutral web navigator for Haddon reading engine.

## HADDON-032: Visible-Location Tracking

This package implements visible-location tracking for semantic DOM rendering as specified in `docs/design/navigator-api.md` sections 4, 7, and 18.

### Key Features

1. **Logical Reading Order**: Observes visibility in logical reading order for semantic DOM content
2. **Precise Boundaries**: Derives first/last DOM or normalized boundaries for each visible resource
3. **Durable Locators**: Converts boundaries through locator/source-mapping services
4. **Animation Frame Coalescing**: Coalesces scroll observations per animation frame
5. **Location Preservation**: Preserves captured locator across root resize, inset change, font completion, and layout-affecting preferences
6. **Layout Revision Tracking**: Increments layoutRevision for every geometry-invalidating transition
7. **Typed Outcomes**: Distinguishes complete, partial, ambiguous, and unavailable visible mapping with typed outcomes/warnings

### Usage

```typescript
import { VisibilityTracker } from "@haddon/navigator";

const tracker = new VisibilityTracker({
  root: articleElement,
  onLocationChange: (location, cause) => {
    console.log("Location changed:", location.current.href);
    console.log("Layout revision:", location.layoutRevision);
  },
  locatorService: myLocatorService,
});

// On theme change, font load, or preference update:
tracker.incrementLayoutRevision("preferences");

// Set viewport insets for chrome overlays:
tracker.setViewportInsets({ top: 60, bottom: 40 });

// Cleanup:
tracker.destroy();
```

### Types

Core types follow the navigator API contract:

- `VisibleLocationV1`: The primary snapshot/event location type
- `PublicationLocatorV1`: Durable publication locator (never persists viewport page indices)
- `BackendVisibleTarget`: Backend-internal visible target
- `ViewportSnapshot`: Current viewport state with layout revision

### Test Coverage

Test fixtures include:
- Hidden anchors
- Zero-sized roots
- Long unbroken text
- RTL content (when supported)
- Vertical text (when supported)
- Multiple visible resources
- Late observer delivery after replacement

Run tests:
```bash
pnpm test
```

### Independence from Framework Internals

This package has no dependencies on React, Remix, or other framework internals. It uses only standard Web APIs and plain serializable values. Demo wiring in `apps/demo` shows integration with React, but the core algorithm lives here in a portable package.

## License

See LICENSE in the repository root.
