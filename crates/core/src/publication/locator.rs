use super::{
    HaddonError, HaddonResult, Outcome, PublicationHref, PublicationWarning, Recovery, Stage,
    WarningSeverity,
};
use serde::Serialize;
use serde_json::{Map, Value};
use std::collections::BTreeMap;

pub const PUBLICATION_LOCATOR_SCHEMA: &str = "haddon.publication-locator";
pub const PUBLICATION_LOCATOR_VERSION: u32 = 1;
pub const WARNING_SELECTOR_DROPPED: &str = "haddon.locator.selector-dropped";
pub const WARNING_UNKNOWN_KEY: &str = "haddon.locator.unknown-key";

const MAX_JSON_SAFE_INTEGER: u64 = 9_007_199_254_740_991;
const KNOWN_TOP_LEVEL_KEYS: &[&str] = &[
    "schema",
    "version",
    "href",
    "mediaType",
    "title",
    "locations",
    "text",
    "extensions",
];

/// Persistable publication locator (schema `haddon.publication-locator`, version 1).
#[derive(Clone, Debug, PartialEq)]
pub struct PublicationLocator {
    pub schema: String,
    pub version: u32,
    pub href: PublicationHref,
    pub media_type: String,
    pub title: Option<String>,
    pub locations: LocatorLocations,
    pub text: Option<LocatorText>,
    pub extensions: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct LocatorLocations {
    pub fragments: Vec<String>,
    pub epub_cfi: Option<String>,
    pub css_selector: Option<String>,
    pub dom_range: Option<DomRangeSelector>,
    pub normalized: Option<NormalizedRangeSelector>,
    pub progression: Option<f64>,
    pub total_progression: Option<f64>,
    pub position: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocatorText {
    pub exact: String,
    pub prefix: Option<String>,
    pub suffix: Option<String>,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum TextOffsetUnit {
    #[default]
    Utf16CodeUnit,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TextOffset {
    pub value: u64,
    pub unit: TextOffsetUnit,
}

impl TextOffset {
    pub fn utf16(value: u64) -> Self {
        Self {
            value,
            unit: TextOffsetUnit::Utf16CodeUnit,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DomPointSelector {
    pub css_selector: String,
    pub text_node_index: u64,
    pub offset: Option<TextOffset>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct DomRangeSelector {
    pub start: DomPointSelector,
    pub end: Option<DomPointSelector>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NormalizedPointSelector {
    pub block_id: String,
    pub offset: TextOffset,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NormalizedRangeSelector {
    pub revision: String,
    pub start: NormalizedPointSelector,
    pub end: Option<NormalizedPointSelector>,
}

impl PublicationLocator {
    pub fn from_json(json: &str) -> HaddonResult<Self> {
        let value = serde_json::from_str(json).map_err(|error| {
            invalid_locator("json", format!("locator JSON is not valid: {error}"))
        })?;
        Self::from_value(value)
    }

    pub fn from_value(value: Value) -> HaddonResult<Self> {
        let object = match value {
            Value::Object(object) => object,
            _ => {
                return Err(invalid_locator(
                    "locator",
                    "publication locator must be a JSON object",
                ))
            }
        };
        parse_locator(object)
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string(self).expect("PublicationLocator always serializes")
    }

    pub fn to_value(&self) -> Value {
        serde_json::to_value(self).expect("PublicationLocator always serializes")
    }

    fn is_ranged_citation(&self) -> bool {
        range_is_open(
            self.locations
                .normalized
                .as_ref()
                .map(|range| (&range.start, range.end.as_ref())),
        ) || range_is_open(
            self.locations
                .dom_range
                .as_ref()
                .map(|range| (&range.start, range.end.as_ref())),
        )
    }
}

fn range_is_open<T: PartialEq>(range: Option<(&T, Option<&T>)>) -> bool {
    match range {
        Some((start, Some(end))) => start != end,
        _ => false,
    }
}

/// UTF-16 code-unit length of `text`. Astral characters contribute two units.
pub fn utf16_len(text: &str) -> usize {
    text.encode_utf16().count()
}

/// True when `offset` is in `0..=utf16_len(text)` and does not split a surrogate pair.
pub fn is_valid_utf16_offset(text: &str, offset: u64) -> bool {
    utf16_to_byte_index(text, offset).is_ok()
}

/// Half-open UTF-16 slice `[start, end)`. Offsets must be valid UTF-16 positions.
pub fn utf16_slice(text: &str, start: u64, end: u64) -> Result<&str, HaddonError> {
    if start > end {
        return Err(invalid_locator(
            "offset",
            "UTF-16 range start must be less than or equal to end",
        ));
    }
    let start_byte = utf16_to_byte_index(text, start)?;
    let end_byte = utf16_to_byte_index(text, end)?;
    debug_assert!(text.is_char_boundary(start_byte) && text.is_char_boundary(end_byte));
    Ok(&text[start_byte..end_byte])
}

/// Convert a UTF-8 byte index on a character boundary into a UTF-16 code-unit offset.
pub fn utf16_offset_at_byte(text: &str, byte_index: usize) -> Result<u64, HaddonError> {
    if !text.is_char_boundary(byte_index) {
        return Err(invalid_locator(
            "offset",
            "UTF-8 byte index is not a character boundary",
        ));
    }
    Ok(text[..byte_index].encode_utf16().count() as u64)
}

fn utf16_to_byte_index(text: &str, offset: u64) -> Result<usize, HaddonError> {
    let mut remaining = offset;
    for (byte_index, character) in text.char_indices() {
        if remaining == 0 {
            return Ok(byte_index);
        }
        let width = character.len_utf16() as u64;
        if remaining < width {
            return Err(invalid_locator(
                "offset",
                "UTF-16 offset splits a surrogate pair",
            ));
        }
        remaining -= width;
    }
    if remaining == 0 {
        Ok(text.len())
    } else {
        Err(invalid_locator(
            "offset",
            "UTF-16 offset is outside the referenced text",
        ))
    }
}

/// Persistable progression values are finite and in `[0, 1]`.
pub fn is_valid_progression(value: f64) -> bool {
    value.is_finite() && (0.0..=1.0).contains(&value)
}

fn parse_locator(object: Map<String, Value>) -> HaddonResult<PublicationLocator> {
    match object.get("schema") {
        None => return Err(invalid_locator("schema", "schema is required")),
        Some(Value::String(schema)) if schema == PUBLICATION_LOCATOR_SCHEMA => {}
        Some(_) => {
            return Err(invalid_locator(
                "schema",
                "schema must be \"haddon.publication-locator\"",
            ))
        }
    }

    match object.get("version") {
        None => return Err(invalid_locator("version", "version is required")),
        Some(value) if as_json_u64(value) == Some(PUBLICATION_LOCATOR_VERSION as u64) => {}
        Some(_) => return Err(invalid_locator("version", "unsupported locator version")),
    }

    let href = match object.get("href") {
        None => return Err(invalid_locator("href", "href is required")),
        Some(Value::String(href)) => PublicationHref::new(href).map_err(relocate_href_error)?,
        Some(_) => return Err(invalid_locator("href", "href must be a string")),
    };

    let media_type = match object.get("mediaType") {
        None => return Err(invalid_locator("mediaType", "mediaType is required")),
        Some(Value::String(media_type)) => normalize_media_type(media_type)?,
        Some(_) => return Err(invalid_locator("mediaType", "mediaType must be a string")),
    };

    let mut warnings = Vec::new();
    for key in object.keys() {
        if !KNOWN_TOP_LEVEL_KEYS.contains(&key.as_str()) {
            warnings.push(unknown_key_warning(key, &href));
        }
    }

    let title = match object.get("title") {
        None => None,
        Some(Value::String(title)) if !title.is_empty() => Some(title.clone()),
        Some(Value::String(_)) | Some(Value::Null) => None,
        Some(_) => {
            warnings.push(selector_dropped_warning("title", &href));
            None
        }
    };

    let locations = match object.get("locations") {
        None | Some(Value::Null) => LocatorLocations::default(),
        Some(Value::Object(locations)) => parse_locations(locations, &href, &mut warnings),
        Some(_) => {
            return Err(invalid_locator(
                "locations",
                "locations must be a JSON object",
            ))
        }
    };

    let extensions = match object.get("extensions") {
        None | Some(Value::Null) => BTreeMap::new(),
        Some(Value::Object(extensions)) => extensions
            .iter()
            .map(|(key, value)| (key.clone(), value.clone()))
            .collect(),
        Some(_) => {
            warnings.push(selector_dropped_warning("extensions", &href));
            BTreeMap::new()
        }
    };

    let mut locator = PublicationLocator {
        schema: PUBLICATION_LOCATOR_SCHEMA.to_string(),
        version: PUBLICATION_LOCATOR_VERSION,
        href: href.clone(),
        media_type,
        title,
        locations,
        text: None,
        extensions,
    };

    locator.text = match object.get("text") {
        None | Some(Value::Null) => None,
        Some(value) => match parse_text(value, &href, &mut warnings) {
            Some(text) if text.exact.is_empty() && locator.is_ranged_citation() => {
                return Err(invalid_locator(
                    "text.exact",
                    "empty text.exact is invalid for a ranged citation",
                ))
            }
            Some(text) if text.exact.is_empty() => {
                warnings.push(selector_dropped_warning("text.exact", &href));
                None
            }
            Some(text) => Some(text),
            None => {
                warnings.push(selector_dropped_warning("text", &href));
                None
            }
        },
    };

    if warnings.is_empty() {
        Ok(Outcome::complete(locator))
    } else {
        Ok(Outcome::partial(locator, warnings, None))
    }
}

fn parse_locations(
    object: &Map<String, Value>,
    href: &PublicationHref,
    warnings: &mut Vec<PublicationWarning>,
) -> LocatorLocations {
    let mut locations = LocatorLocations::default();

    if let Some(value) = object.get("fragments") {
        match parse_fragments(value) {
            Some(fragments) => locations.fragments = fragments,
            None => warnings.push(selector_dropped_warning("locations.fragments", href)),
        }
    }

    if let Some(value) = object.get("epubCfi") {
        match optional_nonempty_string(value) {
            Some(cfi) => locations.epub_cfi = Some(cfi),
            None => warnings.push(selector_dropped_warning("locations.epubCfi", href)),
        }
    }

    if let Some(value) = object.get("cssSelector") {
        match optional_nonempty_string(value) {
            Some(selector) => locations.css_selector = Some(selector),
            None => warnings.push(selector_dropped_warning("locations.cssSelector", href)),
        }
    }

    if let Some(value) = object.get("domRange") {
        match parse_dom_range(value) {
            Some(range) => locations.dom_range = Some(range),
            None => warnings.push(selector_dropped_warning("locations.domRange", href)),
        }
    }

    if let Some(value) = object.get("normalized") {
        match parse_normalized_range(value) {
            Some(range) => locations.normalized = Some(range),
            None => warnings.push(selector_dropped_warning("locations.normalized", href)),
        }
    }

    if let Some(value) = object.get("progression") {
        match parse_progression_value(value) {
            Some(progression) => locations.progression = Some(progression),
            None => warnings.push(selector_dropped_warning("locations.progression", href)),
        }
    }

    if let Some(value) = object.get("totalProgression") {
        match parse_progression_value(value) {
            Some(progression) => locations.total_progression = Some(progression),
            None => warnings.push(selector_dropped_warning("locations.totalProgression", href)),
        }
    }

    if let Some(value) = object.get("position") {
        match as_json_u64(value).filter(|position| *position >= 1) {
            Some(position) => locations.position = Some(position),
            None => warnings.push(selector_dropped_warning("locations.position", href)),
        }
    }

    locations
}

fn parse_fragments(value: &Value) -> Option<Vec<String>> {
    let items = value.as_array()?;
    let mut fragments = Vec::new();
    for item in items {
        let fragment = item.as_str()?;
        if fragment.is_empty() || fragment.contains('#') {
            return None;
        }
        fragments.push(fragment.to_string());
    }
    Some(fragments)
}

fn parse_dom_range(value: &Value) -> Option<DomRangeSelector> {
    let object = value.as_object()?;
    let start = parse_dom_point(object.get("start")?)?;
    let end = match object.get("end") {
        None => None,
        Some(end) => Some(parse_dom_point(end)?),
    };
    let end = end.filter(|end| end != &start);
    Some(DomRangeSelector { start, end })
}

fn parse_dom_point(value: &Value) -> Option<DomPointSelector> {
    let object = value.as_object()?;
    let css_selector = nonempty_string(object.get("cssSelector")?)?;
    let text_node_index = as_json_u64(object.get("textNodeIndex")?)?;
    let offset = match object.get("offset") {
        None => None,
        Some(offset) => Some(parse_text_offset(offset)?),
    };
    Some(DomPointSelector {
        css_selector,
        text_node_index,
        offset,
    })
}

fn parse_normalized_range(value: &Value) -> Option<NormalizedRangeSelector> {
    let object = value.as_object()?;
    let revision = nonempty_string(object.get("revision")?)?;
    let start = parse_normalized_point(object.get("start")?)?;
    let end = match object.get("end") {
        None => None,
        Some(end) => Some(parse_normalized_point(end)?),
    };
    if let Some(end) = &end {
        if end.block_id == start.block_id && end.offset.value < start.offset.value {
            return None;
        }
    }
    let end = end.filter(|end| end != &start);
    Some(NormalizedRangeSelector {
        revision,
        start,
        end,
    })
}

fn parse_normalized_point(value: &Value) -> Option<NormalizedPointSelector> {
    let object = value.as_object()?;
    Some(NormalizedPointSelector {
        block_id: nonempty_string(object.get("blockId")?)?,
        offset: parse_text_offset(object.get("offset")?)?,
    })
}

fn parse_text_offset(value: &Value) -> Option<TextOffset> {
    let object = value.as_object()?;
    let unit = object.get("unit")?.as_str()?;
    if unit != "utf16-code-unit" {
        return None;
    }
    Some(TextOffset::utf16(as_json_u64(object.get("value")?)?))
}

fn parse_text(
    value: &Value,
    href: &PublicationHref,
    warnings: &mut Vec<PublicationWarning>,
) -> Option<LocatorText> {
    let object = value.as_object()?;
    let exact = object.get("exact")?.as_str()?.to_string();
    let prefix = match object.get("prefix") {
        None => None,
        Some(Value::String(prefix)) => Some(prefix.clone()),
        Some(_) => {
            warnings.push(selector_dropped_warning("text.prefix", href));
            None
        }
    };
    let suffix = match object.get("suffix") {
        None => None,
        Some(Value::String(suffix)) => Some(suffix.clone()),
        Some(_) => {
            warnings.push(selector_dropped_warning("text.suffix", href));
            None
        }
    };
    Some(LocatorText {
        exact,
        prefix,
        suffix,
    })
}

fn parse_progression_value(value: &Value) -> Option<f64> {
    let number = value.as_f64()?;
    is_valid_progression(number).then_some(number)
}

fn optional_nonempty_string(value: &Value) -> Option<String> {
    nonempty_string(value)
}

fn nonempty_string(value: &Value) -> Option<String> {
    value
        .as_str()
        .filter(|value| !value.is_empty())
        .map(str::to_string)
}

fn as_json_u64(value: &Value) -> Option<u64> {
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

fn normalize_media_type(raw: &str) -> Result<String, HaddonError> {
    let raw = raw.trim();
    if raw.is_empty() {
        return Err(invalid_locator("mediaType", "mediaType must not be empty"));
    }
    let (essence, parameters) = match raw.split_once(';') {
        Some((essence, parameters)) => (essence.trim(), Some(parameters)),
        None => (raw, None),
    };
    let (type_name, subtype) = essence
        .split_once('/')
        .ok_or_else(|| invalid_locator("mediaType", "mediaType must be type/subtype"))?;
    let type_name = type_name.trim().to_ascii_lowercase();
    let subtype = subtype.trim().to_ascii_lowercase();
    if type_name.is_empty() || subtype.is_empty() {
        return Err(invalid_locator(
            "mediaType",
            "mediaType type and subtype must be non-empty",
        ));
    }
    let mut normalized = format!("{type_name}/{subtype}");
    if let Some(parameters) = parameters {
        for parameter in parameters.split(';') {
            let parameter = parameter.trim();
            if parameter.is_empty() {
                continue;
            }
            let Some((name, value)) = parameter.split_once('=') else {
                return Err(invalid_locator(
                    "mediaType",
                    "mediaType parameter is missing a value",
                ));
            };
            let name = name.trim().to_ascii_lowercase();
            let value = value.trim();
            if name.is_empty() || value.is_empty() {
                return Err(invalid_locator(
                    "mediaType",
                    "mediaType parameter name and value must be non-empty",
                ));
            }
            normalized.push_str("; ");
            normalized.push_str(&name);
            normalized.push('=');
            normalized.push_str(value);
        }
    }
    Ok(normalized)
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

fn invalid_locator(field: impl Into<String>, message: impl Into<String>) -> HaddonError {
    HaddonError::InvalidArgument {
        stage: Stage::Locate,
        field: field.into(),
        message: message.into(),
    }
}

fn selector_dropped_warning(field: &str, href: &PublicationHref) -> PublicationWarning {
    PublicationWarning {
        code: WARNING_SELECTOR_DROPPED.to_string(),
        severity: WarningSeverity::Caution,
        stage: Stage::Locate,
        message: format!("dropped invalid optional selector {field}"),
        href: Some(href.clone()),
        recovery: Some(Recovery::Omitted),
    }
}

fn unknown_key_warning(key: &str, href: &PublicationHref) -> PublicationWarning {
    PublicationWarning {
        code: WARNING_UNKNOWN_KEY.to_string(),
        severity: WarningSeverity::Info,
        stage: Stage::Locate,
        message: format!("ignored unknown top-level key {key}"),
        href: Some(href.clone()),
        recovery: Some(Recovery::Ignored),
    }
}

impl Serialize for PublicationLocator {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        write_dto(self).serialize(serializer)
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LocatorWrite<'a> {
    schema: &'a str,
    version: u32,
    href: &'a str,
    media_type: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    title: Option<&'a str>,
    locations: LocationsWrite<'a>,
    #[serde(skip_serializing_if = "Option::is_none")]
    text: Option<TextWrite<'a>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    extensions: Option<&'a BTreeMap<String, Value>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LocationsWrite<'a> {
    #[serde(skip_serializing_if = "<[String]>::is_empty")]
    fragments: &'a [String],
    #[serde(rename = "epubCfi", skip_serializing_if = "Option::is_none")]
    epub_cfi: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    css_selector: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    dom_range: Option<DomRangeWrite<'a>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    normalized: Option<NormalizedRangeWrite<'a>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    progression: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    total_progression: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    position: Option<u64>,
}

#[derive(Serialize)]
struct TextWrite<'a> {
    exact: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    prefix: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    suffix: Option<&'a str>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DomRangeWrite<'a> {
    start: DomPointWrite<'a>,
    #[serde(skip_serializing_if = "Option::is_none")]
    end: Option<DomPointWrite<'a>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DomPointWrite<'a> {
    css_selector: &'a str,
    text_node_index: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    offset: Option<TextOffsetWrite>,
}

#[derive(Serialize)]
struct NormalizedRangeWrite<'a> {
    revision: &'a str,
    start: NormalizedPointWrite<'a>,
    #[serde(skip_serializing_if = "Option::is_none")]
    end: Option<NormalizedPointWrite<'a>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct NormalizedPointWrite<'a> {
    block_id: &'a str,
    offset: TextOffsetWrite,
}

#[derive(Serialize)]
struct TextOffsetWrite {
    value: u64,
    unit: &'static str,
}

fn write_dto(locator: &PublicationLocator) -> LocatorWrite<'_> {
    LocatorWrite {
        schema: PUBLICATION_LOCATOR_SCHEMA,
        version: PUBLICATION_LOCATOR_VERSION,
        href: locator.href.as_str(),
        media_type: locator.media_type.as_str(),
        title: locator.title.as_deref(),
        locations: LocationsWrite {
            fragments: &locator.locations.fragments,
            epub_cfi: locator.locations.epub_cfi.as_deref(),
            css_selector: locator.locations.css_selector.as_deref(),
            dom_range: locator.locations.dom_range.as_ref().map(write_dom_range),
            normalized: locator
                .locations
                .normalized
                .as_ref()
                .map(write_normalized_range),
            progression: locator.locations.progression,
            total_progression: locator.locations.total_progression,
            position: locator.locations.position,
        },
        text: locator.text.as_ref().map(|text| TextWrite {
            exact: &text.exact,
            prefix: text.prefix.as_deref(),
            suffix: text.suffix.as_deref(),
        }),
        extensions: (!locator.extensions.is_empty()).then_some(&locator.extensions),
    }
}

fn write_dom_range(range: &DomRangeSelector) -> DomRangeWrite<'_> {
    DomRangeWrite {
        start: write_dom_point(&range.start),
        end: range
            .end
            .as_ref()
            .filter(|end| *end != &range.start)
            .map(write_dom_point),
    }
}

fn write_dom_point(point: &DomPointSelector) -> DomPointWrite<'_> {
    DomPointWrite {
        css_selector: &point.css_selector,
        text_node_index: point.text_node_index,
        offset: point.offset.map(write_text_offset),
    }
}

fn write_normalized_range(range: &NormalizedRangeSelector) -> NormalizedRangeWrite<'_> {
    NormalizedRangeWrite {
        revision: &range.revision,
        start: write_normalized_point(&range.start),
        end: range
            .end
            .as_ref()
            .filter(|end| *end != &range.start)
            .map(write_normalized_point),
    }
}

fn write_normalized_point(point: &NormalizedPointSelector) -> NormalizedPointWrite<'_> {
    NormalizedPointWrite {
        block_id: &point.block_id,
        offset: write_text_offset(point.offset),
    }
}

fn write_text_offset(offset: TextOffset) -> TextOffsetWrite {
    TextOffsetWrite {
        value: offset.value,
        unit: "utf16-code-unit",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utf16_offset_at_byte_requires_char_boundary() {
        let text = "👍";
        assert_eq!(utf16_offset_at_byte(text, 0).unwrap(), 0);
        assert!(utf16_offset_at_byte(text, 1).is_err());
        assert_eq!(utf16_offset_at_byte(text, text.len()).unwrap(), 2);
    }

    #[test]
    fn writers_emit_only_utf16_unit() {
        let locator = PublicationLocator::from_json(
            r#"{
                "schema": "haddon.publication-locator",
                "version": 1,
                "href": "text/chapter-1.xhtml",
                "mediaType": "application/xhtml+xml",
                "locations": {
                    "normalized": {
                        "revision": "r",
                        "start": {
                            "blockId": "src:block",
                            "offset": { "value": 0, "unit": "utf16-code-unit" }
                        }
                    }
                }
            }"#,
        )
        .unwrap()
        .value;
        let json = locator.to_json();
        assert!(json.contains("utf16-code-unit"));
        assert!(!json.contains("unicode-scalar"));
        assert!(!json.contains("utf8-byte"));
    }
}
