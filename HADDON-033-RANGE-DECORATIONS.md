# HADDON-033: Range-Accurate Decorations

## Implementation Summary

Fixed the decoration system to paint the exact text range selected by the user, not the entire paragraph.

## Problem

When a user selected a portion of a paragraph (e.g., "Identify the three essential ingredients of natural selection."), the entire paragraph would be highlighted yellow, not just the selected text. The native blue selection showed the correct range, but the Haddon decoration was applied at the block level.

## Solution

Modified `DecorationManager` to use text offsets from `PublicationLocatorV1`:

1. **Range Detection**: Check if locator has both `start` and `end` offsets
2. **Span Wrapping**: When offsets differ, create a `Range` object and wrap it in a `<span>` with the decoration attribute
3. **Graceful Fallback**: If range crosses element boundaries or offsets are missing, fall back to block-level marking
4. **Remount Stability**: Decoration spans are unwrapped and recreated on each `applyDecorations` call

## Technical Details

### Key Methods

- `markRange()`: Wraps a text range (specified by UTF-16 offsets) in a span element
- `createRangeFromOffsets()`: Converts UTF-16 offsets to a DOM Range by walking text nodes
- `clearDecorationMarkers()`: Unwraps decoration spans with no remaining attributes

### Offset Calculation

Text offsets are calculated in UTF-16 code units (matching JavaScript string indexing):

```typescript
// In locatorFromDomSelection():
const startOffset = calculateSelectionOffset(block, range.startContainer, range.startOffset);
const endOffset = calculateSelectionOffset(block, range.endContainer, range.endOffset);
```

### CSS Styling

Both span-wrapped and block-level decorations are styled:

```css
span[data-haddon-decoration-active-citation],
[data-haddon-decoration-active-citation] {
  background: rgba(255, 215, 80, 0.35);
  border-radius: 2px;
}
```

## Test Coverage

### New Tests

1. **Range-accurate marking**: Verifies that only the specified text range is marked, not the entire block
2. **Block fallback**: Confirms block-level marking when offsets are missing
3. **Remount stability**: Ensures range decorations survive DOM recreation

### Test Results

All 34 tests pass, including 3 new range-accurate decoration tests.

## Manual Testing

To manually verify:

1. Open the demo app with a sample EPUB
2. Select a sentence or phrase within a paragraph (not the whole paragraph)
3. Verify that only the selected text is highlighted in yellow
4. Navigate to another chapter and back
5. Verify the decoration is restored to the same text range

## Edge Cases Handled

1. **Range crosses inline elements**: If the selection spans `<em>` or `<strong>` tags, `surroundContents()` will fail. Falls back to block-level marking with a warning.
2. **Missing offsets**: When locator has no `end` offset or offsets are equal, applies block-level decoration.
3. **Remount**: Decoration spans are created fresh on each `applyDecorations()` call, so they survive DOM recreation.

## Future Work

- CSS Custom Highlight API could replace span wrapping for better performance
- Nested/overlapping decorations may need more sophisticated merging
- Text quote recovery could help when block structure changes
