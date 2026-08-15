use haddon_core::epub::parse_epub;
use std::io::{Cursor, Read, Write};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, DateTime, ZipArchive, ZipWriter};

const MIMETYPE: &[u8] = b"application/epub+zip";
const QUOTE_PREFIX: &str = "Before the signal, the copper astrolabe clicked once; ";
const EXACT_QUOTE: &str = "the patient moon answered in blue";
const QUOTE_SUFFIX: &str = ", and the lesson continued after midnight.";

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
    let timestamp = DateTime::from_date_and_time(1980, 1, 1, 0, 0, 0)
        .expect("the ZIP epoch is a valid timestamp");
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

fn fixture_text(path: &str) -> &'static str {
    let bytes = FIXTURE_FILES
        .iter()
        .find_map(|(candidate, bytes)| (*candidate == path).then_some(*bytes))
        .unwrap_or_else(|| panic!("missing fixture source: {path}"));
    std::str::from_utf8(bytes).expect("fixture text is UTF-8")
}

#[test]
fn packages_a_reproducible_epub_with_the_required_mimetype_entry() {
    let first = build_epub();
    let second = build_epub();
    assert_eq!(
        first, second,
        "fixed file order and metadata must be reproducible"
    );

    let mut archive = ZipArchive::new(Cursor::new(first)).unwrap();
    assert_eq!(archive.len(), FIXTURE_FILES.len() + 1);

    let mut mimetype = archive.by_index(0).unwrap();
    assert_eq!(mimetype.name(), "mimetype");
    assert_eq!(mimetype.compression(), CompressionMethod::Stored);
    let mut value = Vec::new();
    mimetype.read_to_end(&mut value).unwrap();
    assert_eq!(value, MIMETYPE);
    drop(mimetype);

    for index in 1..archive.len() {
        let entry = archive.by_index(index).unwrap();
        assert_eq!(entry.compression(), CompressionMethod::Deflated);
        assert_eq!(entry.name(), FIXTURE_FILES[index - 1].0);
    }
}

#[test]
fn source_tree_covers_the_citation_and_publication_contract() {
    let package = fixture_text("EPUB/package.opf");
    assert_eq!(package.matches("<itemref ").count(), 3);
    assert_eq!(package.matches("linear=\"no\"").count(), 1);
    assert!(package.contains("fallback=\"dial-image\""));

    let nav = fixture_text("EPUB/nav.xhtml");
    assert!(nav.contains("epub:type=\"toc\""));
    assert!(nav.contains("epub:type=\"landmarks\""));
    assert!(nav.contains("epub:type=\"page-list\""));
    assert!(nav.contains("<ol>\n            <li><a href=\"text/chapter-1.xhtml#citation-target\""));

    let chapter_one = fixture_text("EPUB/text/chapter-1.xhtml");
    let citation = format!("{QUOTE_PREFIX}<em>{EXACT_QUOTE}</em>{QUOTE_SUFFIX}");
    assert!(chapter_one.contains(&citation));
    assert!(chapter_one.contains("xml:lang=\"el\" lang=\"el\""));
    assert!(chapter_one.contains("alt=\"A blue compass rose pointing north\""));
    assert!(chapter_one.contains("href=\"chapter-2.xhtml#return-point\""));
    assert!(chapter_one.contains("href=\"notes.xhtml#note-1\""));

    let notes = fixture_text("EPUB/text/notes.xhtml");
    assert!(notes.contains("id=\"note-1\""));
    assert!(notes.contains("href=\"chapter-1.xhtml#noteref-1\""));
}

#[test]
fn current_parser_opens_the_fixture_and_preserves_supported_content() {
    let document = parse_epub(&build_epub()).expect("fixture should be accepted by parse_epub");

    assert_eq!(document.title.as_deref(), Some("Citation Round Trip"));
    assert_eq!(document.author.as_deref(), Some("Haddon Fixtures"));
    assert!(document.chapters.len() >= 2);
    assert_eq!(
        document.chapters[0].blocks[0].plain_text(),
        "The Brass Observatory"
    );
    assert_eq!(document.chapters[1].blocks[0].plain_text(), "The Return");

    let citation_block = document.chapters[0]
        .blocks
        .iter()
        .find(|block| block.plain_text().contains(EXACT_QUOTE))
        .expect("normalized citation block");
    assert_eq!(
        citation_block.plain_text(),
        format!("{QUOTE_PREFIX}{EXACT_QUOTE}{QUOTE_SUFFIX}")
    );
    let emphasized_quote = citation_block
        .spans()
        .iter()
        .find(|span| span.text == EXACT_QUOTE)
        .expect("emphasized quote span");
    assert!(emphasized_quote.italic);

    assert_eq!(
        document.notes.get("note-1").map(String::as_str),
        Some("1 The Greek word means order, world, or ornament in this invented lesson.")
    );
    let note_marker = document.chapters[0]
        .blocks
        .iter()
        .flat_map(|block| block.spans())
        .find(|span| span.noteref_id.as_deref() == Some("note-1"))
        .expect("normalized note reference");
    assert_eq!(note_marker.text, "1");
    assert!(note_marker.superscript);
}
