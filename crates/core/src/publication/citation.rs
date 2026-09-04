use super::{HaddonError, HaddonResult, Outcome, PublicationLocator};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

pub const CITATION_ENVELOPE_SCHEMA: &str = "haddon.citation-envelope";
pub const CITATION_ENVELOPE_VERSION: u32 = 1;

/// Haddon Citation Envelope Version 1
///
/// Wraps a PublicationLocatorV1 with volume/edition identity and recovery state.
/// This is the canonical storage and URL representation for citations across
/// Haddon, Klemata, and future Kadmos.
///
/// See `docs/design/citation-envelope.md` for the full specification.
#[derive(Clone, Debug, PartialEq)]
pub struct CitationEnvelopeV1 {
    pub schema: String,
    pub version: u32,
    pub volume_id: String,
    pub edition_id: Option<String>,
    pub source_revision: String,
    pub locator: PublicationLocator,
    pub confidence: CitationConfidence,
    pub label: Option<String>,
    pub recovery_evidence: Option<RecoveryEvidence>,
    pub extensions: BTreeMap<String, Value>,
}

/// Recovery confidence when resolving a citation.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CitationConfidence {
    /// Locator was resolved without ambiguity.
    Exact,
    /// Quote/context matched after normalized structure changed.
    Recovered,
    /// Multiple candidates matched with equal confidence.
    Ambiguous,
    /// Citation could not be resolved in this source revision.
    Unresolved,
}

/// Evidence collected during citation recovery.
///
/// Preserved when confidence is "recovered", "ambiguous", or "unresolved".
#[derive(Clone, Debug, PartialEq)]
pub struct RecoveryEvidence {
    pub original_locator: Option<PublicationLocator>,
    pub strategy: Option<RecoveryStrategy>,
    pub candidates: Vec<RecoveryCandidate>,
    pub message: Option<String>,
}

/// Recovery strategy that produced a result.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RecoveryStrategy {
    QuoteMatch,
    FragmentFallback,
    ProgressionEstimate,
    Manual,
}

/// Alternative candidate during ambiguous resolution.
#[derive(Clone, Debug, PartialEq)]
pub struct RecoveryCandidate {
    pub locator: PublicationLocator,
    pub score: f64,
}

impl CitationEnvelopeV1 {
    /// Create a new exact citation envelope.
    pub fn exact(
        volume_id: impl Into<String>,
        source_revision: impl Into<String>,
        locator: PublicationLocator,
    ) -> Self {
        Self {
            schema: CITATION_ENVELOPE_SCHEMA.to_string(),
            version: CITATION_ENVELOPE_VERSION,
            volume_id: volume_id.into(),
            edition_id: None,
            source_revision: source_revision.into(),
            locator,
            confidence: CitationConfidence::Exact,
            label: None,
            recovery_evidence: None,
            extensions: BTreeMap::new(),
        }
    }

    /// Create a recovered citation envelope with evidence.
    pub fn recovered(
        volume_id: impl Into<String>,
        source_revision: impl Into<String>,
        locator: PublicationLocator,
        evidence: RecoveryEvidence,
    ) -> Self {
        Self {
            schema: CITATION_ENVELOPE_SCHEMA.to_string(),
            version: CITATION_ENVELOPE_VERSION,
            volume_id: volume_id.into(),
            edition_id: None,
            source_revision: source_revision.into(),
            locator,
            confidence: CitationConfidence::Recovered,
            label: None,
            recovery_evidence: Some(evidence),
            extensions: BTreeMap::new(),
        }
    }

    /// Create an ambiguous citation envelope with candidates.
    pub fn ambiguous(
        volume_id: impl Into<String>,
        source_revision: impl Into<String>,
        locator: PublicationLocator,
        evidence: RecoveryEvidence,
    ) -> Self {
        Self {
            schema: CITATION_ENVELOPE_SCHEMA.to_string(),
            version: CITATION_ENVELOPE_VERSION,
            volume_id: volume_id.into(),
            edition_id: None,
            source_revision: source_revision.into(),
            locator,
            confidence: CitationConfidence::Ambiguous,
            label: None,
            recovery_evidence: Some(evidence),
            extensions: BTreeMap::new(),
        }
    }

    /// Create an unresolved citation envelope.
    pub fn unresolved(
        volume_id: impl Into<String>,
        source_revision: impl Into<String>,
        locator: PublicationLocator,
        evidence: RecoveryEvidence,
    ) -> Self {
        Self {
            schema: CITATION_ENVELOPE_SCHEMA.to_string(),
            version: CITATION_ENVELOPE_VERSION,
            volume_id: volume_id.into(),
            edition_id: None,
            source_revision: source_revision.into(),
            locator,
            confidence: CitationConfidence::Unresolved,
            label: None,
            recovery_evidence: Some(evidence),
            extensions: BTreeMap::new(),
        }
    }

    /// Parse a citation envelope from JSON.
    pub fn from_json(json: &str) -> HaddonResult<Self> {
        let value = serde_json::from_str(json).map_err(|error| {
            invalid_envelope("json", format!("citation envelope JSON is not valid: {error}"))
        })?;
        Self::from_value(value)
    }

    /// Parse a citation envelope from a JSON value.
    pub fn from_value(value: Value) -> HaddonResult<Self> {
        let object = match value {
            Value::Object(object) => object,
            _ => {
                return Err(invalid_envelope(
                    "envelope",
                    "citation envelope must be a JSON object",
                ))
            }
        };

        match object.get("schema") {
            None => return Err(invalid_envelope("schema", "schema is required")),
            Some(Value::String(schema)) if schema == CITATION_ENVELOPE_SCHEMA => {}
            Some(_) => {
                return Err(invalid_envelope(
                    "schema",
                    "schema must be \"haddon.citation-envelope\"",
                ))
            }
        }

        match object.get("version") {
            None => return Err(invalid_envelope("version", "version is required")),
            Some(value) if as_json_u64(value) == Some(CITATION_ENVELOPE_VERSION as u64) => {}
            Some(_) => return Err(invalid_envelope("version", "unsupported envelope version")),
        }

        let volume_id = match object.get("volumeId") {
            None => return Err(invalid_envelope("volumeId", "volumeId is required")),
            Some(Value::String(id)) if !id.is_empty() => id.clone(),
            Some(_) => {
                return Err(invalid_envelope(
                    "volumeId",
                    "volumeId must be a non-empty string",
                ))
            }
        };

        let edition_id = match object.get("editionId") {
            None | Some(Value::Null) => None,
            Some(Value::String(id)) if !id.is_empty() => Some(id.clone()),
            Some(Value::String(_)) => None,
            Some(_) => {
                return Err(invalid_envelope(
                    "editionId",
                    "editionId must be a string or null",
                ))
            }
        };

        let source_revision = match object.get("sourceRevision") {
            None => return Err(invalid_envelope("sourceRevision", "sourceRevision is required")),
            Some(Value::String(rev)) if !rev.is_empty() => rev.clone(),
            Some(_) => {
                return Err(invalid_envelope(
                    "sourceRevision",
                    "sourceRevision must be a non-empty string",
                ))
            }
        };

        let locator = match object.get("locator") {
            None => return Err(invalid_envelope("locator", "locator is required")),
            Some(value) => PublicationLocator::from_value(value.clone())?.value,
        };

        let confidence = match object.get("confidence") {
            None => return Err(invalid_envelope("confidence", "confidence is required")),
            Some(Value::String(conf)) => parse_confidence(conf)?,
            Some(_) => {
                return Err(invalid_envelope(
                    "confidence",
                    "confidence must be a string",
                ))
            }
        };

        let label = match object.get("label") {
            None | Some(Value::Null) => None,
            Some(Value::String(label)) if !label.is_empty() => Some(label.clone()),
            Some(Value::String(_)) => None,
            Some(_) => return Err(invalid_envelope("label", "label must be a string or null")),
        };

        let recovery_evidence = match object.get("recoveryEvidence") {
            None | Some(Value::Null) => None,
            Some(value) => Some(parse_recovery_evidence(value)?),
        };

        let extensions = match object.get("extensions") {
            None | Some(Value::Null) => BTreeMap::new(),
            Some(Value::Object(extensions)) => extensions
                .iter()
                .map(|(key, value)| (key.clone(), value.clone()))
                .collect(),
            Some(_) => {
                return Err(invalid_envelope(
                    "extensions",
                    "extensions must be an object or null",
                ))
            }
        };

        Ok(Outcome::complete(Self {
            schema: CITATION_ENVELOPE_SCHEMA.to_string(),
            version: CITATION_ENVELOPE_VERSION,
            volume_id,
            edition_id,
            source_revision,
            locator,
            confidence,
            label,
            recovery_evidence,
            extensions,
        }))
    }

    /// Serialize to JSON.
    pub fn to_json(&self) -> String {
        serde_json::to_string(self).expect("CitationEnvelopeV1 always serializes")
    }

    /// Serialize to a JSON value.
    pub fn to_value(&self) -> Value {
        serde_json::to_value(self).expect("CitationEnvelopeV1 always serializes")
    }
}

impl Serialize for CitationEnvelopeV1 {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        write_envelope(self).serialize(serializer)
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct EnvelopeWrite<'a> {
    schema: &'a str,
    version: u32,
    volume_id: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    edition_id: Option<&'a str>,
    source_revision: &'a str,
    locator: &'a PublicationLocator,
    confidence: CitationConfidence,
    #[serde(skip_serializing_if = "Option::is_none")]
    label: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    recovery_evidence: Option<RecoveryEvidenceWrite<'a>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    extensions: Option<&'a BTreeMap<String, Value>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RecoveryEvidenceWrite<'a> {
    #[serde(skip_serializing_if = "Option::is_none")]
    original_locator: Option<&'a PublicationLocator>,
    #[serde(skip_serializing_if = "Option::is_none")]
    strategy: Option<RecoveryStrategy>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    candidates: Vec<RecoveryCandidateWrite<'a>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    message: Option<&'a str>,
}

#[derive(Serialize)]
struct RecoveryCandidateWrite<'a> {
    locator: &'a PublicationLocator,
    score: f64,
}

fn write_envelope(envelope: &CitationEnvelopeV1) -> EnvelopeWrite<'_> {
    EnvelopeWrite {
        schema: CITATION_ENVELOPE_SCHEMA,
        version: CITATION_ENVELOPE_VERSION,
        volume_id: &envelope.volume_id,
        edition_id: envelope.edition_id.as_deref(),
        source_revision: &envelope.source_revision,
        locator: &envelope.locator,
        confidence: envelope.confidence,
        label: envelope.label.as_deref(),
        recovery_evidence: envelope
            .recovery_evidence
            .as_ref()
            .map(write_recovery_evidence),
        extensions: (!envelope.extensions.is_empty()).then_some(&envelope.extensions),
    }
}

fn write_recovery_evidence(evidence: &RecoveryEvidence) -> RecoveryEvidenceWrite<'_> {
    RecoveryEvidenceWrite {
        original_locator: evidence.original_locator.as_ref(),
        strategy: evidence.strategy,
        candidates: evidence
            .candidates
            .iter()
            .map(|candidate| RecoveryCandidateWrite {
                locator: &candidate.locator,
                score: candidate.score,
            })
            .collect(),
        message: evidence.message.as_deref(),
    }
}

fn parse_confidence(value: &str) -> Result<CitationConfidence, HaddonError> {
    match value {
        "exact" => Ok(CitationConfidence::Exact),
        "recovered" => Ok(CitationConfidence::Recovered),
        "ambiguous" => Ok(CitationConfidence::Ambiguous),
        "unresolved" => Ok(CitationConfidence::Unresolved),
        _ => Err(invalid_envelope(
            "confidence",
            format!("unknown confidence value: {value}"),
        )),
    }
}

fn parse_recovery_evidence(value: &Value) -> Result<RecoveryEvidence, HaddonError> {
    let object = value.as_object().ok_or_else(|| {
        invalid_envelope(
            "recoveryEvidence",
            "recoveryEvidence must be a JSON object",
        )
    })?;

    let original_locator = match object.get("originalLocator") {
        None | Some(Value::Null) => None,
        Some(value) => Some(PublicationLocator::from_value(value.clone())?.value),
    };

    let strategy = match object.get("strategy") {
        None | Some(Value::Null) => None,
        Some(Value::String(strategy)) => Some(parse_recovery_strategy(strategy)?),
        Some(_) => {
            return Err(invalid_envelope(
                "recoveryEvidence.strategy",
                "strategy must be a string or null",
            ))
        }
    };

    let candidates = match object.get("candidates") {
        None | Some(Value::Null) => Vec::new(),
        Some(Value::Array(items)) => {
            let mut candidates = Vec::new();
            for item in items {
                let candidate = parse_recovery_candidate(item)?;
                candidates.push(candidate);
            }
            candidates
        }
        Some(_) => {
            return Err(invalid_envelope(
                "recoveryEvidence.candidates",
                "candidates must be an array or null",
            ))
        }
    };

    let message = match object.get("message") {
        None | Some(Value::Null) => None,
        Some(Value::String(msg)) if !msg.is_empty() => Some(msg.clone()),
        Some(Value::String(_)) => None,
        Some(_) => {
            return Err(invalid_envelope(
                "recoveryEvidence.message",
                "message must be a string or null",
            ))
        }
    };

    Ok(RecoveryEvidence {
        original_locator,
        strategy,
        candidates,
        message,
    })
}

fn parse_recovery_strategy(value: &str) -> Result<RecoveryStrategy, HaddonError> {
    match value {
        "quote-match" => Ok(RecoveryStrategy::QuoteMatch),
        "fragment-fallback" => Ok(RecoveryStrategy::FragmentFallback),
        "progression-estimate" => Ok(RecoveryStrategy::ProgressionEstimate),
        "manual" => Ok(RecoveryStrategy::Manual),
        _ => Err(invalid_envelope(
            "recoveryEvidence.strategy",
            format!("unknown recovery strategy: {value}"),
        )),
    }
}

fn parse_recovery_candidate(value: &Value) -> Result<RecoveryCandidate, HaddonError> {
    let object = value.as_object().ok_or_else(|| {
        invalid_envelope(
            "recoveryEvidence.candidates",
            "candidate must be a JSON object",
        )
    })?;

    let locator = match object.get("locator") {
        None => {
            return Err(invalid_envelope(
                "recoveryEvidence.candidates.locator",
                "locator is required",
            ))
        }
        Some(value) => PublicationLocator::from_value(value.clone())?.value,
    };

    let score = match object.get("score") {
        None => {
            return Err(invalid_envelope(
                "recoveryEvidence.candidates.score",
                "score is required",
            ))
        }
        Some(Value::Number(num)) if num.is_f64() => {
            let score = num.as_f64().unwrap();
            if !(0.0..=1.0).contains(&score) {
                return Err(invalid_envelope(
                    "recoveryEvidence.candidates.score",
                    "score must be in [0, 1]",
                ));
            }
            score
        }
        Some(_) => {
            return Err(invalid_envelope(
                "recoveryEvidence.candidates.score",
                "score must be a number in [0, 1]",
            ))
        }
    };

    Ok(RecoveryCandidate { locator, score })
}

fn as_json_u64(value: &Value) -> Option<u64> {
    const MAX_JSON_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
    if let Some(integer) = value.as_u64() {
        return (integer <= MAX_JSON_SAFE_INTEGER).then_some(integer);
    }
    let float = value.as_f64()?;
    if float.is_finite() && float >= 0.0 && float.fract() == 0.0 {
        let integer = float as u64;
        if integer as f64 == float && integer <= MAX_JSON_SAFE_INTEGER {
            return Some(integer);
        }
    }
    None
}

fn invalid_envelope(field: impl Into<String>, message: impl Into<String>) -> HaddonError {
    HaddonError::InvalidArgument {
        stage: super::Stage::Locate,
        field: field.into(),
        message: message.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::publication::{LocatorText, PublicationHref, PUBLICATION_LOCATOR_SCHEMA};

    fn example_locator() -> PublicationLocator {
        PublicationLocator::from_json(
            r#"{
                "schema": "haddon.publication-locator",
                "version": 1,
                "href": "text/chapter-1.xhtml",
                "mediaType": "application/xhtml+xml",
                "locations": {
                    "fragments": ["citation-target"]
                },
                "text": {
                    "exact": "the patient moon answered in blue",
                    "prefix": "Before the signal, the copper astrolabe clicked once; ",
                    "suffix": ", and the lesson continued after midnight."
                }
            }"#,
        )
        .unwrap()
        .value
    }

    #[test]
    fn exact_citation_round_trips() {
        let envelope = CitationEnvelopeV1::exact(
            "klemata:work:example-uuid",
            "a3c5f1e9b2d8c4f7a1e6d3b9c8f2e5a7d4b1c9e6f3a8d5b2e9c6f1a4d7b3e0c5",
            example_locator(),
        );

        let json = envelope.to_json();
        let parsed = CitationEnvelopeV1::from_json(&json).unwrap().value;

        assert_eq!(parsed, envelope);
        assert_eq!(parsed.confidence, CitationConfidence::Exact);
        assert!(parsed.recovery_evidence.is_none());
    }

    #[test]
    fn recovered_citation_preserves_evidence() {
        let original = example_locator();
        let recovered = example_locator();

        let evidence = RecoveryEvidence {
            original_locator: Some(original),
            strategy: Some(RecoveryStrategy::QuoteMatch),
            candidates: Vec::new(),
            message: Some("Normalizer revision changed".to_string()),
        };

        let envelope = CitationEnvelopeV1::recovered(
            "klemata:work:example-uuid",
            "a3c5f1e9b2d8c4f7a1e6d3b9c8f2e5a7d4b1c9e6f3a8d5b2e9c6f1a4d7b3e0c5",
            recovered,
            evidence,
        );

        let json = envelope.to_json();
        let parsed = CitationEnvelopeV1::from_json(&json).unwrap().value;

        assert_eq!(parsed.confidence, CitationConfidence::Recovered);
        assert!(parsed.recovery_evidence.is_some());
        let evidence = parsed.recovery_evidence.unwrap();
        assert!(evidence.original_locator.is_some());
        assert_eq!(evidence.strategy, Some(RecoveryStrategy::QuoteMatch));
        assert_eq!(
            evidence.message,
            Some("Normalizer revision changed".to_string())
        );
    }

    #[test]
    fn ambiguous_citation_includes_candidates() {
        let locator1 = example_locator();
        let locator2 = example_locator();

        let evidence = RecoveryEvidence {
            original_locator: None,
            strategy: Some(RecoveryStrategy::QuoteMatch),
            candidates: vec![
                RecoveryCandidate {
                    locator: locator1,
                    score: 0.95,
                },
                RecoveryCandidate {
                    locator: locator2,
                    score: 0.95,
                },
            ],
            message: Some("Multiple instances with equal confidence".to_string()),
        };

        let envelope = CitationEnvelopeV1::ambiguous(
            "klemata:work:example-uuid",
            "a3c5f1e9b2d8c4f7a1e6d3b9c8f2e5a7d4b1c9e6f3a8d5b2e9c6f1a4d7b3e0c5",
            example_locator(),
            evidence,
        );

        let json = envelope.to_json();
        let parsed = CitationEnvelopeV1::from_json(&json).unwrap().value;

        assert_eq!(parsed.confidence, CitationConfidence::Ambiguous);
        let evidence = parsed.recovery_evidence.unwrap();
        assert_eq!(evidence.candidates.len(), 2);
        assert_eq!(evidence.candidates[0].score, 0.95);
        assert_eq!(evidence.candidates[1].score, 0.95);
    }

    #[test]
    fn missing_required_fields_fail() {
        let result = CitationEnvelopeV1::from_json(
            r#"{
                "schema": "haddon.citation-envelope",
                "version": 1,
                "sourceRevision": "abc123"
            }"#,
        );
        assert!(result.is_err());
        match result {
            Err(HaddonError::InvalidArgument { field, .. }) => {
                assert_eq!(field, "volumeId");
            }
            _ => panic!("expected InvalidArgument error for missing volumeId"),
        }
    }

    #[test]
    fn wrong_schema_fails() {
        let result = CitationEnvelopeV1::from_json(
            r#"{
                "schema": "wrong.schema",
                "version": 1,
                "volumeId": "vol-1",
                "sourceRevision": "abc123",
                "locator": {},
                "confidence": "exact"
            }"#,
        );
        assert!(result.is_err());
    }

    #[test]
    fn unsupported_version_fails() {
        let result = CitationEnvelopeV1::from_json(
            r#"{
                "schema": "haddon.citation-envelope",
                "version": 2,
                "volumeId": "vol-1",
                "sourceRevision": "abc123",
                "locator": {},
                "confidence": "exact"
            }"#,
        );
        assert!(result.is_err());
    }

    #[test]
    fn label_and_edition_id_are_optional() {
        let mut envelope = CitationEnvelopeV1::exact(
            "klemata:work:example-uuid",
            "a3c5f1e9b2d8c4f7a1e6d3b9c8f2e5a7d4b1c9e6f3a8d5b2e9c6f1a4d7b3e0c5",
            example_locator(),
        );
        envelope.label = Some("Test label".to_string());
        envelope.edition_id = Some("edition-123".to_string());

        let json = envelope.to_json();
        let parsed = CitationEnvelopeV1::from_json(&json).unwrap().value;

        assert_eq!(parsed.label, Some("Test label".to_string()));
        assert_eq!(parsed.edition_id, Some("edition-123".to_string()));
    }
}
