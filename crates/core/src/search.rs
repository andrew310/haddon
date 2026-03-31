use crate::types::EpubDocument;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SearchResult {
    pub chapter_index: usize,
    pub block_index: usize,
    pub snippet: String,
}

pub fn search_document(
    doc: &EpubDocument,
    query: &str,
    limit: usize,
) -> Vec<SearchResult> {
    let needle = query.trim().to_lowercase();
    if needle.is_empty() || limit == 0 {
        return Vec::new();
    }

    let mut results = Vec::new();

    for (chapter_index, chapter) in doc.chapters.iter().enumerate() {
        for (block_index, block) in chapter.blocks.iter().enumerate() {
            let text = block
                .spans()
                .iter()
                .map(|span| span.text.as_str())
                .collect::<String>();
            let haystack = text.to_lowercase();

            if let Some(byte_idx) = haystack.find(&needle) {
                results.push(SearchResult {
                    chapter_index,
                    block_index,
                    snippet: make_snippet(&text, byte_idx, needle.len()),
                });

                if results.len() >= limit {
                    return results;
                }
            }
        }
    }

    results
}

fn make_snippet(text: &str, match_start: usize, match_len: usize) -> String {
    let chars: Vec<char> = text.chars().collect();
    let start_char = text[..match_start].chars().count();
    let end_char = start_char + text[match_start..match_start + match_len].chars().count();
    let snippet_start = start_char.saturating_sub(40);
    let snippet_end = (end_char + 60).min(chars.len());

    let mut snippet: String = chars[snippet_start..snippet_end].iter().collect();
    snippet = snippet.split_whitespace().collect::<Vec<_>>().join(" ");

    if snippet_start > 0 {
        snippet.insert_str(0, "...");
    }
    if snippet_end < chars.len() {
        snippet.push_str("...");
    }

    snippet
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::types::{Block, Chapter, Span};
    use std::collections::HashMap;

    #[test]
    fn finds_block_matches_with_snippets() {
        let doc = EpubDocument {
            title: None,
            author: None,
            chapters: vec![Chapter {
                blocks: vec![
                    Block::Paragraph {
                        spans: vec![Span {
                            text: "Alpha beta gamma".into(),
                            ..Span::default()
                        }],
                    },
                    Block::Paragraph {
                        spans: vec![Span {
                            text: "Delta epsilon zeta".into(),
                            ..Span::default()
                        }],
                    },
                ],
            }],
            notes: HashMap::new(),
        };

        let results = search_document(&doc, "epsilon", 10);
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].chapter_index, 0);
        assert_eq!(results[0].block_index, 1);
        assert!(results[0].snippet.contains("Delta epsilon zeta"));
    }
}
