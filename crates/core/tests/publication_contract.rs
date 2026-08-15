use haddon_core::publication::{
    open_epub, open_epub_default, ByteRange, CapabilityAvailability, Completeness, HaddonError,
    OpenMode, OpenOptions, OpenStatus, OwnerKind, PublicationHref, ServiceKind, Stage,
};
use std::io::{Cursor, Write};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, DateTime, ZipWriter};

const MIMETYPE: &[u8] = b"application/epub+zip";
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

fn build_epub(omit: Option<&str>) -> Vec<u8> {
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
        if omit == Some(*path) {
            continue;
        }
        writer.start_file(*path, deflated).unwrap();
        writer.write_all(bytes).unwrap();
    }
    writer.finish().unwrap().into_inner()
}

#[test]
fn opens_canonical_manifest_without_erasing_nonlinear_spine_resources() {
    let bytes = build_epub(None);
    let opened = open_epub_default(&bytes).expect("fixture publication should open");
    assert_eq!(opened.completeness, Completeness::Complete);
    assert_eq!(opened.value.open_status, OpenStatus::Complete);

    let publication = opened.value.publication;
    let manifest = publication.manifest();
    assert_eq!(
        manifest
            .metadata
            .title
            .as_ref()
            .map(|title| title.value.as_str()),
        Some("Citation Round Trip")
    );
    assert_eq!(manifest.metadata.creator(), Some("Haddon Fixtures"));
    assert_eq!(manifest.metadata.languages, ["en"]);

    assert_eq!(manifest.reading_order.len(), 3);
    assert_eq!(manifest.linear_reading_order().count(), 2);
    let notes = manifest
        .reading_order
        .iter()
        .find(|link| link.href.as_str() == "text/notes.xhtml")
        .expect("nonlinear notes remain in source spine order");
    assert_eq!(notes.linear, Some(false));
    assert_eq!(manifest.resources.len(), 8);
    assert!(publication
        .get_resource("text/notes.xhtml#note-1")
        .unwrap()
        .value
        .is_some());
}

#[test]
fn preserves_toc_landmarks_and_page_list_hierarchy() {
    let bytes = build_epub(None);
    let publication = open_epub_default(&bytes).unwrap().value.publication;
    let navigation = &publication.manifest().navigation;

    assert_eq!(navigation.toc.len(), 2);
    assert_eq!(
        navigation.toc[0].title.as_ref().unwrap().value,
        "The Brass Observatory"
    );
    assert_eq!(navigation.toc[0].children.len(), 1);
    assert_eq!(
        navigation.toc[0].children[0].fragment.as_deref(),
        Some("citation-target")
    );
    assert_eq!(navigation.landmarks.len(), 2);
    assert!(navigation.landmarks[0].rels.contains("bodymatter"));
    assert_eq!(navigation.page_list.len(), 2);
    assert_eq!(navigation.page_list[1].title.as_ref().unwrap().value, "2");
}

#[test]
fn resource_handles_read_full_and_half_open_ranges_independently() {
    let bytes = build_epub(None);
    let publication = open_epub_default(&bytes).unwrap().value.publication;
    let first = publication
        .get_resource("text/chapter-1.xhtml")
        .unwrap()
        .value
        .unwrap();
    let second = publication
        .get_resource("text/chapter-1.xhtml")
        .unwrap()
        .value
        .unwrap();

    let expected = FIXTURE_FILES
        .iter()
        .find(|(path, _)| *path == "EPUB/text/chapter-1.xhtml")
        .unwrap()
        .1;
    assert_eq!(first.length().unwrap().value, Some(expected.len() as u64));
    assert_eq!(
        first
            .read(Some(ByteRange::new(6, 27).unwrap()))
            .unwrap()
            .value,
        expected[6..27]
    );

    first.close().unwrap();
    assert!(first.is_closed());
    assert_eq!(second.read(None).unwrap().value, expected);
    assert!(!second.is_closed());
}

#[test]
fn distinguishes_unowned_from_declared_but_missing_resources() {
    let bytes = build_epub(Some("EPUB/data/dial.haddon"));
    let publication = open_epub_default(&bytes).unwrap().value.publication;

    assert!(publication
        .get_resource("text/not-declared.xhtml")
        .unwrap()
        .value
        .is_none());

    let declared = publication
        .get_resource("data/dial.haddon")
        .unwrap()
        .value
        .expect("the declared resource has a lazy handle");
    assert!(matches!(
        declared.read(None),
        Err(HaddonError::ResourceNotFound { href }) if href.as_str() == "data/dial.haddon"
    ));
}

#[test]
fn all_standard_optional_services_are_explicitly_unavailable() {
    let bytes = build_epub(None);
    let publication = open_epub_default(&bytes).unwrap().value.publication;
    assert_eq!(publication.capabilities().len(), ServiceKind::ALL.len());
    for kind in ServiceKind::ALL {
        let descriptor = publication.capability(kind);
        if matches!(kind, ServiceKind::Normalization | ServiceKind::Locator) {
            assert_ne!(descriptor.availability, CapabilityAvailability::Unavailable);
            assert!(publication.has_service(kind));
        } else {
            assert_eq!(descriptor.availability, CapabilityAvailability::Unavailable);
            assert!(!publication.has_service(kind));
        }
        assert!(!descriptor.version.is_empty());
        assert!(!descriptor.limitations.is_empty());
    }
}

#[test]
fn recover_and_strict_open_distinguish_omitted_navigation() {
    let bytes = build_epub(Some("EPUB/nav.xhtml"));
    let recovered = open_epub_default(&bytes).expect("recover mode keeps a stable manifest");
    assert_eq!(recovered.completeness, Completeness::Partial);
    assert_eq!(recovered.value.open_status, OpenStatus::Partial);
    assert_eq!(recovered.warnings.len(), 1);
    assert_eq!(
        recovered.warnings[0].code,
        "haddon.manifest.navigation-omitted"
    );

    let strict = open_epub(
        &bytes,
        OpenOptions {
            mode: OpenMode::Strict,
            ..OpenOptions::default()
        },
    );
    assert!(matches!(
        strict,
        Err(HaddonError::FormatInvalid {
            stage: Stage::Open,
            ..
        })
    ));
}

#[test]
fn close_is_idempotent_and_invalidates_publication_and_descendants() {
    let bytes = build_epub(None);
    let publication = open_epub_default(&bytes).unwrap().value.publication;
    let resource = publication
        .get_resource("text/chapter-1.xhtml")
        .unwrap()
        .value
        .unwrap();

    publication.close().unwrap();
    publication.close().unwrap();
    assert!(publication.is_closed());
    assert!(resource.is_closed());
    assert!(matches!(
        resource.length(),
        Err(HaddonError::Closed {
            stage: Stage::Resource,
            owner: OwnerKind::Publication,
        })
    ));
    assert!(matches!(
        publication.get_resource("text/chapter-2.xhtml"),
        Err(HaddonError::Closed {
            stage: Stage::Resource,
            owner: OwnerKind::Publication,
        })
    ));
    assert!(matches!(
        publication.parse_legacy_document(),
        Err(HaddonError::Closed {
            stage: Stage::Normalize,
            owner: OwnerKind::Publication,
        })
    ));
}

#[test]
fn legacy_epub_document_remains_an_explicit_compatibility_path() {
    let bytes = build_epub(None);
    let publication = open_epub_default(&bytes).unwrap().value.publication;
    let document = publication.parse_legacy_document().unwrap().value;
    assert_eq!(document.title.as_deref(), Some("Citation Round Trip"));
    assert_eq!(document.author.as_deref(), Some("Haddon Fixtures"));
    assert!(document.chapters.len() >= 2);
}

#[test]
fn identity_is_stable_sha256_and_hrefs_reject_root_traversal() {
    let bytes = build_epub(None);
    let first = open_epub_default(&bytes).unwrap().value.publication;
    let second = open_epub(&bytes, OpenOptions::default())
        .unwrap()
        .value
        .publication;
    assert_eq!(first.identity(), second.identity());
    assert_eq!(first.identity().source_revision.len(), 64);
    assert!(first.identity().volume_id.starts_with("haddon:sha256:"));
    assert!(PublicationHref::new("../../outside.xhtml").is_err());
    assert!(matches!(
        first.get_resource("../../outside.xhtml"),
        Err(HaddonError::InvalidArgument { .. })
    ));
}
