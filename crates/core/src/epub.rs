use crate::types::{Block, Chapter, EpubDocument, Span};
use quick_xml::events::Event;
use quick_xml::Reader;
use std::io::{Cursor, Read};
use thiserror::Error;
use zip::ZipArchive;

#[derive(Error, Debug)]
pub enum EpubError {
    #[error("zip error: {0}")]
    Zip(#[from] zip::result::ZipError),
    #[error("xml error: {0}")]
    Xml(#[from] quick_xml::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("missing file in epub: {0}")]
    MissingFile(String),
    #[error("parse error: {0}")]
    Parse(String),
}

/// Parse an EPUB file from bytes into an EpubDocument.
pub fn parse_epub(data: &[u8]) -> Result<EpubDocument, EpubError> {
    let cursor = Cursor::new(data);
    let mut archive = ZipArchive::new(cursor)?;

    // Step 1: Find OPF path from container.xml
    let opf_path = parse_container_xml(&mut archive)?;

    // Step 2: Parse OPF for metadata and spine
    let opf_dir = opf_path
        .rsplit_once('/')
        .map(|(dir, _)| format!("{}/", dir))
        .unwrap_or_default();
    let (metadata_title, metadata_author, spine_items) = parse_opf(&mut archive, &opf_path)?;

    // Step 3: Identify notes/endnotes files and extract their content
    let mut notes_filenames: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut all_notes: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    let mut note_backlinks: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    for href in &spine_items {
        let full_path = format!("{}{}", opf_dir, href);
        if let Ok(xhtml) = read_zip_text(&mut archive, &full_path) {
            if is_notes_section(&xhtml) {
                let filename = href.rsplit('/').next().unwrap_or(href);
                notes_filenames.insert(filename.to_string());
                let (notes, backlinks) = parse_notes_content(&xhtml);
                all_notes.extend(notes);
                note_backlinks.extend(backlinks);
            }
        }
    }

    // Step 4: Parse each spine item with notes file awareness
    let known_note_ids: std::collections::HashSet<String> = all_notes.keys().cloned().collect();
    let mut chapters = Vec::new();
    for href in &spine_items {
        let full_path = format!("{}{}", opf_dir, href);
        let xhtml = read_zip_text(&mut archive, &full_path)?;
        let filename = href.rsplit('/').next().unwrap_or(href);
        let is_notes_file = notes_filenames.contains(filename);
        let blocks = parse_xhtml(
            &xhtml,
            &notes_filenames,
            &known_note_ids,
            &note_backlinks,
            is_notes_file,
        );
        chapters.push(Chapter { blocks });
    }

    Ok(EpubDocument {
        title: metadata_title,
        author: metadata_author,
        chapters,
        notes: all_notes,
    })
}

/// Quick scan to check if an XHTML file is a notes/endnotes section.
fn is_notes_section(xhtml: &str) -> bool {
    let lower = xhtml.to_lowercase();
    if let Some(body_start) = lower.find("<body") {
        let chunk = &lower[body_start..std::cmp::min(body_start + 1000, lower.len())];
        if chunk.contains("doc-footnote")
            || chunk.contains("doc-endnote")
            || chunk.contains("epub:type=\"footnote")
            || chunk.contains("epub:type=\"endnote")
            || chunk.contains(">notes<")
            || chunk.contains(">endnotes<")
            || chunk.contains(">notes\n")
            || chunk.contains(">notes\r")
            || chunk.contains(">notes<br")
            || chunk.contains(">endnotes<br")
        {
            return true;
        }

        // Legacy heuristic: actual notes pages contain many links back to body
        // anchors like "#a93". A table of contents does not.
        let backlinkish = chunk.matches("#a").count();
        let note_ids = chunk.matches("id=\"d").count();
        backlinkish >= 3 && note_ids >= 3
    } else {
        false
    }
}

/// Parse a notes XHTML file and extract note content by anchor ID.
/// Each note is a <p> containing an <a id="dN"> followed by the note text.
fn parse_notes_content(
    xhtml: &str,
) -> (
    std::collections::HashMap<String, String>,
    std::collections::HashMap<String, String>,
) {
    let mut notes = std::collections::HashMap::new();
    let mut backlinks = std::collections::HashMap::new();
    let mut reader = Reader::from_str(xhtml);
    let mut in_body = false;
    let mut in_note_para = false;
    let mut current_note_id: Option<String> = None;
    let mut current_text = String::new();

    loop {
        match reader.read_event() {
            Ok(Event::Start(ref e)) => {
                let local = e.local_name();
                let tag_bytes = local.as_ref();
                if tag_bytes == b"body" {
                    in_body = true;
                } else if tag_bytes == b"p" && in_body {
                    if let Some(id) = current_note_id.take() {
                        let text = current_text.trim().to_string();
                        if !text.is_empty() {
                            notes.insert(id, text);
                        }
                    }
                    current_text.clear();
                    in_note_para = true;
                } else if tag_bytes == b"a" && in_note_para {
                    let mut href_fragment: Option<String> = None;
                    for attr in e.attributes().flatten() {
                        if attr.key.as_ref() == b"id" {
                            let id = String::from_utf8_lossy(&attr.value).to_string();
                            if current_note_id.is_none() {
                                current_note_id = Some(id);
                            }
                        } else if attr.key.as_ref() == b"href" {
                            let href = String::from_utf8_lossy(&attr.value);
                            if let Some(frag) = href.split('#').nth(1) {
                                href_fragment = Some(frag.to_string());
                            }
                        }
                    }
                    if let (Some(note_id), Some(source_id)) = (current_note_id.as_ref(), href_fragment) {
                        backlinks.entry(note_id.clone()).or_insert(source_id);
                    }
                }
            }
            Ok(Event::Text(ref e)) if in_note_para => {
                let text = e.unescape().unwrap_or_default().to_string();
                current_text.push_str(&text);
            }
            Ok(Event::End(ref e)) => {
                let local = e.local_name();
                let tag_bytes = local.as_ref();
                if tag_bytes == b"p" {
                    in_note_para = false;
                } else if tag_bytes == b"body" {
                    in_body = false;
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
    }
    // Flush last note
    if let Some(id) = current_note_id {
        let text = current_text.trim().to_string();
        if !text.is_empty() {
            notes.insert(id, text);
        }
    }
    (notes, backlinks)
}

/// Extract the filename from an href like "../Text/foo.html#anchor"
fn href_to_filename(href: &str) -> &str {
    let without_fragment = href.split('#').next().unwrap_or(href);
    without_fragment.rsplit('/').next().unwrap_or(without_fragment)
}

fn read_zip_text(archive: &mut ZipArchive<Cursor<&[u8]>>, path: &str) -> Result<String, EpubError> {
    let mut file = archive
        .by_name(path)
        .map_err(|_| EpubError::MissingFile(path.to_string()))?;
    let mut content = String::new();
    file.read_to_string(&mut content)?;
    Ok(content)
}

fn parse_container_xml(archive: &mut ZipArchive<Cursor<&[u8]>>) -> Result<String, EpubError> {
    let xml = read_zip_text(archive, "META-INF/container.xml")?;
    let mut reader = Reader::from_str(&xml);

    loop {
        match reader.read_event() {
            Ok(Event::Empty(ref e)) | Ok(Event::Start(ref e)) => {
                if e.local_name().as_ref() == b"rootfile" {
                    for attr in e.attributes().flatten() {
                        if attr.key.as_ref() == b"full-path" {
                            return Ok(String::from_utf8_lossy(&attr.value).to_string());
                        }
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(EpubError::Xml(e)),
            _ => {}
        }
    }

    Err(EpubError::Parse("no rootfile found in container.xml".into()))
}

fn parse_opf(
    archive: &mut ZipArchive<Cursor<&[u8]>>,
    opf_path: &str,
) -> Result<(Option<String>, Option<String>, Vec<String>), EpubError> {
    let xml = read_zip_text(archive, opf_path)?;
    let mut reader = Reader::from_str(&xml);

    let mut title: Option<String> = None;
    let mut author: Option<String> = None;
    let mut manifest: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    let mut spine_ids: Vec<String> = Vec::new();

    #[derive(PartialEq)]
    enum State { None, Title, Creator }
    let mut state = State::None;

    loop {
        match reader.read_event() {
            Ok(Event::Start(ref e)) => {
                let local = e.local_name();
                if local.as_ref() == b"title" {
                    state = State::Title;
                } else if local.as_ref() == b"creator" {
                    state = State::Creator;
                }
            }
            Ok(Event::Empty(ref e)) => {
                let local = e.local_name();
                if local.as_ref() == b"item" {
                    let mut id = String::new();
                    let mut href = String::new();
                    for attr in e.attributes().flatten() {
                        match attr.key.as_ref() {
                            b"id" => id = String::from_utf8_lossy(&attr.value).to_string(),
                            b"href" => href = String::from_utf8_lossy(&attr.value).to_string(),
                            _ => {}
                        }
                    }
                    if !id.is_empty() {
                        manifest.insert(id, href);
                    }
                } else if local.as_ref() == b"itemref" {
                    for attr in e.attributes().flatten() {
                        if attr.key.as_ref() == b"idref" {
                            spine_ids.push(String::from_utf8_lossy(&attr.value).to_string());
                        }
                    }
                }
            }
            Ok(Event::Text(ref e)) => {
                let text = e.unescape().unwrap_or_default().to_string();
                match state {
                    State::Title => title = Some(text),
                    State::Creator => author = Some(text),
                    State::None => {}
                }
            }
            Ok(Event::End(_)) => {
                state = State::None;
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(EpubError::Xml(e)),
            _ => {}
        }
    }

    let spine_hrefs: Vec<String> = spine_ids
        .iter()
        .filter_map(|id| manifest.get(id).cloned())
        .collect();

    Ok((title, author, spine_hrefs))
}

enum StyleMarker {
    Bold,
    Italic,
    Superscript,
}

fn current_bold(stack: &[StyleMarker]) -> bool {
    stack.iter().any(|m| matches!(m, StyleMarker::Bold))
}

fn current_italic(stack: &[StyleMarker]) -> bool {
    stack.iter().any(|m| matches!(m, StyleMarker::Italic))
}

fn current_superscript(stack: &[StyleMarker]) -> bool {
    stack.iter().any(|m| matches!(m, StyleMarker::Superscript))
}

/// Check if text looks like a footnote reference marker:
/// standalone numbers, bracketed numbers, or typographic symbols.
fn is_noteref_text(text: &str) -> bool {
    let t = text.trim();
    if t.is_empty() || t.len() > 10 {
        return false;
    }
    // Pure digits: "1", "42", "123"
    if t.chars().all(|c| c.is_ascii_digit()) {
        return true;
    }
    // Bracketed: "[1]", "(1)"
    if (t.starts_with('[') && t.ends_with(']')) || (t.starts_with('(') && t.ends_with(')')) {
        let inner = &t[1..t.len() - 1];
        if inner.chars().all(|c| c.is_ascii_digit()) {
            return true;
        }
    }
    // Typographic symbols: *, †, ‡, §
    if t.chars().all(|c| matches!(c, '*' | '†' | '‡' | '§')) {
        return true;
    }
    false
}

fn heading_font_size(level: u8) -> f32 {
    match level {
        1 => 28.0,
        2 => 24.0,
        3 => 20.0,
        4 => 16.0,
        5 => 14.0,
        _ => 12.0,
    }
}

fn parse_xhtml(
    xml_str: &str,
    notes_filenames: &std::collections::HashSet<String>,
    known_note_ids: &std::collections::HashSet<String>,
    note_backlinks: &std::collections::HashMap<String, String>,
    is_notes_file: bool,
) -> Vec<Block> {
    let mut reader = Reader::from_str(xml_str);

    let mut blocks: Vec<Block> = Vec::new();
    let mut current_spans: Vec<Span> = Vec::new();
    let mut current_heading_level: Option<u8> = None;
    let mut in_block = false;
    let mut in_body = false;
    let mut style_stack: Vec<StyleMarker> = Vec::new();
    // Tier 1 noteref: explicit epub:type/role — immediate certainty
    let mut in_noteref_definite = false;
    let mut definite_noteref_spans_start: usize = 0;
    // Fragment ID the current noteref points to (e.g. "d2")
    let mut current_noteref_id: Option<String> = None;
    let mut in_anchor = false;

    loop {
        match reader.read_event() {
            Ok(Event::Start(ref e)) => {
                let name = e.local_name();
                let tag = std::str::from_utf8(name.as_ref()).unwrap_or("");

                match tag {
                    "body" => {
                        in_body = true;
                    }
                    "p" if in_body => {
                        in_block = true;
                        current_heading_level = None;
                    }
                    "h1" | "h2" | "h3" | "h4" | "h5" | "h6" if in_body => {
                        let level: u8 = tag[1..].parse().unwrap_or(1);
                        in_block = true;
                        current_heading_level = Some(level);
                        style_stack.push(StyleMarker::Bold);
                    }
                    "em" | "i" if in_body => {
                        style_stack.push(StyleMarker::Italic);
                    }
                    "strong" | "b" if in_body => {
                        style_stack.push(StyleMarker::Bold);
                    }
                    "sup" if in_body => {
                        style_stack.push(StyleMarker::Superscript);
                    }
                    "a" if in_body => {
                        if is_notes_file {
                            in_anchor = false;
                            continue;
                        }
                        in_anchor = true;
                        let mut has_explicit_noteref = false;
                        let mut href_fragment: Option<String> = None;
                        let mut href_targets_notes_file = false;
                        let mut anchor_id: Option<String> = None;

                        for attr in e.attributes().flatten() {
                            let key = std::str::from_utf8(attr.key.as_ref()).unwrap_or("");
                            let val = String::from_utf8_lossy(&attr.value);

                            // Tier 1: epub:type="noteref" or role="doc-noteref"
                            if key == "type" || key.ends_with(":type") {
                                if val.split_whitespace().any(|t| {
                                    t == "noteref" || t == "biblioref" || t == "glossref"
                                }) {
                                    has_explicit_noteref = true;
                                }
                            }
                            if key == "role" {
                                if val.split_whitespace().any(|r| {
                                    r == "doc-noteref" || r == "doc-biblioref" || r == "doc-glossref"
                                }) {
                                    has_explicit_noteref = true;
                                }
                            }

                            // Extract href and fragment ID
                            if key == "href" {
                                let filename = href_to_filename(&val);
                                href_targets_notes_file = notes_filenames.contains(filename);
                                // Extract fragment: "...#d2" → "d2"
                                if let Some(frag) = val.split('#').nth(1) {
                                    href_fragment = Some(frag.to_string());
                                }
                            }
                            if key == "id" {
                                anchor_id = Some(val.to_string());
                            }
                        }

                        let has_known_note_target = href_fragment
                            .as_ref()
                            .is_some_and(|frag| known_note_ids.contains(frag))
                            && href_targets_notes_file;
                        let has_matching_backlink = match (href_fragment.as_ref(), anchor_id.as_ref()) {
                            (Some(note_id), Some(source_id)) => {
                                note_backlinks.get(note_id).is_some_and(|back| back == source_id)
                            }
                            _ => false,
                        };

                        if has_explicit_noteref || (has_known_note_target && has_matching_backlink) {
                            style_stack.push(StyleMarker::Superscript);
                            in_noteref_definite = true;
                            definite_noteref_spans_start = current_spans.len();
                            current_noteref_id = href_fragment;
                        }
                    }
                    _ => {}
                }
            }
            Ok(Event::Text(ref e)) if in_body && in_block => {
                let text = e.unescape().unwrap_or_default().to_string();
                if !text.is_empty() {
                    let font_size = current_heading_level
                        .map(heading_font_size)
                        .unwrap_or(12.0);
                    current_spans.push(Span {
                        debug_noteref_candidate: in_anchor && is_noteref_text(&text),
                        text,
                        bold: current_bold(&style_stack),
                        italic: current_italic(&style_stack),
                        superscript: current_superscript(&style_stack),
                        noteref_id: None,
                        font_size,
                    });
                }
            }
            Ok(Event::End(ref e)) if in_body => {
                let name = e.local_name();
                let tag = std::str::from_utf8(name.as_ref()).unwrap_or("");

                match tag {
                    "body" => {
                        in_body = false;
                    }
                    "p" => {
                        if !current_spans.is_empty() {
                            blocks.push(Block::Paragraph {
                                spans: std::mem::take(&mut current_spans),
                            });
                        }
                        in_block = false;
                    }
                    "h1" | "h2" | "h3" | "h4" | "h5" | "h6" => {
                        style_stack.pop();
                        if let Some(level) = current_heading_level.take() {
                            blocks.push(Block::Heading {
                                level,
                                spans: std::mem::take(&mut current_spans),
                            });
                        }
                        in_block = false;
                    }
                    "em" | "i" | "strong" | "b" | "sup" => {
                        style_stack.pop();
                    }
                    "a" => {
                        in_anchor = false;
                        if is_notes_file {
                            continue;
                        }
                        if in_noteref_definite {
                            style_stack.pop();
                            // Set noteref_id only on spans created inside this <a>
                            if let Some(ref id) = current_noteref_id {
                                for span in &mut current_spans[definite_noteref_spans_start..] {
                                    span.noteref_id = Some(id.clone());
                                }
                            }
                            in_noteref_definite = false;
                            current_noteref_id = None;
                        }
                    }
                    _ => {}
                }
            }
            Ok(Event::Empty(ref e)) if in_body && in_block => {
                let name = e.local_name();
                if name.as_ref() == b"br" {
                    current_spans.push(Span {
                        text: "\n".to_string(),
                        ..Span::default()
                    });
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => break,
            _ => {}
        }
    }

    blocks
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::write::SimpleFileOptions;
    use zip::ZipWriter;

    fn make_test_epub(chapter_xhtml: &str) -> Vec<u8> {
        let buf = Cursor::new(Vec::new());
        let mut zip = ZipWriter::new(buf);
        let options = SimpleFileOptions::default();

        zip.start_file("mimetype", SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored)).unwrap();
        zip.write_all(b"application/epub+zip").unwrap();

        zip.start_file("META-INF/container.xml", options).unwrap();
        zip.write_all(br#"<?xml version="1.0"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>"#).unwrap();

        zip.start_file("OEBPS/content.opf", options).unwrap();
        zip.write_all(br#"<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Test Book</dc:title>
    <dc:creator>Test Author</dc:creator>
  </metadata>
  <manifest>
    <item id="ch1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="ch1"/>
  </spine>
</package>"#).unwrap();

        zip.start_file("OEBPS/chapter1.xhtml", options).unwrap();
        zip.write_all(chapter_xhtml.as_bytes()).unwrap();

        let cursor = zip.finish().unwrap();
        cursor.into_inner()
    }

    fn make_test_epub_with_notes(chapter_xhtml: &str, notes_xhtml: &str) -> Vec<u8> {
        let buf = Cursor::new(Vec::new());
        let mut zip = ZipWriter::new(buf);
        let options = SimpleFileOptions::default();

        zip.start_file("mimetype", SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored)).unwrap();
        zip.write_all(b"application/epub+zip").unwrap();

        zip.start_file("META-INF/container.xml", options).unwrap();
        zip.write_all(br#"<?xml version="1.0"?>
<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container" version="1.0">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>"#).unwrap();

        zip.start_file("OEBPS/content.opf", options).unwrap();
        zip.write_all(br#"<?xml version="1.0"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:title>Test Book</dc:title>
    <dc:creator>Test Author</dc:creator>
  </metadata>
  <manifest>
    <item id="ch1" href="chapter1.xhtml" media-type="application/xhtml+xml"/>
    <item id="notes" href="notes.xhtml" media-type="application/xhtml+xml"/>
  </manifest>
  <spine>
    <itemref idref="ch1"/>
    <itemref idref="notes"/>
  </spine>
</package>"#).unwrap();

        zip.start_file("OEBPS/chapter1.xhtml", options).unwrap();
        zip.write_all(chapter_xhtml.as_bytes()).unwrap();

        zip.start_file("OEBPS/notes.xhtml", options).unwrap();
        zip.write_all(notes_xhtml.as_bytes()).unwrap();

        let cursor = zip.finish().unwrap();
        cursor.into_inner()
    }

    #[test]
    fn test_parse_simple_epub() {
        let epub_bytes = make_test_epub(r#"<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Ch1</title></head>
<body>
  <h1>Hello World</h1>
  <p>This is a test.</p>
</body>
</html>"#);

        let doc = parse_epub(&epub_bytes).unwrap();
        assert_eq!(doc.title.as_deref(), Some("Test Book"));
        assert_eq!(doc.author.as_deref(), Some("Test Author"));
        assert_eq!(doc.chapters.len(), 1);

        let blocks = &doc.chapters[0].blocks;
        assert_eq!(blocks.len(), 2);

        match &blocks[0] {
            Block::Heading { level, spans } => {
                assert_eq!(*level, 1);
                assert_eq!(spans[0].text, "Hello World");
                assert!(spans[0].bold);
            }
            _ => panic!("expected heading"),
        }

        match &blocks[1] {
            Block::Paragraph { spans } => {
                assert_eq!(spans[0].text, "This is a test.");
            }
            _ => panic!("expected paragraph"),
        }
    }

    #[test]
    fn test_parse_inline_formatting() {
        let epub_bytes = make_test_epub(r#"<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Ch1</title></head>
<body>
  <p>Normal <em>italic</em> and <strong>bold</strong> text.</p>
</body>
</html>"#);

        let doc = parse_epub(&epub_bytes).unwrap();
        let spans = doc.chapters[0].blocks[0].spans();

        assert_eq!(spans.len(), 5);
        assert_eq!(spans[0].text, "Normal ");
        assert!(!spans[0].italic);
        assert_eq!(spans[1].text, "italic");
        assert!(spans[1].italic);
        assert_eq!(spans[2].text, " and ");
        assert_eq!(spans[3].text, "bold");
        assert!(spans[3].bold);
        assert_eq!(spans[4].text, " text.");
    }

    #[test]
    fn test_parse_legacy_notes_page_and_plain_anchor_noteref() {
        let epub_bytes = make_test_epub_with_notes(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Ch1</title></head>
<body>
  <p>Some claim this is true.<a href="notes.xhtml#d142" id="a142">51</a> More text.</p>
</body>
</html>"#,
            r#"<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Notes</title></head>
<body>
  <p class="ct"><a href="chapter1.xhtml#a142" id="d142">NOTES<br/></a></p>
  <p class="ntx"><a href="chapter1.xhtml#a142" id="d142">51</a>. Legacy note text.</p>
  <p class="ntx"><a href="chapter1.xhtml#a143" id="d143">52</a>. Another note.</p>
  <p class="ntx"><a href="chapter1.xhtml#a144" id="d144">53</a>. Third note.</p>
</body>
</html>"#,
        );

        let doc = parse_epub(&epub_bytes).unwrap();
        assert_eq!(doc.notes.get("d142").map(String::as_str), Some("51. Legacy note text."));

        let spans = doc.chapters[0].blocks[0].spans();
        let marker = spans.iter().find(|s| s.text == "51").expect("marker span");
        assert!(marker.superscript);
        assert_eq!(marker.noteref_id.as_deref(), Some("d142"));
    }
}
