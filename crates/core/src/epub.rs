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

    // Step 3: Parse each spine item (XHTML chapter)
    let mut chapters = Vec::new();
    for href in &spine_items {
        let full_path = format!("{}{}", opf_dir, href);
        let xhtml = read_zip_text(&mut archive, &full_path)?;
        let blocks = parse_xhtml(&xhtml);
        chapters.push(Chapter { blocks });
    }

    Ok(EpubDocument {
        title: metadata_title,
        author: metadata_author,
        chapters,
    })
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
}

fn current_bold(stack: &[StyleMarker]) -> bool {
    stack.iter().any(|m| matches!(m, StyleMarker::Bold))
}

fn current_italic(stack: &[StyleMarker]) -> bool {
    stack.iter().any(|m| matches!(m, StyleMarker::Italic))
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

fn parse_xhtml(xml_str: &str) -> Vec<Block> {
    let mut reader = Reader::from_str(xml_str);

    let mut blocks: Vec<Block> = Vec::new();
    let mut current_spans: Vec<Span> = Vec::new();
    let mut current_heading_level: Option<u8> = None;
    let mut in_block = false;
    let mut in_body = false;
    let mut style_stack: Vec<StyleMarker> = Vec::new();

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
                        text,
                        bold: current_bold(&style_stack),
                        italic: current_italic(&style_stack),
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
                    "em" | "i" | "strong" | "b" => {
                        style_stack.pop();
                    }
                    _ => {}
                }
            }
            Ok(Event::Empty(ref e)) if in_body && in_block => {
                let name = e.local_name();
                if name.as_ref() == b"br" {
                    current_spans.push(Span {
                        text: "\n".to_string(),
                        bold: false,
                        italic: false,
                        font_size: 12.0,
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
}
