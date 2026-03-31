use haddon_core::epub::parse_epub;
use haddon_core::layout::{layout_document, DocumentLayout, LayoutPage};
use wasm_bindgen::prelude::*;
use web_sys::{CanvasRenderingContext2d, HtmlCanvasElement};

#[wasm_bindgen]
pub struct EpubReader {
    layout: DocumentLayout,
    title: Option<String>,
    author: Option<String>,
}

#[wasm_bindgen]
impl EpubReader {
    /// Load an EPUB file from bytes.
    pub fn load(data: &[u8]) -> Result<EpubReader, JsValue> {
        let doc = parse_epub(data).map_err(|e| JsValue::from_str(&e.to_string()))?;
        let title = doc.title.clone();
        let author = doc.author.clone();
        let layout = layout_document(&doc);
        Ok(EpubReader { layout, title, author })
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

        render_page_to_canvas(page, canvas, scale)
    }
}

fn render_page_to_canvas(
    page: &LayoutPage,
    canvas: &HtmlCanvasElement,
    scale: f64,
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

    // Render text
    ctx.set_fill_style_str("#333333");

    for line in &page.lines {
        for frag in &line.fragments {
            // Build CSS font string
            let style_prefix = match (frag.bold, frag.italic) {
                (true, true) => "bold italic ",
                (true, false) => "bold ",
                (false, true) => "italic ",
                (false, false) => "",
            };
            let font = format!(
                "{}{}px Liberation Sans, Arial, sans-serif",
                style_prefix, frag.font_size
            );

            ctx.set_font(&font);
            ctx.fill_text(&frag.text, frag.x as f64, frag.y as f64)?;
        }
    }

    ctx.restore();

    Ok(())
}
