//! Fixed-layout EPUB test fixture for HADDON-036.

use std::io::{Cursor, Write};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, DateTime, ZipWriter};

const MIMETYPE: &[u8] = b"application/epub+zip";

const FIXTURE_FILES: &[(&str, &[u8])] = &[
    (
        "META-INF/container.xml",
        include_bytes!("../../tests/fixtures/fixed-layout/META-INF/container.xml"),
    ),
    (
        "EPUB/package.opf",
        include_bytes!("../../tests/fixtures/fixed-layout/EPUB/package.opf"),
    ),
    (
        "EPUB/nav.xhtml",
        include_bytes!("../../tests/fixtures/fixed-layout/EPUB/nav.xhtml"),
    ),
    (
        "EPUB/images/page001.jpg",
        include_bytes!("../../tests/fixtures/fixed-layout/EPUB/images/page001.jpg"),
    ),
    (
        "EPUB/images/page002.jpg",
        include_bytes!("../../tests/fixtures/fixed-layout/EPUB/images/page002.jpg"),
    ),
    (
        "EPUB/text/page003.xhtml",
        include_bytes!("../../tests/fixtures/fixed-layout/EPUB/text/page003.xhtml"),
    ),
    (
        "EPUB/text/page004.xhtml",
        include_bytes!("../../tests/fixtures/fixed-layout/EPUB/text/page004.xhtml"),
    ),
];

/// Package the HADDON-036 fixed-layout fixture as a reproducible EPUB.
pub fn fixed_layout_epub() -> Vec<u8> {
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
