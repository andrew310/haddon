use cosmic_text::FontSystem;
use haddon_core::epub::parse_epub;
use haddon_core::layout::{
    create_font_system, layout_document_with_size, DocumentLayout, LayoutCluster, LayoutLine,
    LayoutPage,
};
use haddon_core::search::search_document;
use haddon_core::types::EpubDocument;
use js_sys::{Array, Object, Reflect};
use wasm_bindgen::prelude::*;
use web_sys::{CanvasRenderingContext2d, HtmlCanvasElement};

#[wasm_bindgen(start)]
pub fn init_panic_hook() {
    console_error_panic_hook::set_once();
}

#[wasm_bindgen]
pub struct EpubReader {
    doc: EpubDocument,
    font_system: FontSystem,
    layout: DocumentLayout,
    title: Option<String>,
    author: Option<String>,
    selection: Option<SelectionRange>,
}

#[derive(Clone)]
struct SelectionPoint {
    page_index: usize,
    chapter_index: usize,
    block_index: usize,
    offset: usize,
}

#[derive(Clone)]
struct SelectionRange {
    start: SelectionPoint,
    end: SelectionPoint,
}

#[wasm_bindgen]
impl EpubReader {
    /// Load an EPUB file from bytes.
    pub fn load(data: &[u8]) -> Result<EpubReader, JsValue> {
        let doc = parse_epub(data).map_err(|e| JsValue::from_str(&e.to_string()))?;
        let title = doc.title.clone();
        let author = doc.author.clone();
        let mut font_system = create_font_system();
        let layout = layout_document_with_size(&doc, 600.0, 800.0, &mut font_system);
        Ok(EpubReader {
            doc,
            font_system,
            layout,
            title,
            author,
            selection: None,
        })
    }

    /// Re-layout the document with new page dimensions.
    pub fn relayout(&mut self, page_width: f32, page_height: f32) {
        self.layout = layout_document_with_size(&self.doc, page_width, page_height, &mut self.font_system);
        self.selection = None;
    }

    pub fn page_count(&self) -> usize {
        self.layout.page_count()
    }

    pub fn title(&self) -> Option<String> {
        self.title.clone()
    }

    pub fn author(&self) -> Option<String> {
        self.author.clone()
    }

    /// Render a page to an HTML canvas.
    pub fn render_page(
        &self,
        canvas: &HtmlCanvasElement,
        page_index: usize,
        scale: f64,
    ) -> Result<(), JsValue> {
        let page = self
            .layout
            .page(page_index)
            .ok_or_else(|| JsValue::from_str("page index out of bounds"))?;

        render_page_to_canvas(page, canvas, scale, self.normalized_selection().as_ref())
    }

    /// Hit-test: returns the note ID if (x, y) in page coords is over a noteref.
    pub fn hit_test_noteref(&self, page_index: usize, x: f32, y: f32) -> Option<String> {
        let page = self.layout.page(page_index)?;
        for line in &page.lines {
            if y < line.y || y > line.y + line.height {
                continue;
            }
            for frag in &line.fragments {
                if let Some(ref id) = frag.noteref_id {
                    if x >= frag.x && x <= frag.x + frag.width {
                        return Some(id.clone());
                    }
                }
            }
        }
        None
    }

    pub fn noteref_anchor_rect(
        &self,
        page_index: usize,
        x: f32,
        y: f32,
    ) -> Result<JsValue, JsValue> {
        let page = self
            .layout
            .page(page_index)
            .ok_or_else(|| JsValue::from_str("page index out of bounds"))?;

        for line in &page.lines {
            if y < line.y || y > line.y + line.height {
                continue;
            }
            for frag in &line.fragments {
                if let Some(ref id) = frag.noteref_id {
                    if x >= frag.x && x <= frag.x + frag.width {
                        let obj = Object::new();
                        Reflect::set(&obj, &JsValue::from_str("id"), &JsValue::from_str(id))?;
                        Reflect::set(
                            &obj,
                            &JsValue::from_str("x"),
                            &JsValue::from_f64(frag.x as f64),
                        )?;
                        Reflect::set(
                            &obj,
                            &JsValue::from_str("y"),
                            &JsValue::from_f64(line.y as f64),
                        )?;
                        Reflect::set(
                            &obj,
                            &JsValue::from_str("width"),
                            &JsValue::from_f64(frag.width as f64),
                        )?;
                        Reflect::set(
                            &obj,
                            &JsValue::from_str("height"),
                            &JsValue::from_f64(line.height as f64),
                        )?;
                        return Ok(obj.into());
                    }
                }
            }
        }

        Ok(JsValue::NULL)
    }

    /// Get the text content of a note by its anchor ID.
    pub fn get_note(&self, id: &str) -> Option<String> {
        self.doc.notes.get(id).cloned()
    }

    /// Returns the number of parsed notes (for debugging).
    pub fn note_count(&self) -> usize {
        self.doc.notes.len()
    }

    pub fn begin_selection(&mut self, page_index: usize, x: f32, y: f32) {
        self.selection = self
            .hit_test_selection_point(page_index, x, y)
            .map(|point| SelectionRange {
                start: point.clone(),
                end: point,
            });
    }

    pub fn update_selection(&mut self, page_index: usize, x: f32, y: f32) {
        let Some(current) = self.selection.clone() else {
            return;
        };
        let Some(point) = self.hit_test_selection_point(page_index, x, y) else {
            return;
        };
        if point.page_index != current.start.page_index {
            return;
        }
        self.selection = Some(SelectionRange {
            start: current.start,
            end: point,
        });
    }

    pub fn clear_selection(&mut self) {
        self.selection = None;
    }

    pub fn has_selection(&self) -> bool {
        self.normalized_selection().is_some()
    }

    pub fn selected_text(&self) -> Option<String> {
        let selection = self.normalized_selection()?;
        Some(extract_selection_text(&self.doc, &selection))
    }

    pub fn selection_anchor_rect(&self, page_index: usize) -> Result<JsValue, JsValue> {
        let page = self
            .layout
            .page(page_index)
            .ok_or_else(|| JsValue::from_str("page index out of bounds"))?;
        let Some(selection) = self.normalized_selection() else {
            return Ok(JsValue::NULL);
        };

        if selection.start.page_index != page_index || selection.end.page_index != page_index {
            return Ok(JsValue::NULL);
        }

        let mut min_x = f32::INFINITY;
        let mut min_y = f32::INFINITY;
        let mut max_x = f32::NEG_INFINITY;
        let mut max_y = f32::NEG_INFINITY;

        for line in &page.lines {
            for (x, width) in highlight_segments_for_line(line, &selection) {
                min_x = min_x.min(x);
                min_y = min_y.min(line.y);
                max_x = max_x.max(x + width);
                max_y = max_y.max(line.y + line.height);
            }
        }

        if !min_x.is_finite() {
            return Ok(JsValue::NULL);
        }

        let obj = Object::new();
        Reflect::set(&obj, &JsValue::from_str("x"), &JsValue::from_f64(min_x as f64))?;
        Reflect::set(&obj, &JsValue::from_str("y"), &JsValue::from_f64(min_y as f64))?;
        Reflect::set(
            &obj,
            &JsValue::from_str("width"),
            &JsValue::from_f64((max_x - min_x) as f64),
        )?;
        Reflect::set(
            &obj,
            &JsValue::from_str("height"),
            &JsValue::from_f64((max_y - min_y) as f64),
        )?;
        Ok(obj.into())
    }

    pub fn search(&self, query: &str) -> Result<Array, JsValue> {
        let results = search_document(&self.doc, query, 50);
        let array = Array::new();

        for result in results {
            let page_index = self
                .layout
                .pages
                .iter()
                .position(|page| {
                    page.lines.iter().any(|line| {
                        line.chapter_index == result.chapter_index
                            && line.block_index == result.block_index
                    })
                })
                .unwrap_or(0);

            let obj = Object::new();
            Reflect::set(
                &obj,
                &JsValue::from_str("chapterIndex"),
                &JsValue::from_f64(result.chapter_index as f64),
            )?;
            Reflect::set(
                &obj,
                &JsValue::from_str("blockIndex"),
                &JsValue::from_f64(result.block_index as f64),
            )?;
            Reflect::set(
                &obj,
                &JsValue::from_str("pageIndex"),
                &JsValue::from_f64(page_index as f64),
            )?;
            Reflect::set(
                &obj,
                &JsValue::from_str("snippet"),
                &JsValue::from_str(&result.snippet),
            )?;
            array.push(&obj);
        }

        Ok(array)
    }
}

fn render_page_to_canvas(
    page: &LayoutPage,
    canvas: &HtmlCanvasElement,
    scale: f64,
    selection: Option<&SelectionRange>,
) -> Result<(), JsValue> {
    canvas.set_width((page.width as f64 * scale) as u32);
    canvas.set_height((page.height as f64 * scale) as u32);

    let ctx: CanvasRenderingContext2d = canvas
        .get_context("2d")?
        .ok_or_else(|| JsValue::from_str("failed to get 2d context"))?
        .dyn_into()?;

    // White background
    ctx.set_fill_style_str("white");
    ctx.fill_rect(
        0.0,
        0.0,
        page.width as f64 * scale,
        page.height as f64 * scale,
    );

    ctx.save();
    ctx.scale(scale, scale)?;

    if let Some(selection) = selection {
        if selection.start.page_index == selection.end.page_index
            && page.lines.iter().any(|line| {
                line.chapter_index == selection.start.chapter_index
                    && line.block_index >= selection.start.block_index
            })
        {
            ctx.set_fill_style_str("rgba(80, 140, 255, 0.28)");
            for line in &page.lines {
                for (x, width) in highlight_segments_for_line(line, selection) {
                    ctx.fill_rect(x as f64, line.y as f64, width as f64, line.height as f64);
                }
            }
        }
    }

    // Render text
    ctx.set_fill_style_str("#333333");

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
                ctx.set_fill_style_str("#6688cc");
            } else {
                ctx.set_fill_style_str("#333333");
            }
            ctx.fill_text(&frag.text, frag.x as f64, frag.y as f64 + y_offset)?;
        }
    }

    ctx.restore();

    Ok(())
}

impl EpubReader {
    fn hit_test_selection_point(
        &self,
        page_index: usize,
        x: f32,
        y: f32,
    ) -> Option<SelectionPoint> {
        let page = self.layout.page(page_index)?;
        let line = page
            .lines
            .iter()
            .find(|line| y >= line.y && y <= line.y + line.height)
            .or_else(|| {
                page.lines.iter().min_by(|a, b| {
                    let da = distance_to_line_center(y, a);
                    let db = distance_to_line_center(y, b);
                    da.partial_cmp(&db).unwrap_or(std::cmp::Ordering::Equal)
                })
            })?;

        let cluster = line
            .clusters
            .iter()
            .find(|cluster| x >= cluster.x && x <= cluster.x + cluster.width)
            .or_else(|| {
                if line.clusters.is_empty() {
                    None
                } else if x < line.clusters.first()?.x {
                    line.clusters.first()
                } else {
                    line.clusters.last()
                }
            })?;

        let relative_x = (x - cluster.x).clamp(0.0, cluster.width);
        let fraction = if cluster.width > 0.0 {
            relative_x / cluster.width
        } else {
            0.0
        };

        Some(SelectionPoint {
            page_index,
            chapter_index: line.chapter_index,
            block_index: line.block_index,
            offset: cluster.start + byte_offset_at_fraction(&cluster.text, fraction),
        })
    }

    fn normalized_selection(&self) -> Option<SelectionRange> {
        let selection = self.selection.clone()?;
        if compare_points(&selection.start, &selection.end).is_le() {
            Some(selection)
        } else {
            Some(SelectionRange {
                start: selection.end,
                end: selection.start,
            })
        }
    }
}

fn compare_points(a: &SelectionPoint, b: &SelectionPoint) -> std::cmp::Ordering {
    (a.page_index, a.chapter_index, a.block_index, a.offset).cmp(&(
        b.page_index,
        b.chapter_index,
        b.block_index,
        b.offset,
    ))
}

fn distance_to_line_center(y: f32, line: &LayoutLine) -> f32 {
    (line.y + line.height * 0.5 - y).abs()
}

fn byte_offset_at_fraction(text: &str, fraction: f32) -> usize {
    let total_chars = text.chars().count();
    if total_chars == 0 {
        return 0;
    }
    let target = ((total_chars as f32) * fraction).round() as usize;
    if target >= total_chars {
        return text.len();
    }
    text.char_indices()
        .nth(target)
        .map(|(idx, _)| idx)
        .unwrap_or(text.len())
}

fn highlight_segments_for_line(
    line: &LayoutLine,
    selection: &SelectionRange,
) -> Vec<(f32, f32)> {
    if line.chapter_index < selection.start.chapter_index
        || line.chapter_index > selection.end.chapter_index
    {
        return Vec::new();
    }
    if line.chapter_index == selection.start.chapter_index
        && line.block_index < selection.start.block_index
    {
        return Vec::new();
    }
    if line.chapter_index == selection.end.chapter_index
        && line.block_index > selection.end.block_index
    {
        return Vec::new();
    }

    let mut out = Vec::new();
    let mut open_start: Option<f32> = None;
    let mut open_end = 0.0;

    for cluster in &line.clusters {
        if let Some((left, right)) = highlight_bounds_for_cluster(cluster, line, selection) {
            if let Some(start) = open_start {
                if (left - open_end).abs() < 0.5 {
                    open_end = right;
                } else {
                    out.push((start, open_end - start));
                    open_start = Some(left);
                    open_end = right;
                }
            } else {
                open_start = Some(left);
                open_end = right;
            }
        } else if let Some(start) = open_start.take() {
            out.push((start, open_end - start));
        }
    }

    if let Some(start) = open_start {
        out.push((start, open_end - start));
    }

    out
}

fn highlight_bounds_for_cluster(
    cluster: &LayoutCluster,
    line: &LayoutLine,
    selection: &SelectionRange,
) -> Option<(f32, f32)> {
    let block_is_start = line.chapter_index == selection.start.chapter_index
        && line.block_index == selection.start.block_index;
    let block_is_end = line.chapter_index == selection.end.chapter_index
        && line.block_index == selection.end.block_index;

    let mut start = cluster.start;
    let mut end = cluster.end;

    if block_is_start {
        start = start.max(selection.start.offset);
    }
    if block_is_end {
        end = end.min(selection.end.offset);
    }

    if start >= end {
        return None;
    }

    let left_fraction = byte_fraction(&cluster.text, start.saturating_sub(cluster.start));
    let right_fraction = byte_fraction(&cluster.text, end.saturating_sub(cluster.start));
    let left = cluster.x + cluster.width * left_fraction;
    let right = cluster.x + cluster.width * right_fraction;
    Some((left, right.max(left)))
}

fn byte_fraction(text: &str, byte_offset: usize) -> f32 {
    let total_chars = text.chars().count();
    if total_chars == 0 {
        return 0.0;
    }
    let clamped = byte_offset.min(text.len());
    let chars_before = text[..clamped].chars().count();
    chars_before as f32 / total_chars as f32
}

fn extract_selection_text(doc: &EpubDocument, selection: &SelectionRange) -> String {
    let mut out = String::new();

    for (chapter_index, chapter) in doc.chapters.iter().enumerate() {
        if chapter_index < selection.start.chapter_index || chapter_index > selection.end.chapter_index
        {
            continue;
        }

        for (block_index, block) in chapter.blocks.iter().enumerate() {
            if chapter_index == selection.start.chapter_index
                && block_index < selection.start.block_index
            {
                continue;
            }
            if chapter_index == selection.end.chapter_index && block_index > selection.end.block_index
            {
                continue;
            }

            let block_text = block
                .spans()
                .iter()
                .map(|span| span.text.replace('\r', ""))
                .collect::<String>();

            let start = if chapter_index == selection.start.chapter_index
                && block_index == selection.start.block_index
            {
                selection.start.offset.min(block_text.len())
            } else {
                0
            };
            let end = if chapter_index == selection.end.chapter_index
                && block_index == selection.end.block_index
            {
                selection.end.offset.min(block_text.len())
            } else {
                block_text.len()
            };

            if start >= end {
                continue;
            }

            if !out.is_empty() {
                out.push('\n');
            }
            out.push_str(&block_text[start..end]);
        }
    }

    out
}
