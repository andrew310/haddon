use super::{HaddonError, Stage};
use std::fmt;

/// The fragmentless, canonical identity of a resource owned by a publication.
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct PublicationHref(String);

impl PublicationHref {
    pub fn new(value: impl AsRef<str>) -> Result<Self, HaddonError> {
        canonicalize(value.as_ref()).map(Self)
    }

    pub fn as_str(&self) -> &str {
        &self.0
    }

    pub fn without_query(&self) -> Self {
        match self.0.split_once('?') {
            Some((path, _)) => Self(path.to_string()),
            None => self.clone(),
        }
    }

    pub fn resolve(base: &Self, reference: &str) -> Result<(Self, Option<String>), HaddonError> {
        let (reference, fragment) = split_fragment(reference);
        let reference_path = reference.split('?').next().unwrap_or(reference);
        let has_scheme = reference_path
            .split('/')
            .next()
            .is_some_and(|part| part.contains(':'));
        if reference.starts_with('/') || has_scheme {
            return Err(invalid_href(
                "absolute and external resource references are not owned",
            ));
        }

        let joined = if reference_path.is_empty() {
            let query = reference.strip_prefix(reference_path).unwrap_or_default();
            format!("{}{}", base.without_query().as_str(), query)
        } else {
            let base_without_query = base.without_query();
            let base_path = base_without_query.as_str();
            let directory = base_path
                .rsplit_once('/')
                .map(|(directory, _)| directory)
                .unwrap_or_default();
            if directory.is_empty() {
                reference.to_string()
            } else {
                format!("{directory}/{reference}")
            }
        };

        Ok((Self::new(joined)?, fragment.map(str::to_string)))
    }
}

impl AsRef<str> for PublicationHref {
    fn as_ref(&self) -> &str {
        self.as_str()
    }
}

impl fmt::Display for PublicationHref {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        self.0.fmt(formatter)
    }
}

impl TryFrom<&str> for PublicationHref {
    type Error = HaddonError;

    fn try_from(value: &str) -> Result<Self, Self::Error> {
        Self::new(value)
    }
}

pub(crate) fn split_fragment(value: &str) -> (&str, Option<&str>) {
    match value.split_once('#') {
        Some((href, fragment)) => (href, Some(fragment)),
        None => (value, None),
    }
}

fn canonicalize(value: &str) -> Result<String, HaddonError> {
    let (without_fragment, _) = split_fragment(value);
    let (path, query) = match without_fragment.split_once('?') {
        Some((path, query)) => (path, Some(query)),
        None => (without_fragment, None),
    };

    if path.is_empty() {
        return Err(invalid_href("resource href must contain a path"));
    }
    if path.starts_with('/') || path.contains('\\') {
        return Err(invalid_href(
            "resource href must be a forward-slash publication-relative path",
        ));
    }
    if path
        .split('/')
        .next()
        .is_some_and(|part| part.contains(':'))
    {
        return Err(invalid_href("resource href must not contain a URI scheme"));
    }

    let normalized_path = normalize_percent_encoding(path)?;
    let mut segments = Vec::new();
    for segment in normalized_path.split('/') {
        match segment {
            "" | "." => {}
            ".." => {
                if segments.pop().is_none() {
                    return Err(invalid_href(
                        "resource href traverses above the publication root",
                    ));
                }
            }
            segment => segments.push(segment),
        }
    }

    if segments.is_empty() {
        return Err(invalid_href(
            "resource href resolves to the publication root",
        ));
    }

    let mut canonical = segments.join("/");
    if let Some(query) = query {
        canonical.push('?');
        canonical.push_str(&normalize_percent_encoding(query)?);
    }
    Ok(canonical)
}

fn normalize_percent_encoding(value: &str) -> Result<String, HaddonError> {
    let bytes = value.as_bytes();
    let mut normalized = String::with_capacity(value.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] != b'%' {
            let character = value[index..]
                .chars()
                .next()
                .expect("index remains within the string");
            normalized.push(character);
            index += character.len_utf8();
            continue;
        }

        if index + 2 >= bytes.len() {
            return Err(invalid_href(
                "resource href has an incomplete percent escape",
            ));
        }
        let high = hex_value(bytes[index + 1]);
        let low = hex_value(bytes[index + 2]);
        let Some(decoded) = high.zip(low).map(|(high, low)| high * 16 + low) else {
            return Err(invalid_href("resource href has an invalid percent escape"));
        };
        if decoded.is_ascii_alphanumeric() || matches!(decoded, b'-' | b'.' | b'_' | b'~') {
            normalized.push(decoded as char);
        } else {
            normalized.push('%');
            normalized.push(
                char::from_digit((decoded >> 4) as u32, 16)
                    .unwrap()
                    .to_ascii_uppercase(),
            );
            normalized.push(
                char::from_digit((decoded & 0xf) as u32, 16)
                    .unwrap()
                    .to_ascii_uppercase(),
            );
        }
        index += 3;
    }
    Ok(normalized)
}

fn hex_value(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

fn invalid_href(message: impl Into<String>) -> HaddonError {
    HaddonError::InvalidArgument {
        stage: Stage::Manifest,
        field: "href".to_string(),
        message: message.into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonicalizes_relative_hrefs_and_strips_fragments() {
        assert_eq!(
            PublicationHref::new("text/./part/../chapter%2d1.xhtml#start")
                .unwrap()
                .as_str(),
            "text/chapter-1.xhtml"
        );
    }

    #[test]
    fn rejects_unsafe_hrefs() {
        for href in ["../secret", "/absolute", "https://example.com/book", r"a\b"] {
            assert!(PublicationHref::new(href).is_err(), "accepted {href}");
        }
    }
}
