use std::fs;
fn main() {
    let data = fs::read("/Users/andrew/src/github.com/andrew310/haddon/annas-arch-9e1f632fec5d.epub").unwrap();
    let doc = haddon_core::epub::parse_epub(&data).unwrap();
    println!("Notes parsed: {}", doc.notes.len());
    for (id, text) in doc.notes.iter().take(5) {
        println!("  [{}]: {}...", id, &text[..text.len().min(80)]);
    }
    // Check noteref_ids on spans
    let mut refs = 0;
    for ch in &doc.chapters {
        for b in &ch.blocks {
            for s in b.spans() {
                if s.noteref_id.is_some() { refs += 1; }
            }
        }
    }
    println!("Spans with noteref_id: {}", refs);
}
