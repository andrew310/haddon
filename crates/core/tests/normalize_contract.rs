use haddon_core::publication::normalize::NodeSourceEvidence;
use haddon_core::publication::{
    open_epub_default, project_inlines, AsideDisposition, BlockNode, CapabilityAvailability,
    InlineNode, MappingResult, NormalizationResult, NoteKind, SemanticRole, ServiceKind,
    SourceNodeRef, TextBlockRole, TextTransform, UnmappedReason,
};
use std::io::{Cursor, Write};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, DateTime, ZipWriter};

const MIMETYPE: &[u8] = b"application/epub+zip";
const QUOTE_PREFIX: &str = "Before the signal, the copper astrolabe clicked once; ";
const EXACT_QUOTE: &str = "the patient moon answered in blue";
const QUOTE_SUFFIX: &str = ", and the lesson continued after midnight.";
const CITATION_TEXT: &str = "Before the signal, the copper astrolabe clicked once; the patient moon answered in blue, and the lesson continued after midnight.";
const CITATION_ID: &str = "src:text/chapter-1.xhtml#citation-target";
const LANGUAGE_ID: &str = "src:text/chapter-1.xhtml#language-and-note";

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

fn open_fixture() -> haddon_core::publication::Publication {
    open_epub_default(&build_epub()).unwrap().value.publication
}

fn normalize_chapter_one() -> haddon_core::publication::NormalizedResource {
    let publication = open_fixture();
    match publication.normalize("text/chapter-1.xhtml").unwrap().value {
        NormalizationResult::Normalized(resource) => resource,
        other => panic!("expected normalized chapter, got {}", other.status()),
    }
}

#[test]
fn get_resource_then_normalize_does_not_require_the_rest_of_the_spine() {
    let publication = open_fixture();
    let resource = publication
        .get_resource("text/chapter-1.xhtml")
        .unwrap()
        .value
        .expect("chapter-1 is an owned resource");
    assert_eq!(resource.link().href.as_str(), "text/chapter-1.xhtml");

    let normalized = publication
        .normalize("text/chapter-1.xhtml")
        .unwrap()
        .value
        .as_normalized()
        .expect("chapter-1 is XHTML")
        .clone();
    assert_eq!(normalized.href, "text/chapter-1.xhtml");
    assert!(normalized.text_block(CITATION_ID).is_some());
    assert!(publication
        .get_resource("text/chapter-2.xhtml")
        .unwrap()
        .value
        .is_some());
}

#[test]
fn citation_paragraph_matches_fixture_facts() {
    let resource = normalize_chapter_one();
    let block = resource
        .text_block(CITATION_ID)
        .expect("citation paragraph");
    assert!(matches!(block.role, TextBlockRole::Paragraph));
    assert_eq!(block.text, CITATION_TEXT);
    assert_eq!(block.utf16_len(), 129);
    assert_eq!(block.slice(54, 87).as_deref(), Some(EXACT_QUOTE));
    assert_eq!(
        format!("{QUOTE_PREFIX}{EXACT_QUOTE}{QUOTE_SUFFIX}"),
        CITATION_TEXT
    );

    let (start, end) = block
        .range_of(|inline| matches!(inline, InlineNode::Emphasis { .. }))
        .expect("emphasis inline");
    assert_eq!((start, end), (54, 87));
}

#[test]
fn citation_source_map_is_three_identity_segments_and_round_trips() {
    let resource = normalize_chapter_one();
    resource
        .assert_complete_normalized_coverage()
        .expect("every utf16 unit is covered once");

    let segments = resource.covering_text_segments(CITATION_ID);
    assert_eq!(segments.len(), 3);
    assert_eq!(
        segments
            .iter()
            .map(|(start, end, transform, _)| (*start, *end, *transform))
            .collect::<Vec<_>>(),
        [
            (0, 54, TextTransform::Identity),
            (54, 87, TextTransform::Identity),
            (87, 129, TextTransform::Identity),
        ]
    );

    let mapped = resource.map_normalized_range(CITATION_ID, 54, 87);
    let (span, _) = match mapped {
        MappingResult::Exact { value, segments } => (value, segments),
        other => panic!("expected exact mapping, got {}", other.status()),
    };
    assert_eq!(
        resource.text_slice(CITATION_ID, 54, 87).as_deref(),
        Some(EXACT_QUOTE)
    );

    let back = resource.map_source_range(&span);
    let (range, _) = match back {
        MappingResult::Exact { value, segments } => (value, segments),
        other => panic!("expected exact reverse mapping, got {}", other.status()),
    };
    assert_eq!(range.start.offset.value, 54);
    assert_eq!(range.end.offset.value, 87);
    assert_eq!(range.block_id(), CITATION_ID);
    assert_eq!(span.parts.len(), 1);
}

#[test]
fn language_span_and_note_reference_survive() {
    let resource = normalize_chapter_one();
    let block = resource
        .text_block(LANGUAGE_ID)
        .expect("language-and-note paragraph");
    assert!(block.text.ends_with("later.1"));
    assert!(!block.text.contains("later. 1"));

    let (start, end) = block
        .range_of(|inline| {
            matches!(
                inline,
                InlineNode::Span { base, .. } if base.language.as_deref() == Some("el")
            )
        })
        .expect("Greek language span");
    assert_eq!((start, end), (24, 30));
    assert_eq!(block.slice(start, end).as_deref(), Some("κόσμος"));

    let (start, end) = block
        .range_of(|inline| matches!(inline, InlineNode::NoteReference { .. }))
        .expect("note reference");
    assert_eq!(block.slice(start, end).as_deref(), Some("1"));

    let mut found = None;
    for inline_walk in &block.inlines {
        inline_walk.walk(&mut |inline| {
            if let InlineNode::NoteReference {
                base,
                target,
                note_kind,
                children,
            } = inline
            {
                found = Some((
                    target.href.clone(),
                    *note_kind,
                    project_child_text(children),
                    base.id.clone(),
                    match &base.source {
                        NodeSourceEvidence::Source {
                            primary: SourceNodeRef::Element(element),
                            ..
                        } => element.fragment.clone(),
                        _ => None,
                    },
                ));
            }
        });
    }
    let (href, kind, text, id, fragment) = found.expect("noteReference inline");
    assert_eq!(href, "text/notes.xhtml#note-1");
    assert_eq!(kind, NoteKind::Footnote);
    assert_eq!(text, "1");
    assert_eq!(id, "src:text/chapter-1.xhtml#noteref-1");
    assert_eq!(fragment.as_deref(), Some("noteref-1"));
}

fn project_child_text(inlines: &[InlineNode]) -> String {
    project_inlines(inlines)
}

#[test]
fn nonlinear_notes_resource_normalizes_footnote_and_backlink() {
    let publication = open_fixture();
    let resource = match publication.normalize("text/notes.xhtml").unwrap().value {
        NormalizationResult::Normalized(resource) => resource,
        other => panic!("notes.xhtml should normalize, got {}", other.status()),
    };
    assert_eq!(resource.href, "text/notes.xhtml");

    let mut saw_footnotes = false;
    let mut saw_footnote = false;
    let mut saw_backlink = false;
    resource.root.for_each_block(&mut |block| {
        if block
            .base()
            .roles
            .iter()
            .any(|role| matches!(role, SemanticRole::Footnotes))
        {
            saw_footnotes = true;
        }
        if let Some(aside) = block.as_aside() {
            assert_eq!(aside.disposition, AsideDisposition::Footnote);
            saw_footnote = true;
        }
        if let Some(text) = block.as_text_block() {
            for inline in &text.inlines {
                inline.walk(&mut |inline| {
                    if let Some(target) = inline.as_link() {
                        if target.href == "text/chapter-1.xhtml#noteref-1" {
                            saw_backlink = true;
                        }
                    }
                });
            }
        }
    });
    assert!(saw_footnotes, "notes section should carry footnotes");
    assert!(saw_footnote, "note body should be an aside footnote");
    assert!(saw_backlink, "backlink should target chapter-1#noteref-1");
}

#[test]
fn page_break_figure_and_forward_link_survive() {
    let resource = normalize_chapter_one();

    let page = resource
        .find_block("src:text/chapter-1.xhtml#page-1")
        .expect("page break");
    match page {
        BlockNode::PageBreak { label, base, .. } => {
            assert_eq!(label.as_deref(), Some("1"));
            assert!(base.source_roles.iter().any(|role| role == "pagebreak"));
            assert!(base.source_roles.iter().any(|role| role == "doc-pagebreak"));
        }
        other => panic!("expected pageBreak, got {other:?}"),
    }

    let figure = resource
        .find_block("src:text/chapter-1.xhtml#compass-figure")
        .and_then(BlockNode::as_figure)
        .expect("figure");
    let image = figure
        .content
        .iter()
        .find_map(|node| match node {
            BlockNode::MediaBlock(media) => Some(media),
            _ => None,
        })
        .expect("figure image");
    assert_eq!(
        image.primary.as_ref().map(|source| source.href.as_str()),
        Some("images/compass.svg")
    );
    assert_eq!(
        image.alt.as_deref(),
        Some("A blue compass rose pointing north")
    );
    let caption = figure
        .caption
        .iter()
        .find_map(BlockNode::as_text_block)
        .expect("caption");
    assert_eq!(caption.text, "An orientation aid.");
    assert!(!resource
        .text_block("src:text/chapter-1.xhtml#citation-target")
        .unwrap()
        .text
        .contains('\u{FFFC}'));

    let forward = resource
        .text_block("src:text/chapter-1.xhtml#forward-link")
        .expect("forward-link paragraph");
    let mut target = None;
    for inline in &forward.inlines {
        inline.walk(&mut |inline| {
            if let Some(link) = inline.as_link() {
                target = Some(link.href.clone());
            }
        });
    }
    assert_eq!(target.as_deref(), Some("text/chapter-2.xhtml#return-point"));
}

#[test]
fn foreign_dial_resource_is_unsupported_and_reports_fallback() {
    let publication = open_fixture();
    match publication.normalize("data/dial.haddon").unwrap().value {
        NormalizationResult::Unsupported {
            href,
            media_type,
            fallback,
            ..
        } => {
            assert_eq!(href, "data/dial.haddon");
            assert_eq!(media_type, "application/vnd.haddon.fixture");
            let fallback = fallback.expect("package fallback");
            assert_eq!(fallback.href.as_str(), "images/dial-fallback.svg");
        }
        NormalizationResult::Normalized(resource) => {
            panic!(
                "must not invent a normalized document under {}",
                resource.href
            )
        }
    }
}

#[test]
fn normalization_is_deterministic_for_the_same_source_and_stamp() {
    let publication = open_fixture();
    let first = publication
        .normalize("text/chapter-1.xhtml")
        .unwrap()
        .value
        .as_normalized()
        .unwrap()
        .to_semantic_json()
        .unwrap();
    let second = publication
        .normalize("text/chapter-1.xhtml")
        .unwrap()
        .value
        .as_normalized()
        .unwrap()
        .to_semantic_json()
        .unwrap();
    assert_eq!(first, second);
    assert_eq!(
        first["normalization"]["revision"],
        "haddon-normalizer/1+3elsjvhyixa4dkzpch4kbfnlqy2lblmk7lgwdgqtroy"
    );
}

#[test]
fn surrogate_pair_offsets_are_rejected() {
    let publication = open_surrogate_fixture();
    let resource = match publication.normalize("text/astro.xhtml").unwrap().value {
        NormalizationResult::Normalized(resource) => resource,
        other => panic!("expected normalized astro, got {}", other.status()),
    };
    let block_id = "src:text/astro.xhtml#astro";
    let block = resource.text_block(block_id).expect("astro paragraph");
    assert_eq!(block.utf16_len(), 4);
    assert!(matches!(
        resource.map_normalized_range(block_id, 2, 3),
        MappingResult::Unmapped {
            reason: UnmappedReason::Invalid
        }
    ));
    assert!(matches!(
        resource.map_normalized_range(block_id, 1, 3),
        MappingResult::Exact { .. }
    ));
}

#[test]
fn normalization_capability_is_available_after_open() {
    let publication = open_fixture();
    let descriptor = publication.capability(ServiceKind::Normalization);
    assert_ne!(descriptor.availability, CapabilityAvailability::Unavailable);
    assert!(publication.has_service(ServiceKind::Normalization));
}

fn open_surrogate_fixture() -> haddon_core::publication::Publication {
    let container = br#"<?xml version="1.0"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="EPUB/package.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>"#;
    let package = br#"<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" unique-identifier="pub-id" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="pub-id">urn:uuid:surrogate-test</dc:identifier>
    <dc:title>Surrogate</dc:title>
    <dc:language>en</dc:language>
  </metadata>
  <manifest>
    <item id="c" href="text/astro.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="c"/>
  </spine>
</package>"#;
    let xhtml = "<html xmlns=\"http://www.w3.org/1999/xhtml\" lang=\"en\"><body><p id=\"astro\">A😀B</p></body></html>";

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
        .start_file("EPUB/text/astro.xhtml", deflated)
        .unwrap();
    writer.write_all(xhtml.as_bytes()).unwrap();
    let bytes = writer.finish().unwrap().into_inner();
    open_epub_default(&bytes).unwrap().value.publication
}
