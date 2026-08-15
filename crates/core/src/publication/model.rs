use super::PublicationHref;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PublicationIdentity {
    pub volume_id: String,
    pub edition_id: Option<String>,
    pub source_revision: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct PublicationIdentityHint {
    pub volume_id: Option<String>,
    pub edition_id: Option<String>,
    pub source_revision: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PublicationProfile {
    Epub,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalizedString {
    pub value: String,
    pub language: Option<String>,
}

impl LocalizedString {
    pub fn new(value: impl Into<String>, language: Option<String>) -> Self {
        Self {
            value: value.into(),
            language,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Contributor {
    pub name: LocalizedString,
    pub roles: BTreeSet<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ReadingProgression {
    LeftToRight,
    RightToLeft,
    TopToBottom,
    BottomToTop,
    Auto,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct PublicationMetadata {
    pub identifier: Option<String>,
    pub title: Option<LocalizedString>,
    pub contributors: Vec<Contributor>,
    pub languages: Vec<String>,
    pub reading_progression: Option<ReadingProgression>,
    pub conforms_to: Vec<String>,
    pub extensions: BTreeMap<String, String>,
}

impl PublicationMetadata {
    pub fn creator(&self) -> Option<&str> {
        self.contributors
            .first()
            .map(|creator| creator.name.value.as_str())
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct ResourceLink {
    pub href: PublicationHref,
    pub fragment: Option<String>,
    pub media_type: String,
    pub title: Option<LocalizedString>,
    pub rels: BTreeSet<String>,
    pub properties: BTreeMap<String, String>,
    pub source_id: Option<String>,
    pub size: Option<u64>,
    pub duration: Option<f64>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub languages: Vec<String>,
    pub alternates: Vec<ResourceLink>,
    pub children: Vec<ResourceLink>,
    /// `None` outside the spine, otherwise the EPUB `linear` value (default true).
    pub linear: Option<bool>,
}

impl ResourceLink {
    pub fn new(href: PublicationHref, media_type: impl Into<String>) -> Self {
        Self {
            href,
            fragment: None,
            media_type: media_type.into(),
            title: None,
            rels: BTreeSet::new(),
            properties: BTreeMap::new(),
            source_id: None,
            size: None,
            duration: None,
            width: None,
            height: None,
            languages: Vec::new(),
            alternates: Vec::new(),
            children: Vec::new(),
            linear: None,
        }
    }

    pub fn is_linear(&self) -> bool {
        self.linear.unwrap_or(false)
    }
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct Navigation {
    pub toc: Vec<ResourceLink>,
    pub landmarks: Vec<ResourceLink>,
    pub page_list: Vec<ResourceLink>,
    pub other: BTreeMap<String, Vec<ResourceLink>>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct RenditionHints {
    pub layout: Option<String>,
    pub orientation: Option<String>,
    pub spread: Option<String>,
    pub flow: Option<String>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Manifest {
    pub metadata: PublicationMetadata,
    pub profile: PublicationProfile,
    pub links: Vec<ResourceLink>,
    /// Every spine entry in source order, including `linear="no"` entries.
    pub reading_order: Vec<ResourceLink>,
    /// The complete OPF manifest, independent of the reading order.
    pub resources: Vec<ResourceLink>,
    pub navigation: Navigation,
    pub rendition: RenditionHints,
    pub extensions: BTreeMap<String, String>,
}

impl Manifest {
    pub fn linear_reading_order(&self) -> impl Iterator<Item = &ResourceLink> {
        self.reading_order.iter().filter(|link| link.is_linear())
    }

    pub fn resource_link(&self, href: &PublicationHref) -> Option<&ResourceLink> {
        self.resources.iter().find(|link| &link.href == href)
    }
}
