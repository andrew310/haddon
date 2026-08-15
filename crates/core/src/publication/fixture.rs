//! Project-owned citation fixture packaged as an EPUB.

use std::io::{Cursor, Write};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, DateTime, ZipWriter};

const MIMETYPE: &[u8] = b"application/epub+zip";

const FIXTURE_FILES: &[(&str, &[u8])] = &[
    (
        "META-INF/container.xml",
        include_bytes!("../../tests/fixtures/citation-roundtrip/META-INF/container.xml"),
    ),
    (
        "EPUB/package.opf",
        include_bytes!("../../tests/fixtures/citation-roundtrip/EPUB/package.opf"),
    ),
    (
        "EPUB/nav.xhtml",
        include_bytes!("../../tests/fixtures/citation-roundtrip/EPUB/nav.xhtml"),
    ),
    (
        "EPUB/text/chapter-1.xhtml",
        include_bytes!("../../tests/fixtures/citation-roundtrip/EPUB/text/chapter-1.xhtml"),
    ),
    (
        "EPUB/text/chapter-2.xhtml",
        include_bytes!("../../tests/fixtures/citation-roundtrip/EPUB/text/chapter-2.xhtml"),
    ),
    (
        "EPUB/text/notes.xhtml",
        include_bytes!("../../tests/fixtures/citation-roundtrip/EPUB/text/notes.xhtml"),
    ),
    (
        "EPUB/styles/book.css",
        include_bytes!("../../tests/fixtures/citation-roundtrip/EPUB/styles/book.css"),
    ),
    (
        "EPUB/images/compass.svg",
        include_bytes!("../../tests/fixtures/citation-roundtrip/EPUB/images/compass.svg"),
    ),
    (
        "EPUB/images/dial-fallback.svg",
        include_bytes!("../../tests/fixtures/citation-roundtrip/EPUB/images/dial-fallback.svg"),
    ),
    (
        "EPUB/data/dial.haddon",
        include_bytes!("../../tests/fixtures/citation-roundtrip/EPUB/data/dial.haddon"),
    ),
];

/// Package the HADDON-010 citation fixture as a reproducible EPUB.
pub fn citation_roundtrip_epub() -> Vec<u8> {
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
