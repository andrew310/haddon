use super::{
    MappingResult, NormalizedResource, NormalizedTextRange, SourceDomPoint, SourceDomRange,
    SourceTextNodeRef, SourceTextSpan, TextOffset, TextTransform, UnmappedReason,
};

pub fn utf16_len(text: &str) -> u64 {
    text.encode_utf16().count() as u64
}

pub fn is_utf16_boundary(text: &str, offset: u64) -> bool {
    let units: Vec<u16> = text.encode_utf16().collect();
    let index = offset as usize;
    if index > units.len() {
        return false;
    }
    if index == 0 || index == units.len() {
        return true;
    }
    !(is_low_surrogate(units[index]) && is_high_surrogate(units[index - 1]))
}

pub fn utf16_slice(text: &str, start: u64, end: u64) -> Option<String> {
    if start > end || !is_utf16_boundary(text, start) || !is_utf16_boundary(text, end) {
        return None;
    }
    let units: Vec<u16> = text.encode_utf16().collect();
    if end as usize > units.len() {
        return None;
    }
    String::from_utf16(&units[start as usize..end as usize]).ok()
}

fn is_high_surrogate(unit: u16) -> bool {
    (0xD800..=0xDBFF).contains(&unit)
}

fn is_low_surrogate(unit: u16) -> bool {
    (0xDC00..=0xDFFF).contains(&unit)
}

/// True when `offset` lands on a trailing UTF-16 surrogate.
pub fn splits_surrogate(text: &str, offset: u64) -> bool {
    let units: Vec<u16> = text.encode_utf16().collect();
    let index = offset as usize;
    index > 0
        && index < units.len()
        && is_low_surrogate(units[index])
        && is_high_surrogate(units[index - 1])
}

pub fn validate_utf16_range(text: &str, start: u64, end: u64) -> Result<(), UnmappedReason> {
    let len = utf16_len(text);
    if start > end {
        return Err(UnmappedReason::Invalid);
    }
    if end > len {
        return Err(UnmappedReason::Outside);
    }
    if splits_surrogate(text, start) || splits_surrogate(text, end) {
        return Err(UnmappedReason::Invalid);
    }
    Ok(())
}

impl NormalizedResource {
    pub fn map_normalized_range(
        &self,
        block_id: &str,
        start: u64,
        end: u64,
    ) -> MappingResult<SourceTextSpan> {
        let Some(block) = self.text_block(block_id) else {
            return MappingResult::Unmapped {
                reason: UnmappedReason::Outside,
            };
        };
        if let Err(reason) = validate_utf16_range(&block.text, start, end) {
            return MappingResult::Unmapped { reason };
        }

        let mut parts = Vec::new();
        let mut indices = Vec::new();
        let mut all_identity = true;
        for (index, segment) in self.source_map.segments.iter().enumerate() {
            let Some((normalized, source, transform)) = segment.as_text_segment() else {
                continue;
            };
            if normalized.block_id() != block_id {
                continue;
            }
            let seg_start = normalized.start.offset.value;
            let seg_end = normalized.end.offset.value;
            if end <= seg_start || start >= seg_end {
                continue;
            }
            if transform != TextTransform::Identity {
                all_identity = false;
            }
            let overlap_start = start.max(seg_start);
            let overlap_end = end.min(seg_end);
            if let Some(part) =
                translate_identity_overlap(source, transform, seg_start, overlap_start, overlap_end)
            {
                parts.push(part);
                indices.push(index);
            }
        }
        if parts.is_empty() {
            return MappingResult::Unmapped {
                reason: UnmappedReason::Outside,
            };
        }
        let value = SourceTextSpan { parts };
        if all_identity {
            MappingResult::Exact {
                value,
                segments: indices,
            }
        } else {
            MappingResult::Covering {
                value,
                reason: super::LossReason::Collapsed,
                segments: indices,
            }
        }
    }

    pub fn map_source_range(&self, span: &SourceTextSpan) -> MappingResult<NormalizedTextRange> {
        if span.parts.is_empty() {
            return MappingResult::Unmapped {
                reason: UnmappedReason::Invalid,
            };
        }
        for part in &span.parts {
            if part.start.node != part.end.node {
                return MappingResult::Unmapped {
                    reason: UnmappedReason::Invalid,
                };
            }
            if part.start.offset.value > part.end.offset.value {
                return MappingResult::Unmapped {
                    reason: UnmappedReason::Invalid,
                };
            }
        }

        let mut hits: Vec<(usize, u64, u64, String)> = Vec::new();
        for (index, segment) in self.source_map.segments.iter().enumerate() {
            let Some((normalized, source, transform)) = segment.as_text_segment() else {
                continue;
            };
            if transform != TextTransform::Identity {
                continue;
            }
            for query in &span.parts {
                for part in &source.parts {
                    if !same_text_node(&query.start.node, &part.start.node) {
                        continue;
                    }
                    let overlap_start = query.start.offset.value.max(part.start.offset.value);
                    let overlap_end = query.end.offset.value.min(part.end.offset.value);
                    if overlap_start >= overlap_end
                        && query.start.offset.value != query.end.offset.value
                    {
                        continue;
                    }
                    if overlap_start > overlap_end {
                        continue;
                    }
                    let delta = overlap_start.saturating_sub(part.start.offset.value);
                    let norm_start = normalized.start.offset.value + delta;
                    let norm_end = norm_start + overlap_end.saturating_sub(overlap_start);
                    hits.push((
                        index,
                        norm_start,
                        norm_end.max(norm_start),
                        normalized.block_id().to_string(),
                    ));
                }
            }
        }
        if hits.is_empty() {
            return MappingResult::Unmapped {
                reason: UnmappedReason::Outside,
            };
        }
        hits.sort_by_key(|hit| (hit.3.clone(), hit.1, hit.2, hit.0));
        let block_id = hits[0].3.clone();
        if hits.iter().any(|hit| hit.3 != block_id) {
            return MappingResult::Ambiguous {
                candidates: hits
                    .iter()
                    .map(|hit| NormalizedTextRange::new(hit.3.clone(), hit.1, hit.2))
                    .collect(),
                segments: hits.iter().map(|hit| hit.0).collect(),
            };
        }
        let start = hits.iter().map(|hit| hit.1).min().unwrap_or(0);
        let end = hits.iter().map(|hit| hit.2).max().unwrap_or(start);
        MappingResult::Exact {
            value: NormalizedTextRange::new(block_id, start, end),
            segments: hits.iter().map(|hit| hit.0).collect(),
        }
    }

    pub fn covering_text_segments(
        &self,
        block_id: &str,
    ) -> Vec<(u64, u64, TextTransform, &SourceTextSpan)> {
        self.source_map
            .segments
            .iter()
            .filter_map(|segment| {
                let (normalized, source, transform) = segment.as_text_segment()?;
                (normalized.block_id() == block_id).then_some((
                    normalized.start.offset.value,
                    normalized.end.offset.value,
                    transform,
                    source,
                ))
            })
            .collect()
    }

    pub fn assert_complete_normalized_coverage(&self) -> Result<(), String> {
        let mut lengths = std::collections::BTreeMap::<String, u64>::new();
        self.root.for_each_block(&mut |block| {
            if let Some(text) = block.as_text_block() {
                lengths.insert(text.base.id.clone(), text.utf16_len());
            }
        });
        let mut covered: std::collections::BTreeMap<String, Vec<bool>> = lengths
            .iter()
            .map(|(id, len)| (id.clone(), vec![false; *len as usize]))
            .collect();
        for segment in &self.source_map.segments {
            if let Some((normalized, _, _)) = segment.as_text_segment() {
                let Some(flags) = covered.get_mut(normalized.block_id()) else {
                    continue;
                };
                let start = normalized.start.offset.value as usize;
                let end = normalized.end.offset.value as usize;
                if end > flags.len() {
                    return Err(format!(
                        "segment overruns block {} [{start}, {end})",
                        normalized.block_id()
                    ));
                }
                for flag in flags.iter_mut().take(end).skip(start) {
                    if *flag {
                        return Err(format!(
                            "overlapping coverage on {} [{start}, {end})",
                            normalized.block_id()
                        ));
                    }
                    *flag = true;
                }
            }
        }
        for (id, flags) in &covered {
            if let Some(index) = flags.iter().position(|flag| !flag) {
                return Err(format!("uncovered utf16 unit {index} on {id}"));
            }
        }
        Ok(())
    }
}

fn translate_identity_overlap(
    source: &SourceTextSpan,
    transform: TextTransform,
    seg_start: u64,
    overlap_start: u64,
    overlap_end: u64,
) -> Option<SourceDomRange> {
    let part = source.parts.first()?;
    if transform == TextTransform::Identity {
        let delta_start = overlap_start.saturating_sub(seg_start);
        let delta_end = overlap_end.saturating_sub(seg_start);
        return Some(SourceDomRange {
            start: SourceDomPoint {
                node: part.start.node.clone(),
                offset: TextOffset::utf16(part.start.offset.value + delta_start),
            },
            end: SourceDomPoint {
                node: part.end.node.clone(),
                offset: TextOffset::utf16(part.start.offset.value + delta_end),
            },
        });
    }
    Some(part.clone())
}

fn same_text_node(left: &SourceTextNodeRef, right: &SourceTextNodeRef) -> bool {
    left.text_node_index == right.text_node_index
        && left.container.href == right.container.href
        && match (&left.container.fragment, &right.container.fragment) {
            (Some(left_id), Some(right_id)) if left_id == right_id => true,
            _ => left.container.dom_path == right.container.dom_path,
        }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_offsets_that_split_surrogate_pairs() {
        let text = "A😀B";
        assert_eq!(utf16_len(text), 4);
        assert!(is_utf16_boundary(text, 0));
        assert!(is_utf16_boundary(text, 1));
        assert!(!is_utf16_boundary(text, 2));
        assert!(is_utf16_boundary(text, 3));
        assert!(is_utf16_boundary(text, 4));
        assert!(splits_surrogate(text, 2));
        assert!(!splits_surrogate(text, 1));
        assert_eq!(
            validate_utf16_range(text, 2, 3),
            Err(UnmappedReason::Invalid)
        );
        assert_eq!(utf16_slice(text, 1, 3).as_deref(), Some("😀"));
        assert_eq!(utf16_slice(text, 2, 3), None);
    }
}
