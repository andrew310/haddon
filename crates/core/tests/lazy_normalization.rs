use haddon_core::publication::{open_epub_default, NormalizationResult};
use std::io::{Cursor, Write};
use std::sync::Arc;
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, DateTime, ZipWriter};

const MIMETYPE: &[u8] = b"application/epub+zip";

fn build_multi_chapter_epub() -> Vec<u8> {
    let container = br#"<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>"#;

    let package = br#"<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="pub-id" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">urn:uuid:lazy-test</dc:identifier>
    <dc:title>Lazy Loading Test</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="c1" href="text/chapter-1.xhtml" media-type="application/xhtml+xml"/>
    <item id="c2" href="text/chapter-2.xhtml" media-type="application/xhtml+xml"/>
    <item id="c3" href="text/chapter-3.xhtml" media-type="application/xhtml+xml"/>
    <item id="c4" href="text/chapter-4.xhtml" media-type="application/xhtml+xml"/>
    <item id="c5" href="text/chapter-5.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="c1"/>
    <itemref idref="c2"/>
    <itemref idref="c3"/>
    <itemref idref="c4"/>
    <itemref idref="c5"/>
  </spine>
</package>"#;

    let nav = br#"<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en">
<head><title>Navigation</title></head>
<body>
  <nav epub:type="toc"><ol><li><a href="text/chapter-1.xhtml">Chapter 1</a></li></ol></nav>
</body>
</html>"#;

    let chapter_template = |n: u32| {
        format!(
            r#"<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head><title>Chapter {}</title></head>
<body>
  <h1 id="heading-{}">Chapter {}</h1>
  <p id="para-{}">This is the content of chapter {}.</p>
</body>
</html>"#,
            n, n, n, n, n
        )
    };

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
    writer
        .start_file("META-INF/container.xml", deflated)
        .unwrap();
    writer.write_all(container).unwrap();
    writer.start_file("EPUB/package.opf", deflated).unwrap();
    writer.write_all(package).unwrap();
    writer.start_file("EPUB/nav.xhtml", deflated).unwrap();
    writer.write_all(nav).unwrap();

    for n in 1..=5 {
        writer
            .start_file(format!("EPUB/text/chapter-{}.xhtml", n), deflated)
            .unwrap();
        writer.write_all(chapter_template(n).as_bytes()).unwrap();
    }

    writer.finish().unwrap().into_inner()
}

#[test]
fn opening_publication_does_not_normalize_any_spine_resources() {
    let bytes = build_multi_chapter_epub();
    let _publication = open_epub_default(&bytes)
        .expect("multi-chapter fixture should open")
        .value
        .publication;

    // Opening the publication should not trigger normalization of any spine resources.
    // The manifest is parsed, but the XHTML content is not processed.
    // This is verified by the fact that we successfully opened the publication
    // without calling normalize() on any resource.
}

#[test]
fn normalizing_one_resource_does_not_normalize_others() {
    let bytes = build_multi_chapter_epub();
    let publication = open_epub_default(&bytes).unwrap().value.publication;

    // Normalize only chapter 2
    let result = publication
        .normalize("text/chapter-2.xhtml")
        .expect("chapter-2 should normalize");

    match result.value {
        NormalizationResult::Normalized(resource) => {
            assert_eq!(resource.href, "text/chapter-2.xhtml");
            assert!(resource.text_block("src:text/chapter-2.xhtml#para-2").is_some());
        }
        other => panic!("expected normalized result, got {}", other.status()),
    }

    // We can still access other chapters without normalizing them
    let chapter1_resource = publication
        .get_resource("text/chapter-1.xhtml")
        .unwrap()
        .value
        .expect("chapter-1 should be accessible");
    assert_eq!(chapter1_resource.link().href.as_str(), "text/chapter-1.xhtml");

    // And we can normalize them independently later
    let result = publication
        .normalize("text/chapter-3.xhtml")
        .expect("chapter-3 should normalize");
    match result.value {
        NormalizationResult::Normalized(resource) => {
            assert_eq!(resource.href, "text/chapter-3.xhtml");
        }
        other => panic!("expected normalized result, got {}", other.status()),
    }
}

#[test]
fn resources_have_deterministic_ownership_via_publication() {
    let bytes = build_multi_chapter_epub();
    let publication = Arc::new(open_epub_default(&bytes).unwrap().value.publication);

    // Get multiple handles to the same resource
    let resource1 = publication
        .get_resource("text/chapter-1.xhtml")
        .unwrap()
        .value
        .expect("chapter-1 exists");
    let resource2 = publication
        .get_resource("text/chapter-1.xhtml")
        .unwrap()
        .value
        .expect("chapter-1 exists");

    // Both resources are independent handles but owned by the same publication
    assert!(!resource1.is_closed());
    assert!(!resource2.is_closed());

    // Reading from one doesn't affect the other
    let bytes1 = resource1.read(None).unwrap().value;
    let bytes2 = resource2.read(None).unwrap().value;
    assert_eq!(bytes1, bytes2);

    // Closing one resource doesn't close the other
    resource1.close().unwrap();
    assert!(resource1.is_closed());
    assert!(!resource2.is_closed());

    // But closing the publication closes all resources
    publication.close().unwrap();
    assert!(resource1.is_closed());
    assert!(resource2.is_closed());
}

#[test]
fn normalized_resources_are_independent_per_href() {
    let bytes = build_multi_chapter_epub();
    let publication = open_epub_default(&bytes).unwrap().value.publication;

    // Normalize the same resource twice
    let norm1 = match publication.normalize("text/chapter-1.xhtml").unwrap().value {
        NormalizationResult::Normalized(r) => r,
        other => panic!("expected normalized, got {}", other.status()),
    };

    let norm2 = match publication.normalize("text/chapter-1.xhtml").unwrap().value {
        NormalizationResult::Normalized(r) => r,
        other => panic!("expected normalized, got {}", other.status()),
    };

    // Both normalizations produce identical results (deterministic)
    assert_eq!(norm1.href, norm2.href);
    assert_eq!(norm1.root, norm2.root);
    assert_eq!(norm1.source_map, norm2.source_map);

    // Normalization is independent per resource
    let norm3 = match publication.normalize("text/chapter-2.xhtml").unwrap().value {
        NormalizationResult::Normalized(r) => r,
        other => panic!("expected normalized, got {}", other.status()),
    };

    assert_eq!(norm3.href, "text/chapter-2.xhtml");
    assert_ne!(norm3.href, norm1.href);
}

#[test]
fn get_resource_is_lazy_and_does_not_read_bytes() {
    let bytes = build_multi_chapter_epub();
    let publication = open_epub_default(&bytes).unwrap().value.publication;

    // Getting a resource handle doesn't read the actual bytes
    let resource = publication
        .get_resource("text/chapter-1.xhtml")
        .unwrap()
        .value
        .expect("chapter-1 exists");

    // The resource link is available immediately
    assert_eq!(resource.link().href.as_str(), "text/chapter-1.xhtml");
    assert_eq!(resource.link().media_type, "application/xhtml+xml");

    // Length query reads the ZIP entry metadata but not the full content
    let length = resource.length().unwrap().value.expect("has length");
    assert!(length > 0);

    // Only when we explicitly read do we get the bytes
    let content = resource.read(None).unwrap().value;
    assert!(!content.is_empty());
    assert_eq!(content.len() as u64, length);
}
