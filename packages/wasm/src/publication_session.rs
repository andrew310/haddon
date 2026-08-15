use haddon_core::publication::{
    citation_roundtrip_epub, open_epub_default, render_normalized_html, LocatorResolution,
    NormalizationResult, Publication, PublicationLocator, ResolutionPolicy, ResourceLink,
};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct PublicationSession {
    publication: Publication,
}

#[wasm_bindgen]
impl PublicationSession {
    pub fn load(data: &[u8]) -> Result<PublicationSession, JsValue> {
        let opened = open_epub_default(data).map_err(haddon_error)?;
        Ok(PublicationSession {
            publication: opened.value.publication,
        })
    }

    pub fn load_citation_fixture() -> Result<PublicationSession, JsValue> {
        Self::load(&citation_roundtrip_epub())
    }

    pub fn title(&self) -> Option<String> {
        self.publication
            .manifest()
            .metadata
            .title
            .as_ref()
            .map(|title| title.value.clone())
    }

    pub fn reading_order_json(&self) -> String {
        let items: Vec<serde_json::Value> = self
            .publication
            .manifest()
            .reading_order
            .iter()
            .filter(|link| link.is_linear())
            .map(link_json)
            .collect();
        serde_json::to_string(&items).unwrap_or_else(|_| "[]".to_string())
    }

    pub fn first_linear_href(&self) -> Option<String> {
        self.publication
            .manifest()
            .reading_order
            .iter()
            .find(|link| link.is_linear())
            .or_else(|| self.publication.manifest().reading_order.first())
            .map(|link| link.href.to_string())
    }

    pub fn render_html(&self, href: &str) -> Result<String, JsValue> {
        let resource = match self
            .publication
            .normalize(href)
            .map_err(haddon_error)?
            .value
        {
            NormalizationResult::Normalized(resource) => resource,
            NormalizationResult::Unsupported { media_type, .. } => {
                return Err(JsValue::from_str(&format!(
                    "{href} cannot be normalized ({media_type})"
                )))
            }
        };
        Ok(render_normalized_html(&resource))
    }

    pub fn resource_bytes(&self, href: &str) -> Result<Vec<u8>, JsValue> {
        let resource = self
            .publication
            .get_resource(href)
            .map_err(haddon_error)?
            .value
            .ok_or_else(|| JsValue::from_str(&format!("resource not found: {href}")))?;
        resource
            .read(None)
            .map(|outcome| outcome.value)
            .map_err(haddon_error)
    }

    pub fn resolve_json(&self, locator_json: &str, policy: &str) -> Result<String, JsValue> {
        let locator = PublicationLocator::from_json(locator_json)
            .map_err(haddon_error)?
            .value;
        let policy = match policy {
            "navigation" => ResolutionPolicy::Navigation,
            "resume" => ResolutionPolicy::Resume,
            _ => ResolutionPolicy::Citation,
        };
        let resolution = self
            .publication
            .resolve(&locator, policy)
            .map_err(haddon_error)?
            .value;
        Ok(resolution_json(&resolution))
    }

    pub fn close(&self) {
        let _ = self.publication.close();
    }
}

fn link_json(link: &ResourceLink) -> serde_json::Value {
    serde_json::json!({
        "href": link.href.as_str(),
        "title": link.title.as_ref().map(|title| title.value.clone()),
        "mediaType": link.media_type,
    })
}

fn resolution_json(resolution: &LocatorResolution) -> String {
    let value = match resolution {
        LocatorResolution::Resolved {
            target,
            locator,
            strategy,
            confidence,
            ..
        } => serde_json::json!({
            "status": "resolved",
            "strategy": format!("{strategy:?}").to_ascii_lowercase(),
            "confidence": format!("{confidence:?}").to_ascii_lowercase(),
            "blockId": target.block_id,
            "start": target.start,
            "end": target.end,
            "href": locator.href.as_str(),
            "exact": locator.text.as_ref().map(|text| text.exact.clone()),
            "locatorJson": locator.to_json(),
        }),
        LocatorResolution::Ambiguous {
            reason,
            total_candidate_count,
            ..
        } => serde_json::json!({
            "status": "ambiguous",
            "reason": reason,
            "totalCandidateCount": total_candidate_count,
        }),
        LocatorResolution::Unresolved { reason, .. } => serde_json::json!({
            "status": "unresolved",
            "reason": reason,
        }),
    };
    serde_json::to_string(&value).unwrap_or_else(|_| "{\"status\":\"unresolved\"}".to_string())
}

fn haddon_error(error: impl std::fmt::Display) -> JsValue {
    JsValue::from_str(&error.to_string())
}
