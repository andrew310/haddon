# Dark Mode Reader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add dark/light mode toggle to the demo ebook reader, with proper themed canvas rendering from the Rust/WASM side.

**Architecture:** Add a `RenderTheme` struct to the WASM layer with color fields for background, text, superscript, highlight, and selection. The JS side passes theme colors to `render_page` based on a React state toggle. CSS variables handle the UI chrome (header, search bar, popovers). Theme preference persists in localStorage.

**Tech Stack:** Rust/wasm-bindgen, React, CSS custom properties, localStorage

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `packages/wasm/src/lib.rs` | Modify | Add `RenderTheme` struct, update `render_page` and `render_page_to_canvas` to accept theme colors |
| `apps/demo/src/App.tsx` | Modify | Add theme state, toggle button, pass colors to `render_page` |
| `apps/demo/src/App.css` | Modify | Convert hardcoded colors to CSS variables, add light/dark variable sets |

---

### Task 1: Add theme color parameters to the Rust renderer

**Files:**
- Modify: `packages/wasm/src/lib.rs:18-27` (EpubReader struct — no changes needed)
- Modify: `packages/wasm/src/lib.rs:74-93` (render_page public API)
- Modify: `packages/wasm/src/lib.rs:359-443` (render_page_to_canvas)

- [ ] **Step 1: Add `RenderTheme` struct and default constructor**

Add this after the `SelectionRange` struct (after line 34):

```rust
#[wasm_bindgen]
pub struct RenderTheme {
    bg: String,
    text: String,
    superscript: String,
    highlight: String,
    selection: String,
}

#[wasm_bindgen]
impl RenderTheme {
    #[wasm_bindgen(constructor)]
    pub fn new(
        bg: &str,
        text: &str,
        superscript: &str,
        highlight: &str,
        selection: &str,
    ) -> RenderTheme {
        RenderTheme {
            bg: bg.to_string(),
            text: text.to_string(),
            superscript: superscript.to_string(),
            highlight: highlight.to_string(),
            selection: selection.to_string(),
        }
    }
}
```

- [ ] **Step 2: Update `render_page` to accept a `RenderTheme`**

Change the `render_page` method signature (line 75) to:

```rust
    pub fn render_page(
        &self,
        canvas: &HtmlCanvasElement,
        page_index: usize,
        scale: f64,
        theme: &RenderTheme,
    ) -> Result<(), JsValue> {
        let page = self
            .layout
            .page(page_index)
            .ok_or_else(|| JsValue::from_str("page index out of bounds"))?;

        render_page_to_canvas(
            page,
            canvas,
            scale,
            &self.highlights,
            self.normalized_selection().as_ref(),
            theme,
        )
    }
```

- [ ] **Step 3: Update `render_page_to_canvas` to use theme colors**

Change the function signature (line 359) and replace all 6 hardcoded color strings:

```rust
fn render_page_to_canvas(
    page: &LayoutPage,
    canvas: &HtmlCanvasElement,
    scale: f64,
    highlights: &[DocumentRange],
    selection: Option<&NormalizedSelection>,
    theme: &RenderTheme,
) -> Result<(), JsValue> {
    canvas.set_width((page.width as f64 * scale) as u32);
    canvas.set_height((page.height as f64 * scale) as u32);

    let ctx: CanvasRenderingContext2d = canvas
        .get_context("2d")?
        .ok_or_else(|| JsValue::from_str("failed to get 2d context"))?
        .dyn_into()?;

    // Background
    ctx.set_fill_style_str(&theme.bg);
    ctx.fill_rect(
        0.0,
        0.0,
        page.width as f64 * scale,
        page.height as f64 * scale,
    );

    ctx.save();
    ctx.scale(scale, scale)?;

    ctx.set_fill_style_str(&theme.highlight);
    for highlight in highlights {
        if page_contains_range(page, highlight) {
            for line in &page.lines {
                for (x, width) in highlight_segments_for_line(line, highlight) {
                    ctx.fill_rect(x as f64, line.y as f64, width as f64, line.height as f64);
                }
            }
        }
    }

    if let Some(selection) = selection {
        if page_contains_range(page, &selection.range) {
            ctx.set_fill_style_str(&theme.selection);
            for line in &page.lines {
                for (x, width) in highlight_segments_for_line(line, &selection.range) {
                    ctx.fill_rect(x as f64, line.y as f64, width as f64, line.height as f64);
                }
            }
        }
    }

    // Render text
    ctx.set_fill_style_str(&theme.text);

    for line in &page.lines {
        for frag in &line.fragments {
            let (render_size, y_offset) = if frag.superscript {
                (frag.font_size * 0.65, -(frag.font_size as f64 * 0.35))
            } else {
                (frag.font_size, 0.0)
            };

            let style_prefix = match (frag.bold, frag.italic) {
                (true, true) => "bold italic ",
                (true, false) => "bold ",
                (false, true) => "italic ",
                (false, false) => "",
            };
            let font = format!(
                "{}{}px Liberation Sans, Arial, sans-serif",
                style_prefix, render_size
            );

            ctx.set_font(&font);
            if frag.superscript {
                ctx.set_fill_style_str(&theme.superscript);
            } else {
                ctx.set_fill_style_str(&theme.text);
            }
            ctx.fill_text(&frag.text, frag.x as f64, frag.y as f64 + y_offset)?;
        }
    }

    ctx.restore();

    Ok(())
}
```

- [ ] **Step 4: Build the WASM package to verify it compiles**

Run: `cd packages/wasm && wasm-pack build --target web --out-dir pkg`
Expected: Build succeeds with no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/wasm/src/lib.rs
git commit -m "feat: add RenderTheme to WASM renderer for dark mode support"
```

---

### Task 2: Add CSS variables and dark/light theme sets

**Files:**
- Modify: `apps/demo/src/App.css`

- [ ] **Step 1: Replace hardcoded colors with CSS variables**

Replace the entire `App.css` with theme-aware variables. The `:root` block defines light mode defaults, and `.dark` overrides for dark mode:

```css
:root {
  --app-bg: #f5f5f0;
  --text: #333;
  --text-muted: #777;
  --text-secondary: #999;
  --surface: #fff;
  --surface-alt: #f0f0f0;
  --border: #ccc;
  --border-accent: #5577bb;
  --canvas-shadow: rgba(0, 0, 0, 0.12);
  --popover-bg: rgba(255, 255, 255, 0.96);
  --popover-text: #333;
  --label-text: #5577bb;
  --active-bg: #333;
  --active-text: #fff;
  --active-border: #333;
  --link: #5577bb;
  --error: #cc3333;
  --result-page: #3366aa;
}

.dark {
  --app-bg: #1a1a1a;
  --text: #e0e0e0;
  --text-muted: #777;
  --text-secondary: #999;
  --surface: #222;
  --surface-alt: #333;
  --border: #555;
  --border-accent: #4d5f9d;
  --canvas-shadow: rgba(0, 0, 0, 0.4);
  --popover-bg: rgba(26, 26, 26, 0.96);
  --popover-text: #e0e0e0;
  --label-text: #b9c7ff;
  --active-bg: #e0e0e0;
  --active-text: #1a1a1a;
  --active-border: #e0e0e0;
  --link: #8aa7ff;
  --error: #ff6b6b;
  --result-page: #8aa7ff;
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: var(--app-bg);
  color: var(--text);
}

.app {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-height: 100vh;
  padding-bottom: 32px;
}

header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  max-width: 700px;
  padding: 16px 20px;
}

.search-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  max-width: 700px;
  padding: 0 20px 12px;
}

.search-bar input {
  flex: 1;
  min-width: 0;
  background: var(--surface);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 10px 12px;
  font-size: 14px;
}

.search-bar button {
  background: var(--surface-alt);
  color: var(--text);
  border: 1px solid var(--border);
  padding: 10px 14px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
}

.search-count {
  color: var(--text-secondary);
  font-size: 13px;
}

.search-results {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
  max-width: 700px;
  padding: 0 20px 16px;
}

.selection-popover {
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-width: 320px;
  background: var(--popover-bg);
  color: var(--popover-text);
  border: 1px solid var(--border-accent);
  border-radius: 10px;
  padding: 10px 12px;
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.38);
  z-index: 30;
}

.selection-label {
  color: var(--label-text);
  font-size: 13px;
  line-height: 1.4;
  max-height: 54px;
  overflow: hidden;
}

.selection-actions {
  display: flex;
  gap: 8px;
}

.selection-actions button {
  background: var(--surface-alt);
  color: var(--text);
  border: 1px solid var(--border);
  padding: 8px 12px;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
}

.search-result {
  display: flex;
  flex-direction: column;
  gap: 4px;
  text-align: left;
  background: var(--surface);
  color: var(--text);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
  cursor: pointer;
}

.search-result-page {
  color: var(--result-page);
  font-size: 12px;
}

header h1 {
  font-size: 18px;
  font-weight: 500;
  color: var(--text);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 400px;
}

.nav {
  display: flex;
  align-items: center;
  gap: 10px;
}

.nav button {
  background: var(--surface-alt);
  color: var(--text);
  border: 1px solid var(--border);
  padding: 6px 14px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
}

.nav button:disabled {
  opacity: 0.4;
  cursor: default;
}

.nav span {
  font-size: 14px;
  color: var(--text-secondary);
}

.view-toggle {
  display: flex;
  gap: 6px;
}

.view-toggle .active {
  background: var(--active-bg);
  color: var(--active-text);
  border-color: var(--active-border);
}

.canvas-container {
  display: flex;
  justify-content: center;
  width: 100%;
  max-width: 900px;
  padding: 0 16px;
  overflow: hidden;
}

.drop-zone {
  width: 600px;
  height: 400px;
  border: 2px dashed var(--border);
  border-radius: 12px;
  margin-top: 80px;
}

.drop-prompt {
  font-size: 18px;
  color: var(--text-muted);
}

.error {
  color: var(--error);
  font-size: 14px;
  padding: 20px;
}

.canvas-wrapper {
  position: relative;
}

.single-page-wrapper {
  margin: 8px 0 40px;
}

.scroll-stack {
  display: flex;
  flex-direction: column;
  gap: 32px;
  width: fit-content;
  max-width: 100%;
  max-height: calc(100vh - 96px);
  overflow-y: auto;
  padding: 8px 0 40px;
  align-items: center;
  margin: 0 auto;
}

canvas {
  box-shadow: 0 4px 24px var(--canvas-shadow);
  border-radius: 2px;
  user-select: none;
  -webkit-user-select: none;
}

.footnote-popover {
  background: var(--popover-bg);
  color: var(--popover-text);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 10px 14px;
  font-size: 13px;
  line-height: 1.5;
  max-width: 400px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
  pointer-events: none;
  z-index: 25;
}

.theme-toggle {
  background: var(--surface-alt);
  color: var(--text);
  border: 1px solid var(--border);
  padding: 6px 10px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
}
```

- [ ] **Step 2: Verify the CSS parses correctly**

Run: `cd apps/demo && npx vite build 2>&1 | head -5`
Expected: No CSS parse errors.

- [ ] **Step 3: Commit**

```bash
git add apps/demo/src/App.css
git commit -m "feat: convert demo CSS to theme variables with light/dark sets"
```

---

### Task 3: Wire up theme toggle in React and pass colors to WASM

**Files:**
- Modify: `apps/demo/src/App.tsx`

- [ ] **Step 1: Add theme state, localStorage persistence, and theme color constants**

At the top of `App.tsx`, after the existing type definitions (after line 61), add:

```typescript
type Theme = "light" | "dark";

const THEME_STORAGE_KEY = "haddon:theme";

const THEMES = {
  light: {
    bg: "#ffffff",
    text: "#333333",
    superscript: "#5577bb",
    highlight: "rgba(255, 215, 80, 0.34)",
    selection: "rgba(80, 140, 255, 0.28)",
  },
  dark: {
    bg: "#1a1a1a",
    text: "#d4d4d4",
    superscript: "#8aa7ff",
    highlight: "rgba(255, 185, 50, 0.30)",
    selection: "rgba(100, 160, 255, 0.32)",
  },
} as const;

function getInitialTheme(): Theme {
  const stored = localStorage.getItem(THEME_STORAGE_KEY);
  if (stored === "light" || stored === "dark") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
```

- [ ] **Step 2: Add theme state and CSS class sync to the App component**

Inside the `App` component, after the existing `useState` declarations (after line 78), add:

```typescript
  const [theme, setTheme] = useState<Theme>(getInitialTheme);
```

After the existing `useEffect` blocks, add a new effect to sync the CSS class and persist preference:

```typescript
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  }, [theme]);
```

- [ ] **Step 3: Create a `makeTheme` helper that builds a `RenderTheme` from WASM**

Inside the `App` component, after the theme state, add:

```typescript
  const makeTheme = useCallback(() => {
    if (!wasmModule) return null;
    const colors = THEMES[theme];
    return new wasmModule.RenderTheme(
      colors.bg,
      colors.text,
      colors.superscript,
      colors.highlight,
      colors.selection,
    );
  }, [theme]);
```

- [ ] **Step 4: Update `renderPage` to pass the theme**

Change the `renderPage` callback (line 187) to:

```typescript
  const renderPage = useCallback(
    (r: EpubReaderType, pageIdx: number, canvas: HTMLCanvasElement | null) => {
      if (!canvas) return;
      const t = makeTheme();
      if (!t) return;
      r.render_page(canvas, pageIdx, DPR, t);
      canvas.style.width = `${canvas.width / DPR}px`;
      canvas.style.height = `${canvas.height / DPR}px`;
    },
    [makeTheme]
  );
```

- [ ] **Step 5: Add theme to the dependency arrays that trigger re-renders**

The `rerenderAllPages` callback already depends on `renderPage`, which now depends on `makeTheme` (which depends on `theme`). This means changing the theme will automatically trigger a full re-render. No additional dependency changes are needed — React's dependency chain handles it.

Verify this by checking: `renderPage` depends on `[makeTheme]`, `rerenderAllPages` depends on `[currentPage, pageCount, renderPage, viewMode]`, and the existing `useEffect` blocks that call `renderPage` already include it in their deps.

- [ ] **Step 6: Add a re-render effect when theme changes**

After the existing `useEffect` blocks, add:

```typescript
  useEffect(() => {
    rerenderAllPages();
  }, [rerenderAllPages]);
```

Wait — `rerenderAllPages` is already called indirectly through the existing effects that depend on `renderPage`. But those effects only fire when `pageCount` or `viewMode` changes. We need an explicit re-render when `theme` changes. However, since `renderPage` changes when `theme` changes (via `makeTheme`), and the existing effects at lines 291-298 and 300-307 both depend on `renderPage`, they will re-fire. So no additional effect is needed.

**Actually:** Double-check that the existing effects cover this. The effect at line 291 fires on `[pageCount, renderPage, viewMode]` — since `renderPage` is in that list, changing theme will re-trigger it. Same for line 300 with `[currentPage, renderPage, ...]`. This is correct — no new effect needed.

- [ ] **Step 7: Add the toggle button to the header**

In the JSX, inside the `<header>` element (line 550), add the toggle button before the `<h1>`:

```tsx
      <header>
        <button
          className="theme-toggle"
          onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
          aria-label="Toggle dark mode"
        >
          {theme === "dark" ? "\u2600" : "\u263E"}
        </button>
        <h1>{title || "Haddon"}</h1>
```

The unicode characters are: `☀` (sun, shown in dark mode to switch to light) and `☾` (moon, shown in light mode to switch to dark).

- [ ] **Step 8: Build and verify**

Run: `cd /Users/andrew/src/github.com/andrew310/haddon && pnpm build:demo`
Expected: Build succeeds with no TypeScript or bundling errors.

- [ ] **Step 9: Commit**

```bash
git add apps/demo/src/App.tsx
git commit -m "feat: wire up dark/light mode toggle with themed canvas rendering"
```

---

### Task 4: Manual smoke test

- [ ] **Step 1: Start the dev server**

Run: `pnpm dev`

- [ ] **Step 2: Verify light mode (default for light system preference)**

Open the localhost URL in a browser. Check:
- Page background is cream/off-white (`#f5f5f0`)
- Drop zone text and borders use light theme colors
- Drop an epub file — canvas pages should render with white background and dark text

- [ ] **Step 3: Toggle to dark mode**

Click the moon icon. Check:
- Background flips to `#1a1a1a`
- Canvas pages re-render with dark background (`#1a1a1a`) and light text (`#d4d4d4`)
- Search bar, header, buttons all use dark theme variables
- Select text — selection highlight should be visible on dark background
- Save a highlight — highlight color should be visible on dark background

- [ ] **Step 4: Verify persistence**

Refresh the page. Theme should persist (dark stays dark). Drop the same epub — it should render in the persisted theme.

- [ ] **Step 5: Toggle back to light**

Click the sun icon. Everything should flip back cleanly. Canvas re-renders with white background and dark text.
