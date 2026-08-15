use haddon_core::publication::{
    is_valid_progression, is_valid_utf16_offset, utf16_len, utf16_slice, Completeness, HaddonError,
    PublicationLocator, Recovery, Stage, TextOffsetUnit,
};

const LOCATOR_SCHEMA: &str = "haddon.publication-locator";
const CITATION_HREF: &str = "text/chapter-1.xhtml";
const CITATION_MEDIA_TYPE: &str = "application/xhtml+xml";
const CITATION_BLOCK: &str =
    "Before the signal, the copper astrolabe clicked once; the patient moon answered in blue, and the lesson continued after midnight.";
const EXACT_QUOTE: &str = "the patient moon answered in blue";
const QUOTE_PREFIX: &str = "Before the signal, the copper astrolabe clicked once; ";
const QUOTE_SUFFIX: &str = ", and the lesson continued after midnight.";
const NORMALIZER_REVISION: &str = "haddon-normalizer/1+testdigest";
const CITATION_BLOCK_ID: &str = "src:text/chapter-1.xhtml#citation-target";

const CITATION_FIXTURE_LOCATOR: &str = r#"{
  "schema": "haddon.publication-locator",
  "version": 1,
  "href": "text/chapter-1.xhtml",
  "mediaType": "application/xhtml+xml",
  "locations": {
    "fragments": ["citation-target"],
    "normalized": {
      "revision": "haddon-normalizer/1+testdigest",
      "start": {
        "blockId": "src:text/chapter-1.xhtml#citation-target",
        "offset": { "value": 54, "unit": "utf16-code-unit" }
      },
      "end": {
        "blockId": "src:text/chapter-1.xhtml#citation-target",
        "offset": { "value": 87, "unit": "utf16-code-unit" }
      }
    }
  },
  "text": {
    "exact": "the patient moon answered in blue",
    "prefix": "Before the signal, the copper astrolabe clicked once; ",
    "suffix": ", and the lesson continued after midnight."
  }
}"#;

fn envelope(locations: serde_json::Value) -> serde_json::Value {
    serde_json::json!({
        "schema": LOCATOR_SCHEMA,
        "version": 1,
        "href": CITATION_HREF,
        "mediaType": CITATION_MEDIA_TYPE,
        "locations": locations,
    })
}

fn parse_value(
    value: serde_json::Value,
) -> haddon_core::publication::HaddonResult<PublicationLocator> {
    PublicationLocator::from_value(value)
}

#[test]
fn citation_fixture_golden_round_trips_semantically() {
    let first = PublicationLocator::from_json(CITATION_FIXTURE_LOCATOR)
        .expect("citation fixture locator must parse");
    assert_eq!(first.completeness, Completeness::Complete);
    assert!(first.warnings.is_empty());

    let locator = &first.value;
    assert_eq!(locator.schema, LOCATOR_SCHEMA);
    assert_eq!(locator.version, 1);
    assert_eq!(locator.href.as_str(), CITATION_HREF);
    assert_eq!(locator.media_type, CITATION_MEDIA_TYPE);
    assert_eq!(locator.locations.fragments, ["citation-target"]);
    let normalized = locator
        .locations
        .normalized
        .as_ref()
        .expect("golden locator includes a normalized range");
    assert_eq!(normalized.revision, NORMALIZER_REVISION);
    assert_eq!(normalized.start.block_id, CITATION_BLOCK_ID);
    assert_eq!(normalized.start.offset.value, 54);
    assert_eq!(normalized.start.offset.unit, TextOffsetUnit::Utf16CodeUnit);
    let end = normalized.end.as_ref().expect("ranged citation has an end");
    assert_eq!(end.block_id, CITATION_BLOCK_ID);
    assert_eq!(end.offset.value, 87);
    let text = locator
        .text
        .as_ref()
        .expect("golden locator includes quote text");
    assert_eq!(text.exact, EXACT_QUOTE);
    assert_eq!(text.prefix.as_deref(), Some(QUOTE_PREFIX));
    assert_eq!(text.suffix.as_deref(), Some(QUOTE_SUFFIX));

    assert_eq!(utf16_len(CITATION_BLOCK), 129);
    assert_eq!(utf16_slice(CITATION_BLOCK, 54, 87).unwrap(), EXACT_QUOTE);

    let encoded = locator.to_json();
    let second = PublicationLocator::from_json(&encoded).expect("writer JSON must parse");
    assert_eq!(second.completeness, Completeness::Complete);
    assert_eq!(first.value, second.value);

    let third = PublicationLocator::from_json(&second.value.to_json()).unwrap();
    assert_eq!(second.value, third.value);
}

#[test]
fn utf16_thumbs_up_has_length_two_and_rejects_surrogate_split() {
    let thumbs = "👍";
    assert_eq!(utf16_len(thumbs), 2);
    assert!(is_valid_utf16_offset(thumbs, 0));
    assert!(!is_valid_utf16_offset(thumbs, 1));
    assert!(is_valid_utf16_offset(thumbs, 2));
    assert!(!is_valid_utf16_offset(thumbs, 3));
    assert_eq!(utf16_slice(thumbs, 0, 2).unwrap(), thumbs);
    assert!(utf16_slice(thumbs, 1, 2).is_err());
    assert_eq!(utf16_len("hello"), 5);
    assert_eq!(utf16_slice("hello", 1, 4).unwrap(), "ell");
}

#[test]
fn utf16_greek_kosmos_is_six_bmp_units() {
    let kosmos = "κόσμος";
    assert_eq!(utf16_len(kosmos), 6);
    assert_eq!(kosmos.chars().count(), 6);
    for offset in 0..=6 {
        assert!(is_valid_utf16_offset(kosmos, offset), "offset {offset}");
    }
    assert_eq!(utf16_slice(kosmos, 0, 6).unwrap(), kosmos);
}

#[test]
fn utf16_combining_mark_may_split_base_and_mark() {
    let marked = "e\u{0301}";
    assert_eq!(utf16_len(marked), 2);
    assert!(is_valid_utf16_offset(marked, 0));
    assert!(is_valid_utf16_offset(marked, 1));
    assert!(is_valid_utf16_offset(marked, 2));
    assert_eq!(utf16_slice(marked, 0, 1).unwrap(), "e");
    assert_eq!(utf16_slice(marked, 1, 2).unwrap(), "\u{0301}");
}

#[test]
fn utf16_variation_selector_is_an_adjacent_code_unit() {
    let varied = "👍\u{FE0F}";
    assert_eq!(utf16_len(varied), 3);
    assert!(is_valid_utf16_offset(varied, 0));
    assert!(!is_valid_utf16_offset(varied, 1));
    assert!(is_valid_utf16_offset(varied, 2));
    assert!(is_valid_utf16_offset(varied, 3));
    assert_eq!(utf16_slice(varied, 2, 3).unwrap(), "\u{FE0F}");
}

#[test]
fn invalid_progression_is_dropped_while_required_fields_remain() {
    assert!(!is_valid_progression(1.5));
    assert!(!is_valid_progression(f64::NAN));
    assert!(!is_valid_progression(f64::INFINITY));
    assert!(!is_valid_progression(-0.1));
    assert!(is_valid_progression(0.0));
    assert!(is_valid_progression(1.0));

    let outcome = parse_value(envelope(serde_json::json!({
        "fragments": ["citation-target"],
        "progression": 1.5,
        "totalProgression": 0.25
    })))
    .expect("invalid optional progression must not reject the locator");
    assert_eq!(outcome.completeness, Completeness::Partial);
    assert!(outcome.value.locations.progression.is_none());
    assert_eq!(outcome.value.locations.total_progression, Some(0.25));
    assert_eq!(outcome.value.href.as_str(), CITATION_HREF);
    assert_eq!(outcome.value.media_type, CITATION_MEDIA_TYPE);
    assert!(outcome.warnings.iter().any(|warning| {
        warning.code == "haddon.locator.selector-dropped"
            && warning.stage == Stage::Locate
            && warning.recovery == Some(Recovery::Omitted)
            && warning.message.contains("locations.progression")
    }));
}

#[test]
fn position_zero_is_dropped() {
    let outcome = parse_value(envelope(serde_json::json!({
        "position": 0,
        "fragments": ["citation-target"]
    })))
    .expect("invalid optional position must not reject the locator");
    assert_eq!(outcome.completeness, Completeness::Partial);
    assert!(outcome.value.locations.position.is_none());
    assert_eq!(outcome.value.locations.fragments, ["citation-target"]);
    assert!(outcome.warnings.iter().any(|warning| {
        warning.code == "haddon.locator.selector-dropped"
            && warning.message.contains("locations.position")
    }));
}

#[test]
fn missing_href_or_media_type_fails() {
    let missing_href = serde_json::json!({
        "schema": LOCATOR_SCHEMA,
        "version": 1,
        "mediaType": CITATION_MEDIA_TYPE,
        "locations": {}
    });
    match parse_value(missing_href) {
        Err(HaddonError::InvalidArgument { stage, field, .. }) => {
            assert_eq!(stage, Stage::Locate);
            assert_eq!(field, "href");
        }
        other => panic!("expected href error, got {other:?}"),
    }

    let missing_media = serde_json::json!({
        "schema": LOCATOR_SCHEMA,
        "version": 1,
        "href": CITATION_HREF,
        "locations": {}
    });
    match parse_value(missing_media) {
        Err(HaddonError::InvalidArgument { stage, field, .. }) => {
            assert_eq!(stage, Stage::Locate);
            assert_eq!(field, "mediaType");
        }
        other => panic!("expected mediaType error, got {other:?}"),
    }
}

#[test]
fn schema_and_version_are_required_and_checked_first() {
    match parse_value(serde_json::json!({
        "version": 1,
        "href": CITATION_HREF,
        "mediaType": CITATION_MEDIA_TYPE
    })) {
        Err(HaddonError::InvalidArgument { field, .. }) => assert_eq!(field, "schema"),
        other => panic!("expected schema error, got {other:?}"),
    }

    match parse_value(serde_json::json!({
        "schema": "haddon.other-locator",
        "version": 2,
        "href": CITATION_HREF,
        "mediaType": CITATION_MEDIA_TYPE
    })) {
        Err(HaddonError::InvalidArgument { field, .. }) => assert_eq!(field, "schema"),
        other => panic!("expected schema error before version, got {other:?}"),
    }

    match parse_value(serde_json::json!({
        "schema": LOCATOR_SCHEMA,
        "version": 2,
        "href": CITATION_HREF,
        "mediaType": CITATION_MEDIA_TYPE
    })) {
        Err(HaddonError::InvalidArgument { field, message, .. }) => {
            assert_eq!(field, "version");
            assert!(message.contains("version"), "{message}");
        }
        other => panic!("expected version error, got {other:?}"),
    }
}

#[test]
fn href_with_fragment_is_canonicalized_by_publication_href() {
    // PublicationHref identity is fragmentless. Locator parse reuses that
    // canonicalizer rather than rejecting, and does not move the fragment
    // into locations.fragments.
    let outcome = parse_value(serde_json::json!({
        "schema": LOCATOR_SCHEMA,
        "version": 1,
        "href": "text/./chapter-1.xhtml#citation-target",
        "mediaType": "Application/XHTML+XML",
        "locations": {}
    }))
    .expect("fragment-bearing href is canonicalized");
    assert_eq!(outcome.value.href.as_str(), CITATION_HREF);
    assert_eq!(outcome.value.media_type, CITATION_MEDIA_TYPE);
    assert!(outcome.value.locations.fragments.is_empty());
}

#[test]
fn empty_exact_with_ranged_normalized_selector_fails() {
    let value = serde_json::json!({
        "schema": LOCATOR_SCHEMA,
        "version": 1,
        "href": CITATION_HREF,
        "mediaType": CITATION_MEDIA_TYPE,
        "locations": {
            "normalized": {
                "revision": NORMALIZER_REVISION,
                "start": {
                    "blockId": CITATION_BLOCK_ID,
                    "offset": { "value": 54, "unit": "utf16-code-unit" }
                },
                "end": {
                    "blockId": CITATION_BLOCK_ID,
                    "offset": { "value": 87, "unit": "utf16-code-unit" }
                }
            }
        },
        "text": { "exact": "" }
    });
    match parse_value(value) {
        Err(HaddonError::InvalidArgument { stage, field, .. }) => {
            assert_eq!(stage, Stage::Locate);
            assert_eq!(field, "text.exact");
        }
        other => panic!("expected empty exact to fail, got {other:?}"),
    }
}

#[test]
fn unknown_top_level_key_is_ignored_and_extensions_survive_round_trip() {
    let value = serde_json::json!({
        "schema": LOCATOR_SCHEMA,
        "version": 1,
        "href": CITATION_HREF,
        "mediaType": CITATION_MEDIA_TYPE,
        "locations": { "fragments": ["citation-target"] },
        "legacyOrdinal": 3,
        "extensions": { "foo": { "kept": true }, "haddon.test": 1 }
    });
    let first = parse_value(value).expect("unknown keys are recoverable");
    assert_eq!(first.completeness, Completeness::Partial);
    assert!(first.warnings.iter().any(|warning| {
        warning.code == "haddon.locator.unknown-key"
            && warning.stage == Stage::Locate
            && warning.recovery == Some(Recovery::Ignored)
            && warning.message.contains("legacyOrdinal")
    }));
    assert_eq!(
        first.value.extensions.get("foo"),
        Some(&serde_json::json!({ "kept": true }))
    );
    assert_eq!(
        first.value.extensions.get("haddon.test"),
        Some(&serde_json::json!(1))
    );

    let second = PublicationLocator::from_json(&first.value.to_json()).unwrap();
    assert_eq!(first.value.extensions, second.value.extensions);
    assert_eq!(first.value, second.value);
}

#[test]
fn invalid_normalized_unit_is_dropped_when_fragments_remain() {
    let outcome = parse_value(envelope(serde_json::json!({
        "fragments": ["citation-target"],
        "normalized": {
            "revision": NORMALIZER_REVISION,
            "start": {
                "blockId": CITATION_BLOCK_ID,
                "offset": { "value": 54, "unit": "utf8-byte" }
            }
        }
    })))
    .expect("invalid optional normalized selector is dropped");
    assert_eq!(outcome.completeness, Completeness::Partial);
    assert!(outcome.value.locations.normalized.is_none());
    assert_eq!(outcome.value.locations.fragments, ["citation-target"]);
    assert!(outcome.warnings.iter().any(|warning| {
        warning.code == "haddon.locator.selector-dropped"
            && warning.message.contains("locations.normalized")
    }));
}

#[test]
fn collapsed_range_omitted_end_round_trips_as_omitted_end() {
    let first = parse_value(envelope(serde_json::json!({
        "normalized": {
            "revision": NORMALIZER_REVISION,
            "start": {
                "blockId": CITATION_BLOCK_ID,
                "offset": { "value": 54, "unit": "utf16-code-unit" }
            }
        }
    })))
    .unwrap();
    assert_eq!(first.completeness, Completeness::Complete);
    let normalized = first.value.locations.normalized.as_ref().unwrap();
    assert!(normalized.end.is_none());

    let encoded = first.value.to_value();
    assert!(encoded["locations"]["normalized"].get("end").is_none());

    let second = parse_value(encoded).unwrap();
    assert!(second
        .value
        .locations
        .normalized
        .as_ref()
        .unwrap()
        .end
        .is_none());
    assert_eq!(first.value, second.value);
}
