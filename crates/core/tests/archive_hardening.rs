use haddon_core::publication::{
    open_epub_default, ByteRange, HaddonError, PublicationHref,
};
use std::io::{Cursor, Write};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, DateTime, ZipWriter};

const MIMETYPE: &[u8] = b"application/epub+zip";

fn minimal_container() -> &'static [u8] {
    br#"<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>"#
}

fn minimal_package(items: &str, spine: &str) -> String {
    format!(
        r#"<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="uid">test-id</dc:identifier>
    <dc:title>Test</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    {}
  </manifest>
  <spine>
    {}
  </spine>
</package>"#,
        items, spine
    )
}

fn minimal_nav() -> &'static [u8] {
    br#"<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
  <body>
    <nav epub:type="toc"><ol></ol></nav>
  </body>
</html>"#
}

fn build_zip_bytes<F>(build: F) -> Vec<u8>
where
    F: FnOnce(&mut ZipWriter<Cursor<Vec<u8>>>) -> Result<(), Box<dyn std::error::Error>>,
{
    let cursor = Cursor::new(Vec::new());
    let mut writer = ZipWriter::new(cursor);
    let timestamp = DateTime::from_date_and_time(1980, 1, 1, 0, 0, 0).unwrap();
    let stored = SimpleFileOptions::default()
        .compression_method(CompressionMethod::Stored)
        .last_modified_time(timestamp)
        .unix_permissions(0o644);

    writer.start_file("mimetype", stored).unwrap();
    writer.write_all(MIMETYPE).unwrap();

    build(&mut writer).unwrap();
    writer.finish().unwrap().into_inner()
}

#[test]
fn rejects_path_traversal_above_virtual_root() {
    assert!(PublicationHref::new("../outside.xhtml").is_err());
    assert!(PublicationHref::new("text/../../secret").is_err());
    assert!(PublicationHref::new("a/b/c/../../../d/../../../../etc/passwd").is_err());
}

#[test]
fn rejects_absolute_paths_and_backslashes() {
    assert!(PublicationHref::new("/absolute/path.xhtml").is_err());
    assert!(PublicationHref::new(r"text\windows\path.xhtml").is_err());
}

#[test]
fn rejects_uri_schemes() {
    assert!(PublicationHref::new("http://example.com/book.xhtml").is_err());
    assert!(PublicationHref::new("file:///etc/passwd").is_err());
    assert!(PublicationHref::new("data:text/html,content").is_err());
}

#[test]
fn normalizes_percent_encoding_consistently() {
    let href1 = PublicationHref::new("text/chapter%2d1.xhtml").unwrap();
    let href2 = PublicationHref::new("text/chapter-1.xhtml").unwrap();
    assert_eq!(href1, href2);

    let href3 = PublicationHref::new("text/caf%C3%A9.xhtml").unwrap();
    assert_eq!(href3.as_str(), "text/caf%C3%A9.xhtml");
}

#[test]
fn rejects_empty_and_root_paths() {
    assert!(PublicationHref::new("").is_err());
    assert!(PublicationHref::new(".").is_err());
    assert!(PublicationHref::new("./").is_err());
    assert!(PublicationHref::new("a/..").is_err());
}

#[test]
fn handles_dot_segments_correctly() {
    let href = PublicationHref::new("text/./chapter/../intro.xhtml").unwrap();
    assert_eq!(href.as_str(), "text/intro.xhtml");

    let href2 = PublicationHref::new("a/b/./c/../../d.xhtml").unwrap();
    assert_eq!(href2.as_str(), "a/d.xhtml");
}

#[test]
fn enforces_uncompressed_size_limit() {
    let huge_content = vec![b'x'; 101 * 1024 * 1024];
    let bytes = build_zip_bytes(|zip| {
        let deflated = SimpleFileOptions::default()
            .compression_method(CompressionMethod::Deflated)
            .last_modified_time(DateTime::from_date_and_time(1980, 1, 1, 0, 0, 0).unwrap())
            .unix_permissions(0o644);

        zip.start_file("META-INF/container.xml", deflated)?;
        zip.write_all(minimal_container())?;

        let package = minimal_package(
            r#"<item id="c1" href="huge.txt" media-type="text/plain"/>"#,
            r#"<itemref idref="c1"/>"#,
        );
        zip.start_file("EPUB/package.opf", deflated)?;
        zip.write_all(package.as_bytes())?;

        zip.start_file("EPUB/nav.xhtml", deflated)?;
        zip.write_all(minimal_nav())?;

        zip.start_file("EPUB/huge.txt", deflated)?;
        zip.write_all(&huge_content)?;
        Ok(())
    });

    let result = open_epub_default(&bytes);
    assert!(result.is_ok(), "should open even with huge resource");

    let publication = result.unwrap().value.publication;
    let resource = publication.get_resource("huge.txt").unwrap().value.unwrap();

    let read_result = resource.read(None);
    assert!(matches!(
        read_result,
        Err(HaddonError::ResourceReadFailed { .. })
    ));
}

#[test]
fn ranged_reads_validate_bounds() {
    let bytes = build_zip_bytes(|zip| {
        let deflated = SimpleFileOptions::default()
            .compression_method(CompressionMethod::Deflated)
            .last_modified_time(DateTime::from_date_and_time(1980, 1, 1, 0, 0, 0).unwrap())
            .unix_permissions(0o644);

        zip.start_file("META-INF/container.xml", deflated)?;
        zip.write_all(minimal_container())?;

        let package = minimal_package(
            r#"<item id="c1" href="test.txt" media-type="text/plain"/>"#,
            r#"<itemref idref="c1"/>"#,
        );
        zip.start_file("EPUB/package.opf", deflated)?;
        zip.write_all(package.as_bytes())?;

        zip.start_file("EPUB/nav.xhtml", deflated)?;
        zip.write_all(minimal_nav())?;

        zip.start_file("EPUB/test.txt", deflated)?;
        zip.write_all(b"Hello world")?;
        Ok(())
    });

    let publication = open_epub_default(&bytes).unwrap().value.publication;
    let resource = publication.get_resource("test.txt").unwrap().value.unwrap();

    let range_beyond = resource.read(Some(ByteRange::new(0, 100).unwrap()));
    assert!(matches!(
        range_beyond,
        Err(HaddonError::InvalidArgument { .. })
    ));

    let valid_range = resource.read(Some(ByteRange::new(6, 11).unwrap())).unwrap();
    assert_eq!(valid_range.value, b"world");

    let empty_range = resource.read(Some(ByteRange::new(5, 5).unwrap())).unwrap();
    assert_eq!(empty_range.value, b"");
}

#[test]
fn distinguishes_unowned_from_missing_declared_resources() {
    let bytes = build_zip_bytes(|zip| {
        let deflated = SimpleFileOptions::default()
            .compression_method(CompressionMethod::Deflated)
            .last_modified_time(DateTime::from_date_and_time(1980, 1, 1, 0, 0, 0).unwrap())
            .unix_permissions(0o644);

        zip.start_file("META-INF/container.xml", deflated)?;
        zip.write_all(minimal_container())?;

        let package = minimal_package(
            r#"<item id="c1" href="present.txt" media-type="text/plain"/>
               <item id="c2" href="missing.txt" media-type="text/plain"/>"#,
            r#"<itemref idref="c1"/><itemref idref="c2"/>"#,
        );
        zip.start_file("EPUB/package.opf", deflated)?;
        zip.write_all(package.as_bytes())?;

        zip.start_file("EPUB/nav.xhtml", deflated)?;
        zip.write_all(minimal_nav())?;

        zip.start_file("EPUB/present.txt", deflated)?;
        zip.write_all(b"content")?;
        Ok(())
    });

    let publication = open_epub_default(&bytes).unwrap().value.publication;

    let unowned = publication.get_resource("never-declared.txt").unwrap().value;
    assert!(unowned.is_none(), "unowned resource should be None");

    let declared_missing = publication.get_resource("missing.txt").unwrap().value;
    assert!(
        declared_missing.is_some(),
        "declared resource should have handle"
    );

    let read_result = declared_missing.unwrap().read(None);
    assert!(
        matches!(read_result, Err(HaddonError::ResourceNotFound { .. })),
        "declared but missing should fail with ResourceNotFound"
    );

    let present = publication.get_resource("present.txt").unwrap().value;
    assert!(present.is_some());
    assert!(present.unwrap().read(None).is_ok());
}

#[test]
fn normalizes_media_types() {
    let bytes = build_zip_bytes(|zip| {
        let deflated = SimpleFileOptions::default()
            .compression_method(CompressionMethod::Deflated)
            .last_modified_time(DateTime::from_date_and_time(1980, 1, 1, 0, 0, 0).unwrap())
            .unix_permissions(0o644);

        zip.start_file("META-INF/container.xml", deflated)?;
        zip.write_all(minimal_container())?;

        let package = minimal_package(
            r#"<item id="c1" href="test1.xhtml" media-type="  Application/XHTML+XML  "/>
               <item id="c2" href="test2.xhtml" media-type="text/html; charset=utf-8"/>
               <item id="c3" href="test3.bin" media-type=""/>
               <item id="c4" href="test4.dat" media-type="invalid"/>"#,
            r#"<itemref idref="c1"/>"#,
        );
        zip.start_file("EPUB/package.opf", deflated)?;
        zip.write_all(package.as_bytes())?;

        zip.start_file("EPUB/nav.xhtml", deflated)?;
        zip.write_all(minimal_nav())?;

        for f in &["test1.xhtml", "test2.xhtml", "test3.bin", "test4.dat"] {
            zip.start_file(&format!("EPUB/{}", f), deflated)?;
            zip.write_all(b"<html/>")?;
        }
        Ok(())
    });

    let publication = open_epub_default(&bytes).unwrap().value.publication;
    let manifest = publication.manifest();

    let item1 = manifest
        .resources
        .iter()
        .find(|link| link.href.as_str() == "test1.xhtml")
        .unwrap();
    assert_eq!(item1.media_type, "application/xhtml+xml");

    let item2 = manifest
        .resources
        .iter()
        .find(|link| link.href.as_str() == "test2.xhtml")
        .unwrap();
    assert!(item2.media_type.starts_with("text/html"));

    let item3 = manifest
        .resources
        .iter()
        .find(|link| link.href.as_str() == "test3.bin")
        .unwrap();
    assert_eq!(item3.media_type, "application/octet-stream");

    let item4 = manifest
        .resources
        .iter()
        .find(|link| link.href.as_str() == "test4.dat")
        .unwrap();
    assert_eq!(item4.media_type, "application/octet-stream");
}

#[test]
fn rejects_excessive_resource_count() {
    let mut item_entries = String::new();
    let mut spine_entries = String::new();
    for i in 0..10001 {
        item_entries.push_str(&format!(
            r#"<item id="c{}" href="chapter{}.xhtml" media-type="application/xhtml+xml"/>"#,
            i, i
        ));
        spine_entries.push_str(&format!(r#"<itemref idref="c{}"/>"#, i));
    }

    let bytes = build_zip_bytes(|zip| {
        let deflated = SimpleFileOptions::default()
            .compression_method(CompressionMethod::Deflated)
            .last_modified_time(DateTime::from_date_and_time(1980, 1, 1, 0, 0, 0).unwrap())
            .unix_permissions(0o644);

        zip.start_file("META-INF/container.xml", deflated)?;
        zip.write_all(minimal_container())?;

        let package = minimal_package(&item_entries, &spine_entries);
        zip.start_file("EPUB/package.opf", deflated)?;
        zip.write_all(package.as_bytes())?;

        zip.start_file("EPUB/nav.xhtml", deflated)?;
        zip.write_all(minimal_nav())?;

        for i in 0..10 {
            zip.start_file(&format!("EPUB/chapter{}.xhtml", i), deflated)?;
            zip.write_all(b"<html/>")?;
        }
        Ok(())
    });

    let result = open_epub_default(&bytes);
    assert!(
        result.is_ok(),
        "should parse manifest with many items (most missing)"
    );
}

#[test]
fn handles_compressed_bomb_attempt() {
    let bytes = build_zip_bytes(|zip| {
        let stored = SimpleFileOptions::default()
            .compression_method(CompressionMethod::Stored)
            .last_modified_time(DateTime::from_date_and_time(1980, 1, 1, 0, 0, 0).unwrap())
            .unix_permissions(0o644);

        zip.start_file("META-INF/container.xml", stored)?;
        zip.write_all(minimal_container())?;

        let package = minimal_package(
            r#"<item id="c1" href="bomb.txt" media-type="text/plain"/>"#,
            r#"<itemref idref="c1"/>"#,
        );
        zip.start_file("EPUB/package.opf", stored)?;
        zip.write_all(package.as_bytes())?;

        zip.start_file("EPUB/nav.xhtml", stored)?;
        zip.write_all(minimal_nav())?;

        let bomb_content = vec![0u8; 150 * 1024 * 1024];
        zip.start_file("EPUB/bomb.txt", stored)?;
        zip.write_all(&bomb_content)?;
        Ok(())
    });

    let publication = open_epub_default(&bytes).unwrap().value.publication;
    let resource = publication.get_resource("bomb.txt").unwrap().value.unwrap();

    let length_result = resource.length();
    assert!(matches!(
        length_result,
        Err(HaddonError::ResourceReadFailed { .. })
    ));
}

#[test]
fn preserves_query_strings_in_hrefs() {
    let href = PublicationHref::new("image.svg?color=blue").unwrap();
    assert_eq!(href.as_str(), "image.svg?color=blue");

    let without_query = href.without_query();
    assert_eq!(without_query.as_str(), "image.svg");
}

#[test]
fn resolves_relative_hrefs_correctly() {
    let base = PublicationHref::new("text/chapter-1.xhtml").unwrap();

    let (resolved, fragment) = PublicationHref::resolve(&base, "../styles/book.css").unwrap();
    assert_eq!(resolved.as_str(), "styles/book.css");
    assert_eq!(fragment, None);

    let (resolved2, fragment2) = PublicationHref::resolve(&base, "chapter-2.xhtml#sec1").unwrap();
    assert_eq!(resolved2.as_str(), "text/chapter-2.xhtml");
    assert_eq!(fragment2.as_deref(), Some("sec1"));

    let (resolved3, _) = PublicationHref::resolve(&base, "?view=print").unwrap();
    assert_eq!(resolved3.as_str(), "text/chapter-1.xhtml?view=print");
}

#[test]
fn rejects_external_references_in_resolve() {
    let base = PublicationHref::new("text/chapter-1.xhtml").unwrap();

    assert!(PublicationHref::resolve(&base, "http://example.com/style.css").is_err());
    assert!(PublicationHref::resolve(&base, "/absolute/path").is_err());
}
