/// A parsed EPUB document.
pub struct EpubDocument {
    pub title: Option<String>,
    pub author: Option<String>,
    pub chapters: Vec<Chapter>,
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
}

impl Default for Span {
    fn default() -> Self {
        Span {
            text: String::new(),
            bold: false,
            italic: false,
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
        let span = Span { text: "hello".into(), bold: true, italic: false, font_size: 12.0 };
        let block = Block::Paragraph { spans: vec![span.clone()] };
        assert_eq!(block.spans(), &[span]);
    }
}
