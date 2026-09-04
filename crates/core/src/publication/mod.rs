mod citation;
mod epub;
mod fixture;
mod href;
mod html;
mod locator;
mod model;
pub mod normalize;
mod resolve;
mod resource;

pub use citation::{
    CitationConfidence, CitationEnvelopeV1, RecoveryCandidate, RecoveryEvidence,
    RecoveryStrategy, CITATION_ENVELOPE_SCHEMA, CITATION_ENVELOPE_VERSION,
};
pub use fixture::citation_roundtrip_epub;
pub use href::PublicationHref;
pub use html::render_normalized_html;
pub use locator::{
    is_valid_progression, is_valid_utf16_offset, utf16_len, utf16_offset_at_byte, utf16_slice,
    DomPointSelector, DomRangeSelector, LocatorLocations, LocatorText, NormalizedPointSelector,
    NormalizedRangeSelector, PublicationLocator, TextOffset, TextOffsetUnit,
    PUBLICATION_LOCATOR_SCHEMA, PUBLICATION_LOCATOR_VERSION, WARNING_SELECTOR_DROPPED,
    WARNING_UNKNOWN_KEY,
};
pub use model::{
    Contributor, LocalizedString, Manifest, Navigation, PublicationIdentity,
    PublicationIdentityHint, PublicationMetadata, PublicationProfile, ReadingProgression,
    RenditionHints, ResourceLink,
};
pub use normalize::{
    default_normalization_stamp, is_utf16_boundary, project_inlines, AsideDisposition, BlockNode,
    DocumentNode, InlineNode, LinkTarget, MappingResult, NormalizationResult, NormalizationStampV1,
    NormalizationWarning, NormalizedResource, NormalizedTextRange, NoteKind, SemanticRole,
    SourceMapSegment, SourceNodeRef, SourceTextSpan, SupportAssessment, TextBlock, TextBlockRole,
    TextTransform, UnmappedReason,
};
pub use resolve::{
    LocatorResolution, ResolutionCandidate, ResolutionConfidence, ResolutionEvidence,
    ResolutionPolicy, ResolutionStrategy, ResolvedTarget,
};
pub use resource::{ByteRange, Resource};

use crate::epub::parse_epub;
use crate::types::EpubDocument;
use resource::{STATE_CLOSED, STATE_OPEN};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicU8, Ordering};
use std::sync::Arc;
use thiserror::Error;

pub type HaddonResult<T> = Result<Outcome<T>, HaddonError>;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Completeness {
    Complete,
    Partial,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Coverage {
    pub included_hrefs: Vec<PublicationHref>,
    pub omitted_hrefs: Vec<PublicationHref>,
    pub completed_units: Option<u64>,
    pub total_units: Option<u64>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Outcome<T> {
    pub value: T,
    pub completeness: Completeness,
    pub warnings: Vec<PublicationWarning>,
    pub coverage: Option<Coverage>,
}

impl<T> Outcome<T> {
    pub fn complete(value: T) -> Self {
        Self {
            value,
            completeness: Completeness::Complete,
            warnings: Vec::new(),
            coverage: None,
        }
    }

    pub fn partial(
        value: T,
        warnings: Vec<PublicationWarning>,
        coverage: Option<Coverage>,
    ) -> Self {
        assert!(
            !warnings.is_empty(),
            "a partial outcome requires at least one explanatory warning"
        );
        Self {
            value,
            completeness: Completeness::Partial,
            warnings,
            coverage,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Stage {
    Open,
    Manifest,
    Resource,
    Normalize,
    Locate,
    Search,
    Positions,
    Rendition,
    Close,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WarningSeverity {
    Info,
    Caution,
    Major,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Recovery {
    Ignored,
    Defaulted,
    Repaired,
    Omitted,
    FallbackUsed,
    Degraded,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PublicationWarning {
    pub code: String,
    pub severity: WarningSeverity,
    pub stage: Stage,
    pub message: String,
    pub href: Option<PublicationHref>,
    pub recovery: Option<Recovery>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OwnerKind {
    Publication,
    Resource,
    Service,
    Session,
}

#[derive(Error, Clone, Debug, PartialEq, Eq)]
pub enum HaddonError {
    #[error("{owner:?} is closed during {stage:?}")]
    Closed { stage: Stage, owner: OwnerKind },
    #[error("invalid argument {field} during {stage:?}: {message}")]
    InvalidArgument {
        stage: Stage,
        field: String,
        message: String,
    },
    #[error("unsupported publication format")]
    FormatUnsupported,
    #[error("invalid publication format during {stage:?}: {message}")]
    FormatInvalid { stage: Stage, message: String },
    #[error("corrupt publication container: {message}")]
    ContainerCorrupt { message: String },
    #[error("required publication resource is missing: {href}")]
    RequiredResourceMissing { href: PublicationHref },
    #[error("owned publication resource is missing: {href}")]
    ResourceNotFound { href: PublicationHref },
    #[error("failed to read resource {href}: {message}")]
    ResourceReadFailed {
        href: PublicationHref,
        retryable: bool,
        message: String,
    },
    #[error("failed to decode resource during open: {message}")]
    DecodeFailed {
        href: Option<PublicationHref>,
        message: String,
    },
    #[error("capability {kind:?} is unavailable: {reason}")]
    CapabilityUnavailable { kind: ServiceKind, reason: String },
}

impl HaddonError {
    pub fn code(&self) -> &'static str {
        match self {
            Self::Closed { .. } => "haddon.closed",
            Self::InvalidArgument { .. } => "haddon.invalid-argument",
            Self::FormatUnsupported => "haddon.format-unsupported",
            Self::FormatInvalid { .. } => "haddon.format-invalid",
            Self::ContainerCorrupt { .. } => "haddon.container-corrupt",
            Self::RequiredResourceMissing { .. } => "haddon.required-resource-missing",
            Self::ResourceNotFound { .. } => "haddon.resource-not-found",
            Self::ResourceReadFailed { .. } => "haddon.resource-read-failed",
            Self::DecodeFailed { .. } => "haddon.decode-failed",
            Self::CapabilityUnavailable { .. } => "haddon.capability-unavailable",
        }
    }

    pub fn stage(&self) -> Stage {
        match self {
            Self::Closed { stage, .. }
            | Self::InvalidArgument { stage, .. }
            | Self::FormatInvalid { stage, .. } => *stage,
            Self::FormatUnsupported | Self::ContainerCorrupt { .. } => Stage::Open,
            Self::RequiredResourceMissing { .. } => Stage::Open,
            Self::ResourceNotFound { .. } | Self::ResourceReadFailed { .. } => Stage::Resource,
            Self::DecodeFailed { .. } => Stage::Open,
            Self::CapabilityUnavailable { .. } => Stage::Open,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum ServiceKind {
    Normalization,
    Locator,
    Search,
    Positions,
    Rendition,
}

impl ServiceKind {
    pub const ALL: [Self; 5] = [
        Self::Normalization,
        Self::Locator,
        Self::Search,
        Self::Positions,
        Self::Rendition,
    ];

    fn contract_name(self) -> &'static str {
        match self {
            Self::Normalization => "haddon.normalization/1",
            Self::Locator => "haddon.locator/1",
            Self::Search => "haddon.search/1",
            Self::Positions => "haddon.positions/1",
            Self::Rendition => "haddon.rendition/1",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CapabilityAvailability {
    Available,
    Partial,
    Unavailable,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CapabilityProvider {
    Core,
    Wasm,
    Navigator,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct CapabilityScope {
    pub profiles: Vec<PublicationProfile>,
    pub media_types: Vec<String>,
    pub included_hrefs: Vec<PublicationHref>,
    pub excluded_hrefs: Vec<PublicationHref>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CapabilityLimitation {
    pub code: String,
    pub message: String,
    pub href: Option<PublicationHref>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CapabilityDescriptor {
    pub kind: ServiceKind,
    pub version: String,
    pub availability: CapabilityAvailability,
    pub provider: CapabilityProvider,
    pub scope: CapabilityScope,
    pub features: Vec<String>,
    pub limitations: Vec<CapabilityLimitation>,
}

impl CapabilityDescriptor {
    fn unavailable(kind: ServiceKind) -> Self {
        Self {
            kind,
            version: kind.contract_name().to_string(),
            availability: CapabilityAvailability::Unavailable,
            provider: CapabilityProvider::Core,
            scope: CapabilityScope {
                profiles: vec![PublicationProfile::Epub],
                ..CapabilityScope::default()
            },
            features: Vec::new(),
            limitations: vec![CapabilityLimitation {
                code: "haddon.capability.not-installed".to_string(),
                message: "this publication skeleton has no provider for the service".to_string(),
                href: None,
            }],
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OpenMode {
    Recover,
    Strict,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OpenOptions {
    pub mode: OpenMode,
    pub identity: PublicationIdentityHint,
}

impl Default for OpenOptions {
    fn default() -> Self {
        Self {
            mode: OpenMode::Recover,
            identity: PublicationIdentityHint::default(),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum OpenStatus {
    Complete,
    Partial,
}

pub struct OpenPublication {
    pub publication: Publication,
    pub open_status: OpenStatus,
}

pub struct Publication {
    identity: PublicationIdentity,
    manifest: Arc<Manifest>,
    source: Arc<[u8]>,
    resource_paths: BTreeMap<PublicationHref, String>,
    capabilities: Vec<CapabilityDescriptor>,
    warnings: Vec<PublicationWarning>,
    state: Arc<AtomicU8>,
}

impl Publication {
    pub fn identity(&self) -> &PublicationIdentity {
        &self.identity
    }

    pub fn manifest(&self) -> &Manifest {
        &self.manifest
    }

    pub fn capabilities(&self) -> &[CapabilityDescriptor] {
        &self.capabilities
    }

    pub fn capability(&self, kind: ServiceKind) -> &CapabilityDescriptor {
        self.capabilities
            .iter()
            .find(|descriptor| descriptor.kind == kind)
            .expect("every standard capability has one descriptor")
    }

    pub fn has_service(&self, kind: ServiceKind) -> bool {
        self.capability(kind).availability != CapabilityAvailability::Unavailable
    }

    pub fn warnings(&self) -> &[PublicationWarning] {
        &self.warnings
    }

    pub fn is_closed(&self) -> bool {
        self.state.load(Ordering::Acquire) != STATE_OPEN
    }

    pub fn get_resource(&self, target: &str) -> HaddonResult<Option<Resource>> {
        self.ensure_open(Stage::Resource)?;
        let href = PublicationHref::new(target).map_err(|error| match error {
            HaddonError::InvalidArgument { field, message, .. } => HaddonError::InvalidArgument {
                stage: Stage::Resource,
                field,
                message,
            },
            other => other,
        })?;
        let mut warnings = Vec::new();

        let (owned_href, archive_path) = if let Some(path) = self.resource_paths.get(&href) {
            (href, path)
        } else {
            let without_query = href.without_query();
            let Some(path) = self.resource_paths.get(&without_query) else {
                return Ok(Outcome::complete(None));
            };
            warnings.push(PublicationWarning {
                code: "haddon.resource.query-fallback-used".to_string(),
                severity: WarningSeverity::Caution,
                stage: Stage::Resource,
                message: "resource lookup ignored an unmatched query component".to_string(),
                href: Some(href),
                recovery: Some(Recovery::FallbackUsed),
            });
            (without_query, path)
        };

        let link = self
            .manifest
            .resource_link(&owned_href)
            .expect("the resource path index is built from manifest links")
            .clone();
        let resource = Resource::new(
            link,
            archive_path.clone(),
            Arc::clone(&self.source),
            Arc::clone(&self.state),
        );
        if warnings.is_empty() {
            Ok(Outcome::complete(Some(resource)))
        } else {
            Ok(Outcome::partial(Some(resource), warnings, None))
        }
    }

    /// Eagerly adapts this publication to the original normalized `EpubDocument`.
    pub fn parse_legacy_document(&self) -> HaddonResult<EpubDocument> {
        self.ensure_open(Stage::Normalize)?;
        parse_epub(self.source.as_ref())
            .map(Outcome::complete)
            .map_err(|error| HaddonError::FormatInvalid {
                stage: Stage::Normalize,
                message: error.to_string(),
            })
    }

    pub fn close(&self) -> HaddonResult<()> {
        self.state.store(STATE_CLOSED, Ordering::Release);
        Ok(Outcome::complete(()))
    }

    fn ensure_open(&self, stage: Stage) -> Result<(), HaddonError> {
        if self.is_closed() {
            Err(HaddonError::Closed {
                stage,
                owner: OwnerKind::Publication,
            })
        } else {
            Ok(())
        }
    }
}

pub fn open_epub(data: &[u8], options: OpenOptions) -> HaddonResult<OpenPublication> {
    let parsed = epub::parse(data)?;
    if options.mode == OpenMode::Strict
        && parsed
            .warnings
            .iter()
            .any(|warning| warning.severity != WarningSeverity::Info)
    {
        return Err(HaddonError::FormatInvalid {
            stage: Stage::Open,
            message: parsed
                .warnings
                .iter()
                .map(|warning| warning.code.as_str())
                .collect::<Vec<_>>()
                .join(", "),
        });
    }

    let source_revision = sha256_hex(data);
    if let Some(expected) = options.identity.source_revision.as_deref() {
        if expected != source_revision {
            return Err(HaddonError::InvalidArgument {
                stage: Stage::Open,
                field: "identity.source_revision".to_string(),
                message: "provided source revision does not match the EPUB bytes".to_string(),
            });
        }
    }
    let identity = PublicationIdentity {
        volume_id: options
            .identity
            .volume_id
            .unwrap_or_else(|| format!("haddon:sha256:{source_revision}")),
        edition_id: options.identity.edition_id,
        source_revision,
    };
    let capabilities = ServiceKind::ALL
        .into_iter()
        .map(|kind| match kind {
            ServiceKind::Normalization => normalize::normalization_capability(),
            ServiceKind::Locator => resolve::locator_capability(),
            other => CapabilityDescriptor::unavailable(other),
        })
        .collect();
    let open_status = if parsed.warnings.is_empty() {
        OpenStatus::Complete
    } else {
        OpenStatus::Partial
    };
    let completeness = if parsed.warnings.is_empty() {
        Completeness::Complete
    } else {
        Completeness::Partial
    };
    let publication = Publication {
        identity,
        manifest: Arc::new(parsed.manifest),
        source: Arc::from(data),
        resource_paths: parsed.resources,
        capabilities,
        warnings: parsed.warnings.clone(),
        state: Arc::new(AtomicU8::new(STATE_OPEN)),
    };

    Ok(Outcome {
        value: OpenPublication {
            publication,
            open_status,
        },
        completeness,
        warnings: parsed.warnings,
        coverage: None,
    })
}

pub fn open_epub_default(data: &[u8]) -> HaddonResult<OpenPublication> {
    open_epub(data, OpenOptions::default())
}

fn sha256_hex(data: &[u8]) -> String {
    let digest = Sha256::digest(data);
    digest.iter().map(|byte| format!("{byte:02x}")).collect()
}
