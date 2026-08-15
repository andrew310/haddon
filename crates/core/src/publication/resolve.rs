//! Locator resolution (HADDON-018).
//!
//! Turns a persisted citation back into a passage in an opened publication.

use super::locator::{
    DomPointSelector, DomRangeSelector, LocatorLocations, LocatorText, NormalizedPointSelector,
    NormalizedRangeSelector, PublicationLocator, TextOffset, PUBLICATION_LOCATOR_SCHEMA,
    PUBLICATION_LOCATOR_VERSION,
};
use super::normalize::{
    utf16_len, utf16_slice, MappingResult, NodeSourceEvidence, NormalizationResult,
    NormalizedResource, SourceNodeRef, SupportAssessment,
};
use super::{
    CapabilityAvailability, CapabilityDescriptor, CapabilityLimitation, CapabilityProvider,
    CapabilityScope, HaddonError, HaddonResult, Outcome, OwnerKind, Publication, PublicationHref,
    PublicationProfile, PublicationWarning, ServiceKind, Stage,
};

pub(super) fn locator_capability() -> CapabilityDescriptor {
    CapabilityDescriptor {
        kind: ServiceKind::Locator,
        version: "haddon.locator/1".to_string(),
        availability: CapabilityAvailability::Available,
        provider: CapabilityProvider::Core,
        scope: CapabilityScope {
            profiles: vec![PublicationProfile::Epub],
            media_types: vec!["application/xhtml+xml".to_string(), "text/html".to_string()],
            ..CapabilityScope::default()
        },
        features: vec![
            "normalized".to_string(),
            "fragment".to_string(),
            "quote".to_string(),
        ],
        limitations: vec![CapabilityLimitation {
            code: "haddon.locator.epub-cfi-opaque".to_string(),
            message: "EPUB CFI is stored but not parsed in this revision".to_string(),
            href: None,
        }],
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ResolutionPolicy {
    Citation,
    Navigation,
    Resume,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ResolutionStrategy {
    Normalized,
    EpubCfi,
    Fragment,
    DomRange,
    CssSelector,
    Quote,
    Position,
    Progression,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum ResolutionConfidence {
    Weak,
    Strong,
    Exact,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ResolutionEvidence {
    pub selector: String,
    pub outcome: String,
    pub detail: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ResolutionCandidate {
    pub locator: PublicationLocator,
    pub strategy: ResolutionStrategy,
    pub confidence: ResolutionConfidence,
}

#[derive(Clone, Debug, PartialEq)]
pub struct ResolvedTarget {
    pub href: PublicationHref,
    pub reading_order_index: Option<usize>,
    pub block_id: Option<String>,
    pub start: Option<u64>,
    pub end: Option<u64>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum LocatorResolution {
    Resolved {
        target: ResolvedTarget,
        locator: PublicationLocator,
        strategy: ResolutionStrategy,
        confidence: ResolutionConfidence,
        evidence: Vec<ResolutionEvidence>,
        warnings: Vec<PublicationWarning>,
    },
    Ambiguous {
        candidates: Vec<ResolutionCandidate>,
        total_candidate_count: usize,
        evidence: Vec<ResolutionEvidence>,
        reason: &'static str,
        warnings: Vec<PublicationWarning>,
    },
    Unresolved {
        evidence: Vec<ResolutionEvidence>,
        reason: &'static str,
        warnings: Vec<PublicationWarning>,
    },
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct Passage {
    block_id: String,
    start: u64,
    end: u64,
    strategy: ResolutionStrategy,
}

impl Publication {
    pub fn resolve(
        &self,
        locator: &PublicationLocator,
        policy: ResolutionPolicy,
    ) -> HaddonResult<LocatorResolution> {
        ensure_open_for_locate(self)?;
        Ok(Outcome::complete(self.resolve_inner(locator, policy)?))
    }

    pub fn locator_from_normalized(
        &self,
        href: &str,
        block_id: &str,
        start: u64,
        end: u64,
    ) -> HaddonResult<PublicationLocator> {
        ensure_open_for_locate(self)?;
        let href = PublicationHref::new(href).map_err(relocate_href_error)?;
        let resource = self.normalized_resource(href.as_str())?;
        let locator = build_locator(self, &resource, block_id, start, end)?;
        Ok(Outcome::complete(locator))
    }

    fn resolve_inner(
        &self,
        locator: &PublicationLocator,
        policy: ResolutionPolicy,
    ) -> Result<LocatorResolution, HaddonError> {
        let mut evidence = Vec::new();
        let Some(link) = self
            .manifest()
            .resource_link(&locator.href)
            .or_else(|| self.manifest().resource_link(&locator.href.without_query()))
        else {
            evidence.push(evidence_line(
                "href",
                "unavailable",
                "href is not an owned publication resource",
            ));
            return Ok(LocatorResolution::Unresolved {
                evidence,
                reason: "resource-missing",
                warnings: Vec::new(),
            });
        };
        evidence.push(evidence_line("href", "matched", link.href.as_str()));

        if locator.locations.epub_cfi.is_some() {
            evidence.push(evidence_line(
                "epub-cfi",
                "unavailable",
                "EPUB CFI is opaque in this revision",
            ));
        }

        let resource = match self.supports_normalization(link.href.as_str())?.value {
            SupportAssessment::Unsupported { reason } => {
                evidence.push(evidence_line("normalized", "unavailable", &reason.message));
                return Ok(LocatorResolution::Unresolved {
                    evidence,
                    reason: "unsupported",
                    warnings: Vec::new(),
                });
            }
            _ => self.normalized_resource(link.href.as_str())?,
        };

        let quote_hits = quote_passages(&resource, locator, &mut evidence);
        let fragment_blocks = fragment_blocks(&resource, locator, &mut evidence);
        let normalized_hit = normalized_passage(&resource, locator, &mut evidence);

        if let Some(css) = locator.locations.css_selector.as_deref() {
            if find_block_by_css(&resource, css).is_some() {
                evidence.push(evidence_line("css-selector", "matched", css));
            } else {
                evidence.push(evidence_line(
                    "css-selector",
                    "unavailable",
                    "no node carries this cssSelector",
                ));
            }
        }

        let agreed = agree_passages(
            normalized_hit,
            &quote_hits,
            &fragment_blocks,
            locator,
            &mut evidence,
        );

        match agreed {
            PassageDecision::Unique(passage) => {
                finish_unique(self, &resource, locator, policy, passage, evidence)
            }
            PassageDecision::Ambiguous { passages, reason } => {
                let total = passages.len();
                let candidates = passages
                    .into_iter()
                    .map(|passage| {
                        let built = build_locator(
                            self,
                            &resource,
                            &passage.block_id,
                            passage.start,
                            passage.end,
                        )?;
                        Ok(ResolutionCandidate {
                            locator: built,
                            strategy: passage.strategy,
                            confidence: confidence_for(&passage, locator),
                        })
                    })
                    .collect::<Result<Vec<_>, HaddonError>>()?;
                Ok(LocatorResolution::Ambiguous {
                    candidates,
                    total_candidate_count: total,
                    evidence,
                    reason,
                    warnings: Vec::new(),
                })
            }
            PassageDecision::None { reason } => Ok(LocatorResolution::Unresolved {
                evidence,
                reason,
                warnings: Vec::new(),
            }),
        }
    }

    fn normalized_resource(&self, href: &str) -> Result<NormalizedResource, HaddonError> {
        match self.normalize(href)?.value {
            NormalizationResult::Normalized(resource) => Ok(resource),
            NormalizationResult::Unsupported { media_type, .. } => {
                Err(HaddonError::CapabilityUnavailable {
                    kind: ServiceKind::Normalization,
                    reason: format!("{href} ({media_type}) cannot be normalized"),
                })
            }
        }
    }
}

enum PassageDecision {
    Unique(Passage),
    Ambiguous {
        passages: Vec<Passage>,
        reason: &'static str,
    },
    None {
        reason: &'static str,
    },
}

fn finish_unique(
    publication: &Publication,
    resource: &NormalizedResource,
    incoming: &PublicationLocator,
    policy: ResolutionPolicy,
    passage: Passage,
    evidence: Vec<ResolutionEvidence>,
) -> Result<LocatorResolution, HaddonError> {
    let confidence = confidence_for(&passage, incoming);
    if policy == ResolutionPolicy::Citation
        && !matches!(
            confidence,
            ResolutionConfidence::Exact | ResolutionConfidence::Strong
        )
    {
        return Ok(LocatorResolution::Unresolved {
            evidence,
            reason: "no-match",
            warnings: Vec::new(),
        });
    }

    let locator = build_locator(
        publication,
        resource,
        &passage.block_id,
        passage.start,
        passage.end,
    )?;
    let reading_order_index = publication
        .manifest()
        .reading_order
        .iter()
        .position(|link| link.href.as_str() == resource.href);
    Ok(LocatorResolution::Resolved {
        target: ResolvedTarget {
            href: locator.href.clone(),
            reading_order_index,
            block_id: Some(passage.block_id),
            start: Some(passage.start),
            end: Some(passage.end),
        },
        locator,
        strategy: passage.strategy,
        confidence,
        evidence,
        warnings: Vec::new(),
    })
}

fn confidence_for(passage: &Passage, incoming: &PublicationLocator) -> ResolutionConfidence {
    let extracted_ok = incoming.text.as_ref().is_some_and(|text| {
        // Confidence is assigned after we already agreed the passage; quote
        // agreement is Exact, structural-only is Strong, fragment-only is Weak.
        !text.exact.is_empty() && passage.strategy != ResolutionStrategy::Fragment
    });
    match passage.strategy {
        ResolutionStrategy::Normalized | ResolutionStrategy::Quote
            if incoming.text.as_ref().is_some_and(|text| {
                text.prefix.is_some() && text.suffix.is_some() && extracted_ok
            }) =>
        {
            ResolutionConfidence::Exact
        }
        ResolutionStrategy::Normalized
        | ResolutionStrategy::Quote
        | ResolutionStrategy::DomRange => {
            if incoming.text.is_some() {
                ResolutionConfidence::Exact
            } else {
                ResolutionConfidence::Strong
            }
        }
        ResolutionStrategy::Fragment
        | ResolutionStrategy::CssSelector
        | ResolutionStrategy::Position
        | ResolutionStrategy::Progression
        | ResolutionStrategy::EpubCfi => ResolutionConfidence::Weak,
    }
}

fn agree_passages(
    normalized: Option<Passage>,
    quotes: &[Passage],
    fragment_blocks: &[String],
    locator: &PublicationLocator,
    evidence: &mut Vec<ResolutionEvidence>,
) -> PassageDecision {
    let fragment_filtered_quotes: Vec<Passage> =
        if fragment_blocks.is_empty() || locator.locations.fragments.is_empty() {
            quotes.to_vec()
        } else {
            quotes
                .iter()
                .filter(|quote| fragment_blocks.iter().any(|block| block == &quote.block_id))
                .cloned()
                .collect()
        };

    if !locator.locations.fragments.is_empty()
        && !quotes.is_empty()
        && fragment_filtered_quotes.is_empty()
    {
        evidence.push(evidence_line(
            "fragment",
            "contradicted",
            "quote matches do not lie inside the cited fragment",
        ));
        return PassageDecision::Ambiguous {
            passages: quotes.to_vec(),
            reason: "conflicting-selectors",
        };
    }

    if let Some(normalized) = normalized {
        if !fragment_filtered_quotes.is_empty() {
            let matching: Vec<_> = fragment_filtered_quotes
                .iter()
                .filter(|quote| same_passage(quote, &normalized))
                .cloned()
                .collect();
            let conflicting: Vec<_> = fragment_filtered_quotes
                .iter()
                .filter(|quote| !same_passage(quote, &normalized))
                .cloned()
                .collect();
            if !conflicting.is_empty() && matching.is_empty() {
                evidence.push(evidence_line(
                    "normalized",
                    "contradicted",
                    "normalized range and quote point at different passages",
                ));
                let mut passages = vec![normalized];
                passages.extend(conflicting);
                return PassageDecision::Ambiguous {
                    passages,
                    reason: "conflicting-selectors",
                };
            }
        }
        return PassageDecision::Unique(normalized);
    }

    match fragment_filtered_quotes.len() {
        0 => {
            if fragment_blocks.len() == 1 {
                if let Some(block_id) = fragment_blocks.first() {
                    return PassageDecision::Unique(Passage {
                        block_id: block_id.clone(),
                        start: 0,
                        end: 0,
                        strategy: ResolutionStrategy::Fragment,
                    });
                }
            }
            if fragment_blocks.len() > 1 {
                return PassageDecision::Ambiguous {
                    passages: fragment_blocks
                        .iter()
                        .map(|block_id| Passage {
                            block_id: block_id.clone(),
                            start: 0,
                            end: 0,
                            strategy: ResolutionStrategy::Fragment,
                        })
                        .collect(),
                    reason: "multiple-matches",
                };
            }
            PassageDecision::None { reason: "no-match" }
        }
        1 => PassageDecision::Unique(fragment_filtered_quotes[0].clone()),
        _ => PassageDecision::Ambiguous {
            passages: fragment_filtered_quotes,
            reason: "multiple-matches",
        },
    }
}

fn same_passage(left: &Passage, right: &Passage) -> bool {
    left.block_id == right.block_id && left.start == right.start && left.end == right.end
}

fn normalized_passage(
    resource: &NormalizedResource,
    locator: &PublicationLocator,
    evidence: &mut Vec<ResolutionEvidence>,
) -> Option<Passage> {
    let Some(range) = &locator.locations.normalized else {
        return None;
    };
    if range.revision != resource.normalization.revision {
        evidence.push(evidence_line(
            "normalized",
            "unavailable",
            "normalized.revision does not match the active normalizer",
        ));
        return None;
    }
    let end = range
        .end
        .as_ref()
        .map(|end| end.offset.value)
        .unwrap_or(range.start.offset.value);
    if range
        .end
        .as_ref()
        .is_some_and(|end| end.block_id != range.start.block_id)
    {
        evidence.push(evidence_line(
            "normalized",
            "invalid",
            "normalized range crosses blocks",
        ));
        return None;
    }
    match resource.text_block(&range.start.block_id) {
        Some(block) if utf16_slice(&block.text, range.start.offset.value, end).is_some() => {
            evidence.push(evidence_line(
                "normalized",
                "matched",
                &range.start.block_id,
            ));
            Some(Passage {
                block_id: range.start.block_id.clone(),
                start: range.start.offset.value,
                end,
                strategy: ResolutionStrategy::Normalized,
            })
        }
        _ => {
            evidence.push(evidence_line(
                "normalized",
                "invalid",
                "normalized range is not a valid block offset",
            ));
            None
        }
    }
}

fn fragment_blocks(
    resource: &NormalizedResource,
    locator: &PublicationLocator,
    evidence: &mut Vec<ResolutionEvidence>,
) -> Vec<String> {
    if locator.locations.fragments.is_empty() {
        return Vec::new();
    }
    let mut blocks = Vec::new();
    resource.root.for_each_block(&mut |block| {
        for fragment in &locator.locations.fragments {
            if block_has_fragment(block.id(), &block.base().source, fragment) {
                blocks.push(block.id().to_string());
            }
        }
    });
    if blocks.is_empty() {
        evidence.push(evidence_line(
            "fragment",
            "unavailable",
            "no node matches the supplied fragments",
        ));
    } else {
        evidence.push(evidence_line(
            "fragment",
            "matched",
            &locator.locations.fragments.join(","),
        ));
    }
    blocks
}

fn quote_passages(
    resource: &NormalizedResource,
    locator: &PublicationLocator,
    evidence: &mut Vec<ResolutionEvidence>,
) -> Vec<Passage> {
    let Some(text) = &locator.text else {
        return Vec::new();
    };
    if text.exact.is_empty() {
        evidence.push(evidence_line("quote", "invalid", "text.exact is empty"));
        return Vec::new();
    }
    let mut hits = Vec::new();
    resource.root.for_each_block(&mut |block| {
        let Some(paragraph) = block.as_text_block() else {
            return;
        };
        for (start, end) in find_exact_ranges(&paragraph.text, &text.exact) {
            if context_agrees(&paragraph.text, start, end, text) {
                hits.push(Passage {
                    block_id: paragraph.base.id.clone(),
                    start,
                    end,
                    strategy: ResolutionStrategy::Quote,
                });
            }
        }
    });
    match hits.len() {
        0 => evidence.push(evidence_line(
            "quote",
            "unavailable",
            "text.exact was not found in this resource",
        )),
        1 => evidence.push(evidence_line("quote", "matched", &text.exact)),
        _ => evidence.push(evidence_line(
            "quote",
            "matched",
            &format!("{} quote matches", hits.len()),
        )),
    }
    hits
}

fn find_exact_ranges(text: &str, exact: &str) -> Vec<(u64, u64)> {
    let needle = utf16_len(exact);
    let hay = utf16_len(text);
    if needle == 0 || needle > hay {
        return Vec::new();
    }
    let mut hits = Vec::new();
    let mut start = 0;
    while start + needle <= hay {
        if utf16_slice(text, start, start + needle).as_deref() == Some(exact) {
            hits.push((start, start + needle));
        }
        start += 1;
    }
    hits
}

fn context_agrees(text: &str, start: u64, end: u64, quote: &LocatorText) -> bool {
    if let Some(prefix) = &quote.prefix {
        let prefix_len = utf16_len(prefix);
        if start < prefix_len {
            return false;
        }
        if utf16_slice(text, start - prefix_len, start).as_deref() != Some(prefix.as_str()) {
            return false;
        }
    }
    if let Some(suffix) = &quote.suffix {
        let suffix_len = utf16_len(suffix);
        if utf16_slice(text, end, end + suffix_len).as_deref() != Some(suffix.as_str()) {
            return false;
        }
    }
    true
}

fn block_has_fragment(id: &str, source: &NodeSourceEvidence, fragment: &str) -> bool {
    id.rsplit_once('#')
        .is_some_and(|(_, suffix)| suffix == fragment)
        || source_fragment(source) == Some(fragment)
}

fn source_fragment(source: &NodeSourceEvidence) -> Option<&str> {
    match source {
        NodeSourceEvidence::Source { primary, .. } => match primary {
            SourceNodeRef::Element(element) => element.fragment.as_deref(),
            SourceNodeRef::Text(text) => text.container.fragment.as_deref(),
        },
        NodeSourceEvidence::Generated { .. } => None,
    }
}

fn find_block_by_css<'a>(resource: &'a NormalizedResource, css: &str) -> Option<&'a str> {
    let mut found = None;
    resource.root.for_each_block(&mut |block| {
        if found.is_none() {
            if let NodeSourceEvidence::Source {
                primary: SourceNodeRef::Element(element),
                ..
            } = &block.base().source
            {
                if element.css_selector.as_deref() == Some(css) {
                    found = Some(block.id());
                }
            }
        }
    });
    found
}

fn build_locator(
    publication: &Publication,
    resource: &NormalizedResource,
    block_id: &str,
    start: u64,
    end: u64,
) -> Result<PublicationLocator, HaddonError> {
    let block = resource
        .text_block(block_id)
        .ok_or_else(|| HaddonError::InvalidArgument {
            stage: Stage::Locate,
            field: "blockId".to_string(),
            message: format!("{block_id} is not a text block in {}", resource.href),
        })?;
    let (start, end) = if start == 0 && end == 0 && block.utf16_len() > 0 {
        // Fragment-only navigation: address the whole block.
        (0, block.utf16_len())
    } else {
        (start, end)
    };
    let exact =
        utf16_slice(&block.text, start, end).ok_or_else(|| HaddonError::InvalidArgument {
            stage: Stage::Locate,
            field: "offset".to_string(),
            message: format!("[{start}, {end}) is not a valid UTF-16 range in {block_id}"),
        })?;
    let prefix = (start > 0)
        .then(|| utf16_slice(&block.text, 0, start))
        .flatten();
    let suffix = (end < block.utf16_len())
        .then(|| utf16_slice(&block.text, end, block.utf16_len()))
        .flatten();

    let fragment = source_fragment(&block.base.source).map(str::to_string);
    let css_selector = match &block.base.source {
        NodeSourceEvidence::Source {
            primary: SourceNodeRef::Element(element),
            ..
        } => element.css_selector.clone(),
        _ => None,
    };
    let dom_range = match resource.map_normalized_range(block_id, start, end) {
        MappingResult::Exact { value, .. } => span_to_dom_range(&value),
        _ => None,
    };

    let media_type = publication
        .manifest()
        .resource_link(&PublicationHref::new(&resource.href).map_err(relocate_href_error)?)
        .map(|link| link.media_type.clone())
        .unwrap_or_else(|| resource.media_type.clone());

    let href = PublicationHref::new(&resource.href).map_err(relocate_href_error)?;
    let normalized = NormalizedRangeSelector {
        revision: resource.normalization.revision.clone(),
        start: NormalizedPointSelector {
            block_id: block_id.to_string(),
            offset: TextOffset::utf16(start),
        },
        end: (end != start).then_some(NormalizedPointSelector {
            block_id: block_id.to_string(),
            offset: TextOffset::utf16(end),
        }),
    };

    Ok(PublicationLocator {
        schema: PUBLICATION_LOCATOR_SCHEMA.to_string(),
        version: PUBLICATION_LOCATOR_VERSION,
        href,
        media_type,
        title: None,
        locations: LocatorLocations {
            fragments: fragment.into_iter().collect(),
            epub_cfi: None,
            css_selector,
            dom_range,
            normalized: Some(normalized),
            progression: None,
            total_progression: None,
            position: None,
        },
        text: Some(LocatorText {
            exact,
            prefix,
            suffix,
        }),
        extensions: Default::default(),
    })
}

fn span_to_dom_range(span: &super::normalize::SourceTextSpan) -> Option<DomRangeSelector> {
    let first = span.parts.first()?;
    let last = span.parts.last()?;
    Some(DomRangeSelector {
        start: DomPointSelector {
            css_selector: first.start.node.container.css_selector.clone()?,
            text_node_index: u64::from(first.start.node.text_node_index),
            offset: Some(TextOffset::utf16(first.start.offset.value)),
        },
        end: Some(DomPointSelector {
            css_selector: last.end.node.container.css_selector.clone()?,
            text_node_index: u64::from(last.end.node.text_node_index),
            offset: Some(TextOffset::utf16(last.end.offset.value)),
        }),
    })
}

fn ensure_open_for_locate(publication: &Publication) -> Result<(), HaddonError> {
    if publication.is_closed() {
        Err(HaddonError::Closed {
            stage: Stage::Locate,
            owner: OwnerKind::Publication,
        })
    } else {
        Ok(())
    }
}

fn evidence_line(selector: &str, outcome: &str, detail: &str) -> ResolutionEvidence {
    ResolutionEvidence {
        selector: selector.to_string(),
        outcome: outcome.to_string(),
        detail: Some(detail.to_string()),
    }
}

fn relocate_href_error(error: HaddonError) -> HaddonError {
    match error {
        HaddonError::InvalidArgument { field, message, .. } => HaddonError::InvalidArgument {
            stage: Stage::Locate,
            field,
            message,
        },
        other => other,
    }
}
