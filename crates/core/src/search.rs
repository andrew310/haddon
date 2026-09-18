use crate::publication::{
    utf16_offset_at_byte, NormalizationResult, NormalizedResource, Publication,
};
use crate::types::{DocumentPoint, DocumentRange, EpubDocument};
use serde::Serialize;
use unicode_normalization::char::{canonical_combining_class, decompose_canonical};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SearchResult {
    pub range: DocumentRange,
    pub snippet: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TextMatch {
    pub start_byte: usize,
    pub end_byte: usize,
    pub exact: String,
    pub snippet: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NormalizedSearchHit {
    pub href: String,
    pub block_id: String,
    pub start: u64,
    pub end: u64,
    pub exact: String,
    pub snippet: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SearchOutcome<T> {
    Complete(Vec<T>),
    Cancelled,
}

/// Case-fold and strip combining marks for matching. The result is not a source offset map.
pub fn fold_query(query: &str) -> String {
    fold_string(query.trim())
}

pub fn find_text_matches(text: &str, query: &str, limit: usize) -> Vec<TextMatch> {
    let needle = fold_query(query);
    find_text_matches_folded(text, &needle, limit)
}

pub fn find_text_matches_folded(text: &str, needle_folded: &str, limit: usize) -> Vec<TextMatch> {
    if needle_folded.is_empty() || limit == 0 {
        return Vec::new();
    }

    let hay = FoldedHaystack::fold(text);
    let mut matches = Vec::new();
    let mut search_offset = 0;

    while matches.len() < limit {
        let remainder = &hay.folded[search_offset..];
        let Some(relative) = remainder.find(needle_folded) else {
            break;
        };
        let folded_start = search_offset + relative;
        let folded_end = folded_start + needle_folded.len();
        search_offset = folded_end;

        let Some((start_byte, end_byte)) = hay.original_range(folded_start, folded_end) else {
            continue;
        };
        if !text.is_char_boundary(start_byte) || !text.is_char_boundary(end_byte) {
            continue;
        }

        matches.push(TextMatch {
            exact: text[start_byte..end_byte].to_string(),
            snippet: make_snippet(text, start_byte, end_byte - start_byte),
            start_byte,
            end_byte,
        });
    }

    matches
}

pub fn search_document(doc: &EpubDocument, query: &str, limit: usize) -> Vec<SearchResult> {
    let needle = fold_query(query);
    if needle.is_empty() || limit == 0 {
        return Vec::new();
    }

    let mut results = Vec::new();

    for (chapter_index, chapter) in doc.chapters.iter().enumerate() {
        for (block_index, block) in chapter.blocks.iter().enumerate() {
            if results.len() >= limit {
                return results;
            }
            let text: String = block
                .spans()
                .iter()
                .map(|span| span.text.as_str())
                .collect();
            let remaining = limit - results.len();
            for found in find_text_matches_folded(&text, &needle, remaining) {
                results.push(SearchResult {
                    range: DocumentRange::new(
                        DocumentPoint::new(chapter_index, block_index, found.start_byte),
                        DocumentPoint::new(chapter_index, block_index, found.end_byte),
                    ),
                    snippet: found.snippet,
                });
                if results.len() >= limit {
                    return results;
                }
            }
        }
    }

    results
}

pub fn search_normalized_resource(
    resource: &NormalizedResource,
    needle_folded: &str,
    limit: usize,
) -> Vec<NormalizedSearchHit> {
    if needle_folded.is_empty() || limit == 0 {
        return Vec::new();
    }

    let mut hits = Vec::new();
    resource.root.for_each_block(&mut |block| {
        if hits.len() >= limit {
            return;
        }
        let Some(text_block) = block.as_text_block() else {
            return;
        };
        let remaining = limit - hits.len();
        for found in find_text_matches_folded(&text_block.text, needle_folded, remaining) {
            let Ok(start) = utf16_offset_at_byte(&text_block.text, found.start_byte) else {
                continue;
            };
            let Ok(end) = utf16_offset_at_byte(&text_block.text, found.end_byte) else {
                continue;
            };
            if start >= end {
                continue;
            }
            hits.push(NormalizedSearchHit {
                href: resource.href.clone(),
                block_id: text_block.base.id.clone(),
                start,
                end,
                exact: found.exact,
                snippet: found.snippet,
            });
            if hits.len() >= limit {
                return;
            }
        }
    });
    hits
}

pub fn search_publication_resource(
    publication: &Publication,
    href: &str,
    query: &str,
    limit: usize,
) -> Vec<NormalizedSearchHit> {
    let needle = fold_query(query);
    if needle.is_empty() || limit == 0 {
        return Vec::new();
    }
    let normalized = match publication.normalize(href) {
        Ok(outcome) => match outcome.value {
            NormalizationResult::Normalized(resource) => resource,
            _ => return Vec::new(),
        },
        Err(_) => return Vec::new(),
    };
    search_normalized_resource(&normalized, &needle, limit)
}

/// Search linear spine items. `should_continue` is checked before each resource so a
/// new query generation can abandon in-flight work without returning partial hits.
pub fn search_publication(
    publication: &Publication,
    query: &str,
    limit: usize,
    mut should_continue: impl FnMut() -> bool,
) -> SearchOutcome<NormalizedSearchHit> {
    let needle = fold_query(query);
    if needle.is_empty() || limit == 0 {
        return SearchOutcome::Complete(Vec::new());
    }

    let mut hits = Vec::new();
    for link in publication.manifest().linear_reading_order() {
        if !should_continue() {
            return SearchOutcome::Cancelled;
        }
        if hits.len() >= limit {
            break;
        }
        let normalized = match publication.normalize(link.href.as_str()) {
            Ok(outcome) => match outcome.value {
                NormalizationResult::Normalized(resource) => resource,
                _ => continue,
            },
            Err(_) => continue,
        };
        let remaining = limit - hits.len();
        hits.extend(search_normalized_resource(&normalized, &needle, remaining));
    }
    SearchOutcome::Complete(hits)
}

struct FoldedHaystack {
    folded: String,
    orig_start: Vec<usize>,
    orig_end: Vec<usize>,
}

impl FoldedHaystack {
    fn fold(text: &str) -> Self {
        let mut folded = String::with_capacity(text.len());
        let mut orig_start = Vec::with_capacity(text.len());
        let mut orig_end = Vec::with_capacity(text.len());

        for (byte_idx, ch) in text.char_indices() {
            let next_idx = byte_idx + ch.len_utf8();
            let produced_at = folded.len();
            fold_char(ch, &mut folded);
            for _ in produced_at..folded.len() {
                orig_start.push(byte_idx);
                orig_end.push(next_idx);
            }
            if folded.len() == produced_at {
                if let Some(end) = orig_end.last_mut() {
                    *end = next_idx;
                }
            }
        }

        debug_assert_eq!(orig_start.len(), folded.len());
        debug_assert_eq!(orig_end.len(), folded.len());
        Self {
            folded,
            orig_start,
            orig_end,
        }
    }

    fn original_range(&self, folded_start: usize, folded_end: usize) -> Option<(usize, usize)> {
        if folded_start >= folded_end || folded_end > self.folded.len() {
            return None;
        }
        if !self.folded.is_char_boundary(folded_start) || !self.folded.is_char_boundary(folded_end)
        {
            return None;
        }
        let start = self.orig_start[folded_start];
        let end = self.orig_end[folded_end - 1];
        if start >= end {
            return None;
        }
        Some((start, end))
    }
}

fn fold_string(text: &str) -> String {
    let mut folded = String::with_capacity(text.len());
    for ch in text.chars() {
        fold_char(ch, &mut folded);
    }
    folded
}

fn fold_char(ch: char, folded: &mut String) {
    // Full Unicode case-fold maps ß/ẞ → "ss". `to_lowercase` leaves ß unchanged.
    if ch == 'ß' || ch == 'ẞ' {
        folded.push_str("ss");
        return;
    }
    decompose_canonical(ch, |decomp| {
        for lower in decomp.to_lowercase() {
            decompose_canonical(lower, |ld| {
                if canonical_combining_class(ld) == 0 {
                    folded.push(ld);
                }
            });
        }
    });
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
    use crate::publication::{
        citation_roundtrip_epub, is_valid_utf16_offset, open_epub_default, utf16_slice,
    };
    use crate::types::{Block, Chapter, Span};
    use std::collections::HashMap;

    fn assert_valid_hit(text: &str, hit: &TextMatch) {
        assert!(
            text.is_char_boundary(hit.start_byte),
            "start {} is not a char boundary in {text:?}",
            hit.start_byte
        );
        assert!(
            text.is_char_boundary(hit.end_byte),
            "end {} is not a char boundary in {text:?}",
            hit.end_byte
        );
        assert_eq!(&text[hit.start_byte..hit.end_byte], hit.exact);
        let start = utf16_offset_at_byte(text, hit.start_byte).unwrap();
        let end = utf16_offset_at_byte(text, hit.end_byte).unwrap();
        assert!(is_valid_utf16_offset(text, start));
        assert!(is_valid_utf16_offset(text, end));
        assert!(end > start);
        assert_eq!(utf16_slice(text, start, end).unwrap(), hit.exact);
    }

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
        assert_eq!(results[0].range.start.chapter_index, 0);
        assert_eq!(results[0].range.start.block_index, 1);
        assert!(results[0].snippet.contains("Delta epsilon zeta"));
    }

    #[test]
    fn empty_query_returns_no_hits() {
        assert!(find_text_matches("naïve coffee", "", 10).is_empty());
        assert!(find_text_matches("naïve coffee", "   ", 10).is_empty());
        assert!(find_text_matches("naïve coffee", "\u{0308}", 10).is_empty());
    }

    #[test]
    fn respects_limit() {
        let text = "naive naïve naive";
        let hits = find_text_matches(text, "naive", 2);
        assert_eq!(hits.len(), 2);
        let unlimited = find_text_matches(text, "naive", 10);
        assert_eq!(unlimited.len(), 3);
        assert!(find_text_matches(text, "naive", 0).is_empty());
    }

    #[test]
    fn two_hits_in_one_paragraph() {
        let text = "The copper astrolabe and the patient moon.";
        let hits = find_text_matches(text, "the", 10);
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].exact.to_lowercase(), "the");
        assert_eq!(hits[1].exact.to_lowercase(), "the");
        assert!(hits[0].end_byte <= hits[1].start_byte);
        for hit in &hits {
            assert_valid_hit(text, hit);
        }

        let doc = EpubDocument {
            title: None,
            author: None,
            chapters: vec![Chapter {
                blocks: vec![Block::Paragraph {
                    spans: vec![Span {
                        text: text.into(),
                        ..Span::default()
                    }],
                }],
            }],
            notes: HashMap::new(),
        };
        let results = search_document(&doc, "the", 10);
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].range.start.block_index, 0);
        assert_eq!(results[1].range.start.block_index, 0);
        assert!(results[0].range.end.offset <= results[1].range.start.offset);
    }

    #[test]
    fn diacritic_folding_precomposed_and_combining() {
        let precomposed = "The naïve approach";
        let combining = "The nai\u{0308}ve approach";
        let ascii = "The naive approach";

        for query in ["naive", "naïve", "NAÏVE", "nai\u{0308}ve"] {
            for text in [precomposed, combining, ascii] {
                let hits = find_text_matches(text, query, 10);
                assert_eq!(hits.len(), 1, "query {query:?} in {text:?}");
                assert_valid_hit(text, &hits[0]);
                let folded_exact = fold_query(&hits[0].exact);
                assert_eq!(folded_exact, "naive");
            }
        }

        let precomposed_hits = find_text_matches(precomposed, "naive", 10);
        assert_eq!(precomposed_hits[0].exact, "naïve");

        let combining_hits = find_text_matches(combining, "naive", 10);
        assert_eq!(combining_hits[0].exact, "nai\u{0308}ve");

        let ascii_hits = find_text_matches(ascii, "naïve", 10);
        assert_eq!(ascii_hits[0].exact, "naive");
    }

    #[test]
    fn vietnamese_combining_cluster_maps_to_source() {
        let combining = "e\u{0302}\u{0323}";
        let precomposed = "ệ";
        for text in [combining, precomposed] {
            let hits = find_text_matches(text, "e", 10);
            assert_eq!(hits.len(), 1, "{text:?}");
            assert_eq!(hits[0].exact, text);
            assert_valid_hit(text, &hits[0]);
        }
    }

    #[test]
    fn unicode_expansion_eszett_keeps_valid_offsets() {
        let text = "Straße";
        let hits = find_text_matches(text, "strasse", 10);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].exact, "Straße");
        assert_valid_hit(text, &hits[0]);

        let ss_hits = find_text_matches(text, "ss", 10);
        assert_eq!(ss_hits.len(), 1);
        assert_eq!(ss_hits[0].exact, "ß");
        assert_valid_hit(text, &ss_hits[0]);
    }

    #[test]
    fn offsets_stay_valid_after_non_ascii_and_emoji() {
        let text = "👍 naïve κόσμος naïve";
        let hits = find_text_matches(text, "naive", 10);
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].exact, "naïve");
        assert_eq!(hits[1].exact, "naïve");
        assert!(hits[0].start_byte > 0);
        for hit in &hits {
            assert_valid_hit(text, hit);
        }

        let thumbs_end = utf16_offset_at_byte(text, "👍 ".len()).unwrap();
        let first_start = utf16_offset_at_byte(text, hits[0].start_byte).unwrap();
        assert_eq!(first_start, thumbs_end);
        assert!(is_valid_utf16_offset(text, thumbs_end));
        assert!(!is_valid_utf16_offset(text, 1));
    }

    #[test]
    fn search_publication_empty_query_and_limit() {
        let opened = open_epub_default(&citation_roundtrip_epub()).unwrap().value;
        let publication = opened.publication;
        assert_eq!(
            search_publication(&publication, "", 50, || true),
            SearchOutcome::Complete(Vec::new())
        );
        assert_eq!(
            search_publication(&publication, "the", 0, || true),
            SearchOutcome::Complete(Vec::new())
        );

        let SearchOutcome::Complete(hits) = search_publication(&publication, "the", 3, || true)
        else {
            panic!("expected complete search");
        };
        assert_eq!(hits.len(), 3);
        for hit in &hits {
            assert!(hit.end > hit.start);
            assert!(!hit.exact.is_empty());
            assert!(!hit.block_id.is_empty());
        }
    }

    #[test]
    fn search_publication_two_hits_in_one_block() {
        let opened = open_epub_default(&citation_roundtrip_epub()).unwrap().value;
        let publication = opened.publication;
        let SearchOutcome::Complete(hits) = search_publication(&publication, "the", 50, || true)
        else {
            panic!("expected complete search");
        };
        assert!(hits.len() > 1);

        let mut grouped: HashMap<String, Vec<&NormalizedSearchHit>> = HashMap::new();
        for hit in &hits {
            grouped.entry(hit.block_id.clone()).or_default().push(hit);
        }
        let multi = grouped
            .values()
            .find(|block_hits| block_hits.len() >= 2)
            .expect("fixture paragraph repeats 'the'");
        assert_ne!(multi[0].start, multi[1].start);
        assert_eq!(multi[0].href, multi[1].href);
    }

    #[test]
    fn search_publication_cancels_between_resources() {
        let opened = open_epub_default(&citation_roundtrip_epub()).unwrap().value;
        let publication = opened.publication;
        let mut seen = 0;
        let outcome = search_publication(&publication, "the", 50, || {
            seen += 1;
            seen <= 1
        });
        assert_eq!(outcome, SearchOutcome::Cancelled);
        assert!(seen >= 2);
    }
}
