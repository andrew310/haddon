//! Fixture-scoped normalized AST, stamp, and source-map (HADDON-017).

mod ids;
mod source_map;
mod xhtml;

use crate::publication::{
    CapabilityAvailability, CapabilityDescriptor, CapabilityLimitation, CapabilityProvider,
    CapabilityScope, HaddonError, HaddonResult, Outcome, OwnerKind, Publication, PublicationHref,
    PublicationProfile, ResourceLink, ServiceKind, Stage,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

pub use source_map::{is_utf16_boundary, utf16_len, utf16_slice};

const ALGORITHM: &str = "haddon-normalizer";
const ALGORITHM_REVISION: &str = "1";
const CONFIG_SCHEMA: &str = "haddon.normalization-config";
pub(super) const RESOURCE_SCHEMA: &str = "haddon.normalized-resource";
const SOURCE_MAP_SCHEMA: &str = "haddon.source-map";

/// Default stamp revision: `haddon-normalizer/1+<configDigest>`.
///
/// `configDigest` is lowercase base64url(SHA-256(canonical JSON)) of
/// `{configSchema, configVersion, config}` with sorted keys and no spaces
/// (RFC 8785-compatible subset; not a full JCS implementation).
pub fn default_normalization_stamp() -> NormalizationStampV1 {
    let config = NormalizationConfigV1::default();
    let config_digest = config_digest(&config);
    NormalizationStampV1 {
        algorithm: ALGORITHM.to_string(),
        algorithm_revision: ALGORITHM_REVISION.to_string(),
        config_schema: CONFIG_SCHEMA.to_string(),
        config_version: 1,
        revision: format!("{ALGORITHM}/{ALGORITHM_REVISION}+{config_digest}"),
        config,
        config_digest,
    }
}

pub(super) fn normalization_capability() -> CapabilityDescriptor {
    CapabilityDescriptor {
        kind: ServiceKind::Normalization,
        version: "haddon.normalization/1".to_string(),
        availability: CapabilityAvailability::Available,
        provider: CapabilityProvider::Core,
        scope: CapabilityScope {
            profiles: vec![PublicationProfile::Epub],
            media_types: vec![
                "application/xhtml+xml".to_string(),
                "text/html".to_string(),
            ],
            ..CapabilityScope::default()
        },
        features: vec![
            "xhtml-ast".to_string(),
            "source-map".to_string(),
            "deterministic-ids".to_string(),
            "sections".to_string(),
            "headings".to_string(),
            "paragraphs".to_string(),
            "lists".to_string(),
            "tables".to_string(),
            "figures".to_string(),
            "blockquotes".to_string(),
            "code-blocks".to_string(),
            "definition-lists".to_string(),
            "links".to_string(),
            "note-references".to_string(),
            "inline-semantics".to_string(),
            "ruby".to_string(),
            "language".to_string(),
            "direction".to_string(),
        ],
        limitations: vec![CapabilityLimitation {
            code: "haddon.normalization.v1-vocabulary".to_string(),
            message: "MathML, SVG content, embedded objects, and CSS-generated content are not yet normalized"
                .to_string(),
            href: None,
        }],
    }
}

impl Publication {
    pub fn supports_normalization(&self, href: &str) -> HaddonResult<SupportAssessment> {
        ensure_open_for_normalize(self)?;
        let href = parse_normalize_href(href)?;
        let Some(link) = self.manifest().resource_link(&href.without_query()) else {
            return Ok(Outcome::complete(SupportAssessment::Unsupported {
                reason: CapabilityLimitation {
                    code: "haddon.normalization.unknown-resource".to_string(),
                    message: "href is not an owned publication resource".to_string(),
                    href: Some(href),
                },
            }));
        };
        Ok(Outcome::complete(assess_link(link)))
    }

    pub fn normalize(&self, href: &str) -> HaddonResult<NormalizationResult> {
        ensure_open_for_normalize(self)?;
        let href = parse_normalize_href(href)?;
        let resource = match self.get_resource(href.as_str())?.value {
            Some(resource) => resource,
            None => return Err(HaddonError::ResourceNotFound { href: href.clone() }),
        };
        let link = resource.link().clone();
        match assess_link(&link) {
            SupportAssessment::Unsupported { reason } => {
                let fallback = fallback_link(self, &link);
                return Ok(Outcome::complete(NormalizationResult::Unsupported {
                    href: link.href.to_string(),
                    media_type: link.media_type,
                    fallback,
                    warnings: vec![NormalizationWarning {
                        code: "normalization.unsupported-resource".to_string(),
                        severity: WarningLevel::Warning,
                        message: reason.message,
                        href: link.href.to_string(),
                        source: None,
                        node_ids: Vec::new(),
                        recoverable: true,
                        detail: None,
                    }],
                }));
            }
            SupportAssessment::Supported | SupportAssessment::Degraded { .. } => {}
        }

        let bytes = resource.read(None)?.value;
        let xml = std::str::from_utf8(&bytes).map_err(|error| HaddonError::DecodeFailed {
            href: Some(link.href.clone()),
            message: error.to_string(),
        })?;
        let resource = xhtml::normalize_xhtml(
            &link.href,
            &link.media_type,
            xml,
            &self.identity().source_revision,
            &self.manifest().resources,
        )?;
        Ok(Outcome::complete(NormalizationResult::Normalized(resource)))
    }
}

fn ensure_open_for_normalize(publication: &Publication) -> Result<(), HaddonError> {
    if publication.is_closed() {
        Err(HaddonError::Closed {
            stage: Stage::Normalize,
            owner: OwnerKind::Publication,
        })
    } else {
        Ok(())
    }
}

fn parse_normalize_href(href: &str) -> Result<PublicationHref, HaddonError> {
    PublicationHref::new(href).map_err(|error| match error {
        HaddonError::InvalidArgument { field, message, .. } => HaddonError::InvalidArgument {
            stage: Stage::Normalize,
            field,
            message,
        },
        other => other,
    })
}

fn assess_link(link: &ResourceLink) -> SupportAssessment {
    if is_normalizable_media_type(&link.media_type) {
        SupportAssessment::Supported
    } else {
        SupportAssessment::Unsupported {
            reason: CapabilityLimitation {
                code: "haddon.normalization.unsupported-media-type".to_string(),
                message: format!(
                    "media type {} is not a normalizable textual resource",
                    link.media_type
                ),
                href: Some(link.href.clone()),
            },
        }
    }
}

fn is_normalizable_media_type(media_type: &str) -> bool {
    let base = media_type
        .split(';')
        .next()
        .unwrap_or(media_type)
        .trim()
        .to_ascii_lowercase();
    matches!(base.as_str(), "application/xhtml+xml" | "text/html")
}

fn fallback_link(publication: &Publication, link: &ResourceLink) -> Option<ResourceLink> {
    if let Some(alternate) = link.alternates.first() {
        return Some(alternate.clone());
    }
    let fallback_id = link.properties.get("epub:fallback")?;
    publication
        .manifest()
        .resources
        .iter()
        .find(|candidate| candidate.source_id.as_deref() == Some(fallback_id.as_str()))
        .cloned()
}

/// `configDigest` input is sorted-key, no-space JSON of the stamp config envelope.
fn config_digest(config: &NormalizationConfigV1) -> String {
    let canonical = format!(
        "{{\"config\":{{\"generatedCssContent\":\"{}\",\"hiddenContent\":\"{}\",\"mediaProjection\":\"{}\",\"noteBodies\":\"{}\",\"rubyProjection\":\"{}\",\"unicodeNormalization\":\"{}\",\"unknownElements\":\"{}\",\"unsupportedContent\":\"{}\",\"whitespace\":\"{}\"}},\"configSchema\":\"{}\",\"configVersion\":1}}",
        config.generated_css_content,
        config.hidden_content,
        config.media_projection,
        config.note_bodies,
        config.ruby_projection,
        config.unicode_normalization,
        config.unknown_elements,
        config.unsupported_content,
        config.whitespace,
        CONFIG_SCHEMA,
    );
    let digest = Sha256::digest(canonical.as_bytes());
    base64url_lower(&digest)
}

pub(crate) fn base64url_lower(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::new();
    let mut index = 0;
    while index < bytes.len() {
        let b0 = bytes[index];
        let b1 = bytes.get(index + 1).copied().unwrap_or(0);
        let b2 = bytes.get(index + 2).copied().unwrap_or(0);
        let triple = ((b0 as u32) << 16) | ((b1 as u32) << 8) | b2 as u32;
        out.push(TABLE[((triple >> 18) & 63) as usize] as char);
        out.push(TABLE[((triple >> 12) & 63) as usize] as char);
        if index + 1 < bytes.len() {
            out.push(TABLE[((triple >> 6) & 63) as usize] as char);
        }
        if index + 2 < bytes.len() {
            out.push(TABLE[(triple & 63) as usize] as char);
        }
        index += 3;
    }
    out.make_ascii_lowercase();
    out
}

#[derive(Clone, Debug, PartialEq)]
pub enum SupportAssessment {
    Supported,
    Degraded {
        limitations: Vec<CapabilityLimitation>,
    },
    Unsupported {
        reason: CapabilityLimitation,
    },
}

#[derive(Clone, Debug, PartialEq)]
pub enum NormalizationResult {
    Normalized(NormalizedResource),
    Unsupported {
        href: String,
        media_type: String,
        fallback: Option<ResourceLink>,
        warnings: Vec<NormalizationWarning>,
    },
}

impl NormalizationResult {
    pub fn status(&self) -> &'static str {
        match self {
            Self::Normalized(_) => "normalized",
            Self::Unsupported { .. } => "unsupported",
        }
    }

    pub fn as_normalized(&self) -> Option<&NormalizedResource> {
        match self {
            Self::Normalized(resource) => Some(resource),
            Self::Unsupported { .. } => None,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizationStampV1 {
    pub algorithm: String,
    pub algorithm_revision: String,
    pub config_schema: String,
    pub config_version: u32,
    pub config: NormalizationConfigV1,
    pub config_digest: String,
    pub revision: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizationConfigV1 {
    pub whitespace: String,
    pub unicode_normalization: String,
    pub hidden_content: String,
    pub unknown_elements: String,
    pub unsupported_content: String,
    pub ruby_projection: String,
    pub media_projection: String,
    pub note_bodies: String,
    pub generated_css_content: String,
}

impl Default for NormalizationConfigV1 {
    fn default() -> Self {
        Self {
            whitespace: "html-and-preserve-pre".to_string(),
            unicode_normalization: "none".to_string(),
            hidden_content: "source-semantic".to_string(),
            unknown_elements: "opaque-with-children".to_string(),
            unsupported_content: "fallback-or-placeholder".to_string(),
            ruby_projection: "base-only".to_string(),
            media_projection: "object-replacement".to_string(),
            note_bodies: "in-source-position".to_string(),
            generated_css_content: "exclude".to_string(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedResource {
    pub schema: String,
    pub version: u32,
    pub href: String,
    pub media_type: String,
    pub source_revision: String,
    pub normalization: NormalizationStampV1,
    pub root: DocumentNode,
    pub source_map: SourceMapV1,
    pub warnings: Vec<NormalizationWarning>,
}

impl NormalizedResource {
    pub fn to_semantic_json(&self) -> Result<serde_json::Value, serde_json::Error> {
        serde_json::to_value(self)
    }

    pub fn text_block(&self, id: &str) -> Option<&TextBlock> {
        self.find_block(id).and_then(BlockNode::as_text_block)
    }

    pub fn find_block(&self, id: &str) -> Option<&BlockNode> {
        let mut found = None;
        self.root.for_each_block(&mut |block| {
            if found.is_none() && block.id() == id {
                found = Some(block);
            }
        });
        found
    }

    pub fn text_slice(&self, block_id: &str, start: u64, end: u64) -> Option<String> {
        utf16_slice(&self.text_block(block_id)?.text, start, end)
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocumentNode {
    pub kind: DocumentKind,
    #[serde(flatten)]
    pub base: NodeBase,
    pub children: Vec<BlockNode>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DocumentKind {
    Document,
}

impl DocumentNode {
    pub fn for_each_block<'a>(&'a self, visit: &mut impl FnMut(&'a BlockNode)) {
        for child in &self.children {
            child.walk(visit);
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NodeBase {
    pub id: String,
    pub source: NodeSourceEvidence,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub language: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub direction: Option<TextDirection>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub roles: Vec<SemanticRole>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub source_roles: Vec<String>,
    #[serde(default, skip_serializing_if = "BTreeMap::is_empty")]
    pub extensions: BTreeMap<String, serde_json::Value>,
}

impl NodeBase {
    fn new(id: String, source: NodeSourceEvidence) -> Self {
        Self {
            id,
            source,
            language: None,
            direction: None,
            roles: Vec::new(),
            source_roles: Vec::new(),
            extensions: BTreeMap::new(),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TextDirection {
    Ltr,
    Rtl,
    Auto,
}

#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum SemanticRole {
    Abstract,
    Acknowledgments,
    Appendix,
    Bibliography,
    Bodymatter,
    Chapter,
    Conclusion,
    Endnote,
    Endnotes,
    Epigraph,
    Footnote,
    Footnotes,
    Glossary,
    Introduction,
    Landmark,
    Pagebreak,
    Part,
    Preface,
    Prologue,
    Pullquote,
    Sidebar,
    Extension(String),
}

impl SemanticRole {
    fn as_str(&self) -> String {
        match self {
            Self::Abstract => "abstract".to_string(),
            Self::Acknowledgments => "acknowledgments".to_string(),
            Self::Appendix => "appendix".to_string(),
            Self::Bibliography => "bibliography".to_string(),
            Self::Bodymatter => "bodymatter".to_string(),
            Self::Chapter => "chapter".to_string(),
            Self::Conclusion => "conclusion".to_string(),
            Self::Endnote => "endnote".to_string(),
            Self::Endnotes => "endnotes".to_string(),
            Self::Epigraph => "epigraph".to_string(),
            Self::Footnote => "footnote".to_string(),
            Self::Footnotes => "footnotes".to_string(),
            Self::Glossary => "glossary".to_string(),
            Self::Introduction => "introduction".to_string(),
            Self::Landmark => "landmark".to_string(),
            Self::Pagebreak => "pagebreak".to_string(),
            Self::Part => "part".to_string(),
            Self::Preface => "preface".to_string(),
            Self::Prologue => "prologue".to_string(),
            Self::Pullquote => "pullquote".to_string(),
            Self::Sidebar => "sidebar".to_string(),
            Self::Extension(token) => format!("extension:{token}"),
        }
    }
}

impl Serialize for SemanticRole {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.as_str())
    }
}

impl<'de> Deserialize<'de> for SemanticRole {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let value = String::deserialize(deserializer)?;
        Ok(parse_semantic_role(&value).unwrap_or(SemanticRole::Extension(value)))
    }
}

pub(super) fn parse_semantic_role(token: &str) -> Option<SemanticRole> {
    Some(match token {
        "abstract" => SemanticRole::Abstract,
        "acknowledgments" | "acknowledgements" => SemanticRole::Acknowledgments,
        "appendix" => SemanticRole::Appendix,
        "bibliography" => SemanticRole::Bibliography,
        "bodymatter" => SemanticRole::Bodymatter,
        "chapter" => SemanticRole::Chapter,
        "conclusion" => SemanticRole::Conclusion,
        "endnote" => SemanticRole::Endnote,
        "endnotes" => SemanticRole::Endnotes,
        "epigraph" => SemanticRole::Epigraph,
        "footnote" => SemanticRole::Footnote,
        "footnotes" => SemanticRole::Footnotes,
        "glossary" => SemanticRole::Glossary,
        "introduction" => SemanticRole::Introduction,
        "landmark" => SemanticRole::Landmark,
        "pagebreak" | "doc-pagebreak" => SemanticRole::Pagebreak,
        "part" => SemanticRole::Part,
        "preface" => SemanticRole::Preface,
        "prologue" => SemanticRole::Prologue,
        "pullquote" => SemanticRole::Pullquote,
        "sidebar" => SemanticRole::Sidebar,
        "doc-footnote" => SemanticRole::Footnote,
        "doc-endnote" => SemanticRole::Endnote,
        "doc-endnotes" => SemanticRole::Endnotes,
        other if other.starts_with("extension:") => {
            SemanticRole::Extension(other["extension:".len()..].to_string())
        }
        _ => return None,
    })
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum BlockNode {
    #[serde(rename = "section")]
    Section {
        #[serde(flatten)]
        base: NodeBase,
        children: Vec<BlockNode>,
    },
    #[serde(rename = "textBlock")]
    TextBlock(TextBlock),
    #[serde(rename = "list")]
    List {
        #[serde(flatten)]
        base: NodeBase,
        ordered: bool,
        children: Vec<BlockNode>,
    },
    #[serde(rename = "listItem")]
    ListItem {
        #[serde(flatten)]
        base: NodeBase,
        children: Vec<BlockNode>,
    },
    #[serde(rename = "figure")]
    Figure(FigureBlock),
    #[serde(rename = "table")]
    Table {
        #[serde(flatten)]
        base: NodeBase,
        children: Vec<BlockNode>,
    },
    #[serde(rename = "tableSection")]
    TableSection {
        #[serde(flatten)]
        base: NodeBase,
        section: String,
        children: Vec<BlockNode>,
    },
    #[serde(rename = "tableRow")]
    TableRow {
        #[serde(flatten)]
        base: NodeBase,
        children: Vec<BlockNode>,
    },
    #[serde(rename = "tableCell")]
    TableCell {
        #[serde(flatten)]
        base: NodeBase,
        header: bool,
        colspan: u32,
        rowspan: u32,
        headers: Vec<String>,
        children: Vec<BlockNode>,
    },
    #[serde(rename = "aside")]
    Aside(AsideBlock),
    #[serde(rename = "thematicBreak")]
    ThematicBreak {
        #[serde(flatten)]
        base: NodeBase,
    },
    #[serde(rename = "pageBreak")]
    PageBreak {
        #[serde(flatten)]
        base: NodeBase,
        #[serde(skip_serializing_if = "Option::is_none")]
        label: Option<String>,
    },
    #[serde(rename = "mediaBlock")]
    MediaBlock(MediaNode),
    #[serde(rename = "opaqueBlock")]
    OpaqueBlock {
        #[serde(flatten)]
        base: NodeBase,
        children: Vec<BlockNode>,
    },
    #[serde(rename = "unsupportedBlock")]
    UnsupportedBlock {
        #[serde(flatten)]
        base: NodeBase,
        feature: String,
        fallback: Vec<BlockNode>,
    },
}

impl BlockNode {
    pub fn id(&self) -> &str {
        &self.base().id
    }

    pub fn base(&self) -> &NodeBase {
        match self {
            Self::Section { base, .. }
            | Self::List { base, .. }
            | Self::ListItem { base, .. }
            | Self::Table { base, .. }
            | Self::TableSection { base, .. }
            | Self::TableRow { base, .. }
            | Self::TableCell { base, .. }
            | Self::ThematicBreak { base, .. }
            | Self::PageBreak { base, .. }
            | Self::OpaqueBlock { base, .. }
            | Self::UnsupportedBlock { base, .. } => base,
            Self::TextBlock(block) => &block.base,
            Self::Figure(block) => &block.base,
            Self::Aside(block) => &block.base,
            Self::MediaBlock(block) => &block.base,
        }
    }

    pub fn as_text_block(&self) -> Option<&TextBlock> {
        match self {
            Self::TextBlock(block) => Some(block),
            _ => None,
        }
    }

    pub fn as_aside(&self) -> Option<&AsideBlock> {
        match self {
            Self::Aside(block) => Some(block),
            _ => None,
        }
    }

    pub fn as_figure(&self) -> Option<&FigureBlock> {
        match self {
            Self::Figure(block) => Some(block),
            _ => None,
        }
    }

    pub fn as_page_break(&self) -> Option<&str> {
        match self {
            Self::PageBreak { label, .. } => Some(label.as_deref().unwrap_or("")),
            _ => None,
        }
    }

    pub fn walk<'a>(&'a self, visit: &mut impl FnMut(&'a BlockNode)) {
        visit(self);
        match self {
            Self::Section { children, .. }
            | Self::List { children, .. }
            | Self::ListItem { children, .. }
            | Self::Table { children, .. }
            | Self::TableSection { children, .. }
            | Self::TableRow { children, .. }
            | Self::TableCell { children, .. }
            | Self::OpaqueBlock { children, .. } => {
                for child in children {
                    child.walk(visit);
                }
            }
            Self::Aside(block) => {
                for child in &block.children {
                    child.walk(visit);
                }
            }
            Self::Figure(block) => {
                for child in block.content.iter().chain(&block.caption) {
                    child.walk(visit);
                }
            }
            Self::UnsupportedBlock { fallback, .. } => {
                for child in fallback {
                    child.walk(visit);
                }
            }
            Self::TextBlock(_)
            | Self::ThematicBreak { .. }
            | Self::PageBreak { .. }
            | Self::MediaBlock(_) => {}
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextBlock {
    #[serde(flatten)]
    pub base: NodeBase,
    pub role: TextBlockRole,
    pub inlines: Vec<InlineNode>,
    pub text: String,
}

impl TextBlock {
    pub fn utf16_len(&self) -> u64 {
        utf16_len(&self.text)
    }

    pub fn slice(&self, start: u64, end: u64) -> Option<String> {
        utf16_slice(&self.text, start, end)
    }

    pub fn range_of(&self, pred: impl Fn(&InlineNode) -> bool) -> Option<(u64, u64)> {
        range_of_inline(&self.inlines, &pred)
    }
}

fn range_of_inline(
    inlines: &[InlineNode],
    pred: &impl Fn(&InlineNode) -> bool,
) -> Option<(u64, u64)> {
    let mut offset = 0u64;
    fn walk(
        inlines: &[InlineNode],
        offset: &mut u64,
        pred: &impl Fn(&InlineNode) -> bool,
    ) -> Option<(u64, u64)> {
        for inline in inlines {
            let start = *offset;
            let len = inline.projected_len();
            if pred(inline) {
                return Some((start, start + len));
            }
            if !inline.children().is_empty() {
                if let Some(found) = walk(inline.children(), offset, pred) {
                    return Some(found);
                }
            } else {
                *offset += len;
            }
        }
        None
    }
    walk(inlines, &mut offset, pred)
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum TextBlockRole {
    Paragraph,
    Heading {
        level: u32,
    },
    Quote {
        #[serde(skip_serializing_if = "Option::is_none")]
        cite: Option<LinkTarget>,
    },
    Preformatted,
    Code {
        #[serde(skip_serializing_if = "Option::is_none")]
        language_hint: Option<String>,
    },
    Caption,
    Term,
    Definition,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FigureBlock {
    #[serde(flatten)]
    pub base: NodeBase,
    pub content: Vec<BlockNode>,
    pub caption: Vec<BlockNode>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AsideBlock {
    #[serde(flatten)]
    pub base: NodeBase,
    pub disposition: AsideDisposition,
    pub children: Vec<BlockNode>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum AsideDisposition {
    Note,
    Footnote,
    Endnote,
    Sidebar,
    Other,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaNode {
    #[serde(flatten)]
    pub base: NodeBase,
    pub media_kind: MediaKind,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub primary: Option<MediaSource>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub alternatives: Vec<MediaSource>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub alt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum MediaKind {
    Image,
    Audio,
    Video,
    Object,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaSource {
    pub href: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub media_type: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum InlineNode {
    #[serde(rename = "text")]
    Text {
        #[serde(flatten)]
        base: NodeBase,
        text: String,
    },
    #[serde(rename = "emphasis")]
    Emphasis {
        #[serde(flatten)]
        base: NodeBase,
        children: Vec<InlineNode>,
    },
    #[serde(rename = "strong")]
    Strong {
        #[serde(flatten)]
        base: NodeBase,
        children: Vec<InlineNode>,
    },
    #[serde(rename = "code")]
    Code {
        #[serde(flatten)]
        base: NodeBase,
        children: Vec<InlineNode>,
    },
    #[serde(rename = "subscript")]
    Subscript {
        #[serde(flatten)]
        base: NodeBase,
        children: Vec<InlineNode>,
    },
    #[serde(rename = "superscript")]
    Superscript {
        #[serde(flatten)]
        base: NodeBase,
        children: Vec<InlineNode>,
    },
    #[serde(rename = "strikethrough")]
    Strikethrough {
        #[serde(flatten)]
        base: NodeBase,
        children: Vec<InlineNode>,
    },
    #[serde(rename = "mark")]
    Mark {
        #[serde(flatten)]
        base: NodeBase,
        children: Vec<InlineNode>,
    },
    #[serde(rename = "quote")]
    Quote {
        #[serde(flatten)]
        base: NodeBase,
        #[serde(skip_serializing_if = "Option::is_none")]
        cite: Option<String>,
        children: Vec<InlineNode>,
    },
    #[serde(rename = "span")]
    Span {
        #[serde(flatten)]
        base: NodeBase,
        children: Vec<InlineNode>,
    },
    #[serde(rename = "link")]
    Link {
        #[serde(flatten)]
        base: NodeBase,
        target: LinkTarget,
        children: Vec<InlineNode>,
    },
    #[serde(rename = "noteReference")]
    NoteReference {
        #[serde(flatten)]
        base: NodeBase,
        target: LinkTarget,
        note_kind: NoteKind,
        children: Vec<InlineNode>,
    },
    #[serde(rename = "ruby")]
    Ruby {
        #[serde(flatten)]
        base: NodeBase,
        base_text: Vec<InlineNode>,
        annotations: Vec<RubyAnnotation>,
    },
    #[serde(rename = "lineBreak")]
    LineBreak {
        #[serde(flatten)]
        base: NodeBase,
    },
    #[serde(rename = "mediaInline")]
    MediaInline(MediaNode),
    #[serde(rename = "opaqueInline")]
    OpaqueInline {
        #[serde(flatten)]
        base: NodeBase,
        children: Vec<InlineNode>,
    },
    #[serde(rename = "unsupportedInline")]
    UnsupportedInline {
        #[serde(flatten)]
        base: NodeBase,
        feature: String,
        children: Vec<InlineNode>,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RubyAnnotation {
    pub text: Vec<InlineNode>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub position: Option<String>,
}

impl InlineNode {
    pub fn base(&self) -> &NodeBase {
        match self {
            Self::Text { base, .. }
            | Self::Emphasis { base, .. }
            | Self::Strong { base, .. }
            | Self::Code { base, .. }
            | Self::Subscript { base, .. }
            | Self::Superscript { base, .. }
            | Self::Strikethrough { base, .. }
            | Self::Mark { base, .. }
            | Self::Quote { base, .. }
            | Self::Span { base, .. }
            | Self::Link { base, .. }
            | Self::NoteReference { base, .. }
            | Self::Ruby { base, .. }
            | Self::LineBreak { base, .. }
            | Self::OpaqueInline { base, .. }
            | Self::UnsupportedInline { base, .. } => base,
            Self::MediaInline(node) => &node.base,
        }
    }

    pub fn children(&self) -> &[InlineNode] {
        match self {
            Self::Emphasis { children, .. }
            | Self::Strong { children, .. }
            | Self::Code { children, .. }
            | Self::Subscript { children, .. }
            | Self::Superscript { children, .. }
            | Self::Strikethrough { children, .. }
            | Self::Mark { children, .. }
            | Self::Quote { children, .. }
            | Self::Span { children, .. }
            | Self::Link { children, .. }
            | Self::NoteReference { children, .. }
            | Self::OpaqueInline { children, .. }
            | Self::UnsupportedInline { children, .. } => children,
            Self::Ruby { base_text, .. } => base_text,
            Self::Text { .. } | Self::LineBreak { .. } | Self::MediaInline(_) => &[],
        }
    }

    pub fn children_mut(&mut self) -> Option<&mut Vec<InlineNode>> {
        match self {
            Self::Emphasis { children, .. }
            | Self::Strong { children, .. }
            | Self::Code { children, .. }
            | Self::Subscript { children, .. }
            | Self::Superscript { children, .. }
            | Self::Strikethrough { children, .. }
            | Self::Mark { children, .. }
            | Self::Quote { children, .. }
            | Self::Span { children, .. }
            | Self::Link { children, .. }
            | Self::NoteReference { children, .. }
            | Self::OpaqueInline { children, .. }
            | Self::UnsupportedInline { children, .. } => Some(children),
            Self::Ruby { base_text, .. } => Some(base_text),
            Self::Text { .. } | Self::LineBreak { .. } | Self::MediaInline(_) => None,
        }
    }

    pub fn as_text(&self) -> Option<&str> {
        match self {
            Self::Text { text, .. } => Some(text.as_str()),
            _ => None,
        }
    }

    pub fn as_link(&self) -> Option<&LinkTarget> {
        match self {
            Self::Link { target, .. } => Some(target),
            _ => None,
        }
    }

    pub fn as_note_reference(&self) -> Option<(&LinkTarget, NoteKind)> {
        match self {
            Self::NoteReference {
                target, note_kind, ..
            } => Some((target, *note_kind)),
            _ => None,
        }
    }

    pub fn projected_len(&self) -> u64 {
        match self {
            Self::Text { text, .. } => utf16_len(text),
            Self::LineBreak { .. } => 1,
            Self::MediaInline(_) => 1,
            Self::Ruby { base_text, .. } => base_text.iter().map(Self::projected_len).sum(),
            Self::UnsupportedInline { children, .. } if children.is_empty() => 1,
            other => other.children().iter().map(Self::projected_len).sum(),
        }
    }

    pub fn walk<'a>(&'a self, visit: &mut impl FnMut(&'a InlineNode)) {
        visit(self);
        for child in self.children() {
            child.walk(visit);
        }
        if let Self::Ruby { annotations, .. } = self {
            for annotation in annotations {
                for child in &annotation.text {
                    child.walk(visit);
                }
            }
        }
    }
}

pub fn project_inlines(inlines: &[InlineNode]) -> String {
    let mut out = String::new();
    fn walk(inlines: &[InlineNode], out: &mut String) {
        for inline in inlines {
            match inline {
                InlineNode::Text { text, .. } => out.push_str(text),
                InlineNode::LineBreak { .. } => out.push('\n'),
                InlineNode::MediaInline(_) => out.push('\u{FFFC}'),
                InlineNode::Ruby { base_text, .. } => {
                    // Ruby: only base text contributes to primary projection
                    walk(base_text, out);
                }
                InlineNode::UnsupportedInline { children, .. } if children.is_empty() => {
                    out.push('\u{FFFC}')
                }
                other => walk(other.children(), out),
            }
        }
    }
    walk(inlines, &mut out);
    out
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkTarget {
    pub href: String,
    pub external: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub media_type: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub rels: Vec<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum NoteKind {
    Footnote,
    Endnote,
    Bibliography,
    Glossary,
    Unknown,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "origin", rename_all = "camelCase")]
pub enum NodeSourceEvidence {
    Source {
        primary: SourceNodeRef,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        contributors: Vec<SourceNodeRef>,
    },
    Generated {
        reason: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        before: Option<SourceDomPoint>,
        #[serde(skip_serializing_if = "Option::is_none")]
        after: Option<SourceDomPoint>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        contributors: Vec<SourceNodeRef>,
    },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum SourceNodeRef {
    Text(SourceTextNodeRef),
    Element(SourceElementRef),
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceElementRef {
    pub href: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fragment: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub css_selector: Option<String>,
    pub dom_path: Vec<SourcePathStep>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceTextNodeRef {
    pub container: SourceElementRef,
    pub text_node_index: u32,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourcePathStep {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub namespace: Option<String>,
    pub local_name: String,
    pub same_name_index: u32,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceDomPoint {
    pub node: SourceTextNodeRef,
    pub offset: TextOffset,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SourceDomRange {
    pub start: SourceDomPoint,
    pub end: SourceDomPoint,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct SourceTextSpan {
    pub parts: Vec<SourceDomRange>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TextOffset {
    pub value: u64,
    pub unit: OffsetUnit,
}

impl TextOffset {
    pub fn utf16(value: u64) -> Self {
        Self {
            value,
            unit: OffsetUnit::Utf16CodeUnit,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum OffsetUnit {
    #[serde(rename = "utf16-code-unit")]
    Utf16CodeUnit,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedTextPoint {
    pub block_id: String,
    pub offset: TextOffset,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct NormalizedTextRange {
    pub start: NormalizedTextPoint,
    pub end: NormalizedTextPoint,
}

impl NormalizedTextRange {
    pub fn new(block_id: impl Into<String>, start: u64, end: u64) -> Self {
        let block_id = block_id.into();
        Self {
            start: NormalizedTextPoint {
                block_id: block_id.clone(),
                offset: TextOffset::utf16(start),
            },
            end: NormalizedTextPoint {
                block_id,
                offset: TextOffset::utf16(end),
            },
        }
    }

    pub fn block_id(&self) -> &str {
        &self.start.block_id
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceMapV1 {
    pub schema: String,
    pub version: u32,
    pub offset_unit: OffsetUnit,
    pub segments: Vec<SourceMapSegment>,
}

impl SourceMapV1 {
    fn new(segments: Vec<SourceMapSegment>) -> Self {
        Self {
            schema: SOURCE_MAP_SCHEMA.to_string(),
            version: 1,
            offset_unit: OffsetUnit::Utf16CodeUnit,
            segments,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum SourceMapSegment {
    Text {
        normalized: NormalizedTextRange,
        source: SourceTextSpan,
        transform: TextTransform,
        #[serde(skip_serializing_if = "Option::is_none")]
        alignment: Option<Vec<AlignmentPoint>>,
    },
    Object {
        node_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        normalized: Option<NormalizedTextRange>,
        source: SourceElementRef,
        projection: ObjectProjection,
    },
    Omitted {
        normalized_at: NormalizedTextPoint,
        source: OmittedSource,
        reason: String,
    },
    Generated {
        normalized: NormalizedTextRange,
        source_anchor: SourceElementRef,
        reason: String,
    },
}

impl SourceMapSegment {
    pub fn as_text_segment(
        &self,
    ) -> Option<(&NormalizedTextRange, &SourceTextSpan, TextTransform)> {
        match self {
            Self::Text {
                normalized,
                source,
                transform,
                ..
            } => Some((normalized, source, *transform)),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum TextTransform {
    Identity,
    WhitespaceCollapse,
    Replacement,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ObjectProjection {
    None,
    ObjectReplacement,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AlignmentPoint {
    pub normalized: TextOffset,
    pub source: TextOffset,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum OmittedSource {
    Span(SourceTextSpan),
    Element(SourceElementRef),
}

#[derive(Clone, Debug, PartialEq)]
pub enum MappingResult<T> {
    Exact {
        value: T,
        segments: Vec<usize>,
    },
    Covering {
        value: T,
        reason: LossReason,
        segments: Vec<usize>,
    },
    Ambiguous {
        candidates: Vec<T>,
        segments: Vec<usize>,
    },
    Unmapped {
        reason: UnmappedReason,
    },
}

impl<T> MappingResult<T> {
    pub fn status(&self) -> &'static str {
        match self {
            Self::Exact { .. } => "exact",
            Self::Covering { .. } => "covering",
            Self::Ambiguous { .. } => "ambiguous",
            Self::Unmapped { .. } => "unmapped",
        }
    }

    pub fn exact(self) -> Option<(T, Vec<usize>)> {
        match self {
            Self::Exact { value, segments } => Some((value, segments)),
            _ => None,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LossReason {
    Collapsed,
    Replacement,
    Generated,
    Omitted,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UnmappedReason {
    Outside,
    Unsupported,
    Invalid,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizationWarning {
    pub code: String,
    pub severity: WarningLevel,
    pub message: String,
    pub href: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<SourceElementRef>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub node_ids: Vec<String>,
    pub recoverable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<BTreeMap<String, serde_json::Value>>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WarningLevel {
    Info,
    Warning,
    Error,
}
