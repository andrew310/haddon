use super::{
    Contributor, HaddonError, LocalizedString, Manifest, Navigation, PublicationHref,
    PublicationMetadata, PublicationProfile, PublicationWarning, ReadingProgression, Recovery,
    RenditionHints, ResourceLink, Stage, WarningSeverity,
};
use quick_xml::events::{BytesStart, Event};
use quick_xml::Reader;
use std::collections::{BTreeMap, BTreeSet};
use std::io::{Cursor, Read};
use zip::ZipArchive;

pub(crate) struct ParsedPublication {
    pub manifest: Manifest,
    pub resources: BTreeMap<PublicationHref, String>,
    pub warnings: Vec<PublicationWarning>,
}

#[derive(Clone)]
struct PackageItem {
    id: String,
    href: PublicationHref,
    media_type: String,
    properties: BTreeSet<String>,
    fallback: Option<String>,
    archive_path: String,
}

struct PackageDocument {
    metadata: PublicationMetadata,
    items: Vec<PackageItem>,
    spine: Vec<(String, bool)>,
    rendition: RenditionHints,
    ncx_id: Option<String>,
}

pub(crate) fn parse(data: &[u8]) -> Result<ParsedPublication, HaddonError> {
    let mut archive =
        ZipArchive::new(Cursor::new(data)).map_err(|error| HaddonError::ContainerCorrupt {
            message: error.to_string(),
        })?;
    let container = read_required_text(&mut archive, "META-INF/container.xml")?;
    let (opf_path, mut warnings) = parse_container(&container)?;
    let opf_path = canonical_archive_path(&opf_path)?;
    let opf = read_required_text(&mut archive, &opf_path)?;
    let package = parse_package(&opf, &opf_path)?;

    let mut by_id = BTreeMap::new();
    for item in &package.items {
        if by_id.insert(item.id.as_str(), item).is_some() {
            return Err(HaddonError::FormatInvalid {
                stage: Stage::Manifest,
                message: format!("duplicate manifest item id {}", item.id),
            });
        }
    }
    let mut reading_order = Vec::with_capacity(package.spine.len());
    for (id, linear) in &package.spine {
        let item = by_id
            .get(id.as_str())
            .ok_or_else(|| HaddonError::FormatInvalid {
                stage: Stage::Manifest,
                message: format!("spine references missing manifest item {id}"),
            })?;
        let mut link = item_link(item);
        link.linear = Some(*linear);
        reading_order.push(link);
    }

    let resources = package.items.iter().map(item_link).collect::<Vec<_>>();
    let mut resource_paths = BTreeMap::new();
    for item in &package.items {
        if resource_paths
            .insert(item.href.clone(), item.archive_path.clone())
            .is_some()
        {
            return Err(HaddonError::FormatInvalid {
                stage: Stage::Manifest,
                message: format!("duplicate canonical resource href {}", item.href),
            });
        }
    }

    // Detect fallback cycles
    for item in &package.items {
        if let Some(cycle) = detect_fallback_cycle(&item.id, &by_id) {
            warnings.push(PublicationWarning {
                code: "haddon.manifest.fallback-cycle".to_string(),
                severity: WarningSeverity::Major,
                stage: Stage::Manifest,
                message: format!("fallback cycle detected: {}", cycle.join(" -> ")),
                href: Some(item.href.clone()),
                recovery: Some(Recovery::Ignored),
            });
        }
    }

    let mut warnings = warnings;
    let navigation = match package
        .items
        .iter()
        .find(|item| item.properties.contains("nav"))
    {
        Some(nav_item) => match read_optional_text(&mut archive, &nav_item.archive_path) {
            Ok(Some(nav)) => match parse_navigation(&nav, &nav_item.href) {
                Ok(navigation) => navigation,
                Err(error) => {
                    warnings.push(navigation_warning(
                        &nav_item.href,
                        format!("navigation document could not be parsed: {error}"),
                    ));
                    Navigation::default()
                }
            },
            Ok(None) => {
                warnings.push(navigation_warning(
                    &nav_item.href,
                    "declared navigation document is missing".to_string(),
                ));
                Navigation::default()
            }
            Err(error) => {
                warnings.push(navigation_warning(
                    &nav_item.href,
                    format!("navigation document could not be read: {error}"),
                ));
                Navigation::default()
            }
        },
        None => {
            // Try EPUB 2 NCX if no EPUB 3 nav
            if let Some(ncx_id) = &package.ncx_id {
                if let Some(ncx_item) = by_id.get(ncx_id.as_str()) {
                    match read_optional_text(&mut archive, &ncx_item.archive_path) {
                        Ok(Some(ncx)) => match parse_ncx(&ncx, &ncx_item.href) {
                            Ok(navigation) => navigation,
                            Err(error) => {
                                warnings.push(navigation_warning(
                                    &ncx_item.href,
                                    format!("NCX document could not be parsed: {error}"),
                                ));
                                Navigation::default()
                            }
                        },
                        Ok(None) => {
                            warnings.push(navigation_warning(
                                &ncx_item.href,
                                "declared NCX document is missing".to_string(),
                            ));
                            Navigation::default()
                        }
                        Err(error) => {
                            warnings.push(navigation_warning(
                                &ncx_item.href,
                                format!("NCX document could not be read: {error}"),
                            ));
                            Navigation::default()
                        }
                    }
                } else {
                    Navigation::default()
                }
            } else {
                Navigation::default()
            }
        }
    };

    Ok(ParsedPublication {
        manifest: Manifest {
            metadata: package.metadata,
            profile: PublicationProfile::Epub,
            links: Vec::new(),
            reading_order,
            resources,
            navigation,
            rendition: package.rendition,
            extensions: BTreeMap::new(),
        },
        resources: resource_paths,
        warnings,
    })
}

fn parse_container(xml: &str) -> Result<(String, Vec<PublicationWarning>), HaddonError> {
    let mut reader = Reader::from_str(xml);
    let mut rootfiles = Vec::new();
    loop {
        match reader.read_event() {
            Ok(Event::Start(element)) | Ok(Event::Empty(element))
                if element.local_name().as_ref() == b"rootfile" =>
            {
                if let Some(path) = attribute(&element, b"full-path") {
                    rootfiles.push(path);
                }
            }
            Ok(Event::Eof) => break,
            Err(error) => return Err(format_invalid(Stage::Open, error)),
            _ => {}
        }
    }
    
    if rootfiles.is_empty() {
        return Err(HaddonError::RequiredResourceMissing {
            href: PublicationHref::new("META-INF/container.xml")
                .expect("the standard container path is canonical"),
        });
    }
    
    let mut warnings = Vec::new();
    if rootfiles.len() > 1 {
        warnings.push(PublicationWarning {
            code: "haddon.manifest.multiple-packages".to_string(),
            severity: WarningSeverity::Caution,
            stage: Stage::Manifest,
            message: format!(
                "container lists {} package files; using the first ({})",
                rootfiles.len(),
                rootfiles[0]
            ),
            href: None,
            recovery: Some(Recovery::Defaulted),
        });
    }
    
    Ok((rootfiles[0].clone(), warnings))
}

fn parse_package(xml: &str, opf_path: &str) -> Result<PackageDocument, HaddonError> {
    let mut reader = Reader::from_str(xml);
    let package_language = package_language(xml);
    let mut metadata = PublicationMetadata::default();
    let mut items = Vec::new();
    let mut spine = Vec::new();
    let mut progression = None;
    let mut rendition = RenditionHints::default();
    let mut text_field: Option<TextField> = None;
    let mut text = String::new();
    let mut ncx_id = None;
    let opf_directory = opf_path
        .rsplit_once('/')
        .map(|(directory, _)| directory)
        .unwrap_or_default();

    loop {
        match reader.read_event() {
            Ok(Event::Start(element)) => match element.local_name().as_ref() {
                b"identifier" => begin_text(&mut text_field, &mut text, TextField::Identifier),
                b"title" => begin_text(&mut text_field, &mut text, TextField::Title),
                b"creator" => begin_text(&mut text_field, &mut text, TextField::Creator),
                b"language" => begin_text(&mut text_field, &mut text, TextField::Language),
                b"item" => items.push(parse_item(&element, opf_directory)?),
                b"itemref" => parse_itemref(&element, &mut spine),
                b"spine" => {
                    progression = attribute(&element, b"page-progression-direction")
                        .and_then(|value| parse_progression(&value));
                    ncx_id = attribute(&element, b"toc");
                }
                b"meta" => {
                    if let Some(property) = attribute(&element, b"property") {
                        text_field = rendition_field(&property);
                        text.clear();
                    }
                }
                _ => {}
            },
            Ok(Event::Empty(element)) => match element.local_name().as_ref() {
                b"item" => items.push(parse_item(&element, opf_directory)?),
                b"itemref" => parse_itemref(&element, &mut spine),
                _ => {}
            },
            Ok(Event::Text(event)) if text_field.is_some() => {
                text.push_str(&event.unescape().unwrap_or_default());
            }
            Ok(Event::End(element)) => {
                let matches_field = matches!(
                    (element.local_name().as_ref(), text_field),
                    (b"identifier", Some(TextField::Identifier))
                        | (b"title", Some(TextField::Title))
                        | (b"creator", Some(TextField::Creator))
                        | (b"language", Some(TextField::Language))
                        | (b"meta", Some(TextField::RenditionLayout))
                        | (b"meta", Some(TextField::RenditionOrientation))
                        | (b"meta", Some(TextField::RenditionSpread))
                        | (b"meta", Some(TextField::RenditionFlow))
                );
                if matches_field {
                    let value = text.trim().to_string();
                    match text_field.take().expect("field was matched") {
                        TextField::Identifier => metadata.identifier = nonempty(value),
                        TextField::Title => {
                            metadata.title = nonempty(value)
                                .map(|value| LocalizedString::new(value, package_language.clone()))
                        }
                        TextField::Creator => {
                            if let Some(value) = nonempty(value) {
                                metadata.contributors.push(Contributor {
                                    name: LocalizedString::new(value, package_language.clone()),
                                    roles: BTreeSet::from(["author".to_string()]),
                                });
                            }
                        }
                        TextField::Language => {
                            if let Some(value) = nonempty(value) {
                                metadata.languages.push(value);
                            }
                        }
                        TextField::RenditionLayout => rendition.layout = nonempty(value),
                        TextField::RenditionOrientation => rendition.orientation = nonempty(value),
                        TextField::RenditionSpread => rendition.spread = nonempty(value),
                        TextField::RenditionFlow => rendition.flow = nonempty(value),
                    }
                    text.clear();
                }
            }
            Ok(Event::Eof) => break,
            Err(error) => return Err(format_invalid(Stage::Manifest, error)),
            _ => {}
        }
    }

    if items.is_empty() {
        return Err(HaddonError::FormatInvalid {
            stage: Stage::Manifest,
            message: "package manifest is empty".to_string(),
        });
    }

    metadata.reading_progression = progression;
    Ok(PackageDocument {
        metadata,
        items,
        spine,
        rendition,
        ncx_id,
    })
}

#[derive(Clone, Copy)]
enum TextField {
    Identifier,
    Title,
    Creator,
    Language,
    RenditionLayout,
    RenditionOrientation,
    RenditionSpread,
    RenditionFlow,
}

fn begin_text(field: &mut Option<TextField>, text: &mut String, value: TextField) {
    *field = Some(value);
    text.clear();
}

fn rendition_field(property: &str) -> Option<TextField> {
    match property {
        "rendition:layout" => Some(TextField::RenditionLayout),
        "rendition:orientation" => Some(TextField::RenditionOrientation),
        "rendition:spread" => Some(TextField::RenditionSpread),
        "rendition:flow" => Some(TextField::RenditionFlow),
        _ => None,
    }
}

fn parse_item(element: &BytesStart<'_>, opf_directory: &str) -> Result<PackageItem, HaddonError> {
    let id = attribute(element, b"id").ok_or_else(|| HaddonError::FormatInvalid {
        stage: Stage::Manifest,
        message: "manifest item is missing id".to_string(),
    })?;
    let raw_href = attribute(element, b"href").ok_or_else(|| HaddonError::FormatInvalid {
        stage: Stage::Manifest,
        message: format!("manifest item {id} is missing href"),
    })?;
    let href = publication_href_from_source(&raw_href)?;
    let archive_path = if opf_directory.is_empty() {
        href.without_query().to_string()
    } else {
        canonical_archive_path(&format!("{opf_directory}/{}", href.without_query()))?
    };
    let media_type = attribute(element, b"media-type")
        .filter(|value| !value.is_empty())
        .map(|mt| normalize_media_type(&mt))
        .unwrap_or_else(|| "application/octet-stream".to_string());
    let properties = attribute(element, b"properties")
        .map(|properties| properties.split_whitespace().map(str::to_string).collect())
        .unwrap_or_default();

    Ok(PackageItem {
        id,
        href,
        media_type,
        properties,
        fallback: attribute(element, b"fallback"),
        archive_path,
    })
}

fn parse_itemref(element: &BytesStart<'_>, spine: &mut Vec<(String, bool)>) {
    if let Some(idref) = attribute(element, b"idref") {
        let linear = attribute(element, b"linear").as_deref() != Some("no");
        spine.push((idref, linear));
    }
}

fn item_link(item: &PackageItem) -> ResourceLink {
    let mut link = ResourceLink::new(item.href.clone(), item.media_type.clone());
    link.source_id = Some(item.id.clone());
    if !item.properties.is_empty() {
        link.properties.insert(
            "epub:properties".to_string(),
            item.properties
                .iter()
                .cloned()
                .collect::<Vec<_>>()
                .join(" "),
        );
    }
    if let Some(fallback) = &item.fallback {
        link.properties
            .insert("epub:fallback".to_string(), fallback.clone());
    }
    link
}

#[derive(Default)]
struct NavigationNode {
    link: Option<ResourceLink>,
    children: Vec<ResourceLink>,
}

struct Anchor {
    href: String,
    rels: BTreeSet<String>,
    text: String,
}

fn parse_navigation(xml: &str, nav_href: &PublicationHref) -> Result<Navigation, HaddonError> {
    let mut reader = Reader::from_str(xml);
    let mut navigation = Navigation::default();
    let mut kind: Option<String> = None;
    let mut roots = Vec::new();
    let mut stack: Vec<NavigationNode> = Vec::new();
    let mut anchor: Option<Anchor> = None;

    loop {
        match reader.read_event() {
            Ok(Event::Start(element)) => match element.local_name().as_ref() {
                b"nav" => {
                    kind = attribute_suffix(&element, b"type").and_then(|types| {
                        types
                            .split_whitespace()
                            .find(|value| matches!(*value, "toc" | "landmarks" | "page-list"))
                            .map(str::to_string)
                    });
                    roots.clear();
                    stack.clear();
                }
                b"li" if kind.is_some() => stack.push(NavigationNode::default()),
                b"a" if kind.is_some() => {
                    if let Some(href) = attribute(&element, b"href") {
                        let rels = attribute_suffix(&element, b"type")
                            .map(|types| types.split_whitespace().map(str::to_string).collect())
                            .unwrap_or_default();
                        anchor = Some(Anchor {
                            href,
                            rels,
                            text: String::new(),
                        });
                    }
                }
                _ => {}
            },
            Ok(Event::Text(event)) if anchor.is_some() => {
                anchor
                    .as_mut()
                    .expect("guard ensures an anchor")
                    .text
                    .push_str(&event.unescape().unwrap_or_default());
            }
            Ok(Event::End(element)) => match element.local_name().as_ref() {
                b"a" if anchor.is_some() => {
                    let current = anchor.take().expect("guard ensures an anchor");
                    if let Ok((href, fragment)) = PublicationHref::resolve(nav_href, &current.href)
                    {
                        let mut link = ResourceLink::new(href, "application/xhtml+xml");
                        link.fragment = fragment;
                        link.rels = current.rels;
                        link.title = nonempty(current.text.trim().to_string())
                            .map(|title| LocalizedString::new(title, None));
                        if let Some(node) = stack.last_mut() {
                            node.link = Some(link);
                        }
                    }
                }
                b"li" if kind.is_some() => {
                    if let Some(mut node) = stack.pop() {
                        if let Some(mut link) = node.link.take() {
                            link.children = node.children;
                            if let Some(parent) = stack.last_mut() {
                                parent.children.push(link);
                            } else {
                                roots.push(link);
                            }
                        }
                    }
                }
                b"nav" if kind.is_some() => {
                    let current_kind = kind.take().expect("guard ensures a navigation kind");
                    let current_roots = std::mem::take(&mut roots);
                    match current_kind.as_str() {
                        "toc" => navigation.toc = current_roots,
                        "landmarks" => navigation.landmarks = current_roots,
                        "page-list" => navigation.page_list = current_roots,
                        _ => {
                            navigation.other.insert(current_kind, current_roots);
                        }
                    }
                    stack.clear();
                }
                _ => {}
            },
            Ok(Event::Eof) => break,
            Err(error) => return Err(format_invalid(Stage::Manifest, error)),
            _ => {}
        }
    }

    Ok(navigation)
}

fn parse_ncx(xml: &str, ncx_href: &PublicationHref) -> Result<Navigation, HaddonError> {
    let mut reader = Reader::from_str(xml);
    let mut navigation = Navigation::default();
    let mut current_label = String::new();
    let mut current_src: Option<String> = None;
    let mut in_nav_label = false;
    let mut in_text = false;

    loop {
        match reader.read_event() {
            Ok(Event::Start(element)) => match element.local_name().as_ref() {
                b"navLabel" => {
                    in_nav_label = true;
                    current_label.clear();
                }
                b"text" if in_nav_label => {
                    in_text = true;
                }
                _ => {}
            },
            Ok(Event::Empty(element)) => {
                if element.local_name().as_ref() == b"content" {
                    if let Some(src) = attribute(&element, b"src") {
                        current_src = Some(src);
                    }
                }
            }
            Ok(Event::Text(event)) if in_text => {
                current_label.push_str(&event.unescape().unwrap_or_default());
            }
            Ok(Event::End(element)) => match element.local_name().as_ref() {
                b"text" => {
                    in_text = false;
                }
                b"navLabel" => {
                    in_nav_label = false;
                }
                b"navPoint" => {
                    // Complete the current nav point
                    if let Some(src) = current_src.take() {
                        match PublicationHref::resolve(ncx_href, &src) {
                            Ok((href, fragment)) => {
                                let mut link = ResourceLink::new(href, "application/xhtml+xml");
                                link.fragment = fragment;
                                if !current_label.is_empty() {
                                    link.title = Some(LocalizedString::new(
                                        current_label.trim().to_string(),
                                        None,
                                    ));
                                }
                                navigation.toc.push(link);
                            }
                            Err(_) => {}
                        }
                    }
                    current_label.clear();
                }
                _ => {}
            },
            Ok(Event::Eof) => break,
            Err(error) => return Err(format_invalid(Stage::Manifest, error)),
            _ => {}
        }
    }

    Ok(navigation)
}

fn package_language(xml: &str) -> Option<String> {
    let mut reader = Reader::from_str(xml);
    loop {
        match reader.read_event() {
            Ok(Event::Start(element)) if element.local_name().as_ref() == b"package" => {
                return attribute_suffix(&element, b"lang");
            }
            Ok(Event::Eof) | Err(_) => return None,
            _ => {}
        }
    }
}

fn parse_progression(value: &str) -> Option<ReadingProgression> {
    match value {
        "ltr" => Some(ReadingProgression::LeftToRight),
        "rtl" => Some(ReadingProgression::RightToLeft),
        "default" | "auto" => Some(ReadingProgression::Auto),
        _ => None,
    }
}

fn attribute(element: &BytesStart<'_>, name: &[u8]) -> Option<String> {
    element.attributes().flatten().find_map(|attribute| {
        (attribute.key.as_ref() == name)
            .then(|| String::from_utf8_lossy(attribute.value.as_ref()).into_owned())
    })
}

fn attribute_suffix(element: &BytesStart<'_>, local_name: &[u8]) -> Option<String> {
    element.attributes().flatten().find_map(|attribute| {
        let key = attribute.key.as_ref();
        (key == local_name
            || key
                .strip_suffix(local_name)
                .is_some_and(|prefix| prefix.ends_with(b":")))
        .then(|| String::from_utf8_lossy(attribute.value.as_ref()).into_owned())
    })
}

fn read_required_text(
    archive: &mut ZipArchive<Cursor<&[u8]>>,
    path: &str,
) -> Result<String, HaddonError> {
    match read_optional_text(archive, path)? {
        Some(text) => Ok(text),
        None => Err(HaddonError::RequiredResourceMissing {
            href: PublicationHref::new(path).unwrap_or_else(|_| {
                PublicationHref::new("META-INF/container.xml")
                    .expect("the standard container path is canonical")
            }),
        }),
    }
}

fn read_optional_text(
    archive: &mut ZipArchive<Cursor<&[u8]>>,
    path: &str,
) -> Result<Option<String>, HaddonError> {
    let mut file = match archive.by_name(path) {
        Ok(file) => file,
        Err(zip::result::ZipError::FileNotFound) => return Ok(None),
        Err(error) => {
            return Err(HaddonError::ContainerCorrupt {
                message: error.to_string(),
            })
        }
    };
    let mut text = String::new();
    file.read_to_string(&mut text)
        .map_err(|error| HaddonError::DecodeFailed {
            href: PublicationHref::new(path).ok(),
            message: error.to_string(),
        })?;
    Ok(Some(text))
}

fn canonical_archive_path(path: &str) -> Result<String, HaddonError> {
    publication_href_from_source(path).map(|href| href.without_query().to_string())
}

fn publication_href_from_source(path: &str) -> Result<PublicationHref, HaddonError> {
    PublicationHref::new(path).map_err(|error| HaddonError::FormatInvalid {
        stage: Stage::Manifest,
        message: error.to_string(),
    })
}

fn nonempty(value: String) -> Option<String> {
    (!value.is_empty()).then_some(value)
}

fn format_invalid(stage: Stage, error: impl std::fmt::Display) -> HaddonError {
    HaddonError::FormatInvalid {
        stage,
        message: error.to_string(),
    }
}

fn navigation_warning(href: &PublicationHref, message: String) -> PublicationWarning {
    PublicationWarning {
        code: "haddon.manifest.navigation-omitted".to_string(),
        severity: WarningSeverity::Caution,
        stage: Stage::Manifest,
        message,
        href: Some(href.clone()),
        recovery: Some(Recovery::Omitted),
    }
}

fn normalize_media_type(media_type: &str) -> String {
    let trimmed = media_type.trim();
    if trimmed.is_empty() {
        return "application/octet-stream".to_string();
    }
    
    let (type_subtype, params) = trimmed.split_once(';').unwrap_or((trimmed, ""));
    let type_subtype = type_subtype.trim().to_lowercase();
    
    if !type_subtype.contains('/') {
        return "application/octet-stream".to_string();
    }
    
    let (main_type, sub_type) = type_subtype.split_once('/').unwrap();
    if main_type.is_empty() || sub_type.is_empty() {
        return "application/octet-stream".to_string();
    }
    
    if !params.is_empty() {
        format!("{};{}", type_subtype, params.trim())
    } else {
        type_subtype
    }
}

fn detect_fallback_cycle(
    start_id: &str,
    items: &BTreeMap<&str, &PackageItem>,
) -> Option<Vec<String>> {
    let mut visited = BTreeSet::new();
    let mut path = Vec::new();
    let mut current_id = start_id;

    loop {
        if !visited.insert(current_id) {
            // Found a cycle
            if let Some(cycle_start) = path.iter().position(|id| id == current_id) {
                let mut cycle = path[cycle_start..].to_vec();
                cycle.push(current_id.to_string());
                return Some(cycle);
            }
            return None;
        }

        path.push(current_id.to_string());

        let Some(item) = items.get(current_id) else {
            return None;
        };

        let Some(fallback_id) = &item.fallback else {
            return None;
        };

        current_id = fallback_id;
    }
}
