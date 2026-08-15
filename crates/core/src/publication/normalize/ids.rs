use super::{base64url_lower, SourcePathStep};
use sha2::{Digest, Sha256};

pub(super) fn encode_component(value: &str) -> String {
    value.replace('%', "%25").replace('#', "%23")
}

pub(super) fn src_id(href: &str, source_id: &str) -> String {
    format!(
        "src:{}#{}",
        encode_component(href),
        encode_component(source_id)
    )
}

#[allow(dead_code)]
pub(super) fn src_id_split(href: &str, source_id: &str, kind: &str, ordinal: u32) -> String {
    format!("{}~{kind}~{ordinal}", src_id(href, source_id))
}

/// Length-prefixed SHA-256 identity: href, structural path, kind, split ordinal, nearest id.
pub(super) fn n1_id(parts: &[&str]) -> String {
    let mut bytes = Vec::new();
    for part in parts {
        let raw = part.as_bytes();
        bytes.extend_from_slice(&(raw.len() as u32).to_be_bytes());
        bytes.extend_from_slice(raw);
    }
    let digest = Sha256::digest(&bytes);
    format!("n1:{}", base64url_lower(&digest[..16]))
}

pub(super) fn structural_path(steps: &[SourcePathStep], text_node_index: Option<u32>) -> String {
    let mut path = String::new();
    for step in steps {
        path.push('/');
        if let Some(namespace) = &step.namespace {
            path.push('{');
            path.push_str(namespace);
            path.push('}');
        }
        path.push_str(&step.local_name);
        path.push('[');
        path.push_str(&step.same_name_index.to_string());
        path.push(']');
    }
    if let Some(index) = text_node_index {
        path.push_str("/text()[");
        path.push_str(&index.to_string());
        path.push(']');
    }
    path
}
