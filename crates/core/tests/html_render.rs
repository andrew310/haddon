//! HADDON-031: a normalized chapter becomes selectable semantic HTML.

use haddon_core::publication::{
    open_epub_default, render_normalized_html, NormalizationResult, Publication,
};
use std::io::{Cursor, Write};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, DateTime, ZipWriter};

const MIMETYPE: &[u8] = b"application/epub+zip";
const EXACT_QUOTE: &str = "the patient moon answered in blue";

const FIXTURE_FILES: &[(&str, &[u8])] = &[
    (
        "META-INF/container.xml",
        include_bytes!("fixtures/citation-roundtrip/META-INF/container.xml"),
    ),
    (
        "EPUB/package.opf",
        include_bytes!("fixtures/citation-roundtrip/EPUB/package.opf"),
    ),
    (
        "EPUB/nav.xhtml",
        include_bytes!("fixtures/citation-roundtrip/EPUB/nav.xhtml"),
    ),
    (
        "EPUB/text/chapter-1.xhtml",
        include_bytes!("fixtures/citation-roundtrip/EPUB/text/chapter-1.xhtml"),
    ),
    (
        "EPUB/text/chapter-2.xhtml",
        include_bytes!("fixtures/citation-roundtrip/EPUB/text/chapter-2.xhtml"),
    ),
    (
        "EPUB/text/notes.xhtml",
        include_bytes!("fixtures/citation-roundtrip/EPUB/text/notes.xhtml"),
    ),
    (
        "EPUB/styles/book.css",
        include_bytes!("fixtures/citation-roundtrip/EPUB/styles/book.css"),
    ),
    (
        "EPUB/images/compass.svg",
        include_bytes!("fixtures/citation-roundtrip/EPUB/images/compass.svg"),
    ),
    (
        "EPUB/images/dial-fallback.svg",
        include_bytes!("fixtures/citation-roundtrip/EPUB/images/dial-fallback.svg"),
    ),
    (
        "EPUB/data/dial.haddon",
        include_bytes!("fixtures/citation-roundtrip/EPUB/data/dial.haddon"),
    ),
];

fn build_epub() -> Vec<u8> {
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

fn open_book() -> Publication {
    open_epub_default(&build_epub()).unwrap().value.publication
}

fn chapter_html(href: &str) -> String {
    let book = open_book();
    let resource = match book.normalize(href).unwrap().value {
        NormalizationResult::Normalized(resource) => resource,
        other => panic!("{href} should normalize, got {}", other.status()),
    };
    render_normalized_html(&resource)
}

#[test]
fn chapter_one_is_a_semantic_article_you_can_point_at() {
    let html = chapter_html("text/chapter-1.xhtml");

    assert!(
        html.contains("<article"),
        "chapter should be a real article, got: {html}"
    );
    assert!(
        html.contains("data-haddon-id=\"src:text/chapter-1.xhtml#citation-target\""),
        "citation paragraph must keep its node id"
    );
    assert!(
        html.contains("<em") && html.contains(EXACT_QUOTE),
        "the moon quote must remain emphasized selectable text"
    );
    assert!(
        html.contains("href=\"text/chapter-2.xhtml#return-point\""),
        "internal link must stay a real anchor"
    );
    assert!(
        html.contains("alt=\"A blue compass rose pointing north\""),
        "image alt text must survive"
    );
    assert!(
        !html.contains("<script"),
        "rendered HTML must not grow a script"
    );
}

#[test]
fn notes_chapter_keeps_the_footnote_and_backlink() {
    let html = chapter_html("text/notes.xhtml");
    assert!(html.contains("data-haddon-id=\"src:text/notes.xhtml#note-1\"") || html.contains("id=\"note-1\""));
    assert!(html.contains("text/chapter-1.xhtml#noteref-1"));
}

#[test]
fn lists_and_blockquotes_render_as_lists_and_quotes() {
    let xhtml = br#"<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<body>
  <blockquote><p>Quoted sky.</p></blockquote>
  <ul><li>first</li><li>second</li></ul>
</body>
</html>"#;
    let bytes = pack_simple(xhtml);
    let book = open_epub_default(&bytes).unwrap().value.publication;
    let html = match book.normalize("text/chapter.xhtml").unwrap().value {
        NormalizationResult::Normalized(resource) => render_normalized_html(&resource),
        other => panic!("expected normalized, got {}", other.status()),
    };
    assert!(html.contains("<ul"), "lists should stay lists: {html}");
    assert!(html.contains("<li"), "{html}");
    assert!(html.contains("first") && html.contains("second"), "{html}");
    assert!(
        html.contains("<blockquote") || html.contains("Quoted sky."),
        "blockquote text should survive: {html}"
    );
}

#[test]
fn repo_epub_opens_in_the_html_pipeline() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../annas-arch-9e1f632fec5d.epub");
    let Ok(bytes) = std::fs::read(&path) else {
        return;
    };
    let book = open_epub_default(&bytes)
        .expect("real EPUB should open")
        .value
        .publication;
    let href = book
        .manifest()
        .reading_order
        .iter()
        .find(|link| link.is_linear())
        .or_else(|| book.manifest().reading_order.first())
        .expect("spine")
        .href
        .to_string();
    let html = match book.normalize(&href).unwrap().value {
        NormalizationResult::Normalized(resource) => render_normalized_html(&resource),
        other => panic!("first spine item should normalize, got {}", other.status()),
    };
    assert!(
        html.contains("<article") && html.len() > 200,
        "expected readable HTML from {href}, got {} bytes",
        html.len()
    );
}

fn pack_simple(xhtml: &[u8]) -> Vec<u8> {
    let cursor = Cursor::new(Vec::new());
    let mut writer = ZipWriter::new(cursor);
    let timestamp = DateTime::from_date_and_time(1980, 1, 1, 0, 0, 0).unwrap();
    let stored = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Stored)
        .last_modified_time(timestamp)
        .unix_permissions(0o644);
    writer.start_file("mimetype", stored).unwrap();
    writer.write_all(MIMETYPE).unwrap();
    writer.start_file("META-INF/container.xml", stored).unwrap();
    writer.write_all(br#"<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>"#).unwrap();
    writer.start_file("EPUB/package.opf", stored).unwrap();
    writer.write_all(br#"<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" unique-identifier="id" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">list</dc:identifier><dc:title>List</dc:title><dc:language>en</dc:language></metadata><manifest><item id="c" href="text/chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="c"/></spine></package>"#).unwrap();
    writer.start_file("EPUB/text/chapter.xhtml", stored).unwrap();
    writer.write_all(xhtml).unwrap();
    writer.finish().unwrap().into_inner()
}
