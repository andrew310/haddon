use haddon_core::publication::{
    citation_roundtrip_epub, open_epub_default, render_normalized_html, LocatorResolution,
    NormalizationResult, Publication, PublicationLocator, ResolutionPolicy, ResourceLink,
};
use haddon_core::search::{search_publication, search_publication_resource, SearchOutcome};
use std::sync::atomic::{AtomicU32, Ordering};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct PublicationSession {
    publication: Publication,
    search_epoch: AtomicU32,
}

#[wasm_bindgen]
impl PublicationSession {
    pub fn load(data: &[u8]) -> Result<PublicationSession, JsValue> {
        let opened = open_epub_default(data).map_err(haddon_error)?;
        Ok(PublicationSession {
            publication: opened.value.publication,
            search_epoch: AtomicU32::new(0),
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

    pub fn toc_json(&self) -> String {
        let items: Vec<serde_json::Value> = self
            .publication
            .manifest()
            .navigation
            .toc
            .iter()
            .map(toc_entry_json)
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

    pub fn begin_search(&self) -> u32 {
        self.search_epoch.fetch_add(1, Ordering::AcqRel) + 1
    }

    pub fn cancel_search(&self) {
        self.search_epoch.fetch_add(1, Ordering::AcqRel);
    }

    pub fn search_generation(&self) -> u32 {
        self.search_epoch.load(Ordering::Acquire)
    }

    pub fn search_json(&self, query: &str, limit: usize) -> Result<String, JsValue> {
        self.search_json_for_generation(query, limit, None)
    }

    pub fn search_json_for(
        &self,
        query: &str,
        limit: usize,
        generation: u32,
    ) -> Result<String, JsValue> {
        self.search_json_for_generation(query, limit, Some(generation))
    }

    pub fn search_resource_json(
        &self,
        href: &str,
        query: &str,
        limit: usize,
        generation: u32,
    ) -> Result<String, JsValue> {
        if !self.generation_is_current(Some(generation)) {
            return Ok(cancelled_json());
        }
        let hits = search_publication_resource(&self.publication, href, query, limit);
        if !self.generation_is_current(Some(generation)) {
            return Ok(cancelled_json());
        }
        serde_json::to_string(&hits).map_err(haddon_error)
    }
}

impl PublicationSession {
    fn generation_is_current(&self, generation: Option<u32>) -> bool {
        match generation {
            None => true,
            Some(expected) => self.search_epoch.load(Ordering::Acquire) == expected,
        }
    }

    fn search_json_for_generation(
        &self,
        query: &str,
        limit: usize,
        generation: Option<u32>,
    ) -> Result<String, JsValue> {
        let outcome = search_publication(&self.publication, query, limit, || {
            self.generation_is_current(generation)
        });
        match outcome {
            SearchOutcome::Cancelled => Ok(cancelled_json()),
            SearchOutcome::Complete(hits) => serde_json::to_string(&hits).map_err(haddon_error),
        }
    }
}

fn cancelled_json() -> String {
    "{\"cancelled\":true}".to_string()
}

fn link_json(link: &ResourceLink) -> serde_json::Value {
    serde_json::json!({
        "href": link.href.as_str(),
        "title": link.title.as_ref().map(|title| title.value.clone()),
        "mediaType": link.media_type,
    })
}

fn toc_entry_json(link: &ResourceLink) -> serde_json::Value {
    let mut entry = serde_json::json!({
        "href": link.href.as_str(),
        "title": link.title.as_ref().map(|title| title.value.clone()),
    });

    if !link.children.is_empty() {
        let children: Vec<serde_json::Value> = link.children.iter().map(toc_entry_json).collect();
        entry["children"] = serde_json::json!(children);
    }

    entry
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
