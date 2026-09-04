use haddon_core::publication::{
    open_epub_default, BlockNode, InlineNode, NormalizationResult, TextBlockRole,
};
use std::io::{Cursor, Write};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, DateTime, ZipWriter};

const MIMETYPE: &[u8] = b"application/epub+zip";

const FIXTURE_FILES: &[(&str, &[u8])] = &[
    (
        "META-INF/container.xml",
        include_bytes!("fixtures/semantic-html/META-INF/container.xml"),
    ),
    (
        "EPUB/package.opf",
        include_bytes!("fixtures/semantic-html/EPUB/package.opf"),
    ),
    (
        "EPUB/nav.xhtml",
        include_bytes!("fixtures/semantic-html/EPUB/nav.xhtml"),
    ),
    (
        "EPUB/text/comprehensive.xhtml",
        include_bytes!("fixtures/semantic-html/EPUB/text/comprehensive.xhtml"),
    ),
];

fn build_semantic_epub() -> Vec<u8> {
    let cursor = Cursor::new(Vec::new());
    let mut writer = ZipWriter::new(cursor);
    let timestamp = DateTime::from_date_and_time(1980, 1, 1, 0, 0, 0).unwrap();
    let stored = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Stored)
        .last_modified_time(timestamp)
        .unix_permissions(0o644);
    let deflated = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .last_modified_time(timestamp)
        .unix_permissions(0o644);

    writer.start_file("mimetype", stored).unwrap();
    writer.write_all(MIMETYPE).unwrap();
    for (path, bytes) in FIXTURE_FILES {
        writer.start_file(*path, deflated).unwrap();
        writer.write_all(bytes).unwrap();
    }
    writer.finish().unwrap().into_inner()
}

#[test]
fn lists_normalize_with_structure() {
    let publication = open_epub_default(&build_semantic_epub())
        .unwrap()
        .value
        .publication;
    let resource = match publication
        .normalize("text/comprehensive.xhtml")
        .unwrap()
        .value
    {
        NormalizationResult::Normalized(resource) => resource,
        other => panic!("expected normalized, got {}", other.status()),
    };

    // Check unordered list
    let ul = resource
        .find_block("src:text/comprehensive.xhtml#unordered-list")
        .expect("unordered list");
    match ul {
        BlockNode::List {
            ordered, children, ..
        } => {
            assert!(!ordered);
            assert_eq!(children.len(), 2);
        }
        _ => panic!("expected list block"),
    }

    // Check ordered list
    let ol = resource
        .find_block("src:text/comprehensive.xhtml#ordered-list")
        .expect("ordered list");
    match ol {
        BlockNode::List {
            ordered, children, ..
        } => {
            assert!(ordered);
            assert_eq!(children.len(), 2);
        }
        _ => panic!("expected list block"),
    }
}

#[test]
fn definition_lists_normalize() {
    let publication = open_epub_default(&build_semantic_epub())
        .unwrap()
        .value
        .publication;
    let resource = match publication
        .normalize("text/comprehensive.xhtml")
        .unwrap()
        .value
    {
        NormalizationResult::Normalized(resource) => resource,
        other => panic!("expected normalized, got {}", other.status()),
    };

    // dl becomes a section; dt/dd are text blocks within it
    let _dl = resource
        .find_block("src:text/comprehensive.xhtml#definition-list")
        .expect("definition list section");

    // Check that terms and definitions are present
    let mut found_term = false;
    let mut found_def = false;
    resource.root.for_each_block(&mut |block| {
        if block.id() == "src:text/comprehensive.xhtml#term-1" {
            found_term = true;
            if let Some(text_block) = block.as_text_block() {
                assert!(matches!(text_block.role, TextBlockRole::Term));
                assert_eq!(text_block.text, "Term 1");
            }
        }
        if block.id() == "src:text/comprehensive.xhtml#def-1" {
            found_def = true;
            if let Some(text_block) = block.as_text_block() {
                assert!(matches!(text_block.role, TextBlockRole::Definition));
                assert_eq!(text_block.text, "Definition 1");
            }
        }
    });
    assert!(found_term, "term should be normalized");
    assert!(found_def, "definition should be normalized");
}

#[test]
fn tables_normalize_with_structure() {
    let publication = open_epub_default(&build_semantic_epub())
        .unwrap()
        .value
        .publication;
    let resource = match publication
        .normalize("text/comprehensive.xhtml")
        .unwrap()
        .value
    {
        NormalizationResult::Normalized(resource) => resource,
        other => panic!("expected normalized, got {}", other.status()),
    };

    let table = resource
        .find_block("src:text/comprehensive.xhtml#data-table")
        .expect("table");
    match table {
        BlockNode::Table { children, .. } => {
            assert!(!children.is_empty(), "table should have sections");
        }
        _ => panic!("expected table block"),
    }
}

#[test]
fn blockquote_with_cite_normalizes() {
    let publication = open_epub_default(&build_semantic_epub())
        .unwrap()
        .value
        .publication;
    let resource = match publication
        .normalize("text/comprehensive.xhtml")
        .unwrap()
        .value
    {
        NormalizationResult::Normalized(resource) => resource,
        other => panic!("expected normalized, got {}", other.status()),
    };

    let quote_block = resource
        .text_block("src:text/comprehensive.xhtml#block-quote")
        .expect("block quote");
    
    match &quote_block.role {
        TextBlockRole::Quote { cite } => {
            assert_eq!(
                cite.as_ref().map(|t| t.href.as_str()),
                Some("https://example.com/source")
            );
        }
        _ => panic!("expected quote text block role, got {:?}", quote_block.role),
    }
    assert_eq!(
        quote_block.text,
        "This is a block quotation with cite attribute."
    );
}

#[test]
fn inline_quote_with_cite_normalizes() {
    let publication = open_epub_default(&build_semantic_epub())
        .unwrap()
        .value
        .publication;
    let resource = match publication
        .normalize("text/comprehensive.xhtml")
        .unwrap()
        .value
    {
        NormalizationResult::Normalized(resource) => resource,
        other => panic!("expected normalized, got {}", other.status()),
    };

    let para = resource
        .text_block("src:text/comprehensive.xhtml#inline-quote-para")
        .expect("inline quote paragraph");

    let mut found_quote = false;
    for inline in &para.inlines {
        inline.walk(&mut |node| {
            if let InlineNode::Quote { cite, .. } = node {
                found_quote = true;
                assert_eq!(cite.as_deref(), Some("https://example.com/dialogue"));
            }
        });
    }
    assert!(found_quote, "should find inline quote");
}

#[test]
fn code_block_with_language_hint_normalizes() {
    let publication = open_epub_default(&build_semantic_epub())
        .unwrap()
        .value
        .publication;
    let resource = match publication
        .normalize("text/comprehensive.xhtml")
        .unwrap()
        .value
    {
        NormalizationResult::Normalized(resource) => resource,
        other => panic!("expected normalized, got {}", other.status()),
    };

    // The ID is on the <pre> element which becomes the text block
    let code_block = resource
        .text_block("src:text/comprehensive.xhtml#code-block")
        .expect("code block");

    match &code_block.role {
        TextBlockRole::Code { language_hint } => {
            assert_eq!(language_hint.as_deref(), Some("rust"));
        }
        _ => panic!("expected code block role, got {:?}", code_block.role),
    }
    assert!(code_block.text.contains("fn main()"));
}

#[test]
fn inline_code_normalizes() {
    let publication = open_epub_default(&build_semantic_epub())
        .unwrap()
        .value
        .publication;
    let resource = match publication
        .normalize("text/comprehensive.xhtml")
        .unwrap()
        .value
    {
        NormalizationResult::Normalized(resource) => resource,
        other => panic!("expected normalized, got {}", other.status()),
    };

    let para = resource
        .text_block("src:text/comprehensive.xhtml#inline-code-para")
        .expect("inline code paragraph");

    let mut found_code = false;
    for inline in &para.inlines {
        inline.walk(&mut |node| {
            if matches!(node, InlineNode::Code { .. }) {
                found_code = true;
            }
        });
    }
    assert!(found_code, "should find inline code");
}

#[test]
fn ruby_annotation_normalizes() {
    let publication = open_epub_default(&build_semantic_epub())
        .unwrap()
        .value
        .publication;
    let resource = match publication
        .normalize("text/comprehensive.xhtml")
        .unwrap()
        .value
    {
        NormalizationResult::Normalized(resource) => resource,
        other => panic!("expected normalized, got {}", other.status()),
    };

    let para = resource
        .text_block("src:text/comprehensive.xhtml#ruby-para")
        .expect("ruby paragraph");

    let mut found_ruby = false;
    for inline in &para.inlines {
        inline.walk(&mut |node| {
            if let InlineNode::Ruby {
                base_text,
                annotations,
                ..
            } = node
            {
                found_ruby = true;
                assert!(!base_text.is_empty());
                assert!(!annotations.is_empty());
            }
        });
    }
    assert!(found_ruby, "should find ruby");
}

#[test]
fn inline_semantics_normalize() {
    let publication = open_epub_default(&build_semantic_epub())
        .unwrap()
        .value
        .publication;
    let resource = match publication
        .normalize("text/comprehensive.xhtml")
        .unwrap()
        .value
    {
        NormalizationResult::Normalized(resource) => resource,
        other => panic!("expected normalized, got {}", other.status()),
    };

    let para = resource
        .text_block("src:text/comprehensive.xhtml#inline-semantics-para")
        .expect("inline semantics paragraph");

    let mut found_sub = false;
    let mut found_sup = false;
    let mut found_mark = false;
    let mut found_strike = false;

    for inline in &para.inlines {
        inline.walk(&mut |node| match node {
            InlineNode::Subscript { .. } => found_sub = true,
            InlineNode::Superscript { .. } => found_sup = true,
            InlineNode::Mark { .. } => found_mark = true,
            InlineNode::Strikethrough { .. } => found_strike = true,
            _ => {}
        });
    }

    assert!(found_sub, "should find subscript");
    assert!(found_sup, "should find superscript");
    assert!(found_mark, "should find mark");
    assert!(found_strike, "should find strikethrough");
}
