# HADDON-032 Acceptance Verification

## Acceptance Criteria

> Resizing, theme changes, and font changes preserve the logical location and emit a new rendition location.

## Manual Verification Steps

### 1. Start the Demo App

```bash
cd apps/demo
pnpm dev
```

### 2. Load the Sample Chapter

1. Open http://localhost:5173 in your browser
2. Click "Open the sample chapter" to load the citation fixture

### 3. Verify Initial Visible Location Tracking

You should see a floating debug panel in the bottom-right showing:
- Current location (href)
- Block ID and offset
- Layout revision number
- Number of visible segments

**Expected**: Panel appears and updates as you scroll through the content.

### 4. Test Scroll Preservation

1. Scroll to the middle of the chapter
2. Note the current block ID and offset in the debug panel
3. Scroll up and down slightly
4. Observe that the location updates smoothly

**Expected**: Location changes are coalesced (not on every single scroll event) and the debug panel updates showing the new visible block.

### 5. Test Resize Preservation

1. Scroll to a specific paragraph (note the block ID)
2. Resize your browser window (make it narrower/wider)
3. Observe the layout revision increment
4. Check that the same block remains in view

**Expected**: 
- Layout revision increments on resize
- The captured location is preserved (same block ID should remain visible after reflow)
- Console logs show "Location changed" with cause: "resize"

### 6. Test Theme Change Preservation

1. Note the current visible block ID
2. Click the theme toggle button (sun/moon icon)
3. Observe that the layout revision increments
4. Check that the same block remains in view

**Expected**:
- Layout revision increments on theme change
- The same logical location is preserved
- Console shows "Location changed" with cause: "preferences"

### 7. Verify Layout Revision Tracking

Open the browser console and observe the log messages:

```
[VisibilityTracker] Location changed: {
  cause: "scroll" | "resize" | "preferences" | "initial",
  href: "chapter-1.xhtml",
  blockId: "...",
  offset: 42,
  layoutRevision: N
}
```

**Expected**:
- `layoutRevision` increments for each geometry-invalidating change
- `cause` accurately reflects the trigger (scroll, resize, preferences)
- Block ID and offset are valid normalized references

### 8. Test Hidden Content Handling

1. Open browser DevTools
2. Inspect a paragraph element
3. Add `style="display: none;"` to hide it
4. Observe that the visibility tracker skips it and reports the next visible block

**Expected**: Hidden elements are excluded from visible location calculation.

### 9. Test Zero-Width Viewport

1. Make the browser window extremely narrow (< 100px)
2. Check that the app doesn't crash
3. The debug panel may show "unavailable" status

**Expected**: Graceful degradation - no JavaScript errors, tracker remains functional.

### 10. Test Cleanup on Navigation

1. Load the sample chapter
2. Switch to a different chapter using the toolbar
3. Check browser console for any errors
4. Verify the old tracker is destroyed and a new one is created

**Expected**: Clean destruction and re-initialization, no memory leaks or stale observers.

## Automated Test Verification

Run the test suite:

```bash
cd packages/haddon-navigator
pnpm test
```

**Expected**: All tests pass, including:
- ✓ should track initial visible location
- ✓ should handle zero-sized root gracefully
- ✓ should increment layoutRevision on resize
- ✓ should handle hidden anchors correctly
- ✓ should coalesce scroll events per animation frame
- ✓ should handle long unbroken text
- ✓ should preserve captured locator across layout changes
- ✓ should update viewport insets correctly
- ✓ should cleanup observers on destroy

## Sign-Off

Once all manual and automated tests pass, HADDON-032 is considered **COMPLETE** and can be marked as such in ROADMAP.md.

---

**Verified by**: [Name]  
**Date**: [Date]  
**Branch**: cursor/visible-location-tracking-9d01  
**Commit**: [SHA]
