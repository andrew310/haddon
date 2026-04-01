#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub struct DocumentPoint {
    pub chapter_index: usize,
    pub block_index: usize,
    pub offset: usize,
}

impl DocumentPoint {
    pub fn new(chapter_index: usize, block_index: usize, offset: usize) -> Self {
        Self {
            chapter_index,
            block_index,
            offset,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DocumentRange {
    pub start: DocumentPoint,
    pub end: DocumentPoint,
}

impl DocumentRange {
    pub fn new(start: DocumentPoint, end: DocumentPoint) -> Self {
        if start <= end {
            Self { start, end }
        } else {
            Self {
                start: end,
                end: start,
            }
        }
    }

    pub fn collapsed(point: DocumentPoint) -> Self {
        Self {
            start: point.clone(),
            end: point,
        }
    }

    pub fn is_collapsed(&self) -> bool {
        self.start == self.end
    }

    pub fn contains_point(&self, point: &DocumentPoint) -> bool {
        self.start <= *point && *point <= self.end
    }

    pub fn intersects(&self, other: &DocumentRange) -> bool {
        self.start <= other.end && other.start <= self.end
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AnnotationKind {
    Footnote,
    Comment,
    Highlight,
    Summary,
    Citation,
    Entity,
    Link,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Annotation {
    pub id: String,
    pub kind: AnnotationKind,
    pub source_range: DocumentRange,
    pub title: Option<String>,
    pub content: Option<String>,
    pub href: Option<String>,
}

/// A parsed EPUB document.
pub struct EpubDocument {
    pub title: Option<String>,
    pub author: Option<String>,
    pub chapters: Vec<Chapter>,
    /// Footnote/endnote content: fragment ID → text
    pub notes: std::collections::HashMap<String, String>,
}

/// A single chapter (one XHTML spine item).
pub struct Chapter {
    pub blocks: Vec<Block>,
}

/// A block-level element.
pub enum Block {
    Heading { level: u8, spans: Vec<Span> },
    Paragraph { spans: Vec<Span> },
}

/// A run of text with uniform styling.
#[derive(Clone, Debug, PartialEq)]
pub struct Span {
    pub text: String,
    pub bold: bool,
    pub italic: bool,
    pub superscript: bool,
    pub debug_noteref_candidate: bool,
    /// Fragment ID this noteref points to (e.g. "d2")
    pub noteref_id: Option<String>,
    pub font_size: f32,
}

impl Block {
    pub fn spans(&self) -> &[Span] {
        match self {
            Block::Heading { spans, .. } => spans,
            Block::Paragraph { spans } => spans,
        }
    }

    pub fn font_size(&self) -> f32 {
        match self {
            Block::Heading { level, .. } => match level {
                1 => 28.0,
                2 => 24.0,
                3 => 20.0,
                4 => 16.0,
                5 => 14.0,
                _ => 12.0,
            },
            Block::Paragraph { .. } => 12.0,
        }
    }

    pub fn plain_text(&self) -> String {
        self.spans().iter().map(|span| span.text.as_str()).collect()
    }
}

impl EpubDocument {
    pub fn block_text(&self, chapter_index: usize, block_index: usize) -> Option<String> {
        Some(
            self.chapters
                .get(chapter_index)?
                .blocks
                .get(block_index)?
                .plain_text()
                .replace('\r', ""),
        )
    }

    pub fn extract_range_text(&self, range: &DocumentRange) -> String {
        let mut out = String::new();

        for (chapter_index, chapter) in self.chapters.iter().enumerate() {
            if chapter_index < range.start.chapter_index || chapter_index > range.end.chapter_index
            {
                continue;
            }

            for (block_index, block) in chapter.blocks.iter().enumerate() {
                if chapter_index == range.start.chapter_index
                    && block_index < range.start.block_index
                {
                    continue;
                }
                if chapter_index == range.end.chapter_index
                    && block_index > range.end.block_index
                {
                    continue;
                }

                let block_text = block.plain_text().replace('\r', "");

                let start = if chapter_index == range.start.chapter_index
                    && block_index == range.start.block_index
                {
                    range.start.offset.min(block_text.len())
                } else {
                    0
                };

                let end = if chapter_index == range.end.chapter_index
                    && block_index == range.end.block_index
                {
                    range.end.offset.min(block_text.len())
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
}

impl Default for Span {
    fn default() -> Self {
        Span {
            text: String::new(),
            bold: false,
            italic: false,
            superscript: false,
            debug_noteref_candidate: false,
            noteref_id: None,
            font_size: 12.0,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_heading_font_sizes() {
        let h1 = Block::Heading { level: 1, spans: vec![] };
        assert_eq!(h1.font_size(), 28.0);
        let h3 = Block::Heading { level: 3, spans: vec![] };
        assert_eq!(h3.font_size(), 20.0);
        let p = Block::Paragraph { spans: vec![] };
        assert_eq!(p.font_size(), 12.0);
    }

    #[test]
    fn test_block_spans() {
        let span = Span { text: "hello".into(), bold: true, ..Span::default() };
        let block = Block::Paragraph { spans: vec![span.clone()] };
        assert_eq!(block.spans(), &[span]);
    }

    #[test]
    fn test_document_range_normalizes_points() {
        let a = DocumentPoint::new(0, 3, 10);
        let b = DocumentPoint::new(0, 1, 5);
        let range = DocumentRange::new(a, b.clone());
        assert_eq!(range.start, b);
    }

    #[test]
    fn test_extract_range_text_single_block() {
        let doc = EpubDocument {
            title: None,
            author: None,
            chapters: vec![Chapter {
                blocks: vec![Block::Paragraph {
                    spans: vec![Span {
                        text: "Hello world".into(),
                        ..Span::default()
                    }],
                }],
            }],
            notes: std::collections::HashMap::new(),
        };

        let text = doc.extract_range_text(&DocumentRange::new(
            DocumentPoint::new(0, 0, 6),
            DocumentPoint::new(0, 0, 11),
        ));
        assert_eq!(text, "world");
    }
}
