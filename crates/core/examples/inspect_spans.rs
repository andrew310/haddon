use std::fs;

fn main() {
    let data =
        fs::read("/Users/andrew/src/github.com/andrew310/haddon/annas-arch-9e1f632fec5d.epub")
            .unwrap();
    let doc = haddon_core::epub::parse_epub(&data).unwrap();
    let layout = haddon_core::layout::layout_document(&doc);

    for (chapter_idx, chapter) in doc.chapters.iter().enumerate() {
        for (block_idx, block) in chapter.blocks.iter().enumerate() {
            let text: String = block.spans().iter().map(|s| s.text.as_str()).collect();
            if text.contains("Dead Sea scroll finds")
                || text.contains("THE BIG IDEA?")
                || text.contains("ACKNOWLEDGMENTS")
            {
                println!(
                    "chapter={chapter_idx} block={block_idx} text={:?}",
                    text.chars().take(220).collect::<String>()
                );
                for span in block.spans() {
                    if span.noteref_id.is_some()
                        || span.debug_noteref_candidate
                        || matches!(span.text.trim(), "1" | "2" | "3" | "4" | "5")
                        || span.text.contains("ACKNOWLEDGMENTS")
                        || span.text.contains("THE BIG IDEA?")
                    {
                        println!(
                            "  text={:?} note={:?} debug={} super={}",
                            span.text,
                            span.noteref_id,
                            span.debug_noteref_candidate,
                            span.superscript
                        );
                    }
                }
            }
        }
    }

    println!("-- layout refs --");
    for (page_idx, page) in layout.pages.iter().enumerate() {
        for (line_idx, line) in page.lines.iter().enumerate() {
            for frag in &line.fragments {
                if frag.noteref_id.is_some() {
                    println!(
                        "page={} line={} text={:?} note={:?} super={}",
                        page_idx, line_idx, frag.text, frag.noteref_id, frag.superscript
                    );
                }
            }
        }
    }

    println!("notes={} chapters={}", doc.notes.len(), doc.chapters.len());
}
