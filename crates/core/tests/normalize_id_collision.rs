use haddon_core::publication::{open_epub_default, NormalizationResult};
use std::io::{Cursor, Write};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, DateTime, ZipWriter};

const MIMETYPE: &[u8] = b"application/epub+zip";

/// Test that nested wrappers with missing IDs don't produce colliding node IDs.
/// This simulates a cover or chapter where multiple divs/sections wrap content
/// without unique IDs, causing the same structural path + kind + nearest_id.
#[test]
fn nested_wrappers_without_ids_should_not_collide() {
    let epub = build_collision_fixture();
    let publication = open_epub_default(&epub).unwrap().value.publication;
    
    // This should normalize successfully without collision errors
    let result = publication.normalize("text/content.xhtml");
    assert!(result.is_ok(), "Normalization should not fail: {:?}", result.err());
    
    let normalized = match result.unwrap().value {
        NormalizationResult::Normalized(resource) => resource,
        other => panic!("Expected normalized resource, got {}", other.status()),
    };
    
    // Verify we have a document with sections
    assert_eq!(normalized.href, "text/content.xhtml");
    
    // All node IDs should be unique
    let mut node_ids = std::collections::HashSet::new();
    let mut duplicate_found = false;
    normalized.root.for_each_block(&mut |block| {
        let id = &block.base().id;
        if !node_ids.insert(id.clone()) {
            eprintln!("ERROR: Duplicate node ID found: {}", id);
            duplicate_found = true;
        }
    });
    
    assert!(!duplicate_found, "Found duplicate node IDs");
    
    // Verify that if there were any collisions, they were disambiguated
    // Disambiguated IDs have the format "n1:hash~counter"
    let disambiguated_count = node_ids.iter().filter(|id| id.contains('~')).count();
    if disambiguated_count > 0 {
        println!("Note: {} IDs were disambiguated with counters", disambiguated_count);
    }
}

/// Test similar structure but with sibling divs instead of nested
#[test]
fn sibling_wrappers_without_ids_should_not_collide() {
    let epub = build_sibling_fixture();
    let publication = open_epub_default(&epub).unwrap().value.publication;
    
    let result = publication.normalize("text/content.xhtml");
    assert!(result.is_ok(), "Normalization should not fail with siblings");
    
    let normalized = match result.unwrap().value {
        NormalizationResult::Normalized(resource) => resource,
        other => panic!("Expected normalized resource, got {}", other.status()),
    };
    
    assert_eq!(normalized.href, "text/content.xhtml");
    
    let mut node_ids = std::collections::HashSet::new();
    normalized.root.for_each_block(&mut |block| {
        let id = &block.base().id;
        assert!(
            node_ids.insert(id.clone()),
            "Duplicate node ID found in siblings: {}",
            id
        );
    });
}

fn build_collision_fixture() -> Vec<u8> {
    let container = br#"<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>"#;

    let package = br#"<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="pub-id" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">urn:uuid:collision-test</dc:identifier>
    <dc:title>Collision Test</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="content" href="text/content.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="content"/>
  </spine>
</package>"#;

    // Real collision scenario from EPUBs in the wild:
    // Cover pages often have wrapper divs without IDs.
    // If structural indexing is broken, we can get collisions.
    let xhtml = br#"<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
  <body>
    <div class="cover">
      <div class="image-wrapper">
        <p>Title Page</p>
      </div>
    </div>
    <div class="cover-back">
      <div class="image-wrapper">
        <p>Credits</p>
      </div>
    </div>
  </body>
</html>"#;

    build_epub_from_parts(container, package, xhtml)
}

fn build_sibling_fixture() -> Vec<u8> {
    let container = br#"<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>"#;

    let package = br#"<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="pub-id" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">urn:uuid:sibling-test</dc:identifier>
    <dc:title>Sibling Test</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="content" href="text/content.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="content"/>
  </spine>
</package>"#;

    // Multiple sections with same structure but no IDs
    let xhtml = br#"<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
  <body>
    <section>
      <p>First section paragraph</p>
    </section>
    <section>
      <p>Second section paragraph</p>
    </section>
    <section>
      <p>Third section paragraph</p>
    </section>
  </body>
</html>"#;

    build_epub_from_parts(container, package, xhtml)
}

fn build_epub_from_parts(container: &[u8], package: &[u8], xhtml: &[u8]) -> Vec<u8> {
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
    writer
        .start_file("EPUB/text/content.xhtml", deflated)
        .unwrap();
    writer.write_all(xhtml).unwrap();
    
    writer.finish().unwrap().into_inner()
}
