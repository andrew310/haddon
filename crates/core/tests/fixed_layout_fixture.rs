use haddon_core::publication::{fixed_layout_epub, open_epub_default};

#[test]
fn fixed_layout_fixture_opens_successfully() {
    let bytes = fixed_layout_epub();
    let result = open_epub_default(&bytes);
    
    assert!(result.is_ok(), "Fixed-layout EPUB should open successfully");
    
    let opened = result.unwrap();
    let manifest = opened.value.publication.manifest();
    
    // Check metadata
    assert_eq!(manifest.metadata.identifier, Some("haddon-fixed-layout-test".to_string()));
    assert_eq!(manifest.metadata.title.as_ref().map(|t| t.value.as_str()), Some("Fixed-Layout Test"));
    
    // Check rendition hints
    assert_eq!(manifest.rendition.layout, Some("pre-paginated".to_string()));
    assert_eq!(manifest.rendition.orientation, Some("auto".to_string()));
    assert_eq!(manifest.rendition.spread, Some("auto".to_string()));
}

#[test]
fn fixed_layout_fixture_has_correct_spine() {
    let bytes = fixed_layout_epub();
    let opened = open_epub_default(&bytes).unwrap();
    let manifest = opened.value.publication.manifest();
    
    // Should have 4 spine items
    assert_eq!(manifest.reading_order.len(), 4);
    
    // Check spine order
    assert_eq!(manifest.reading_order[0].href.as_str(), "images/page001.jpg");
    assert_eq!(manifest.reading_order[1].href.as_str(), "images/page002.jpg");
    assert_eq!(manifest.reading_order[2].href.as_str(), "text/page003.xhtml");
    assert_eq!(manifest.reading_order[3].href.as_str(), "text/page004.xhtml");
    
    // Check media types
    assert_eq!(manifest.reading_order[0].media_type, "image/jpeg");
    assert_eq!(manifest.reading_order[1].media_type, "image/jpeg");
    assert_eq!(manifest.reading_order[2].media_type, "application/xhtml+xml");
    assert_eq!(manifest.reading_order[3].media_type, "application/xhtml+xml");
}

#[test]
fn fixed_layout_fixture_image_resources_accessible() {
    let bytes = fixed_layout_epub();
    let opened = open_epub_default(&bytes).unwrap();
    let publication = opened.value.publication;
    
    // Access image resources
    let page001_result = publication.get_resource("images/page001.jpg", None);
    assert!(page001_result.is_ok());
    
    let page001_resource = page001_result.unwrap().value;
    assert!(page001_resource.bytes.len() > 0);
    
    // Check JPEG signature
    let jpeg_signature = &page001_resource.bytes[0..2];
    assert_eq!(jpeg_signature, &[0xFF, 0xD8], "Should be valid JPEG");
}

#[test]
fn fixed_layout_fixture_xhtml_resources_accessible() {
    let bytes = fixed_layout_epub();
    let opened = open_epub_default(&bytes).unwrap();
    let publication = opened.value.publication;
    
    // Access XHTML resources
    let page003_result = publication.get_resource("text/page003.xhtml", None);
    assert!(page003_result.is_ok());
    
    let page003_resource = page003_result.unwrap().value;
    let html = std::str::from_utf8(&page003_resource.bytes).unwrap();
    
    assert!(html.contains("<?xml"));
    assert!(html.contains("Page 3"));
    assert!(html.contains("width=800, height=1200"));
}
