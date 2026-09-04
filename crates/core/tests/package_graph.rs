use haddon_core::publication::open_epub_default;
use std::io::{Cursor, Write};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, DateTime, ZipWriter};

const MIMETYPE: &[u8] = b"application/epub+zip";

fn build_test_epub(container: &str, opf: &str, nav: Option<&str>, ncx: Option<&str>) -> Vec<u8> {
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

    writer.start_file("META-INF/container.xml", deflated).unwrap();
    writer.write_all(container.as_bytes()).unwrap();

    writer.start_file("EPUB/package.opf", deflated).unwrap();
    writer.write_all(opf.as_bytes()).unwrap();

    if let Some(nav_content) = nav {
        writer.start_file("EPUB/nav.xhtml", deflated).unwrap();
        writer.write_all(nav_content.as_bytes()).unwrap();
    }

    if let Some(ncx_content) = ncx {
        writer.start_file("EPUB/toc.ncx", deflated).unwrap();
        writer.write_all(ncx_content.as_bytes()).unwrap();
    }

    writer
        .start_file("EPUB/text/chapter-1.xhtml", deflated)
        .unwrap();
    writer
        .write_all(b"<?xml version=\"1.0\"?><html xmlns=\"http://www.w3.org/1999/xhtml\"><body><p>Chapter 1</p></body></html>")
        .unwrap();

    writer
        .start_file("EPUB/text/chapter-2.xhtml", deflated)
        .unwrap();
    writer
        .write_all(b"<?xml version=\"1.0\"?><html xmlns=\"http://www.w3.org/1999/xhtml\"><body><p>Chapter 2</p></body></html>")
        .unwrap();

    writer.finish().unwrap().into_inner()
}

#[test]
fn manifest_order_and_spine_order_remain_distinct() {
    let container = r#"<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>"#;

    let opf = r#"<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="pub-id" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">test-001</dc:identifier>
    <dc:title>Package Graph Test</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="chapter-one" href="text/chapter-1.xhtml" media-type="application/xhtml+xml"/>
    <item id="chapter-two" href="text/chapter-2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="chapter-two"/>
    <itemref idref="chapter-one"/>
  </spine>
</package>"#;

    let nav = r#"<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<body>
  <nav epub:type="toc"><ol></ol></nav>
</body>
</html>"#;

    let bytes = build_test_epub(container, opf, Some(nav), None);
    let opened = open_epub_default(&bytes).expect("test EPUB should open");
    let manifest = opened.value.publication.manifest();

    // Manifest order preserves declaration order
    assert_eq!(manifest.resources.len(), 3);
    assert_eq!(manifest.resources[0].href.as_str(), "nav.xhtml");
    assert_eq!(manifest.resources[1].href.as_str(), "text/chapter-1.xhtml");
    assert_eq!(manifest.resources[2].href.as_str(), "text/chapter-2.xhtml");

    // Spine order differs from manifest order
    assert_eq!(manifest.reading_order.len(), 2);
    assert_eq!(manifest.reading_order[0].href.as_str(), "text/chapter-2.xhtml");
    assert_eq!(manifest.reading_order[1].href.as_str(), "text/chapter-1.xhtml");
}

#[test]
fn fallback_chains_are_preserved() {
    let container = r#"<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>"#;

    let opf = r#"<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="pub-id" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">test-002</dc:identifier>
    <dc:title>Fallback Test</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="chapter-one" href="text/chapter-1.xhtml" media-type="application/xhtml+xml"/>
    <item id="exotic" href="content.exotic" media-type="application/x-exotic" fallback="fallback-1"/>
    <item id="fallback-1" href="fallback-1.xhtml" media-type="application/xhtml+xml" fallback="fallback-2"/>
    <item id="fallback-2" href="fallback-2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="chapter-one"/>
    <itemref idref="exotic"/>
  </spine>
</package>"#;

    let nav = r#"<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<body>
  <nav epub:type="toc"><ol></ol></nav>
</body>
</html>"#;

    let bytes = build_test_epub(container, opf, Some(nav), None);
    let opened = open_epub_default(&bytes).expect("test EPUB should open");
    let manifest = opened.value.publication.manifest();

    // Find the exotic item
    let exotic = manifest
        .resources
        .iter()
        .find(|link| link.href.as_str() == "content.exotic")
        .expect("exotic item should be in manifest");

    // Verify fallback is preserved
    assert_eq!(
        exotic.properties.get("epub:fallback"),
        Some(&"fallback-1".to_string())
    );

    // Find fallback-1
    let fallback1 = manifest
        .resources
        .iter()
        .find(|link| link.href.as_str() == "fallback-1.xhtml")
        .expect("fallback-1 should be in manifest");

    assert_eq!(
        fallback1.properties.get("epub:fallback"),
        Some(&"fallback-2".to_string())
    );
}

#[test]
fn fallback_cycles_are_detected_and_terminated() {
    let container = r#"<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>"#;

    // Create a cycle: item-a -> item-b -> item-c -> item-a
    let opf = r#"<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="pub-id" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">test-003</dc:identifier>
    <dc:title>Fallback Cycle Test</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="chapter-one" href="text/chapter-1.xhtml" media-type="application/xhtml+xml"/>
    <item id="item-a" href="a.exotic" media-type="application/x-exotic" fallback="item-b"/>
    <item id="item-b" href="b.exotic" media-type="application/x-exotic" fallback="item-c"/>
    <item id="item-c" href="c.exotic" media-type="application/x-exotic" fallback="item-a"/>
  </manifest>
  <spine>
    <itemref idref="chapter-one"/>
    <itemref idref="item-a"/>
  </spine>
</package>"#;

    let nav = r#"<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<body>
  <nav epub:type="toc"><ol></ol></nav>
</body>
</html>"#;

    let bytes = build_test_epub(container, opf, Some(nav), None);
    let opened = open_epub_default(&bytes).expect("EPUB with fallback cycle should open");

    // Should have a warning about the cycle
    let has_cycle_warning = opened
        .warnings
        .iter()
        .any(|w| w.code.contains("fallback-cycle"));
    assert!(
        has_cycle_warning,
        "should warn about fallback cycle, warnings: {:?}",
        opened.warnings
    );
}

#[test]
fn multiple_package_candidates_are_handled_deterministically() {
    let container = r#"<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="EPUB/package-1.opf" media-type="application/oebps-package+xml"/>
    <rootfile full-path="EPUB/package-2.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>"#;

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

    writer.start_file("META-INF/container.xml", deflated).unwrap();
    writer.write_all(container.as_bytes()).unwrap();

    let opf1 = r#"<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="pub-id" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">test-004-pkg1</dc:identifier>
    <dc:title>Package 1</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="chapter-one" href="text/chapter-1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="chapter-one"/>
  </spine>
</package>"#;

    let opf2 = r#"<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="pub-id" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">test-004-pkg2</dc:identifier>
    <dc:title>Package 2</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="chapter-two" href="text/chapter-2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="chapter-two"/>
  </spine>
</package>"#;

    let nav = r#"<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<body>
  <nav epub:type="toc"><ol></ol></nav>
</body>
</html>"#;

    writer.start_file("EPUB/package-1.opf", deflated).unwrap();
    writer.write_all(opf1.as_bytes()).unwrap();

    writer.start_file("EPUB/package-2.opf", deflated).unwrap();
    writer.write_all(opf2.as_bytes()).unwrap();

    writer.start_file("EPUB/nav.xhtml", deflated).unwrap();
    writer.write_all(nav.as_bytes()).unwrap();

    writer
        .start_file("EPUB/text/chapter-1.xhtml", deflated)
        .unwrap();
    writer
        .write_all(b"<?xml version=\"1.0\"?><html xmlns=\"http://www.w3.org/1999/xhtml\"><body><p>Chapter 1</p></body></html>")
        .unwrap();

    writer
        .start_file("EPUB/text/chapter-2.xhtml", deflated)
        .unwrap();
    writer
        .write_all(b"<?xml version=\"1.0\"?><html xmlns=\"http://www.w3.org/1999/xhtml\"><body><p>Chapter 2</p></body></html>")
        .unwrap();

    let bytes = writer.finish().unwrap().into_inner();

    let opened = open_epub_default(&bytes).expect("EPUB with multiple packages should open");

    // Should use the first package deterministically
    let manifest = opened.value.publication.manifest();
    assert_eq!(
        manifest.metadata.identifier,
        Some("test-004-pkg1".to_string())
    );

    // Should have a warning about multiple packages
    let has_multi_package_warning = opened
        .warnings
        .iter()
        .any(|w| w.code.contains("multiple-packages"));
    assert!(
        has_multi_package_warning,
        "should warn about multiple packages, warnings: {:?}",
        opened.warnings
    );
}

#[test]
fn epub2_ncx_is_parsed_and_integrated_with_nav() {
    let container = r#"<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>"#;

    let opf = r#"<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="pub-id" version="2.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">test-005</dc:identifier>
    <dc:title>EPUB 2 NCX Test</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    <item id="chapter-one" href="text/chapter-1.xhtml" media-type="application/xhtml+xml"/>
    <item id="chapter-two" href="text/chapter-2.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="chapter-one"/>
    <itemref idref="chapter-two"/>
  </spine>
</package>"#;

    let ncx = r#"<?xml version="1.0"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="test-005"/>
  </head>
  <docTitle><text>EPUB 2 NCX Test</text></docTitle>
  <navMap>
    <navPoint id="chapter1">
      <navLabel><text>First Chapter</text></navLabel>
      <content src="text/chapter-1.xhtml"/>
    </navPoint>
    <navPoint id="chapter2">
      <navLabel><text>Second Chapter</text></navLabel>
      <content src="text/chapter-2.xhtml"/>
    </navPoint>
  </navMap>
</ncx>"#;

    let bytes = build_test_epub(container, opf, None, Some(ncx));
    let opened = open_epub_default(&bytes).expect("EPUB 2 with NCX should open");
    let navigation = &opened.value.publication.manifest().navigation;

    // NCX should populate the TOC
    assert_eq!(navigation.toc.len(), 2);
    assert_eq!(
        navigation.toc[0].title.as_ref().unwrap().value,
        "First Chapter"
    );
    assert_eq!(navigation.toc[0].href.as_str(), "text/chapter-1.xhtml");
    assert_eq!(
        navigation.toc[1].title.as_ref().unwrap().value,
        "Second Chapter"
    );
    assert_eq!(navigation.toc[1].href.as_str(), "text/chapter-2.xhtml");
}

#[test]
fn rendition_hints_are_fully_preserved() {
    let container = r#"<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>"#;

    let opf = r#"<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="pub-id" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">test-006</dc:identifier>
    <dc:title>Rendition Hints Test</dc:title>
    <dc:language>en</dc:language>
    <meta property="rendition:layout">pre-paginated</meta>
    <meta property="rendition:orientation">landscape</meta>
    <meta property="rendition:spread">both</meta>
    <meta property="rendition:flow">scrolled-continuous</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="chapter-one" href="text/chapter-1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="chapter-one"/>
  </spine>
</package>"#;

    let nav = r#"<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<body>
  <nav epub:type="toc"><ol></ol></nav>
</body>
</html>"#;

    let bytes = build_test_epub(container, opf, Some(nav), None);
    let opened = open_epub_default(&bytes).expect("test EPUB should open");
    let rendition = &opened.value.publication.manifest().rendition;

    assert_eq!(rendition.layout, Some("pre-paginated".to_string()));
    assert_eq!(rendition.orientation, Some("landscape".to_string()));
    assert_eq!(rendition.spread, Some("both".to_string()));
    assert_eq!(rendition.flow, Some("scrolled-continuous".to_string()));
}
