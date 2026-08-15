use super::ids::{n1_id, src_id, structural_path};
use super::source_map::utf16_len;
use super::{
    default_normalization_stamp, parse_semantic_role, project_inlines, AsideBlock,
    AsideDisposition, BlockNode, DocumentKind, DocumentNode, FigureBlock, InlineNode, LinkTarget,
    MediaKind, MediaNode, MediaSource, NodeBase, NodeSourceEvidence, NormalizedResource,
    NormalizedTextPoint, NormalizedTextRange, NoteKind, ObjectProjection, OmittedSource,
    ResourceLink, SemanticRole, SourceDomPoint, SourceDomRange, SourceElementRef, SourceMapSegment,
    SourceMapV1, SourceNodeRef, SourcePathStep, SourceTextNodeRef, SourceTextSpan, TextBlock,
    TextBlockRole, TextDirection, TextOffset, TextTransform, WarningLevel, RESOURCE_SCHEMA,
};
use crate::publication::{HaddonError, PublicationHref, Stage};
use quick_xml::events::{BytesStart, Event};
use quick_xml::Reader;
use std::collections::{BTreeMap, BTreeSet, HashSet};

const XHTML_NS: &str = "http://www.w3.org/1999/xhtml";

pub(super) fn normalize_xhtml(
    href: &PublicationHref,
    media_type: &str,
    xml: &str,
    source_revision: &str,
    resources: &[ResourceLink],
) -> Result<NormalizedResource, HaddonError> {
    let root = parse_source_tree(xml)?;
    let mut converter = Converter::new(href, resources);
    converter.collect_ids(&root);
    let document = converter.convert_document(&root)?;
    converter.warnings.sort_by(|left, right| {
        (
            left.source
                .as_ref()
                .map(|source| source.dom_path.len())
                .unwrap_or(0),
            left.code.as_str(),
            left.node_ids.first().map(String::as_str).unwrap_or(""),
        )
            .cmp(&(
                right
                    .source
                    .as_ref()
                    .map(|source| source.dom_path.len())
                    .unwrap_or(0),
                right.code.as_str(),
                right.node_ids.first().map(String::as_str).unwrap_or(""),
            ))
    });
    let resource = NormalizedResource {
        schema: RESOURCE_SCHEMA.to_string(),
        version: 1,
        href: href.to_string(),
        media_type: media_type.to_string(),
        source_revision: source_revision.to_string(),
        normalization: default_normalization_stamp(),
        root: document,
        source_map: SourceMapV1::new(std::mem::take(&mut converter.segments)),
        warnings: std::mem::take(&mut converter.warnings),
    };
    if let Err(message) = resource.assert_complete_normalized_coverage() {
        let mut resource = resource;
        resource.warnings.push(super::NormalizationWarning {
            code: "normalization.incomplete-source-map".to_string(),
            severity: super::WarningLevel::Warning,
            message,
            href: href.to_string(),
            source: None,
            node_ids: Vec::new(),
            recoverable: true,
            detail: None,
        });
        return Ok(resource);
    }
    Ok(resource)
}

struct Converter<'a> {
    href: PublicationHref,
    resources: &'a [ResourceLink],
    unique_ids: HashSet<String>,
    claimed_src_ids: HashSet<String>,
    assigned_ids: HashSet<String>,
    id_counts: BTreeMap<String, u32>,
    warnings: Vec<super::NormalizationWarning>,
    segments: Vec<SourceMapSegment>,
}

#[derive(Clone)]
struct Inherited {
    language: Option<String>,
    direction: Option<TextDirection>,
    nearest_unique_id: Option<String>,
}

impl<'a> Converter<'a> {
    fn new(href: &PublicationHref, resources: &'a [ResourceLink]) -> Self {
        Self {
            href: href.clone(),
            resources,
            unique_ids: HashSet::new(),
            claimed_src_ids: HashSet::new(),
            assigned_ids: HashSet::new(),
            id_counts: BTreeMap::new(),
            warnings: Vec::new(),
            segments: Vec::new(),
        }
    }

    fn collect_ids(&mut self, element: &ParsedElement) {
        if let Some(id) = &element.id {
            *self.id_counts.entry(id.clone()).or_insert(0) += 1;
        }
        for child in &element.children {
            if let ParsedNode::Element(element) = child {
                self.collect_ids(element);
            }
        }
        self.unique_ids = self
            .id_counts
            .iter()
            .filter_map(|(id, count)| (*count == 1).then_some(id.clone()))
            .collect();
    }

    fn convert_document(&mut self, html: &ParsedElement) -> Result<DocumentNode, HaddonError> {
        let inherited = Inherited {
            language: html.lang.clone(),
            direction: html.direction(),
            nearest_unique_id: unique_id(html, &self.unique_ids),
        };
        let body = find_child(html, "body").unwrap_or(html);
        let body_inherited = self.next_inherited(body, &inherited);
        let children = if body.local_name == "body" {
            self.convert_flow(&body.children, body, &body_inherited)?
        } else {
            self.convert_flow(&html.children, html, &inherited)?
        };
        let mut base = self.node_base(html, "document", &inherited, None)?;
        base.language = inherited.language.clone();
        base.direction = inherited.direction;
        let (roles, source_roles) = semantic_roles(body);
        if base.roles.is_empty() {
            base.roles = roles;
        }
        if base.source_roles.is_empty() {
            base.source_roles = source_roles;
        }
        Ok(DocumentNode {
            kind: DocumentKind::Document,
            base,
            children,
        })
    }

    fn convert_flow(
        &mut self,
        nodes: &[ParsedNode],
        parent: &ParsedElement,
        inherited: &Inherited,
    ) -> Result<Vec<BlockNode>, HaddonError> {
        let mut blocks = Vec::new();
        let mut pending: Vec<&ParsedNode> = Vec::new();
        for node in nodes {
            match node {
                ParsedNode::Text { text, .. } if pending.is_empty() && is_whitespace_only(text) => {
                }
                ParsedNode::Element(element)
                    if is_omitted(element)
                        || element.is_hidden()
                        || element.local_name == "head" => {}
                ParsedNode::Element(element) if is_flow_block(element) => {
                    self.flush_anonymous(&mut pending, parent, inherited, &mut blocks)?;
                    blocks.push(self.convert_block(element, inherited)?);
                }
                _ => pending.push(node),
            }
        }
        self.flush_anonymous(&mut pending, parent, inherited, &mut blocks)?;
        Ok(blocks)
    }

    fn flush_anonymous(
        &mut self,
        pending: &mut Vec<&ParsedNode>,
        parent: &ParsedElement,
        inherited: &Inherited,
        blocks: &mut Vec<BlockNode>,
    ) -> Result<(), HaddonError> {
        if pending.is_empty() {
            return Ok(());
        }
        let has_content = pending.iter().any(|node| match node {
            ParsedNode::Text { text, .. } => !is_whitespace_only(text),
            ParsedNode::Element(_) => true,
        });
        if !has_content {
            pending.clear();
            return Ok(());
        }
        let owned: Vec<ParsedNode> = pending.iter().map(|node| (*node).clone()).collect();
        pending.clear();
        let inlines = self.convert_inlines(&owned, parent, inherited)?;
        if inlines.is_empty() {
            return Ok(());
        }
        let mut block = self.make_text_block(
            parent,
            inherited,
            TextBlockRole::Paragraph,
            inlines,
            Some("anonymous-paragraph"),
        )?;
        self.finalize_text_block(&mut block);
        blocks.push(BlockNode::TextBlock(block));
        Ok(())
    }

    fn convert_block(
        &mut self,
        element: &ParsedElement,
        inherited: &Inherited,
    ) -> Result<BlockNode, HaddonError> {
        let next = self.next_inherited(element, inherited);
        if is_pagebreak(element) {
            return self.convert_page_break(element, &next);
        }
        match element.local_name.as_str() {
            "section" | "article" | "nav" => {
                let mut base = self.node_base(element, "section", inherited, None)?;
                apply_block_semantics(&mut base, element, inherited);
                let children = self.convert_flow(&element.children, element, &next)?;
                Ok(BlockNode::Section { base, children })
            }
            "aside" => self.convert_aside(element, inherited, aside_disposition(element)),
            name if name == "p" && is_note_body(element) => {
                self.convert_aside(element, inherited, aside_disposition(element))
            }
            "p" => self.convert_text_block(element, inherited, TextBlockRole::Paragraph),
            "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => {
                let level = element.local_name[1..].parse::<u32>().unwrap_or(1);
                self.convert_text_block(element, inherited, TextBlockRole::Heading { level })
            }
            "figcaption" => self.convert_text_block(element, inherited, TextBlockRole::Caption),
            "figure" => self.convert_figure(element, inherited),
            "blockquote" => self.convert_blockquote(element, inherited),
            "ul" | "ol" => self.convert_list(element, inherited),
            "li" => self.convert_list_item(element, inherited),
            "img" => self.convert_media_block(element, inherited),
            "hr" => {
                let mut base = self.node_base(element, "thematicBreak", inherited, None)?;
                apply_block_semantics(&mut base, element, inherited);
                Ok(BlockNode::ThematicBreak { base })
            }
            _ => {
                let mut base = self.node_base(element, "opaqueBlock", inherited, None)?;
                apply_block_semantics(&mut base, element, inherited);
                let children = self.convert_flow(&element.children, element, &next)?;
                Ok(BlockNode::OpaqueBlock { base, children })
            }
        }
    }

    fn convert_aside(
        &mut self,
        element: &ParsedElement,
        inherited: &Inherited,
        disposition: AsideDisposition,
    ) -> Result<BlockNode, HaddonError> {
        let next = self.next_inherited(element, inherited);
        let mut base = self.node_base(element, "aside", inherited, None)?;
        apply_block_semantics(&mut base, element, inherited);
        if !base.roles.iter().any(|role| {
            matches!(
                role,
                SemanticRole::Footnote | SemanticRole::Endnote | SemanticRole::Sidebar
            )
        }) {
            match disposition {
                AsideDisposition::Footnote => base.roles.push(SemanticRole::Footnote),
                AsideDisposition::Endnote => base.roles.push(SemanticRole::Endnote),
                AsideDisposition::Sidebar => base.roles.push(SemanticRole::Sidebar),
                _ => {}
            }
        }
        let children = if looks_like_inline_container(element) {
            let inlines = self.convert_inlines(&element.children, element, &next)?;
            if inlines.is_empty() {
                Vec::new()
            } else {
                let mut paragraph = self.make_text_block(
                    element,
                    &next,
                    TextBlockRole::Paragraph,
                    inlines,
                    Some("anonymous-paragraph"),
                )?;
                self.finalize_text_block(&mut paragraph);
                vec![BlockNode::TextBlock(paragraph)]
            }
        } else {
            self.convert_flow(&element.children, element, &next)?
        };
        Ok(BlockNode::Aside(AsideBlock {
            base,
            disposition,
            children,
        }))
    }

    fn convert_blockquote(
        &mut self,
        element: &ParsedElement,
        inherited: &Inherited,
    ) -> Result<BlockNode, HaddonError> {
        if looks_like_inline_container(element) {
            return self.convert_text_block(element, inherited, TextBlockRole::Quote { cite: None });
        }
        let next = self.next_inherited(element, inherited);
        let mut base = self.node_base(element, "section", inherited, None)?;
        apply_block_semantics(&mut base, element, inherited);
        let children = self.convert_flow(&element.children, element, &next)?;
        Ok(BlockNode::Section { base, children })
    }

    fn convert_list(
        &mut self,
        element: &ParsedElement,
        inherited: &Inherited,
    ) -> Result<BlockNode, HaddonError> {
        let next = self.next_inherited(element, inherited);
        let mut base = self.node_base(element, "list", inherited, None)?;
        apply_block_semantics(&mut base, element, inherited);
        let ordered = element.local_name == "ol";
        let mut children = Vec::new();
        for child in &element.children {
            match child {
                ParsedNode::Text { text, .. } if is_whitespace_only(text) => {}
                ParsedNode::Element(item) if item.local_name == "li" => {
                    children.push(self.convert_list_item(item, &next)?);
                }
                ParsedNode::Element(item)
                    if is_omitted(item) || item.is_hidden() || item.local_name == "head" => {}
                ParsedNode::Element(item) => {
                    children.push(self.convert_block(item, &next)?);
                }
                ParsedNode::Text { .. } => {}
            }
        }
        Ok(BlockNode::List {
            base,
            ordered,
            children,
        })
    }

    fn convert_list_item(
        &mut self,
        element: &ParsedElement,
        inherited: &Inherited,
    ) -> Result<BlockNode, HaddonError> {
        let next = self.next_inherited(element, inherited);
        let mut base = self.node_base(element, "listItem", inherited, None)?;
        apply_block_semantics(&mut base, element, inherited);
        let children = self.convert_flow(&element.children, element, &next)?;
        Ok(BlockNode::ListItem { base, children })
    }

    fn convert_figure(
        &mut self,
        element: &ParsedElement,
        inherited: &Inherited,
    ) -> Result<BlockNode, HaddonError> {
        let next = self.next_inherited(element, inherited);
        let mut base = self.node_base(element, "figure", inherited, None)?;
        apply_block_semantics(&mut base, element, inherited);
        let mut content = Vec::new();
        let mut caption = Vec::new();
        for child in &element.children {
            match child {
                ParsedNode::Text { text, .. } if is_whitespace_only(text) => {}
                ParsedNode::Element(child) if child.local_name == "figcaption" => {
                    caption.push(self.convert_block(child, &next)?);
                }
                ParsedNode::Element(child) if child.local_name == "img" => {
                    content.push(self.convert_media_block(child, &next)?);
                }
                ParsedNode::Element(child) if is_omitted(child) || child.is_hidden() => {}
                ParsedNode::Element(child) => {
                    content.push(self.convert_block(child, &next)?);
                }
                ParsedNode::Text { .. } => {}
            }
        }
        Ok(BlockNode::Figure(FigureBlock {
            base,
            content,
            caption,
        }))
    }

    fn convert_page_break(
        &mut self,
        element: &ParsedElement,
        inherited: &Inherited,
    ) -> Result<BlockNode, HaddonError> {
        let mut base = self.node_base(element, "pageBreak", inherited, None)?;
        apply_block_semantics(&mut base, element, inherited);
        if !base.roles.contains(&SemanticRole::Pagebreak) {
            base.roles.push(SemanticRole::Pagebreak);
        }
        let label = element
            .aria_label
            .clone()
            .or_else(|| element.title.clone())
            .or_else(|| {
                let text = collect_raw_text(element);
                let trimmed = text.trim();
                (!trimmed.is_empty()).then(|| trimmed.to_string())
            });
        let source = match &base.source {
            NodeSourceEvidence::Source {
                primary: SourceNodeRef::Element(element),
                ..
            } => element.clone(),
            _ => self.element_ref(element),
        };
        self.segments.push(SourceMapSegment::Object {
            node_id: base.id.clone(),
            normalized: None,
            source,
            projection: ObjectProjection::None,
        });
        Ok(BlockNode::PageBreak { base, label })
    }

    fn convert_media_block(
        &mut self,
        element: &ParsedElement,
        inherited: &Inherited,
    ) -> Result<BlockNode, HaddonError> {
        let node = self.convert_media(element, inherited, "mediaBlock")?;
        if let NodeSourceEvidence::Source {
            primary: SourceNodeRef::Element(source),
            ..
        } = &node.base.source
        {
            self.segments.push(SourceMapSegment::Object {
                node_id: node.base.id.clone(),
                normalized: None,
                source: source.clone(),
                projection: ObjectProjection::None,
            });
        }
        Ok(BlockNode::MediaBlock(node))
    }

    fn convert_media(
        &mut self,
        element: &ParsedElement,
        inherited: &Inherited,
        kind: &str,
    ) -> Result<MediaNode, HaddonError> {
        let mut base = self.node_base(element, kind, inherited, None)?;
        apply_block_semantics(&mut base, element, inherited);
        let href = element
            .src
            .as_deref()
            .map(|src| self.resolve_resource_href(src));
        let media_type = href.as_ref().and_then(|href| self.lookup_media_type(href));
        Ok(MediaNode {
            base,
            media_kind: MediaKind::Image,
            primary: href.map(|href| MediaSource { href, media_type }),
            alternatives: Vec::new(),
            alt: element.alt.clone(),
            title: element.title.clone(),
        })
    }

    fn convert_text_block(
        &mut self,
        element: &ParsedElement,
        inherited: &Inherited,
        role: TextBlockRole,
    ) -> Result<BlockNode, HaddonError> {
        let next = self.next_inherited(element, inherited);
        let inlines = self.convert_inlines(&element.children, element, &next)?;
        let mut block = self.make_text_block(element, inherited, role, inlines, None)?;
        self.finalize_text_block(&mut block);
        Ok(BlockNode::TextBlock(block))
    }

    fn make_text_block(
        &mut self,
        element: &ParsedElement,
        inherited: &Inherited,
        role: TextBlockRole,
        inlines: Vec<InlineNode>,
        generated: Option<&str>,
    ) -> Result<TextBlock, HaddonError> {
        let kind = "textBlock";
        let mut base = if let Some(reason) = generated {
            self.generated_base(element, kind, reason, inherited)?
        } else {
            self.node_base(element, kind, inherited, None)?
        };
        if generated.is_none() {
            apply_block_semantics(&mut base, element, inherited);
        }
        Ok(TextBlock {
            base,
            role,
            inlines,
            text: String::new(),
        })
    }

    fn convert_inlines(
        &mut self,
        nodes: &[ParsedNode],
        parent: &ParsedElement,
        inherited: &Inherited,
    ) -> Result<Vec<InlineNode>, HaddonError> {
        let mut inlines = Vec::new();
        for node in nodes {
            match node {
                ParsedNode::Text {
                    text,
                    text_node_index,
                } => {
                    inlines.push(self.convert_text_inline(
                        parent,
                        text,
                        *text_node_index,
                        inherited,
                    )?);
                }
                ParsedNode::Element(element)
                    if is_omitted(element) || element.is_hidden() || is_pagebreak(element) => {}
                ParsedNode::Element(element) => {
                    inlines.extend(self.convert_inline_element(element, inherited)?);
                }
            }
        }
        Ok(inlines)
    }

    fn convert_inline_element(
        &mut self,
        element: &ParsedElement,
        inherited: &Inherited,
    ) -> Result<Vec<InlineNode>, HaddonError> {
        let next = self.next_inherited(element, inherited);
        match element.local_name.as_str() {
            "em" | "i" => Ok(vec![InlineNode::Emphasis {
                base: self.inline_base(element, "emphasis", inherited)?,
                children: self.convert_inlines(&element.children, element, &next)?,
            }]),
            "strong" | "b" => Ok(vec![InlineNode::Strong {
                base: self.inline_base(element, "strong", inherited)?,
                children: self.convert_inlines(&element.children, element, &next)?,
            }]),
            "span" if keeps_span(element) => Ok(vec![InlineNode::Span {
                base: self.inline_base(element, "span", inherited)?,
                children: self.convert_inlines(&element.children, element, &next)?,
            }]),
            "span" => self.convert_inlines(&element.children, element, &next),
            "a" if is_noteref(element) => {
                let mut base = self.inline_base(element, "noteReference", inherited)?;
                apply_roles(&mut base, element);
                Ok(vec![InlineNode::NoteReference {
                    base,
                    target: self.link_target(element),
                    note_kind: note_kind(element),
                    children: self.convert_inlines(&element.children, element, &next)?,
                }])
            }
            "a" => {
                let mut base = self.inline_base(element, "link", inherited)?;
                apply_roles(&mut base, element);
                Ok(vec![InlineNode::Link {
                    base,
                    target: self.link_target(element),
                    children: self.convert_inlines(&element.children, element, &next)?,
                }])
            }
            "br" => Ok(vec![InlineNode::LineBreak {
                base: self.inline_base(element, "lineBreak", inherited)?,
            }]),
            "img" => Ok(vec![InlineNode::MediaInline(self.convert_media(
                element,
                inherited,
                "mediaInline",
            )?)]),
            name if is_flow_block_name(name) => {
                self.convert_inlines(&element.children, element, &next)
            }
            _ => Ok(vec![InlineNode::OpaqueInline {
                base: self.inline_base(element, "opaqueInline", inherited)?,
                children: self.convert_inlines(&element.children, element, &next)?,
            }]),
        }
    }

    fn convert_text_inline(
        &mut self,
        parent: &ParsedElement,
        text: &str,
        text_node_index: u32,
        inherited: &Inherited,
    ) -> Result<InlineNode, HaddonError> {
        let container = self.element_ref(parent);
        let path = structural_path(&parent.path, Some(text_node_index));
        let nearest = inherited.nearest_unique_id.clone().unwrap_or_default();
        let id = self.claim_id(n1_id(&[self.href.as_str(), &path, "text", "0", &nearest]))?;
        let node = SourceTextNodeRef {
            container,
            text_node_index,
        };
        Ok(InlineNode::Text {
            base: NodeBase::new(
                id,
                NodeSourceEvidence::Source {
                    primary: SourceNodeRef::Text(node),
                    contributors: Vec::new(),
                },
            ),
            text: text.to_string(),
        })
    }

    fn finalize_text_block(&mut self, block: &mut TextBlock) {
        let raws = collect_raw_text_inlines(&block.inlines);
        let collapsed = collapse_block_texts(&raws);
        apply_collapsed_text(&mut block.inlines, &collapsed);
        prune_empty_text_inlines(&mut block.inlines);
        block.text = project_inlines(&block.inlines);
        emit_text_segments(&mut self.segments, &block.base.id, &raws, &collapsed);
    }

    fn inline_base(
        &mut self,
        element: &ParsedElement,
        kind: &str,
        inherited: &Inherited,
    ) -> Result<NodeBase, HaddonError> {
        let mut base = self.node_base(element, kind, inherited, None)?;
        apply_inline_language(&mut base, element, inherited);
        Ok(base)
    }

    fn node_base(
        &mut self,
        element: &ParsedElement,
        kind: &str,
        inherited: &Inherited,
        generated: Option<&str>,
    ) -> Result<NodeBase, HaddonError> {
        if let Some(reason) = generated {
            return self.generated_base(element, kind, reason, inherited);
        }
        let path = structural_path(&element.path, None);
        let nearest = inherited.nearest_unique_id.clone().unwrap_or_default();
        let id = if let Some(source_id) = &element.id {
            if self.claimed_src_ids.insert(source_id.clone()) {
                if self.id_counts.get(source_id).copied().unwrap_or(0) > 1 {
                    self.warnings.push(super::NormalizationWarning {
                        code: "normalization.duplicate-source-id".to_string(),
                        severity: WarningLevel::Warning,
                        message: format!("duplicate source id {source_id}"),
                        href: self.href.to_string(),
                        source: Some(self.element_ref(element)),
                        node_ids: Vec::new(),
                        recoverable: true,
                        detail: None,
                    });
                }
                src_id(self.href.as_str(), source_id)
            } else {
                n1_id(&[self.href.as_str(), &path, kind, "0", &nearest])
            }
        } else {
            n1_id(&[self.href.as_str(), &path, kind, "0", &nearest])
        };
        let id = self.claim_id(id)?;
        Ok(NodeBase::new(
            id,
            NodeSourceEvidence::Source {
                primary: SourceNodeRef::Element(self.element_ref(element)),
                contributors: Vec::new(),
            },
        ))
    }

    fn generated_base(
        &mut self,
        element: &ParsedElement,
        kind: &str,
        reason: &str,
        inherited: &Inherited,
    ) -> Result<NodeBase, HaddonError> {
        let nearest = inherited.nearest_unique_id.clone().unwrap_or_default();
        let path = structural_path(&element.path, None);
        let generated_path = format!("generated:{reason}:{path}");
        let id = self.claim_id(n1_id(&[
            self.href.as_str(),
            &generated_path,
            kind,
            "0",
            &nearest,
        ]))?;
        Ok(NodeBase::new(
            id,
            NodeSourceEvidence::Generated {
                reason: reason.to_string(),
                before: None,
                after: None,
                contributors: vec![SourceNodeRef::Element(self.element_ref(element))],
            },
        ))
    }

    fn claim_id(&mut self, id: String) -> Result<String, HaddonError> {
        if !self.assigned_ids.insert(id.clone()) {
            return Err(HaddonError::FormatInvalid {
                stage: Stage::Normalize,
                message: format!("normalization produced a colliding node id {id}"),
            });
        }
        Ok(id)
    }

    fn element_ref(&self, element: &ParsedElement) -> SourceElementRef {
        let unique = element
            .id
            .as_ref()
            .is_some_and(|id| self.unique_ids.contains(id));
        SourceElementRef {
            href: self.href.to_string(),
            fragment: unique.then(|| element.id.clone()).flatten(),
            css_selector: unique
                .then(|| element.id.as_ref().map(|id| format!("#{id}")))
                .flatten(),
            dom_path: element.path.clone(),
        }
    }

    fn link_target(&self, element: &ParsedElement) -> LinkTarget {
        let raw = element.href.clone().unwrap_or_default();
        let title = element.title.clone().or_else(|| element.aria_label.clone());
        let rels = element
            .rel
            .as_deref()
            .map(|rel| rel.split_whitespace().map(str::to_string).collect())
            .unwrap_or_default();
        match PublicationHref::resolve(&self.href, &raw) {
            Ok((href, fragment)) => {
                let media_type = self.lookup_media_type(href.as_str());
                let href = match fragment {
                    Some(fragment) => format!("{}#{fragment}", href.as_str()),
                    None => href.to_string(),
                };
                LinkTarget {
                    href,
                    external: false,
                    media_type,
                    title,
                    rels,
                }
            }
            Err(_) => LinkTarget {
                href: raw,
                external: true,
                media_type: None,
                title,
                rels,
            },
        }
    }

    fn resolve_resource_href(&self, reference: &str) -> String {
        match PublicationHref::resolve(&self.href, reference) {
            Ok((href, fragment)) => match fragment {
                Some(fragment) => format!("{}#{fragment}", href.as_str()),
                None => href.to_string(),
            },
            Err(_) => reference.to_string(),
        }
    }

    fn lookup_media_type(&self, href: &str) -> Option<String> {
        let Ok(parsed) = PublicationHref::new(href) else {
            return None;
        };
        self.resources
            .iter()
            .find(|link| link.href == parsed)
            .map(|link| link.media_type.clone())
    }

    fn next_inherited(&self, element: &ParsedElement, inherited: &Inherited) -> Inherited {
        Inherited {
            language: element.lang.clone().or_else(|| inherited.language.clone()),
            direction: element.direction().or(inherited.direction),
            nearest_unique_id: unique_id(element, &self.unique_ids)
                .or_else(|| inherited.nearest_unique_id.clone()),
        }
    }
}

fn apply_block_semantics(base: &mut NodeBase, element: &ParsedElement, inherited: &Inherited) {
    apply_roles(base, element);
    apply_inline_language(base, element, inherited);
}

fn apply_roles(base: &mut NodeBase, element: &ParsedElement) {
    let (roles, source_roles) = semantic_roles(element);
    base.roles = roles;
    base.source_roles = source_roles;
}

fn apply_inline_language(base: &mut NodeBase, element: &ParsedElement, inherited: &Inherited) {
    if let Some(language) = &element.lang {
        if inherited.language.as_deref() != Some(language.as_str()) {
            base.language = Some(language.clone());
        } else {
            base.language = None;
        }
    } else {
        base.language = None;
    }
    if let Some(direction) = element.direction() {
        if inherited.direction != Some(direction) {
            base.direction = Some(direction);
        } else {
            base.direction = None;
        }
    } else {
        base.direction = None;
    }
}

fn unique_id(element: &ParsedElement, unique_ids: &HashSet<String>) -> Option<String> {
    element
        .id
        .as_ref()
        .filter(|id| unique_ids.contains(*id))
        .cloned()
}

fn semantic_roles(element: &ParsedElement) -> (Vec<SemanticRole>, Vec<String>) {
    let mut source_roles = Vec::new();
    let mut roles = Vec::new();
    let mut seen_source = BTreeSet::new();
    let mut seen_roles = BTreeSet::new();
    for token in element.epub_types.iter().chain(element.roles.iter()) {
        if seen_source.insert(token.clone()) {
            source_roles.push(token.clone());
        }
        if let Some(role) = parse_semantic_role(token) {
            if seen_roles.insert(role.clone()) {
                roles.push(role);
            }
        }
    }
    (roles, source_roles)
}

fn is_pagebreak(element: &ParsedElement) -> bool {
    element.epub_types.iter().any(|token| token == "pagebreak")
        || element.roles.iter().any(|token| token == "doc-pagebreak")
}

fn is_noteref(element: &ParsedElement) -> bool {
    element
        .epub_types
        .iter()
        .any(|token| matches!(token.as_str(), "noteref" | "biblioref" | "glossref"))
        || element.roles.iter().any(|token| {
            matches!(
                token.as_str(),
                "doc-noteref" | "doc-biblioref" | "doc-glossref"
            )
        })
}

fn is_note_body(element: &ParsedElement) -> bool {
    element
        .epub_types
        .iter()
        .any(|token| matches!(token.as_str(), "footnote" | "endnote" | "note"))
        || element.roles.iter().any(|token| {
            matches!(
                token.as_str(),
                "doc-footnote" | "doc-endnote" | "doc-endnotes"
            )
        })
}

fn aside_disposition(element: &ParsedElement) -> AsideDisposition {
    if element.epub_types.iter().any(|token| token == "endnote")
        || element.roles.iter().any(|token| token == "doc-endnote")
    {
        AsideDisposition::Endnote
    } else if element.epub_types.iter().any(|token| token == "footnote")
        || element.roles.iter().any(|token| token == "doc-footnote")
    {
        AsideDisposition::Footnote
    } else if element.epub_types.iter().any(|token| token == "sidebar") {
        AsideDisposition::Sidebar
    } else if element.epub_types.iter().any(|token| token == "note") {
        AsideDisposition::Note
    } else {
        AsideDisposition::Other
    }
}

fn note_kind(element: &ParsedElement) -> NoteKind {
    if element.epub_types.iter().any(|token| token == "biblioref")
        || element.roles.iter().any(|token| token == "doc-biblioref")
    {
        NoteKind::Bibliography
    } else if element.epub_types.iter().any(|token| token == "glossref")
        || element.roles.iter().any(|token| token == "doc-glossref")
    {
        NoteKind::Glossary
    } else {
        NoteKind::Footnote
    }
}

fn keeps_span(element: &ParsedElement) -> bool {
    element.lang.is_some()
        || element.dir.is_some()
        || element.id.is_some()
        || !element.epub_types.is_empty()
        || !element.roles.is_empty()
}

fn is_omitted(element: &ParsedElement) -> bool {
    matches!(
        element.local_name.as_str(),
        "head" | "script" | "style" | "template" | "noscript" | "meta" | "link" | "title"
    )
}

fn is_flow_block(element: &ParsedElement) -> bool {
    is_pagebreak(element) || is_flow_block_name(&element.local_name)
}

fn is_flow_block_name(name: &str) -> bool {
    matches!(
        name,
        "section"
            | "article"
            | "nav"
            | "aside"
            | "p"
            | "h1"
            | "h2"
            | "h3"
            | "h4"
            | "h5"
            | "h6"
            | "figure"
            | "figcaption"
            | "div"
            | "blockquote"
            | "ul"
            | "ol"
            | "li"
            | "table"
            | "hr"
            | "img"
    )
}

fn looks_like_inline_container(element: &ParsedElement) -> bool {
    element.children.iter().all(|child| match child {
        ParsedNode::Text { .. } => true,
        ParsedNode::Element(child) => !is_flow_block(child),
    })
}

fn find_child<'a>(element: &'a ParsedElement, name: &str) -> Option<&'a ParsedElement> {
    element.children.iter().find_map(|child| match child {
        ParsedNode::Element(child) if child.local_name == name => Some(child),
        _ => None,
    })
}

fn is_whitespace_only(text: &str) -> bool {
    text.chars().all(is_collapsible_ws)
}

fn is_collapsible_ws(ch: char) -> bool {
    matches!(ch, '\t' | '\n' | '\r' | '\u{000C}' | ' ')
}

fn collect_raw_text(element: &ParsedElement) -> String {
    let mut out = String::new();
    for child in &element.children {
        match child {
            ParsedNode::Text { text, .. } => out.push_str(text),
            ParsedNode::Element(child) => out.push_str(&collect_raw_text(child)),
        }
    }
    out
}

struct RawText {
    text: String,
    node: SourceTextNodeRef,
}

struct CollapsedPiece {
    text: String,
    identity: bool,
}

fn collect_raw_text_inlines(inlines: &[InlineNode]) -> Vec<RawText> {
    let mut out = Vec::new();
    fn walk(inlines: &[InlineNode], out: &mut Vec<RawText>) {
        for inline in inlines {
            match inline {
                InlineNode::Text { base, text } => {
                    if let NodeSourceEvidence::Source {
                        primary: SourceNodeRef::Text(node),
                        ..
                    } = &base.source
                    {
                        out.push(RawText {
                            text: text.clone(),
                            node: node.clone(),
                        });
                    }
                }
                other => walk(other.children(), out),
            }
        }
    }
    walk(inlines, &mut out);
    out
}

fn collapse_block_texts(raws: &[RawText]) -> Vec<CollapsedPiece> {
    #[derive(Clone, Copy)]
    struct Item {
        ch: char,
        raw: usize,
    }
    let mut items = Vec::new();
    for (raw_index, raw) in raws.iter().enumerate() {
        for ch in raw.text.chars() {
            items.push(Item { ch, raw: raw_index });
        }
    }
    let mut pieces: Vec<CollapsedPiece> = raws
        .iter()
        .map(|_| CollapsedPiece {
            text: String::new(),
            identity: true,
        })
        .collect();

    let mut at_start = true;
    let mut index = 0;
    while index < items.len() {
        if is_collapsible_ws(items[index].ch) {
            let run_start = index;
            while index < items.len() && is_collapsible_ws(items[index].ch) {
                index += 1;
            }
            let at_end = index == items.len();
            if at_start || at_end {
                for item in &items[run_start..index] {
                    pieces[item.raw].identity = false;
                }
                continue;
            }
            let run = &items[run_start..index];
            let single_space = run.len() == 1 && run[0].ch == ' ';
            let first = run[0];
            pieces[first.raw].text.push(' ');
            if !single_space {
                pieces[first.raw].identity = false;
            }
        } else {
            at_start = false;
            let item = items[index];
            pieces[item.raw].text.push(item.ch);
            index += 1;
        }
    }
    pieces
}

fn apply_collapsed_text(inlines: &mut [InlineNode], collapsed: &[CollapsedPiece]) {
    let mut index = 0;
    fn walk(inlines: &mut [InlineNode], collapsed: &[CollapsedPiece], index: &mut usize) {
        for inline in inlines {
            match inline {
                InlineNode::Text { text, .. } => {
                    if let Some(piece) = collapsed.get(*index) {
                        *text = piece.text.clone();
                    }
                    *index += 1;
                }
                other => {
                    if let Some(children) = other.children_mut() {
                        walk(children, collapsed, index);
                    }
                }
            }
        }
    }
    walk(inlines, collapsed, &mut index);
}

fn prune_empty_text_inlines(inlines: &mut Vec<InlineNode>) {
    inlines.retain_mut(|inline| {
        if let Some(children) = inline.children_mut() {
            prune_empty_text_inlines(children);
        }
        match inline {
            InlineNode::Text { text, .. } => !text.is_empty(),
            _ => true,
        }
    });
}

fn emit_text_segments(
    segments: &mut Vec<SourceMapSegment>,
    block_id: &str,
    raws: &[RawText],
    collapsed: &[CollapsedPiece],
) {
    let mut offset = 0u64;
    for (raw, piece) in raws.iter().zip(collapsed) {
        if piece.text.is_empty() {
            if !raw.text.is_empty() {
                segments.push(SourceMapSegment::Omitted {
                    normalized_at: NormalizedTextPoint {
                        block_id: block_id.to_string(),
                        offset: TextOffset::utf16(offset),
                    },
                    source: OmittedSource::Span(SourceTextSpan {
                        parts: vec![dom_range(&raw.node, 0, utf16_len(&raw.text))],
                    }),
                    reason: "html-whitespace".to_string(),
                });
            }
            continue;
        }
        let length = utf16_len(&piece.text);
        let source_end = if piece.identity {
            utf16_len(&raw.text)
        } else {
            utf16_len(&raw.text)
        };
        let transform = if piece.identity && piece.text == raw.text {
            TextTransform::Identity
        } else {
            TextTransform::WhitespaceCollapse
        };
        segments.push(SourceMapSegment::Text {
            normalized: NormalizedTextRange::new(block_id, offset, offset + length),
            source: SourceTextSpan {
                parts: vec![dom_range(&raw.node, 0, source_end)],
            },
            transform,
            alignment: None,
        });
        offset += length;
    }
}

fn dom_range(node: &SourceTextNodeRef, start: u64, end: u64) -> SourceDomRange {
    SourceDomRange {
        start: SourceDomPoint {
            node: node.clone(),
            offset: TextOffset::utf16(start),
        },
        end: SourceDomPoint {
            node: node.clone(),
            offset: TextOffset::utf16(end),
        },
    }
}

#[derive(Clone)]
enum ParsedNode {
    Element(ParsedElement),
    Text { text: String, text_node_index: u32 },
}

#[derive(Clone)]
struct ParsedElement {
    local_name: String,
    path: Vec<SourcePathStep>,
    id: Option<String>,
    lang: Option<String>,
    dir: Option<String>,
    epub_types: Vec<String>,
    roles: Vec<String>,
    href: Option<String>,
    src: Option<String>,
    alt: Option<String>,
    title: Option<String>,
    aria_label: Option<String>,
    rel: Option<String>,
    hidden: bool,
    aria_hidden: bool,
    children: Vec<ParsedNode>,
}

impl ParsedElement {
    fn direction(&self) -> Option<TextDirection> {
        match self.dir.as_deref() {
            Some("ltr") => Some(TextDirection::Ltr),
            Some("rtl") => Some(TextDirection::Rtl),
            Some("auto") => Some(TextDirection::Auto),
            _ => None,
        }
    }

    fn is_hidden(&self) -> bool {
        self.hidden || self.aria_hidden
    }
}

struct Frame {
    element: ParsedElement,
    sibling_counts: BTreeMap<String, u32>,
    default_ns: String,
}

fn parse_source_tree(xml: &str) -> Result<ParsedElement, HaddonError> {
    let mut reader = Reader::from_str(xml);
    let config = reader.config_mut();
    config.trim_text(false);
    config.expand_empty_elements = true;

    let mut stack: Vec<Frame> = Vec::new();
    let mut root = None;
    loop {
        match reader.read_event() {
            Ok(Event::Start(event)) => {
                let parent_ns = stack
                    .last()
                    .map(|frame| frame.default_ns.clone())
                    .unwrap_or_default();
                let (element, declared_ns) = start_element(&event, stack.last_mut(), &parent_ns)?;
                let default_ns = declared_ns.unwrap_or(parent_ns);
                stack.push(Frame {
                    element,
                    sibling_counts: BTreeMap::new(),
                    default_ns,
                });
            }
            Ok(Event::End(_)) => {
                let Some(finished) = stack.pop() else {
                    continue;
                };
                let mut element = finished.element;
                if let Some(parent) = stack.last_mut() {
                    parent.element.children.push(ParsedNode::Element(element));
                } else {
                    assign_text_indices(&mut element);
                    root = Some(element);
                }
            }
            Ok(Event::Text(event)) => {
                let text = event
                    .unescape()
                    .map_err(|error| HaddonError::FormatInvalid {
                        stage: Stage::Normalize,
                        message: format!("xhtml entity error: {error}"),
                    })?;
                push_text(&mut stack, text.into_owned());
            }
            Ok(Event::CData(event)) => {
                push_text(
                    &mut stack,
                    String::from_utf8_lossy(event.as_ref()).into_owned(),
                );
            }
            Ok(Event::Eof) => break,
            Err(error) => {
                return Err(HaddonError::FormatInvalid {
                    stage: Stage::Normalize,
                    message: format!("xhtml parse error: {error}"),
                });
            }
            _ => {}
        }
    }
    root.ok_or_else(|| HaddonError::FormatInvalid {
        stage: Stage::Normalize,
        message: "xhtml document has no root element".to_string(),
    })
}

fn start_element(
    event: &BytesStart<'_>,
    parent: Option<&mut Frame>,
    inherited_ns: &str,
) -> Result<(ParsedElement, Option<String>), HaddonError> {
    let local_name = String::from_utf8_lossy(event.local_name().as_ref()).into_owned();
    let attrs = parse_attrs(event);
    let namespace = attrs
        .xmlns
        .clone()
        .unwrap_or_else(|| inherited_ns.to_string());
    let namespace = if namespace.is_empty() {
        XHTML_NS.to_string()
    } else {
        namespace
    };
    let (index, mut path) = if let Some(parent) = parent {
        let count = parent.sibling_counts.entry(local_name.clone()).or_insert(0);
        *count += 1;
        (*count, parent.element.path.clone())
    } else {
        (1, Vec::new())
    };
    path.push(SourcePathStep {
        namespace: Some(namespace.clone()),
        local_name: local_name.clone(),
        same_name_index: index,
    });
    Ok((
        ParsedElement {
            local_name,
            path,
            id: attrs.id,
            lang: attrs.xml_lang.or(attrs.lang),
            dir: attrs.dir,
            epub_types: attrs.epub_types,
            roles: attrs.roles,
            href: attrs.href,
            src: attrs.src,
            alt: attrs.alt,
            title: attrs.title,
            aria_label: attrs.aria_label,
            rel: attrs.rel,
            hidden: attrs.hidden,
            aria_hidden: attrs.aria_hidden,
            children: Vec::new(),
        },
        attrs.xmlns,
    ))
}

#[derive(Default)]
struct Attrs {
    id: Option<String>,
    lang: Option<String>,
    xml_lang: Option<String>,
    dir: Option<String>,
    epub_types: Vec<String>,
    roles: Vec<String>,
    href: Option<String>,
    src: Option<String>,
    alt: Option<String>,
    title: Option<String>,
    aria_label: Option<String>,
    rel: Option<String>,
    hidden: bool,
    aria_hidden: bool,
    xmlns: Option<String>,
}

fn parse_attrs(event: &BytesStart<'_>) -> Attrs {
    let mut attrs = Attrs::default();
    for attr in event.attributes().flatten() {
        let key = String::from_utf8_lossy(attr.key.as_ref());
        let local_name = attr.key.local_name();
        let local = String::from_utf8_lossy(local_name.as_ref());
        let value = attr
            .unescape_value()
            .map(|value| value.into_owned())
            .unwrap_or_else(|_| String::from_utf8_lossy(attr.value.as_ref()).into_owned());
        match local.as_ref() {
            "id" => attrs.id = Some(value),
            "lang" if key == "xml:lang" || key.ends_with(":lang") => attrs.xml_lang = Some(value),
            "lang" => attrs.lang = Some(value),
            "dir" => attrs.dir = Some(value),
            "type" if key.contains("type") && (key.contains(':') || key == "type") => {
                if key.ends_with(":type") || key == "epub:type" {
                    attrs.epub_types = value.split_whitespace().map(str::to_string).collect();
                }
            }
            "role" => attrs.roles = value.split_whitespace().map(str::to_string).collect(),
            "href" => attrs.href = Some(value),
            "src" => attrs.src = Some(value),
            "alt" => attrs.alt = Some(value),
            "title" => attrs.title = Some(value),
            "rel" => attrs.rel = Some(value),
            "label" if key.contains("aria-label") => attrs.aria_label = Some(value),
            "hidden" => attrs.hidden = true,
            "xmlns" if key == "xmlns" => attrs.xmlns = Some(value),
            other if other == "aria-label" || key == "aria-label" => attrs.aria_label = Some(value),
            other if other == "aria-hidden" || key == "aria-hidden" => {
                attrs.aria_hidden = value == "true";
            }
            _ => {}
        }
    }
    attrs
}

fn push_text(stack: &mut [Frame], text: String) {
    if text.is_empty() {
        return;
    }
    let Some(frame) = stack.last_mut() else {
        return;
    };
    if let Some(ParsedNode::Text { text: existing, .. }) = frame.element.children.last_mut() {
        existing.push_str(&text);
        return;
    }
    frame.element.children.push(ParsedNode::Text {
        text,
        text_node_index: 0,
    });
}

fn assign_text_indices(element: &mut ParsedElement) {
    fn number_all(element: &mut ParsedElement) {
        let mut index = 0u32;
        number_descendants(element, &mut index);
        for child in &mut element.children {
            if let ParsedNode::Element(child) = child {
                number_all(child);
            }
        }
    }
    fn number_descendants(element: &mut ParsedElement, index: &mut u32) {
        for child in &mut element.children {
            match child {
                ParsedNode::Text {
                    text_node_index, ..
                } => {
                    *index += 1;
                    *text_node_index = *index;
                }
                ParsedNode::Element(child) => number_descendants(child, index),
            }
        }
    }
    number_all(element);
}
