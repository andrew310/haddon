use crate::types::{Block, EpubDocument};
use cosmic_text::{
    Attrs, Buffer, Family, FontSystem, Metrics, Shaping, Style, Weight,
};

static LIBERATION_SANS_REGULAR: &[u8] =
    include_bytes!("../fonts/LiberationSans-Regular.ttf");
static LIBERATION_SANS_BOLD: &[u8] =
    include_bytes!("../fonts/LiberationSans-Bold.ttf");
static LIBERATION_SANS_ITALIC: &[u8] =
    include_bytes!("../fonts/LiberationSans-Italic.ttf");
static LIBERATION_SANS_BOLD_ITALIC: &[u8] =
    include_bytes!("../fonts/LiberationSans-BoldItalic.ttf");

const DEFAULT_PAGE_WIDTH: f32 = 600.0;
const DEFAULT_PAGE_HEIGHT: f32 = 800.0;
const MARGIN_TOP: f32 = 50.0;
const MARGIN_BOTTOM: f32 = 50.0;
const MARGIN_LEFT: f32 = 50.0;
const MARGIN_RIGHT: f32 = 50.0;
const BLOCK_SPACING: f32 = 8.0;
const HEADING_SPACING_BEFORE: f32 = 16.0;

/// A text fragment with position and style (one span on one line).
#[derive(Clone, Debug)]
pub struct LayoutFragment {
    pub text: String,
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub font_size: f32,
    pub bold: bool,
    pub italic: bool,
    pub superscript: bool,
    pub debug_noteref_candidate: bool,
    pub noteref_id: Option<String>,
}

#[derive(Clone, Debug)]
pub struct LayoutCluster {
    pub text: String,
    pub x: f32,
    pub width: f32,
    pub start: usize,
    pub end: usize,
}

/// A visual line of text on a page.
#[derive(Clone, Debug)]
pub struct LayoutLine {
    pub fragments: Vec<LayoutFragment>,
    pub clusters: Vec<LayoutCluster>,
    pub y: f32,
    pub height: f32,
    pub baseline: f32,
    pub chapter_index: usize,
    pub block_index: usize,
}

/// A rendered page.
#[derive(Clone, Debug)]
pub struct LayoutPage {
    pub width: f32,
    pub height: f32,
    pub lines: Vec<LayoutLine>,
}

/// Complete layout of all pages.
pub struct DocumentLayout {
    pub pages: Vec<LayoutPage>,
}

pub fn create_font_system() -> FontSystem {
    let mut db = cosmic_text::fontdb::Database::new();
    db.load_font_data(LIBERATION_SANS_REGULAR.to_vec());
    db.load_font_data(LIBERATION_SANS_BOLD.to_vec());
    db.load_font_data(LIBERATION_SANS_ITALIC.to_vec());
    db.load_font_data(LIBERATION_SANS_BOLD_ITALIC.to_vec());
    FontSystem::new_with_locale_and_db("en-US".to_string(), db)
}

/// A shaped line before pagination (positions relative to block start).
struct ShapedLine {
    fragments: Vec<LayoutFragment>,
    clusters: Vec<LayoutCluster>,
    height: f32,
}

/// Shape a single block into lines using cosmic-text.
fn shape_block(
    block: &Block,
    font_system: &mut FontSystem,
    content_width: f32,
) -> Vec<ShapedLine> {
    let spans = block.spans();
    if spans.is_empty() {
        return vec![];
    }

    let font_size = block.font_size();
    let line_height = font_size * 1.4;
    let metrics = Metrics::new(font_size, line_height);

    let mut buffer = Buffer::new(font_system, metrics);
    buffer.set_size(font_system, Some(content_width), None);

    // Normalize text: strip \r since cosmic-text normalizes line endings internally.
    // Without this, glyph byte indices won't match our full_text.
    let normalized: Vec<String> = spans.iter().map(|s| s.text.replace('\r', "")).collect();

    let mut full_text = String::new();
    for text in &normalized {
        full_text.push_str(text);
    }

    let rich_text: Vec<(&str, Attrs)> = normalized
        .iter()
        .zip(spans.iter())
        .enumerate()
        .map(|(span_idx, (text, s))| {
            let attrs = Attrs::new()
                .family(Family::Name("Liberation Sans"))
                .weight(if s.bold { Weight::BOLD } else { Weight::NORMAL })
                .style(if s.italic {
                    Style::Italic
                } else {
                    Style::Normal
                })
                .metadata(span_idx);
            (text.as_str(), attrs)
        })
        .collect();

    let default_attrs = Attrs::new().family(Family::Name("Liberation Sans"));
    buffer.set_rich_text(font_system, rich_text, &default_attrs, Shaping::Advanced, None);
    buffer.shape_until_scroll(font_system, false);

    // Iterate layout runs (one per visual line) and build ShapedLines
    let mut shaped_lines: Vec<ShapedLine> = Vec::new();

    for layout_run in buffer.layout_runs() {
        let mut fragments: Vec<LayoutFragment> = Vec::new();
        let mut clusters: Vec<LayoutCluster> = Vec::new();
        let mut current_span_idx: Option<usize> = None;
        let mut frag_start_x: f32 = 0.0;
        let mut frag_text = String::new();

        for glyph in layout_run.glyphs {
            let span_idx = glyph.metadata;

            // Guard against out-of-bounds span index
            if span_idx >= spans.len() {
                continue;
            }

            if current_span_idx != Some(span_idx) {
                // Flush previous fragment
                if !frag_text.is_empty() {
                    if let Some(sidx) = current_span_idx {
                        if sidx < spans.len() {
                            let span = &spans[sidx];
                            fragments.push(LayoutFragment {
                                text: std::mem::take(&mut frag_text),
                                x: frag_start_x + MARGIN_LEFT,
                                y: 0.0, // set during pagination
                                width: glyph.x - frag_start_x,
                                font_size: span.font_size,
                                bold: span.bold,
                                italic: span.italic,
                                superscript: span.superscript,
                                debug_noteref_candidate: span.debug_noteref_candidate,
                                noteref_id: span.noteref_id.clone(),
                            });
                        }
                    }
                }
                current_span_idx = Some(span_idx);
                frag_start_x = glyph.x;
                frag_text.clear();
            }

            // Extract glyph text from the layout run's text (not full_text)
            if glyph.start <= glyph.end && glyph.end <= layout_run.text.len() {
                let glyph_text = &layout_run.text[glyph.start..glyph.end];
                frag_text.push_str(glyph_text);
                clusters.push(LayoutCluster {
                    text: glyph_text.to_string(),
                    x: glyph.x + MARGIN_LEFT,
                    width: glyph.w,
                    start: glyph.start,
                    end: glyph.end,
                });
            }
        }

        // Flush last fragment
        if !frag_text.is_empty() {
            if let Some(sidx) = current_span_idx.filter(|&i| i < spans.len()) {
                let span = &spans[sidx];
                let last_glyph = layout_run.glyphs.last();
                let end_x = last_glyph.map(|g| g.x + g.w).unwrap_or(frag_start_x);
                fragments.push(LayoutFragment {
                    text: frag_text,
                    x: frag_start_x + MARGIN_LEFT,
                    y: 0.0,
                    width: end_x - frag_start_x,
                    font_size: span.font_size,
                    bold: span.bold,
                    italic: span.italic,
                    superscript: span.superscript,
                    debug_noteref_candidate: span.debug_noteref_candidate,
                    noteref_id: span.noteref_id.clone(),
                });
            }
        }

        shaped_lines.push(ShapedLine {
            fragments,
            clusters,
            height: line_height,
        });
    }

    shaped_lines
}

/// Lay out an entire EpubDocument into pages with default dimensions.
pub fn layout_document(doc: &EpubDocument) -> DocumentLayout {
    let mut font_system = create_font_system();
    layout_document_with_size(doc, DEFAULT_PAGE_WIDTH, DEFAULT_PAGE_HEIGHT, &mut font_system)
}

/// Lay out an entire EpubDocument into pages with custom dimensions and a reusable FontSystem.
pub fn layout_document_with_size(doc: &EpubDocument, page_width: f32, page_height: f32, font_system: &mut FontSystem) -> DocumentLayout {
    let content_width = page_width - MARGIN_LEFT - MARGIN_RIGHT;
    let content_bottom = page_height - MARGIN_BOTTOM;

    // Phase 1: Shape all blocks
    struct ShapedBlock {
        lines: Vec<ShapedLine>,
        is_heading: bool,
        chapter_index: usize,
        block_index: usize,
    }

    let mut shaped_chapters: Vec<Vec<ShapedBlock>> = Vec::new();
    for (chapter_index, chapter) in doc.chapters.iter().enumerate() {
        let mut shaped_blocks: Vec<ShapedBlock> = Vec::new();
        for (block_index, block) in chapter.blocks.iter().enumerate() {
            let lines = shape_block(block, font_system, content_width);
            let is_heading = matches!(block, Block::Heading { .. });
            shaped_blocks.push(ShapedBlock {
                lines,
                is_heading,
                chapter_index,
                block_index,
            });
        }
        shaped_chapters.push(shaped_blocks);
    }

    // Phase 2: Paginate
    let mut pages: Vec<LayoutPage> = Vec::new();
    let mut current_lines: Vec<LayoutLine> = Vec::new();
    let mut y = MARGIN_TOP;

    for (chapter_idx, shaped_blocks) in shaped_chapters.iter().enumerate() {
        // EPUB spine items are separate flow boundaries; start each later chapter on a new page.
        if chapter_idx > 0 && !current_lines.is_empty() {
            pages.push(LayoutPage {
                width: page_width,
                height: page_height,
                lines: std::mem::take(&mut current_lines),
            });
            y = MARGIN_TOP;
        }

        for shaped_block in shaped_blocks {
            // Extra space before headings
            if shaped_block.is_heading {
                y += HEADING_SPACING_BEFORE;
            }

            for shaped_line in &shaped_block.lines {
                // Start new page if this line doesn't fit
                if y + shaped_line.height > content_bottom && !current_lines.is_empty() {
                    pages.push(LayoutPage {
                        width: page_width,
                        height: page_height,
                        lines: std::mem::take(&mut current_lines),
                    });
                    y = MARGIN_TOP;
                }

                // Position fragments on the page
                let baseline = y + shaped_line.height * 0.75; // approximate baseline
                let mut positioned_frags: Vec<LayoutFragment> = Vec::new();
                for frag in &shaped_line.fragments {
                    let mut f = frag.clone();
                    f.y = baseline;
                    positioned_frags.push(f);
                }

                current_lines.push(LayoutLine {
                    fragments: positioned_frags,
                    clusters: shaped_line.clusters.clone(),
                    y,
                    height: shaped_line.height,
                    baseline,
                    chapter_index: shaped_block.chapter_index,
                    block_index: shaped_block.block_index,
                });

                y += shaped_line.height;
            }

            y += BLOCK_SPACING;
        }
    }

    // Push final page
    if !current_lines.is_empty() {
        pages.push(LayoutPage {
            width: page_width,
            height: page_height,
            lines: std::mem::take(&mut current_lines),
        });
    }

    // Ensure at least one page
    if pages.is_empty() {
        pages.push(LayoutPage {
            width: page_width,
            height: page_height,
            lines: vec![],
        });
    }

    DocumentLayout { pages }
}

impl DocumentLayout {
    pub fn page_count(&self) -> usize {
        self.pages.len()
    }

    pub fn page(&self, index: usize) -> Option<&LayoutPage> {
        self.pages.get(index)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{Chapter, EpubDocument, Span};

    fn make_doc(blocks: Vec<Block>) -> EpubDocument {
        EpubDocument {
            title: None,
            author: None,
            chapters: vec![Chapter { blocks }],
            notes: std::collections::HashMap::new(),
        }
    }

    #[test]
    fn test_single_paragraph_layout() {
        let doc = make_doc(vec![Block::Paragraph {
            spans: vec![Span {
                text: "Hello, world!".into(),
                ..Span::default()
            }],
        }]);

        let layout = layout_document(&doc);
        assert_eq!(layout.page_count(), 1);
        assert!(!layout.pages[0].lines.is_empty());
    }

    #[test]
    fn test_empty_document_has_one_page() {
        let doc = make_doc(vec![]);
        let layout = layout_document(&doc);
        assert_eq!(layout.page_count(), 1);
    }

    #[test]
    fn test_many_paragraphs_paginate() {
        // Create enough paragraphs to force multiple pages
        let blocks: Vec<Block> = (0..100)
            .map(|i| Block::Paragraph {
                spans: vec![Span {
                    text: format!("Paragraph number {} with some text to fill the line.", i),
                    ..Span::default()
                }],
            })
            .collect();

        let doc = make_doc(blocks);
        let layout = layout_document(&doc);
        assert!(layout.page_count() > 1, "100 paragraphs should span multiple pages");
    }

    #[test]
    fn test_chapter_boundary_starts_new_page() {
        let doc = EpubDocument {
            title: None,
            author: None,
            chapters: vec![
                Chapter {
                    blocks: vec![Block::Paragraph {
                        spans: vec![Span {
                            text: "Chapter one".into(),
                            ..Span::default()
                        }],
                    }],
                },
                Chapter {
                    blocks: vec![Block::Paragraph {
                        spans: vec![Span {
                            text: "Chapter two".into(),
                            ..Span::default()
                        }],
                    }],
                },
            ],
            notes: std::collections::HashMap::new(),
        };

        let layout = layout_document(&doc);
        assert_eq!(layout.page_count(), 2);
    }
}
