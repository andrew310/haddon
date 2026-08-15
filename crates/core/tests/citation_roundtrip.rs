//! HADDON-018: can you leave a passage and come back to the same words?
//!
//! This is the test that should make the locator/normalizer work obvious:
//! highlight a sentence, save the citation as JSON, close the book, open it
//! again, and land on the same sentence.

use haddon_core::publication::{
    open_epub_default, LocatorResolution, NormalizationResult, Publication, PublicationLocator,
    ResolutionConfidence, ResolutionPolicy, ResolutionStrategy, ServiceKind,
};
use std::io::{Cursor, Write};
use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, DateTime, ZipWriter};

const MIMETYPE: &[u8] = b"application/epub+zip";
const QUOTE_PREFIX: &str = "Before the signal, the copper astrolabe clicked once; ";
const EXACT_QUOTE: &str = "the patient moon answered in blue";
const QUOTE_SUFFIX: &str = ", and the lesson continued after midnight.";
const CITATION_HREF: &str = "text/chapter-1.xhtml";
const CITATION_FRAGMENT: &str = "citation-target";
const CITATION_BLOCK: &str = "src:text/chapter-1.xhtml#citation-target";
const QUOTE_START: u64 = 54;
const QUOTE_END: u64 = 87;

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

fn source_citation_json() -> String {
    format!(
        r#"{{
  "schema": "haddon.publication-locator",
  "version": 1,
  "href": "{CITATION_HREF}",
  "mediaType": "application/xhtml+xml",
  "locations": {{ "fragments": ["{CITATION_FRAGMENT}"] }},
  "text": {{
    "exact": "{EXACT_QUOTE}",
    "prefix": "{QUOTE_PREFIX}",
    "suffix": "{QUOTE_SUFFIX}"
  }}
}}"#
    )
}

fn resolved_quote(resolution: &LocatorResolution) -> &PublicationLocator {
    match resolution {
        LocatorResolution::Resolved { locator, .. } => locator,
        other => panic!("expected to land on the moon quote, got {other:?}"),
    }
}

#[test]
fn highlight_save_reopen_lands_on_the_same_sentence() {
    // 1. Open the book and turn a source highlight into a saved citation.
    let book = open_book();
    let source = PublicationLocator::from_json(&source_citation_json())
        .expect("source citation JSON must parse")
        .value;

    let first = book
        .resolve(&source, ResolutionPolicy::Citation)
        .expect("resolve must not be a fatal error")
        .value;
    let saved = resolved_quote(&first);
    let normalized = saved
        .locations
        .normalized
        .as_ref()
        .expect("a saved citation must remember the normalized range");
    assert_eq!(normalized.start.block_id, CITATION_BLOCK);
    assert_eq!(normalized.start.offset.value, QUOTE_START);
    assert_eq!(
        normalized.end.as_ref().map(|end| end.offset.value),
        Some(QUOTE_END)
    );
    assert_eq!(
        saved.text.as_ref().map(|text| text.exact.as_str()),
        Some(EXACT_QUOTE)
    );
    assert_eq!(saved.locations.fragments, [CITATION_FRAGMENT]);

    // 2. Persist it the way Klemata would: a JSON string, nothing live.
    let json = saved.to_json();
    book.close().unwrap();

    // 3. Reopen a fresh handle and follow the saved citation back.
    let again = open_book();
    let parsed = PublicationLocator::from_json(&json).unwrap().value;
    let second = again
        .resolve(&parsed, ResolutionPolicy::Citation)
        .unwrap()
        .value;
    let LocatorResolution::Resolved {
        confidence,
        strategy,
        locator,
        ..
    } = second
    else {
        panic!("reopened citation must resolve, got {second:?}");
    };
    assert_eq!(confidence, ResolutionConfidence::Exact);
    assert_eq!(strategy, ResolutionStrategy::Normalized);
    assert_eq!(locator.href.as_str(), CITATION_HREF);
    let range = locator.locations.normalized.as_ref().unwrap();
    assert_eq!(range.start.block_id, CITATION_BLOCK);
    assert_eq!(range.start.offset.value, QUOTE_START);
    assert_eq!(range.end.as_ref().unwrap().offset.value, QUOTE_END);
    assert_eq!(locator.text.unwrap().exact, EXACT_QUOTE);
}

#[test]
fn stale_normalizer_revision_still_finds_the_quote() {
    let book = open_book();
    let source = PublicationLocator::from_json(&source_citation_json())
        .unwrap()
        .value;
    let mut stale = resolved_quote(
        &book
            .resolve(&source, ResolutionPolicy::Citation)
            .unwrap()
            .value,
    )
    .clone();
    stale
        .locations
        .normalized
        .as_mut()
        .expect("round-trip locator has a normalized range")
        .revision = "haddon-normalizer/1+stale-harmless-revision".to_string();

    let recovered = book
        .resolve(&stale, ResolutionPolicy::Citation)
        .unwrap()
        .value;
    let LocatorResolution::Resolved {
        confidence,
        strategy,
        locator,
        ..
    } = recovered
    else {
        panic!("quote context should recover the passage, got {recovered:?}");
    };
    assert_eq!(strategy, ResolutionStrategy::Quote);
    assert_eq!(confidence, ResolutionConfidence::Exact);
    let range = locator.locations.normalized.as_ref().unwrap();
    assert_eq!(range.start.block_id, CITATION_BLOCK);
    assert_eq!(range.start.offset.value, QUOTE_START);
    assert_eq!(range.end.as_ref().unwrap().offset.value, QUOTE_END);
}

#[test]
fn matching_revision_resolves_a_structural_locator_without_quote() {
    let book = open_book();
    let with_quote = PublicationLocator::from_json(&source_citation_json())
        .unwrap()
        .value;
    let mut structural = resolved_quote(
        &book
            .resolve(&with_quote, ResolutionPolicy::Citation)
            .unwrap()
            .value,
    )
    .clone();
    structural.text = None;

    let hit = book
        .resolve(&structural, ResolutionPolicy::Citation)
        .unwrap()
        .value;
    let LocatorResolution::Resolved {
        confidence,
        strategy,
        locator,
        ..
    } = hit
    else {
        panic!("matching normalized coordinates should resolve, got {hit:?}");
    };
    assert_eq!(strategy, ResolutionStrategy::Normalized);
    assert_eq!(confidence, ResolutionConfidence::Strong);
    assert_eq!(
        locator
            .locations
            .normalized
            .as_ref()
            .unwrap()
            .start
            .block_id,
        CITATION_BLOCK
    );
}

#[test]
fn citation_policy_will_not_auto_highlight_a_bare_fragment() {
    let book = open_book();
    let fragment_only = PublicationLocator::from_json(&format!(
        r#"{{
          "schema": "haddon.publication-locator",
          "version": 1,
          "href": "{CITATION_HREF}",
          "mediaType": "application/xhtml+xml",
          "locations": {{ "fragments": ["{CITATION_FRAGMENT}"] }}
        }}"#
    ))
    .unwrap()
    .value;

    let citation = book
        .resolve(&fragment_only, ResolutionPolicy::Citation)
        .unwrap()
        .value;
    assert!(
        !matches!(citation, LocatorResolution::Resolved { .. }),
        "citation policy must not treat a weak fragment as a highlight, got {citation:?}"
    );

    let navigation = book
        .resolve(&fragment_only, ResolutionPolicy::Navigation)
        .unwrap()
        .value;
    let LocatorResolution::Resolved {
        confidence,
        strategy,
        locator,
        ..
    } = navigation
    else {
        panic!("navigation may follow a unique fragment, got {navigation:?}");
    };
    assert_eq!(strategy, ResolutionStrategy::Fragment);
    assert_eq!(confidence, ResolutionConfidence::Weak);
    assert_eq!(locator.locations.fragments, [CITATION_FRAGMENT]);
}

#[test]
fn duplicate_quote_without_context_is_ambiguous() {
    let book = open_book();
    let many_the = PublicationLocator::from_json(&format!(
        r#"{{
          "schema": "haddon.publication-locator",
          "version": 1,
          "href": "{CITATION_HREF}",
          "mediaType": "application/xhtml+xml",
          "locations": {{}},
          "text": {{ "exact": "the" }}
        }}"#
    ))
    .unwrap()
    .value;

    let result = book
        .resolve(&many_the, ResolutionPolicy::Citation)
        .unwrap()
        .value;
    match result {
        LocatorResolution::Ambiguous {
            reason,
            total_candidate_count,
            ..
        } => {
            assert_eq!(reason, "multiple-matches");
            assert!(total_candidate_count >= 2);
        }
        other => panic!("bare word 'the' must be ambiguous, got {other:?}"),
    }
}

#[test]
fn missing_resource_is_unresolved() {
    let book = open_book();
    let missing = PublicationLocator::from_json(
        r#"{
          "schema": "haddon.publication-locator",
          "version": 1,
          "href": "text/no-such-chapter.xhtml",
          "mediaType": "application/xhtml+xml",
          "locations": {}
        }"#,
    )
    .unwrap()
    .value;

    let result = book
        .resolve(&missing, ResolutionPolicy::Citation)
        .unwrap()
        .value;
    match result {
        LocatorResolution::Unresolved { reason, .. } => {
            assert_eq!(reason, "resource-missing");
        }
        other => panic!("expected resource-missing, got {other:?}"),
    }
}

#[test]
fn locator_service_is_available_after_open() {
    let book = open_book();
    assert!(book.has_service(ServiceKind::Locator));
    let chapter = match book.normalize(CITATION_HREF).unwrap().value {
        NormalizationResult::Normalized(resource) => resource,
        other => panic!("chapter-1 should normalize, got {}", other.status()),
    };
    let built = book
        .locator_from_normalized(&chapter.href, CITATION_BLOCK, QUOTE_START, QUOTE_END)
        .unwrap()
        .value;
    assert_eq!(built.text.as_ref().unwrap().exact, EXACT_QUOTE);
    assert_eq!(
        built.text.as_ref().unwrap().prefix.as_deref(),
        Some(QUOTE_PREFIX)
    );
    assert_eq!(
        built.text.as_ref().unwrap().suffix.as_deref(),
        Some(QUOTE_SUFFIX)
    );
}
