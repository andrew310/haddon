# HADDON-032 Fixes Applied

## Review Feedback Addressed

Based on concrete gaps identified vs navigator-api.md §4/§7/§18 and acceptance criteria:

### ✅ 1. Proper Locator Restoration

**Problem**: `capturedLocator` was stored in `incrementLayoutRevision` and then ignored. Recomputing whatever happened to be at the top of the new viewport is not restoration.

**Fix**: 
- Made `incrementLayoutRevision` async
- Implemented full restoration flow: capture → relayout → navigate/restore → publish
- Added `navigateToLocator` to `LocatorService` interface
- `WasmLocatorService.navigateToLocator` scrolls to the captured block ID
- After navigation, DOM settles, then new `VisibleLocationV1` is computed and published

**Code**: `visibility-tracker.ts` lines ~78-108

### ✅ 2. Layout Revision in Location Change Detection

**Problem**: `hasLocationChanged` ignored `layoutRevision`, so theme/font changes staying on the same block might emit nothing. Acceptance requires a new rendition location.

**Fix**:
- Added explicit check: `if (this.currentLocation.layoutRevision !== newLocation.layoutRevision) return true`
- Now guarantees emission on any geometry-invalidating change, even if logical block is unchanged

**Code**: `visibility-tracker.ts` lines ~168-171

### ✅ 3. Visible Edge Offsets

**Problem**: `findVisibleBoundaries` always called `getBlockBoundary(textNode, 0)`. First/last offsets must be the visible edges, not the start of each text node.

**Fix**:
- Added `findVisibleCharacterOffsets` method that samples character positions
- Checks start, middle, and end offsets of each text node
- Uses `Range.setStart/setEnd` with specific character offsets
- Returns actual `{ firstVisible, lastVisible }` character indices
- `findVisibleBoundaries` now passes these precise offsets to `getBlockBoundary`

**Code**: `visibility-tracker.ts` lines ~241-284, ~320-352

### ✅ 4. Honest Typed Outcomes

**Problem**: `computeVisibleLocation` always returned status "complete" even when segment was partial.

**Fix**:
- Returns `{ status: "complete", location }` only when `target.complete === true`
- Returns `{ status: "partial", location, warnings }` when `target.complete === false`
- Warnings array includes `["Resource is partially visible"]` for partial status

**Code**: `visibility-tracker.ts` lines ~221-231

### ✅ 5. Test Coverage Documentation

**Problem**: Tests listed in file header (RTL, vertical, multiple visible resources, late observer after replacement) were not implemented. jsdom smoke that "does not crash" is not verification.

**Fix**:
- Updated test file header with explicit status:
  - ✅ Implemented: hidden anchors, zero-sized roots, long text, coalescing, revision tracking, preservation, insets, cleanup
  - ⏸️ Deferred with reasons: RTL (needs full bidirectional fixture), vertical text (needs vertical writing mode fixture), multiple resources (single resource per viewport for M1), late observer (needs full navigator lifecycle in HADDON-034+)
- Justification: structure supports deferred cases, but proper test fixtures require full navigator implementation

**Code**: `visibility-tracker.test.ts` lines 1-17

### ✅ 6. Unused IntersectionObserver

**Problem**: IntersectionObserver was declared and never used.

**Fix**:
- Removed `intersectionObserver` field declaration
- Removed `intersectionObserver?.disconnect()` from destroy method
- Using scroll + ResizeObserver only (as intended)

**Code**: `visibility-tracker.ts` line ~56 (removed), line ~143 (cleanup simplified)

### ✅ 7. Real Restoration Test

**Problem**: Test "should preserve captured locator across layout changes" said "in a real implementation" and only asserted `afterBlockId` was defined.

**Fix**:
- Added proper DOM structure with scrollable blocks
- Scrolls to block-2 before layout change
- Calls async `incrementLayoutRevision("preferences")`
- Asserts three critical facts:
  1. `afterBlockId === beforeBlockId` (same logical passage)
  2. `afterRevision === beforeRevision + 1` (layoutRevision increased)
  3. `lastCause === "preferences"` (location-change emitted with correct cause)
- Now a real, passing test of restoration behavior

**Code**: `visibility-tracker.test.ts` lines ~142-182

## Summary of Changes

### Modified Files

1. **`packages/haddon-navigator/src/visibility-tracker.ts`**
   - Made `incrementLayoutRevision` async with proper restoration flow
   - Fixed `hasLocationChanged` to check layoutRevision
   - Fixed `findVisibleBoundaries` to compute actual visible offsets
   - Added `findVisibleCharacterOffsets` helper
   - Fixed `computeVisibleLocation` to return honest partial/complete status
   - Removed unused IntersectionObserver
   - Added `navigateToLocator` to LocatorService interface

2. **`apps/demo/src/LocatorService.ts`**
   - Implemented `navigateToLocator` method
   - Uses `scrollIntoView` to restore captured block position

3. **`packages/haddon-navigator/src/visibility-tracker.test.ts`**
   - Documented deferred test cases with reasons
   - Fixed restoration test to assert actual preservation
   - Added mock `navigateToLocator` implementation

## Acceptance Criteria Status

> **Acceptance**: Resizing, theme changes, and font changes preserve the logical location and emit a new rendition location.

**After fixes**:

- ✅ **Capture before change**: `capturedLocator` stored
- ✅ **Navigate to captured location**: `navigateToLocator` called
- ✅ **Compute new location**: After DOM settles, new visible location calculated
- ✅ **Emit new rendition location**: Published with updated `layoutRevision`
- ✅ **Same logical passage**: Test verifies `beforeBlockId === afterBlockId`
- ✅ **Layout revision increments**: Test verifies revision increased
- ✅ **Always emit on geometry change**: `hasLocationChanged` checks layoutRevision

## Remaining Work

HADDON-032 is **not complete** until:

1. ✅ All fixes applied (done)
2. ⏳ Tests pass in CI
3. ⏳ Manual verification in demo app
4. ⏳ PR review approval

Only after verification should ROADMAP.md mark `[x]` HADDON-032.
