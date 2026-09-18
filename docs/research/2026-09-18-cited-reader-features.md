# Research result

**Status: Partial**

The distinctive features worth copying are in-text study overlays (Literal Word tap-to-lexicon and Strong’s occurrence lists; Kindle X-Ray, Word Wise, and Smart Lookup), passage- or progress-scoped in-book AI (Kindle Ask this Book, Readwise Ghostreader, Play Books Book insights), and a handful of open-reader locators (Thorium W3C annotation export, Foliate CFI copy). Almost none already hang on a volume + file hash + locator + quote: they key off Protestant verse IDs, store-catalog flags, Reader document IDs, or whole-book modes. The payloads that can hang off locator + quote are Thorium’s annotation JSON and Foliate’s CFI-plus-copied-text; Vocabulary Builder and Ghostreader at least carry a quote, but identity stays proprietary. Literal Word has not shipped side-by-side parallel translations as of App Store 4.4.9 (10 Aug 2026).

### Literal Word: lexicon on a verse ID, not a hash

Tap an English word on the reading surface to open complete Abbott-Smith (NT/Greek) and BDB (OT/Hebrew) lexicon entries, with Liddell-Scott used for a small Greek set. That lookup is wired to each translation’s original-language/Strong’s tagging of the verse’s English words, not to volume + file hash + locator + quote. [S1]

Shipped word study is that tap/hold lexicon plus occurrence lists from the same per-translation tagging; totals reflect how each English edition tags the original, not a Greek/Hebrew running text. Full original-language text and Lexicon Mode morphology were announced as in the works (11 Jun 2026) and were not added in 4.4.9. Keys are Strong’s/tag IDs inside a verse. [S2]

Parallel or interlinear panes are not documented as shipped through 4.4.9. The app instead ships five switchable word-for-word editions—NASB 1995, LSB, ESV, NKJV, KJV—and the June 2026 compare promise (side-by-side translations, and Greek/Hebrew against English) is future tense. [S3]

Notes attach within verses, show a visual marker when the same passage is opened in another of the five translations, and offer free online backup and sync. That attachment is a proprietary Protestant verse identity across versions, not a volume + file-hash + quote locator. [S4]

The reading surface is a customizable English page: typography and spacing, verse-by-verse versus continuous formatting, Bitter plus justified text, dark mode and color themes, official footnotes and linked cross-references. Returning from a cross-reference keeps the original verse selected with its popup restored. Layout toggles still operate on chapter/verse structure. [S5]

The public durable address is `https://app.literalword.com/[translation/]<book>/<chapter>[/<verse>]` with book numbers 1–66, optional slug `nasb|lsb|esv|nkjv|kjv`, a single verse or a whole chapter, and no ranges, file hash, CFI, or quote selector. [S6]

### Kindle: title-bound overlays and in-book AI

X-Ray is an in-book index of all passages that mention characters, places, topics, and terms, plus timeline clips and images, shown only when the Kindle Store listing says “X-Ray Enabled.” The overlay is catalog/title-bound, not identified by volume + file hash. [S7]

Word Wise overlays short, simple definitions above difficult words on English titles flagged “Word Wise: Enabled” on the product detail page—not a sidecar any EPUB with a durable citation can carry. [S8]

Vocabulary Builder auto-adds dictionary lookups, shows each word’s definition plus a usage example quoted from the book, groups the list by Kindle library book, and offers flashcards. The example is a quote; official grouping is that library book, not a documented file-hash citation. [S9]

Smart Lookup is the in-page selection card stack: full dictionary, Wikipedia, and Bing Translate, plus X-Ray and Word Wise when that title has those store overlays. Dictionary, Wikipedia, and translate hang off the selected word; X-Ray and Word Wise are title-gated. [S10]

Ask this Book is in-book Q&A from a highlighted passage using the current reading position, or optionally the full book, on purchased or borrowed US Kindle iOS English titles. The public description does not attach it to a volume + file-hash + locator + quote envelope. [S18]

Story So Far is a spoiler-free recap of the current book up to where the reader stopped, opened from the library or in-book menu and keyed to Kindle progress rather than a durable locator. [S19]

Recaps is a series-level “Previously on…” refresher for books already read, opened from a Kindle series grouping on devices, iOS, Amazon.com, and web (as of 2 Jul 2026), not from a file-hash + locator citation. [S20]

### Open readers: CFI payloads versus whole-book modes

Thorium (v3.1.0 Feb 2025; v3.2.1 Aug 2025) exports and imports annotations as W3C Web Annotation JSON with EPUB CFI and Apache Annotator DOM-range selectors, plus a hover text excerpt. That payload can hang off locator + quote; the release notes do not document a volume id or EPUB file hash. [S13]

Foliate 3.0 (GTK4 rewrite still current in 2026) added Copy Identifier (EPUB CFI of the selected fragment) and Copy with Citation (copied text plus author and title). CFI + selected quote can hang off locator + quote; the documented copy has no file hash or volume id. [S15]

KOReader’s Book Map is a bird’s-eye of the current book—read pages, time-on-page, bookmarks, highlights, notes—with tap-to-jump. It can display locator-backed marks but is itself a whole-book view, not a volume + file-hash + locator + quote citation. [S12]

Readest Parallel Read puts two books or documents in a split-screen with synchronized scrolling. It addresses two publications, so it cannot hang off a single-volume durable citation. [S14]

Kobo Stylus handwriting writes on the page (margins, circling) for EPUB, Kobo EPUB, and non-protected PDF on Sage, Elipsa, and Libra Colour. Notes are device-local (lost on sign-out; not synced to the Kobo Books app or other eReaders), ePub notes cannot be exported, and changing font size can hide ink until layout is reverted—layout ink, not a durable text citation. [S11]

Moon+ Reader Pro still advertises Name replacement | Role reversal (Play listing updated 21 Jul 2026, v10.7). Because that substitutes displayed strings, a quote-based citation of the source bytes would no longer match the on-screen text. [S16]

Librera’s Musician’s mode is hands-free auto-scroll with on-the-fly speed, tap zones for next/previous page, and rewind to the start—a document-level scroll policy that cannot hang off a passage citation. [S17]

### Other in-book AI

Readwise Reader Ghostreader chats with the current file (content, metadata, reading position) and runs prompts on a text selection (`{{ selection }}`, sentence, progress, highlights). Public prompt variables and the Reader API hang off Reader document IDs plus copied quote text, not a volume + file-hash + publication locator. [S21]

Global Ghostreader is library-wide chat that answers with per-passage citations: hover previews a line, click jumps to that spot in the source Reader document—an in-product document link, not a portable volume + SHA-256 + locator + quote envelope. The v2 export API identifies books by `user_book_id` / `book_id` (optional ASIN) and highlights by integer id, text, and `location_type`. [S22]

Google Play Books Book insights is an in-reader Gemini companion: Catch me up recaps and Ask Play Books Q&A limited to text up to the current position, on eligible catalog titles with a Tools badge (Play ids such as `YBwZEAAAQBAJ`; expanded 2 Sep 2026 to 1M+ English ebooks and iOS). Related Expert Intelligence adds owned Play Books into Gemini Notebook with in-line citations, requires Play ownership, and excludes user-uploaded library files. [S23]

## Sources
- [S1] "Literal Word: Bible & Lexicon App - App Store" — "https://apps.apple.com/us/app/literal-word-bible-lexicon/id1439010388" (independently checked against "Literal Word: Bible & Lexicon App / Deep Links / @Literal_Word lexicon reply" — "https://apps.apple.com/us/app/literal-word-bible-lexicon/id1439010388")
- [S2] "Literal Word on X: morphology and original-language texts in the works" — "https://x.com/Literal_Word/status/2065108194104631754" (independently checked against "Literal Word Play Store listing; @Literal_Word 2026-06-11 and 2026-06-19; App Store 4.4.3/4.4.9 notes" — "https://x.com/Literal_Word/status/2065108194104631754")
- [S3] "Literal Word on X: future side-by-side translation and original-language compare" — "https://x.com/Literal_Word/status/2068098613260210573" (independently checked against "Literal Word App Store 4.4.9 / Google Play listing / @Literal_Word" — "https://x.com/Literal_Word/status/2068098613260210573")
- [S4] "Literal Word: Bible & Lexicon App - App Store (listing and 4.1.0 notes)" — "https://apps.apple.com/us/app/literal-word-bible-lexicon/id1439010388" (independently checked against "Literal Word App Store listing and 4.1.0 notes; Deep Links; @Literal_Word Data Sync" — "https://apps.apple.com/us/app/literal-word-bible-lexicon/id1439010388")
- [S5] "Literal Word: Bible & Lexicon App - App Store version history" — "https://apps.apple.com/us/app/literal-word-bible-lexicon/id1439010388" (independently checked against "Literal Word App Store version history" — "https://apps.apple.com/us/app/literal-word-bible-lexicon/id1439010388")
- [S6] "Literal Word Deep Links" — "https://app.literalword.com/deep-links"
- [S7] "X-Ray for Authors (KDP) and Kindle User’s Guide, Features > X-Ray" — "https://kdp.amazon.com/en_US/help/topic/G202187240"
- [S8] "What is Word Wise? — Amazon Customer Service" — "https://www.amazon.com/gp/help/customer/display.html?nodeId=201645250" (independently checked against "What is Word Wise? — Amazon Customer Service; Kindle User’s Guide, Word Wise" — "https://www.amazon.com/gp/help/customer/display.html?nodeId=201645250")
- [S9] "Kindle User’s Guide, Features > Vocabulary Builder" — "https://d1ergij2b6wmg5.cloudfront.net/kug/kindle_10th/v1/en-US/html/kug.html"
- [S10] "Kindle User’s Guide, Interacting with your content / Smart Lookup" — "https://d1ergij2b6wmg5.cloudfront.net/kug/kindle_10th/v1/en-US/html/kug.html"
- [S11] "Write notes in your book with Kobo Stylus — Rakuten Kobo Help" — "https://help.kobo.com/hc/en-us/articles/1500001927562-Write-notes-in-your-book-with-your-Kobo-Stylus" (independently checked against "Write notes in your book with your Kobo Stylus — Rakuten Kobo Help" — "https://help.kobo.com/hc/en-us/articles/1500001927562-Write-notes-in-your-book-with-your-Kobo-Stylus")
- [S12] "KOReader User Guide" — "https://koreader.rocks/user_guide/"
- [S13] "Thorium Reader v3.2.1 / v3.1.0 release notes" — "https://github.com/edrlab/thorium-reader/releases/tag/v3.2.1" (independently checked against "Thorium Reader v3.2.1 and v3.1.0 release notes" — "https://github.com/edrlab/thorium-reader/releases/tag/v3.2.1")
- [S14] "readest/readest README.md" — "https://github.com/readest/readest/blob/main/README.md" (independently checked against "readest/readest README.md and readest.com Parallel Read" — "https://github.com/readest/readest/blob/main/README.md")
- [S15] "Foliate 3.0.0 release notes" — "https://github.com/johnfactotum/foliate/releases/tag/3.0.0" (independently checked against "Foliate 3.0.0 release notes; gtk4 README; foliate-js EPUB CFI" — "https://github.com/johnfactotum/foliate/releases/tag/3.0.0")
- [S16] "Moon+ Reader Pro — Google Play" — "https://play.google.com/store/apps/details?id=com.flyersoft.moonreaderp&hl=en_US"
- [S17] "Librera FAQ: Reading Modes: Scroll, Book, and Musician’s" — "https://librera.mobi/faq/reading-mode-vertical-book-musician" (independently checked against "Librera FAQ: Reading Modes; LibreraReader docs/index.md and README version table" — "https://librera.mobi/faq/reading-mode-vertical-book-musician")
- [S18] [S19] [S20] "How Kindle helps you stay immersed in every book you read" — "https://www.aboutamazon.com/news/books-and-authors/kindle-recaps-feature-ebook-series-refreshers"
- [S21] "Chat with your documents / Ghostreader References / Reader API" — "https://docs.readwise.io/reader/guides/ghostreader/chat" (independently checked against "Chat with your documents; Ghostreader References; Reader API" — "https://docs.readwise.io/reader/guides/ghostreader/chat")
- [S22] "Global Ghostreader / Readwise API" — "https://docs.readwise.io/reader/guides/ghostreader/global" (independently checked against "Global Ghostreader / Readwise API v2 export" — "https://docs.readwise.io/reader/guides/ghostreader/global")
- [S23] "3 ways Book insights helps you get more from your reading" — "https://blog.google/products-and-platforms/platforms/google-play/book-insights/" (independently checked against "3 ways Book insights helps you get more from your reading; Book insights iOS/1M expansion; Expert Intelligence Play Help" — "https://blog.google/products-and-platforms/platforms/google-play/book-insights/")

## Coverage and uncertainty
- "Question 1 uncertainty: literalword.com/mobile and literalword.com/nasb/about/lw returned a Vercel security checkpoint, so first-party marketing pages were not inspectable; App Store, Play Store, deep-link docs, and @Literal_Word posts were used instead."
- "Question 1 uncertainty: Side-by-side parallel (English-to-English and Greek/Hebrew-to-English) was promised in future tense on 2026-06-19; App Store 4.4.9 (2026-08-10) does not list it, but a later unlisted ship cannot be ruled out from store copy alone."
- "Question 1 uncertainty: Whether user notes can attach to a specific word versus only the containing verse is not specified in official feature lists (one App Store review claims notes on “specific words”)."
- "Question 1 uncertainty: Full original-language Bible text and morphological parsing in Lexicon Mode were announced as in the works (2026-06-11); no inspected store changelog through 4.4.9 records them as shipped."
- "Question 1 uncertainty: No inspected source describes an internal annotation model using volume identifiers, file hashes, or quote locators; absence of those fields in public APIs is not proof they do not exist privately."
- "Question 2 uncertainty: No inspected 2026 primary source documents whether X-Ray mention lists or Vocabulary Builder usage rows store Kindle location numbers, CFI, or a file hash; only store enablement (“X-Ray Enabled”) and “by book” grouping are stated."
- "Question 2 uncertainty: Kobo “My Words” (save dictionary lookups for later review) appears in 2021 firmware notes and later unofficial tutorials; no current official Kobo Help article for it was retrieved, so it is not claimed as a 2026 shipping feature."
- "Question 2 uncertainty: Apple Books Line Guide (dim all but the current line) and Study Cards (highlights/notes/glossary as quiz cards in some interactive books) are documented in-book features but were omitted to stay within six claims; Line Guide is a viewport aid, not a citation."
- "Question 2 uncertainty: Kindle Recaps / Story So Far and Ask this Book (spoiler-bounded AI on purchased/borrowed US English titles, iOS-first as of the July 2026 About Amazon update) are additional 2025–2026 Kindle in-book features beyond the four named overlays; they are gated to Amazon account + supported catalog titles, not a file-hash citation."
- "Question 2 uncertainty: Kobo dictionary lookup is documented but may not work in PDFs, OverDrive/library books, or sideloaded free books; that is a generic dictionary, not a first-in-class overlay, and OverDrive/Pocket were treated as acquisition, not in-book features."
- "Question 3 uncertainty: None of the six vendors was shown to be the exclusive owner of these capabilities; claims report distinctive documented features, not a completed pairwise uniqueness matrix."
- "Question 3 uncertainty: A Haddon-style durable citation is volumeId + SHA-256 sourceRevision + PublicationLocatorV1 + quote (docs/design/citation-envelope.md). None of these apps documents that full tuple; CFI/W3C selectors cover locator+quote only."
- "Question 3 uncertainty: Moon+ Play text names “Name replacement | Role reversal” but does not specify display-time vs in-file rewrite; quote-breakage follows only if the on-screen string changes."
- "Question 3 uncertainty: Foliate gtk4 README no longer lists Copy Identifier; the claim relies on the 3.0.0 changelog remaining in the gtk4 line, not a 2026 re-verification of the menu."
- "Question 3 uncertainty: Readest README says split-screen; readest.com adds “synchronized scrolling and navigation,” which was not confirmed in code."
- "Question 3 uncertainty: Other distinctive 2026 features were not claimed here for space: KOReader K2pdfopt PDF reflow and vocabulary-builder SRS; Thorium DAISY + TTS-instead-of-Media-Overlays; Readest local EPUB↔MP3/M4B read-along pairing; Librera RSVP and TTS-to-MP3."
- "Question 4 uncertainty: Amazon, Readwise, and Google do not publish whether internals use CFI-like locators or content hashes; public identity is Kindle library entitlement + reading position, Reader document/highlight IDs + quote text, or Play Books catalog id + ownership."
- "Question 4 uncertainty: As of Amazon’s 2026-07-02 page, Ask this Book was still iOS-only with device/Android expansion “later this year”; this investigation did not inspect a later Amazon confirmation of that hardware rollout."
- "Question 4 uncertainty: Kobo’s author FAQ describes a future Kobo App recap limited to the last reading session (~150 words, including the reader’s highlights) as “we will be developing,” not as a shipped feature (https://kobowritinglife.zendesk.com/hc/en-us/articles/37446931721883-FAQ)."
- "Question 4 uncertainty: No inspected Apple Books, Literal Word, or other first-party reader page documented an in-book generative Q&A/recap comparable to Kindle/Readwise/Play Books; Literal Word’s public feature list is lexicon/search/notes, not AI."
- "Question 4 uncertainty: Haddon’s own citation join (`volumeId` + SHA-256 `sourceRevision` + `PublicationLocatorV1` + quote) is specified in docs/design/citation-envelope.md; ROADMAP still lists Ask AI as replacing a placeholder, so it is not a shipped competitor feature."
- "Claim claim-10 was excluded by verification: Apple documents fixed-layout Read Aloud with in-file EPUB Media Overlays (SMIL and HTML text IDs), but does not document a volume + file-hash identity or that the feature is independent of an Apple Books store ID.."
