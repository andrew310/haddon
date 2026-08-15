//! Semantic HTML rendition of a normalized resource (HADDON-031).

use super::normalize::{
    AsideBlock, BlockNode, FigureBlock, InlineNode, MediaNode, NormalizedResource, TextBlock,
    TextBlockRole,
};

/// Render one normalized resource as a semantic HTML fragment.
///
/// Text is escaped. Node ids and source hrefs are preserved as data attributes
/// so a host can map a DOM selection back to a locator.
pub fn render_normalized_html(resource: &NormalizedResource) -> String {
    let mut out = String::new();
    out.push_str("<article class=\"haddon-resource\" data-haddon-href=\"");
    push_escaped(&mut out, &resource.href);
    out.push_str("\">");
    for child in &resource.root.children {
        render_block(&mut out, child);
    }
    out.push_str("</article>");
    out
}

fn render_block(out: &mut String, block: &BlockNode) {
    match block {
        BlockNode::Section { base, children } => {
            open_tag(out, "section", &base.id, source_fragment_id(&base.source));
            for child in children {
                render_block(out, child);
            }
            out.push_str("</section>");
        }
        BlockNode::TextBlock(block) => render_text_block(out, block),
        BlockNode::Figure(figure) => render_figure(out, figure),
        BlockNode::Aside(aside) => render_aside(out, aside),
        BlockNode::PageBreak { base, label } => {
            out.push_str("<div");
            write_id_attrs(out, &base.id, source_fragment_id(&base.source));
            out.push_str(" class=\"haddon-pagebreak\" role=\"doc-pagebreak\"");
            if let Some(label) = label {
                out.push_str(" aria-label=\"");
                push_escaped(out, label);
                out.push('"');
            }
            out.push_str("></div>");
        }
        BlockNode::ThematicBreak { base } => {
            out.push_str("<hr");
            write_id_attrs(out, &base.id, source_fragment_id(&base.source));
            out.push_str(" />");
        }
        BlockNode::List {
            base,
            ordered,
            children,
        } => {
            let tag = if *ordered { "ol" } else { "ul" };
            open_tag(out, tag, &base.id, source_fragment_id(&base.source));
            for child in children {
                render_block(out, child);
            }
            out.push_str("</");
            out.push_str(tag);
            out.push('>');
        }
        BlockNode::ListItem { base, children } => {
            open_tag(out, "li", &base.id, source_fragment_id(&base.source));
            for child in children {
                render_block(out, child);
            }
            out.push_str("</li>");
        }
        BlockNode::MediaBlock(media) => render_media(out, media, true),
        BlockNode::OpaqueBlock { base, children }
        | BlockNode::UnsupportedBlock {
            base,
            fallback: children,
            ..
        } => {
            open_tag(out, "div", &base.id, source_fragment_id(&base.source));
            for child in children {
                render_block(out, child);
            }
            out.push_str("</div>");
        }
        BlockNode::Table { base, children } => {
            open_tag(out, "div", &base.id, source_fragment_id(&base.source));
            for child in children {
                render_block(out, child);
            }
            out.push_str("</div>");
        }
    }
}

fn render_text_block(out: &mut String, block: &TextBlock) {
    let (tag, role_attr) = match &block.role {
        TextBlockRole::Heading { level } => {
            let level = (*level).clamp(1, 6);
            (
                match level {
                    1 => "h1",
                    2 => "h2",
                    3 => "h3",
                    4 => "h4",
                    5 => "h5",
                    _ => "h6",
                },
                None,
            )
        }
        TextBlockRole::Quote { .. } => ("blockquote", None),
        TextBlockRole::Preformatted | TextBlockRole::Code { .. } => ("pre", None),
        TextBlockRole::Caption => ("p", Some("caption")),
        TextBlockRole::Term => ("p", Some("term")),
        TextBlockRole::Definition => ("p", Some("definition")),
        TextBlockRole::Paragraph => ("p", None),
    };
    out.push('<');
    out.push_str(tag);
    write_id_attrs(out, &block.base.id, source_fragment_id(&block.base.source));
    if let Some(role) = role_attr {
        out.push_str(" data-haddon-role=\"");
        out.push_str(role);
        out.push('"');
    }
    out.push('>');
    for inline in &block.inlines {
        render_inline(out, inline);
    }
    out.push_str("</");
    out.push_str(tag);
    out.push('>');
}

fn render_figure(out: &mut String, figure: &FigureBlock) {
    open_tag(
        out,
        "figure",
        &figure.base.id,
        source_fragment_id(&figure.base.source),
    );
    for child in &figure.content {
        render_block(out, child);
    }
    if !figure.caption.is_empty() {
        out.push_str("<figcaption>");
        for child in &figure.caption {
            render_block(out, child);
        }
        out.push_str("</figcaption>");
    }
    out.push_str("</figure>");
}

fn render_aside(out: &mut String, aside: &AsideBlock) {
    open_tag(
        out,
        "aside",
        &aside.base.id,
        source_fragment_id(&aside.base.source),
    );
    for child in &aside.children {
        render_block(out, child);
    }
    out.push_str("</aside>");
}

fn render_inline(out: &mut String, inline: &InlineNode) {
    match inline {
        InlineNode::Text { text, .. } => push_escaped(out, text),
        InlineNode::Emphasis { base, children } => {
            wrap_inlines(out, "em", &base.id, children);
        }
        InlineNode::Strong { base, children } => {
            wrap_inlines(out, "strong", &base.id, children);
        }
        InlineNode::Span { base, children } => {
            out.push_str("<span");
            write_id_attrs(out, &base.id, None);
            if let Some(language) = &base.language {
                out.push_str(" lang=\"");
                push_escaped(out, language);
                out.push('"');
            }
            out.push('>');
            for child in children {
                render_inline(out, child);
            }
            out.push_str("</span>");
        }
        InlineNode::Link {
            base,
            target,
            children,
        } => {
            out.push_str("<a");
            write_id_attrs(out, &base.id, source_fragment_id(&base.source));
            out.push_str(" href=\"");
            push_escaped(out, &target.href);
            out.push('"');
            if target.external {
                out.push_str(" rel=\"external\"");
            }
            out.push('>');
            for child in children {
                render_inline(out, child);
            }
            out.push_str("</a>");
        }
        InlineNode::NoteReference {
            base,
            target,
            children,
            ..
        } => {
            out.push_str("<a");
            write_id_attrs(out, &base.id, source_fragment_id(&base.source));
            out.push_str(" class=\"haddon-noteref\" href=\"");
            push_escaped(out, &target.href);
            out.push_str("\" role=\"doc-noteref\">");
            for child in children {
                render_inline(out, child);
            }
            out.push_str("</a>");
        }
        InlineNode::LineBreak { .. } => out.push_str("<br />"),
        InlineNode::MediaInline(media) => render_media(out, media, false),
        InlineNode::OpaqueInline { base, children }
        | InlineNode::UnsupportedInline { base, children, .. } => {
            out.push_str("<span");
            write_id_attrs(out, &base.id, None);
            out.push('>');
            for child in children {
                render_inline(out, child);
            }
            out.push_str("</span>");
        }
    }
}

fn wrap_inlines(out: &mut String, tag: &str, id: &str, children: &[InlineNode]) {
    out.push('<');
    out.push_str(tag);
    write_id_attrs(out, id, None);
    out.push('>');
    for child in children {
        render_inline(out, child);
    }
    out.push_str("</");
    out.push_str(tag);
    out.push('>');
}

fn render_media(out: &mut String, media: &MediaNode, block: bool) {
    let tag = if block { "img" } else { "img" };
    out.push('<');
    out.push_str(tag);
    write_id_attrs(out, &media.base.id, source_fragment_id(&media.base.source));
    if let Some(source) = &media.primary {
        out.push_str(" data-haddon-src=\"");
        push_escaped(out, &source.href);
        out.push('"');
        out.push_str(" src=\"");
        push_escaped(out, &source.href);
        out.push('"');
    }
    if let Some(alt) = &media.alt {
        out.push_str(" alt=\"");
        push_escaped(out, alt);
        out.push('"');
    } else {
        out.push_str(" alt=\"\"");
    }
    out.push_str(" />");
}

fn open_tag(out: &mut String, tag: &str, id: &str, fragment: Option<&str>) {
    out.push('<');
    out.push_str(tag);
    write_id_attrs(out, id, fragment);
    out.push('>');
}

fn write_id_attrs(out: &mut String, id: &str, fragment: Option<&str>) {
    out.push_str(" data-haddon-id=\"");
    push_escaped(out, id);
    out.push('"');
    if let Some(fragment) = fragment {
        out.push_str(" id=\"");
        push_escaped(out, fragment);
        out.push('"');
    }
}

fn source_fragment_id(source: &super::normalize::NodeSourceEvidence) -> Option<&str> {
    match source {
        super::normalize::NodeSourceEvidence::Source { primary, .. } => match primary {
            super::normalize::SourceNodeRef::Element(element) => element.fragment.as_deref(),
            super::normalize::SourceNodeRef::Text(text) => text.container.fragment.as_deref(),
        },
        super::normalize::NodeSourceEvidence::Generated { .. } => None,
    }
}

fn push_escaped(out: &mut String, value: &str) {
    for ch in value.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            other => out.push(other),
        }
    }
}
