# First-in-class reader features (Literal Word and peers)

**Date:** 2026-09-18  
**Issue:** [#28](https://github.com/andrew310/haddon/issues/28)  
**Status:** Product research. Engine contracts in `2026-08-13-e-reader-north-star.md` and the citation envelope in `docs/design/citation-envelope.md` still stand.  
**Host:** `apps/web` (TanStack Start). Not Remix.

Haddon is a normalized, citation-addressable EPUB reading engine. The join is a durable citation: `volumeId` + `sourceRevision` (SHA-256 of EPUB bytes) + `PublicationLocator` + quote. Layout can change. The citation cannot.

This brief steals *unique* mechanics from Literal Word and other serious readers. Generic highlights, search, fonts, and “ask the model about a selection” are already in flight. They are not proposed again.

## What this does not re-propose

Already specified or filed:

| Work | Where |
| --- | --- |
| Typography (font, size, spacing, theme) | GitHub [#24](https://github.com/andrew310/haddon/issues/24) |
| Ask AI into highlight chatheads | GitHub [#25](https://github.com/andrew310/haddon/issues/25) |
| Locator that survives resize/theme/font | HADDON-032 |
| Selection → locator, decorations, Ask AI placeholder | HADDON-033 |
| Search returning locator-backed hits | HADDON-025 (first cut landed; fuzzy/diacritic remainder queued) |
| localStorage annotations | HADDON-044 first cut |
| Named-entity preload, beat reflow, Kadmos suggest | Product north star, later |

Live reader is `apps/web` embedding `apps/demo/src/SemanticReader.tsx`. Selection already produces a `PublicationLocator` with `text.exact` / prefix / suffix. Word tap, occurrence maps, parallel editions, history, and non-scrollbar progress do not exist.

## Thesis

Literal Word does not feel first-in-class because it is a Bible app. It feels first-in-class because **every word is an address**, **every jump is reversible**, and **study never ejects you from the passage**.

Haddon already has the harder half of that: a citation envelope that can name a span independently of layout. The missing half is treating a *word* and a *structural unit* as first-class citations, then building study, parallel text, and wayfinding on top of those envelopes.

A Bible “verse” is OSIS `John.3.16`. An EPUB without a Bible OSIS still has a verse analog: the smallest stable structural unit plus a quote. A word is a Unicode token range on normalized text. Parallel “versions” are two `sourceRevision`s of the same `volumeId`. None of this requires a Scripture schema.

---

## 1. Literal Word

Primary listings: [literalword.com/mobile](https://literalword.com/mobile) (feature copy also on [App Store](https://apps.apple.com/us/app/literal-word-bible-lexicon/id1439010388) and [Google Play](https://play.google.com/store/apps/details?id=com.literalword.mobile_app&hl=en_US)). Deep links: [app.literalword.com/deep-links](https://app.literalword.com/deep-links).

### Unique (cited)

**Tap-a-word original-language study, in place.** Official copy: “Tap any word to open complete lexicon entries from Abbott-Smith (Greek) and BDB (Hebrew), built right into the text. No extra purchases, no switching apps.” App Store What’s New (4.1.4 / 4.1.5 era): “Improved notes/footnotes/cross reference selection.” A 2025 AU review: “Amazing features too like a lexicon if you hold down on a word.” Play reviews: highlight individual words or an entire verse; tap a word to see the Greek/Hebrew and other verses that use it.

**Word search as a visual distribution, not a list.** Official: “Search is quick and powerful, with a unique visual interface for organizing results with precision. Narrow by book or section at a glance, and see every match in context.” Play reviewer Tyson Biegler (30 Dec 2025): “search for a specific word to see how its distributed in the Bible.”

**Notes and highlights bound to verses, visible across translations.** Official: “Highlight in multiple colors, keep notes within verses.” Changelog 4.1.0: “Added a visual marker for user notes in other bible versions.” Identity is the verse, not the pixels of one translation.

**Study surface vs reader surface.** Play review: “choose between different modes like readers or study or even make your own.” App Store (MRaye92, 20 Jun): can “turn the app into a ‘reader’ without verse numbers, headings, etc.” AU review: “preset views for study or reading.” Formatting is a rendition profile. Verse identity stays.

**Rabbit-trail history that restores the popup.** App Store (Monkeyofspice): “Navigating back to the text you were in before going down a rabbit trail is easy.” What’s New 4.4.9: “Returning from a cross-reference now keeps the original verse selected, with its popup restored.” History is not a URL stack of pages; it is a stack of verse identities plus UI state.

**Cross-references and footnotes as linked study, not navigation away.** Official key features: “Footnotes and linked cross-references.” Three Sixteen Publishing (NASB’s publisher, 7 May 2019) quoted a user: “I really like the ability to see the words in the original languages and to see what other verses contain them.”

**Deep links at verse granularity, with translation as a path prefix.** Documented URL:

```
https://app.literalword.com/<book>/<chapter>[/<verse>]
https://app.literalword.com/<translation>/<book>/<chapter>[/<verse>]
```

John 3:16 is `/43/3/16` or `/nasb/43/3/16`. Verse ranges are not supported. Desktop opens the chapter scrolled to the verse with a brief highlight. Mobile opens the app if installed.

**Five word-for-word translations, switchable; users still want a compare pane.** Translations: NASB95, LSB, ESV, NKJV, KJV. Play review (featured): “I would like a compare button that shows the same selected versus in all of the translations one above the other.” Parallel text is the obvious next step they have not fully shipped; Haddon should not wait for them.

**Distraction contract.** “No ads, no articles, no social media.” Offline. Passage history. Free sync. 4.9 on both stores. This is product taste, not a ticket, but it is why the study tools land: chrome recedes; the word is the UI.

### What is *not* unique

Highlights, bookmarks, dark mode, fonts. Do not copy those as Literal Word inventions.

---

## 2. Mapping “verse” and “word” onto Haddon (no OSIS)

A Bible OSIS id is `Book.Chapter.Verse` (example from the [OSIS tutorial](https://www.crosswire.org/osis/tutor.jsp): `<verse osisID="Jas.1.19">…</verse>`). Word-level markup is an OSIS `<w>` with lemma / morph / Strong’s (`<w lemma="strong:H0853 strong:H03045">knew</w>` per [CrossWire OSIS Bibles](https://wiki.crosswire.org/OSIS_Bibles)). Literal Word’s public address is even thinner: book number 1–66, chapter, optional verse, optional translation slug.

An EPUB has none of that unless a publisher happened to stamp `id`s or `epub:type`. Haddon must not invent a Scripture OSIS. It already has the right envelope.

### Verse analog = structural unit + quote

| Bible | Haddon |
| --- | --- |
| OSIS `John.3.16` | `locator.href` + strongest structural selector (`locations.fragments[]`, then `normalized.blockId`, then quote) |
| Translation (NASB vs ESV) | `volumeId` shared; `sourceRevision` (and optional `editionId`) differs |
| Verse range | `normalized` start/end across one or more block ids, plus `text.exact` |
| Human label “John 3:16” | `label` only. Never identity. |
| Print page | `locations.position` / page-list fragment. Viewport-dependent. Not identity. |

**Resolution order (already in the envelope, applied here):**

1. `volumeId` + `sourceRevision` open the bytes.
2. `locator.href` selects the resource.
3. `locations.fragments` / `normalized` select the structural unit (heading, paragraph, note, element with an id).
4. Offsets select the span inside that unit.
5. `text.exact` + prefix/suffix recover after a harmless normalizer revision (`confidence: recovered`).
6. Ambiguous quote → `confidence: ambiguous` with candidates. Never silently pick nearest.

The “verse” in a novel is often a paragraph. In a textbook it is a numbered theorem. In a poem it is a stanza. Haddon should expose the *smallest addressable normalized block that still has source evidence*, not pretend every book has verses.

### Word analog = token range on normalized text

A word citation is a `CitationEnvelopeV1` whose locator range covers one Unicode word (locale-aware segmentation; Readium already tests this — see test catalog TC-034). `text.exact` is the word. Prefix/suffix are surrounding tokens in the same block.

```json
{
  "schema": "haddon.citation-envelope",
  "version": 1,
  "volumeId": "haddon:local:…",
  "sourceRevision": "a3c5f1e9…",
  "locator": {
    "schema": "haddon.publication-locator",
    "version": 1,
    "href": "text/chapter-1.xhtml",
    "mediaType": "application/xhtml+xml",
    "locations": {
      "fragments": ["citation-target"],
      "normalized": {
        "revision": "haddon-normalizer/1+testdigest",
        "start": { "blockId": "src:text/chapter-1.xhtml#citation-target", "offset": { "value": 66, "unit": "utf16-code-unit" } },
        "end":   { "blockId": "src:text/chapter-1.xhtml#citation-target", "offset": { "value": 70, "unit": "utf16-code-unit" } }
      }
    },
    "text": {
      "exact": "moon",
      "prefix": "the patient ",
      "suffix": " answered in blue"
    }
  },
  "confidence": "exact",
  "label": "moon"
}
```

Tap-a-word in Literal Word is this envelope plus a study pane. Haddon does not need Abbott-Smith. The pane’s first job is **other occurrences of this token in this volume**, each itself an envelope. Ask AI (#25) can attach later; it is not this ticket.

### Parallel versions without a Bible OSIS

Literal Word switches NASB/LSB/ESV/NKJV/KJV on the same verse id. Haddon’s join:

- Same `volumeId` (the work).
- Different `sourceRevision` (the edition bytes).
- Alignment: (1) shared source fragments if the publisher kept ids; (2) quote-match recovery already specified for `confidence: recovered`; (3) optional future `extensions.alignment` table. V1 of parallel pane uses (2).

Selecting a span in edition A produces an envelope. Opening edition B runs resolution against B’s bytes. Exact structural match is a bonus, not a requirement.

### What would make Haddon feel like Literal Word rather than a webview

These three, not fonts, not a chat button:

1. **Every word is a citation.** Tap a word; a study pane opens *on the passage*; the word stays highlighted. Leaving the pane does not lose the place.
2. **Occurrences are a map of the volume**, locator-backed, grouped by spine resource, not a browser-find list.
3. **Jumps are a stack of envelopes.** Follow a hit or a noteref; Back restores the original locator *and* the study popup (Literal Word 4.4.9). Parallel editions, when they ship, share `volumeId` and differ only by `sourceRevision`.

---

## 3. Kindle, Apple Books, Kobo — unique mechanics (not typography)

Typography is [#24](https://github.com/andrew310/haddon/issues/24). Highlights and dictionary lookup are table stakes. Steal the rest.

### Kindle

**X-Ray — “bones of the book.”** Amazon’s feature page and the Kindle User’s Guide: tap a name or place; see every passage that mentions that character, setting, or term; tabs for Notable Clips, People, Terms, Images; timeline of cards; works offline because the book ships a sidecar index. Pocket-lint (8 Oct 2025): four tabs, sort by relevance or alphabet. This is an occurrence index with entity types — the same shape as Literal Word’s word search, with a publisher-supplied glossary. Haddon can ship the *index of occurrences* from normalized text without Amazon’s corpus. Entity typing is later (north-star named-entity preload).

**Page Flip — pin, peek, return.** Amazon (2016) and current how-tos: swipe up; current location is pinned; preview pages/chapters/thumbnails; “Back to loc X”; last few peeked locations marked on the scrubber. TechCrunch: inspired by how people riffle a print book. Fast Company: spatial awareness for non-linear reading. Haddon analog: pin a `PublicationLocator`, browse, restore. Progression on the scrubber is *display*, never identity.

**Vocabulary Builder.** Lookups auto-add to a list; flashcards show **the usage in the book you were reading** plus the definition (Pocket-lint). The unique bit is the citation, not the flashcard UI. Haddon: every lookup is a word-level envelope. A list of those envelopes *is* the vocab builder.

**Word Wise.** Short definitions above difficult words, slider for hint density (Amazon feature page). In-flow glosses. Defer; it needs a lexicon sidecar. Do not confuse with #24 typography.

**Ask this Book (Dec 2025).** [The Verge](https://www.theverge.com/news/844538/kindle-app-ask-this-book-ai-ios): in-book chatbot from highlight or menu; answers limited to pages already read; authors cannot opt out; US iOS, English, thousands of titles. **Do not build a second Ask AI.** The steal for #25 is the **spoiler fence**: the model may only see normalized text whose locators are at or before the current `totalProgression`. Recaps / Story So Far are later.

**Whispersync / Immersion Reading.** Audible help: position sync between ebook and audiobook; Immersion Reading highlights words as the narrator speaks. Unique, but audio pairing is out of scope this month.

### Apple Books

**Pages left in the chapter, not a book-percent fetish.** AppleInsider and iGeeksBlog: top of page shows pages left in the *chapter*; bottom shows page in book. Official Apple Books page: Reading Goals (daily minutes, streaks, books this year). iMore (iOS 12): Finished collection is a chronological timeline. Collections behave like tags (a book in many collections), not folders.

Steal: **chapter remaining** derived from the current locator and the next TOC/heading locator. Goals/streaks are library chrome; not this fortnight. Page-curl animation is decoration.

**Look Up / Translate / Speak on a word.** Study aids on a single-word selection. Same tap-a-word seam as Literal Word, thinner payload.

### Kobo

Official [Kobo eReader Features](https://sg.kobobooks.com/pages/kobo-ereader-features): header/footer/progress show what remains in the **chapter or the full book**; scrubber to preview; return to where you were. eWritable on firmware 4.38: **My Words** (saved words + dictionary definition); reading stats (hours, minutes per session, pages per minute); OverDrive; Pocket (web articles become mini-ebooks). Time-remaining-in-chapter is the useful bit. OverDrive/Pocket/Dropbox are distribution, not Haddon.

---

## 4. Power-user EPUB: KOReader, Thorium, Readest, Foliate

### KOReader

User guide ([koreader.rocks/user_guide](https://koreader.rocks/user_guide/), last update 2025-03-25) and How-To Geek (26 Jul 2026):

**Book map.** Unique. Bird’s-eye of the volume: chapter boundaries, pages already read, time spent per page (from statistics), bookmarks/highlights/notes, previous locations, current page. Tap to jump or open page browser. This is a *rendition* of locators and decorations, not a second identity.

**Skim widget + page browser.** Jump by chapter/bookmark/page; compact vs full; long-press on the page number returns to where you opened the skim. Film-strip of page thumbnails. Combined with book map, this is Kindle Page Flip done honestly for reflow.

**Hidden flows.** Exclude appendix/index/references from page counts. Haddon analog: positions service can omit nonlinear spine items; citations to those items still resolve (W3C-003).

**Statistics with MIN/MAX dwell.** Wiki: only count a page if dwell is between 5s and 90s (defaults). Avoids “I left it open overnight.” Calendar view, streaks, time-to-finish. Progress that is not a scrollbar.

**Go back to previous location.** Explicit menu + gesture. Browser-back for in-book jumps.

**Vocabulary Builder plugin** (How-To Geek): add looked-up words; community Anki export. Same envelope as Kindle vocab.

Do not steal: 200-gesture matrix, SSH server, user patches. Concept-only (GPL).

### Thorium Reader

Docs: [Where am I?](https://thorium.edrlab.org/en/docs/210_reading/212_whereami/), [Moving around](https://thorium.edrlab.org/en/docs/210_reading/211_moving/).

**Where am I is a heading trail, not a percent.** `Shift+Ctrl+K` announces page, chapter n/m, percent of chapter, H1/H2 trail. `Shift+Ctrl+I` focuses that section. `Shift+Ctrl+N` opens TOC focused on the nearest heading. Screen-reader page location is acknowledged as approximate.

**History navigation (2.2+).** Jump back (`Ctrl+Backspace`) and forward after TOC, landmarks, bookmarks, go-to-page, timeline, in-pub links. “Find a precedent place and return to the last place.”

**Landmarks and reference pages.** Navigate by EPUB landmarks (cover, start of content, notes) and print page-list. TTS: current sentence highlighted, spoken word underlined; skippability hides footnotes/asides.

**Annotation import/export** with tags, colors, draw types, margin marks. W3C-shaped. Haddon’s envelope is the storage; Thorium is the interaction catalog.

### Readest

[readest.com](https://readest.com/), [Reading docs](https://readest.com/docs/reading), README.

**Parallel Read.** Two (docs say up to four) documents side by side, synchronized scrolling/navigation. Marketed for translations and study. This is the compare pane Literal Word users ask for.

**Highlight every occurrence.** Toggle on an existing highlight fans the same color to every phrase match; live, persists, syncs. Occurrence map as a decoration.

**Nearby-words search.** Two or more words within 5/10/20/50 words. Stronger than substring find; maps onto locator-backed hits.

**Chapter remaining + time-to-finish + reference pages** in the footer. Auto-scroll teleprompter. Footnote popup that does not lose place (and is itself selectable). Deep links with **preview mode** so a recipient sees the passage without overwriting their own locator.

**KOReader sync, Readwise/Hardcover export, Moon+ `.mrexpt` import.** Interop, not identity.

**AI:** TTS (Edge neural voices, language switch mid-book); planned summarization; DeepWiki describes a “Reedy” notebook RAG. Do not duplicate #25. Steal position-aware context if Ask AI grows.

### Foliate

[README](https://github.com/johnfactotum/foliate/blob/master/README.md), OMG Ubuntu (3.0), website:

**Copy with citation / copy CFI.** Copy text plus author and title, or copy the CFI identifier. Haddon should copy a citation envelope (or a human label + deep link), not a CFI.

**Popup footnotes.** Open notes without leaving the spine resource. We have a source-drawer first cut; make it locator-backed and history-aware.

**Navigation history** and progress slider with chapter marks. TTS via Speech Dispatcher with word highlighting and SSML. JSON-per-book annotations using CFI — Foliate’s identity is weaker than Haddon’s; do not adopt CFI as canonical.

---

## 5. Moon+ / Librera — gestures, stats, TTS

### Moon+ Reader

[Play listing](https://play.google.com/store/apps/details?id=com.flyersoft.moonreader&hl=en) / Pro listing:

**24 customizable operations** (tap zones, swipes, hardware keys) mapped onto 15 events. Volume keys, camera key, back key as pagers.

**Five auto-scroll modes**, including **rolling blind** (teleprompter that covers read text). Real-time speed.

**Shake to speak (TTS).** Headset/Bluetooth keys. Name replacement / role reversal (Pro). Reading statistics (Pro). Brightness by sliding the left edge.

**v10.3 focused-reading tools:** highlight first word of sentence, first char of word, or initial part of word — RSVP-adjacent, unique among mainstream readers.

Steal later: one or two tap zones, left-edge brightness, rolling-blind as an accessibility mode. Not this fortnight. Do not import the 24-gesture matrix.

### Librera

[Play listing](https://play.google.com/store/apps/details?id=com.foobnix.pdf.reader&hl=en_US), [GitHub README/docs](https://github.com/foobnix/LibreraReader):

**Musician’s mode:** auto-scroll sheets at a set speed, jump prev/next sheet, return to first sheet. **RSVP (Spritz-style)** speed reading. TTS with media session / lock screen / headset, paragraph follow-along, page-wise record to MP3/WAV. Configurable tap zones. Custom CSS. Vertical-scroll lock.

Steal later: TTS that follows a locator (sentence/word range) if we do read-aloud. Musician’s mode and RSVP are out of scope.

---

## 6. AI inside the book (besides us)

Do not file a second Ask AI ticket. Record what others uniquely did so #25 can steal the *fence*, not the chat.

| App | Unique mechanic | Citation | Haddon take |
| --- | --- | --- | --- |
| Kindle Ask this Book | Answers limited to pages already read; highlight or menu; authors cannot opt out | [The Verge, 15 Dec 2025](https://www.theverge.com/news/844538/kindle-app-ask-this-book-ai-ios) | Spoiler fence = model context is normalized text at/before current locator. Belongs in #25, not a new ticket. |
| Kindle Recaps / Story So Far | Series refresher; summary up to current place | Same Amazon rollout | Later. Needs a locator-bounded summary, not a bookstore recap. |
| Readwise Ghostreader | Select 1–3 words → Quick Lookup with no prompt; chat is position-aware; Global Ghostreader answers **with citations that link to sources** | [Readwise docs](https://docs.readwise.io/reader/guides/ghostreader/overview) | Word tap → study pane. Library RAG is north-star later. Citations in answers must be Haddon envelopes. |
| Readest | Parallel translation pane; planned AI summarization; notebook “Reedy” RAG (third-party writeups) | [readest.com](https://readest.com/), README planned features | Parallel pane is HADDON-065. Summarization later, locator-bounded. |

Authors-Guild-shaped risk: Amazon shipped Ask this Book with no publisher opt-out and non-copyable answers. Haddon’s answers should remain user-owned notes on a citation, as #25 already sketches.

---

## 7. Mapping table (feature → envelope)

| Feature | Persist | Do not persist as identity |
| --- | --- | --- |
| Word tap | Envelope: normalized offsets + `text.exact` = token | DOM node, clientX/Y |
| Verse/block | Envelope: href + fragment/blockId + quote | Page number, column |
| Parallel edition | Same `volumeId`, different `sourceRevision`; alignment via quote recovery | “Left pane vs right pane” |
| Occurrence map | Array of envelopes (or locators) for this `volumeId`+`sourceRevision` | Pixel heatmap |
| Highlight / note / vocab item | Envelope + host payload (color, note body) | Rendition span |
| History stack | Ordered locators + optional UI mode (`study` / `peek`) | Browser history of `/books/:id` |
| Peek pin | One locator | Thumbnail bitmap |
| Where-am-I | Current locator; derive heading trail and chapter remaining | Footer string |
| Book map marks | Decorations already keyed by locator | Canvas y-coordinate |
| Ask AI / Ghostreader | Note on an envelope; model context clipped by current locator | Chat transcript as location |

`extensions` may hold `uiMode`, `parallelPeerRevision`, or `tokenIndex` later. V1 tickets must not require an envelope version bump. If a field is needed on the locator itself, it is a new ticket and a schema discussion, not a silent add.

---

## 8. Follow-up tickets (next two weeks)

Thin vertical slices. Ordered. Each ships in `apps/web` on the existing `SemanticReader` + citation envelope. No Remix. No vendor subtrees. No typography. No Ask AI.

### Week 1 — word identity and rabbit trails

#### HADDON-060 — Word-level citation from tap

**Slice:** A single-word tap (or a collapsed click on a token) produces a `CitationEnvelopeV1` whose range is that token, and the selection chip gains a **Study** action that opens a stub pane on the passage.

**Why:** Literal Word’s entire study surface starts here. Without word identity, occurrence maps and parallel text have nothing to join.

**Depends on:** HADDON-033 selection locators, `citationFromDomSelection`.

**Acceptance:**

- Using `Intl.Segmenter` (or equivalent documented Unicode policy), a click inside “moon” in the HADDON-010 fixture selects that token, not the whole paragraph.
- The envelope’s `locator.text.exact` is the token; `normalized` start/end cover only that token; prefix/suffix are surrounding context in the block.
- Font/size change (when #24 lands, or a test that mutates CSS) does not change the serialized locator.
- Remount restores a decoration on that word from the envelope.
- Existing phrase-selection → highlight / Ask AI still works. Study is additive.
- Tests: token at block start/end, hyphenated word, CJK cluster, emoji; collapsed click vs drag-select.

#### HADDON-061 — Study pane: occurrences of this word

**Slice:** The Study pane lists every locator-backed hit for the token in this volume, with a spine distribution strip (hits plotted by resource / `totalProgression`).

**Why:** Literal Word’s visual search. Kindle X-Ray without Amazon’s entity file. Readest “highlight every occurrence” as a view, not a mutation.

**Depends on:** HADDON-060, HADDON-025 search.

**Acceptance:**

- Opening Study on “moon” in the citation fixture shows each occurrence as a jumpable envelope (snippet + href + quote).
- A one-row distribution strip shows which spine resources contain hits. Empty resources are visible as gaps.
- Clicking a hit navigates and decorates that occurrence; the original word remains in a history stack (HADDON-062 may land same week or stub a single-level Back).
- Hits use the same Unicode policy as 060. Case folding is explicit; default is case-insensitive with original casing shown.
- No network. No lexicon. Pane copy may say “N occurrences in this book.”

#### HADDON-062 — Passage history stack

**Slice:** In-book jumps (study hit, noteref/source-drawer, TOC, search result, citation link) push the previous `PublicationLocator` plus UI mode. Back restores locator *and* the study/source popup.

**Why:** Literal Word 4.4.9 (“original verse selected, with its popup restored”). Thorium jump back/forward. App Store “rabbit trail.” Kindle Page Flip’s pinned location is the peek variant (064).

**Depends on:** HADDON-032 current locator, existing source drawer.

**Acceptance:**

- Jump from a study hit to another occurrence; Back returns to the original token with the study pane open.
- Follow a noteref into the source drawer; Back closes the drawer and restores the noteref’s locator.
- TOC/search jumps push; ordinary page scroll / pagination does **not** push (avoids a 10,000-entry stack).
- Forward exists if Back was used.
- History holds locators, not DOM nodes. Remount of the spine resource still restores.

### Week 2 — wayfinding and parallel text

#### HADDON-063 — Where-am-I that is not a scrollbar

**Slice:** A compact place chip: heading trail (nearest h1/h2 from the current locator) + remaining in this chapter (blocks or positions until the next TOC entry). A control announces the same string (Thorium `Shift+Ctrl+K` analog).

**Why:** Thorium Where am I. Apple “pages left in this chapter.” Kobo chapter remaining. Readest footer. Progress as *structure*, not a percent bar pretending to be identity.

**Depends on:** HADDON-032, TOC already in the demo.

**Acceptance:**

- Chip shows e.g. `Chapter 1 · Moon quote · ~3 min left` or `n blocks left` if no timing yet. No page numbers in the envelope.
- Font/resize updates remaining; the heading trail still matches the locator’s block.
- TOC highlight tracks the same heading (Thorium’s “current chapter in the TOC”).
- Optional: copy place as a citation envelope (Foliate “copy identifier”).
- Scrollbar may remain as a secondary control. It is not the place UI.

#### HADDON-064 — Peek navigation (Page Flip analog)

**Slice:** A Peek control pins the current locator, lets the user scrub/TOC-browse without committing, and offers **Back to [label]**. Committing the preview replaces the pin; cancelling restores it.

**Why:** Kindle Page Flip. KOReader skim widget long-press “return to where you opened this.” Kobo “preview pages and return.”

**Depends on:** HADDON-062 (pin is a history entry with `uiMode: peek`), HADDON-063 label.

**Acceptance:**

- Pin at the HADDON-010 moon quote; peek to chapter 2; cancel returns to the quote with its decoration.
- Commit navigates for real and clears peek.
- Peek does not write “last href” as the committed session locator until commit (session restore after reload is the pin, not the preview).
- No thumbnail grid required this slice. A live preview of the target resource is enough.

#### HADDON-065 — Parallel edition pane (quote-aligned)

**Slice:** Open two publications that share a `volumeId` and differ by `sourceRevision`. Selecting a span in A resolves in B via quote-match recovery and scrolls B to that envelope. Confidence is visible.

**Why:** Literal Word’s missing compare button (Play review). Readest Parallel Read. This is the product shape the north star called “the join,” made visible.

**Depends on:** HADDON-040/041 envelopes, existing recovery, HADDON-060 for word-sized selects.

**Acceptance:**

- Project-owned fixture pair: two tiny EPUBs, same work, overlapping quote “the patient moon answered in blue,” at least one structural id that *does not* match (forces quote recovery).
- Select the quote in A; B lands on the matching quote; both envelopes share `volumeId`, differ in `sourceRevision`.
- If the quote is duplicated in B, show `ambiguous` and let the user pick a candidate (do not silently pick).
- Sync is selection-driven this slice, not continuous scroll-sync (Readest’s sync scroll can wait).
- Host is `apps/web`. Two `PublicationSession`s. No Remix.

#### HADDON-066 — Book map of decorations

**Slice:** A one-screen spine map: chapter ticks, current locator, highlights, Ask AI notes. Tap a mark to jump (pushes history).

**Why:** KOReader book map. Kindle Page Flip’s “bird’s-eye including your highlights.” X-Ray Images tab for figures can wait.

**Depends on:** HADDON-033 decorations, HADDON-062, HADDON-063 chapter ticks.

**Acceptance:**

- Three highlights and one note in the citation fixture appear as distinct marks in the correct chapter bands.
- Current location is a different mark. Tap a highlight jumps and focuses it.
- Changing font does not scramble mark order relative to citation identity (marks are plotted from locators / progression estimates, then re-resolved).
- Unread-vs-read heat (KOReader time-per-page) is **not** required this slice.

### Suggested order inside the fortnight

```text
060 word tap
  ├─ 061 occurrence study pane
  └─ 062 history stack (can start in parallel once 060 emits envelopes)
       ├─ 063 where-am-I
       ├─ 064 peek (uses 062 + 063)
       ├─ 065 parallel pane (uses 060 + recovery)
       └─ 066 book map (uses 062 + 063 + decorations)
```

Ship 060–062 even if 065 slips. Parallel text without word identity is a split webview.

---

## 9. Non-goals this month

- Vendor Readium/Thorium/KOReader/Foliate trees onto `main` or cloud-agent starting refs (`repos/` stays a local research library).
- Remix 3 adapter (HADDON-042). Host is TanStack Start.
- Beating Kindle at bookstore, recommendations, or Whispersync.
- Typography (#24) and Ask AI (#25), except the spoiler-fence note above for #25.
- A Bible OSIS/USX engine, Strong’s, or shipping Abbott-Smith/BDB.
- Publisher X-Ray sidecar / named-entity preload (north star, later).
- TTS, Immersion Reading, Moon+ shake-to-speak, Librera musician mode / RSVP.
- KOReader 200-gesture matrix, SSH, user patches.
- Postgres annotations (HADDON-044 remainder) and library RAG.
- Beat reflow, Kadmos citation-while-typing.
- Goals, streaks, awards, OverDrive, Pocket, Dropbox.
- Envelope v2.

---

## 10. Sources

### Literal Word

- [Literal Word mobile marketing](https://literalword.com/mobile) (feature copy mirrored on store listings)
- [App Store: Literal Word: Bible & Lexicon](https://apps.apple.com/us/app/literal-word-bible-lexicon/id1439010388) — key features, What’s New 4.1.0–4.4.9, reviews (MRaye92; Monkeyofspice; AU “hold down on a word”)
- [Google Play: Literal Word Bible App](https://play.google.com/store/apps/details?id=com.literalword.mobile_app&hl=en_US) — key features, reviews (Tyson Biegler; compare-translations request; reader/study modes)
- [Deep links](https://app.literalword.com/deep-links)
- [Three Sixteen Publishing, 7 May 2019](https://316publishing.com/blogs/blog/literal-words-new-nasb-app-is-a-hit)
- [faith.tools entry](https://faith.tools/app/51-literal-word-bible-app)

### Verse / word identity

- [OSIS tutorial (osisID, verse, reference)](https://www.crosswire.org/osis/tutor.jsp)
- [CrossWire: OSIS Bibles — `<w>` / Strong’s](https://wiki.crosswire.org/OSIS_Bibles)
- [OSIS book abbreviations](https://wiki.crosswire.org/OSIS_Book_Abbreviations)

### Kindle / Apple / Kobo

- [Amazon Kindle Features: Search, X-Ray, lookup, Word Wise](https://www.amazon.com/b?ie=UTF8&node=17717476011)
- Kindle User’s Guide excerpts (X-Ray, Word Wise, Vocabulary Builder, Smart Lookup) via Amazon KUG HTML/PDF mirrors
- [TechCrunch, 28 Jun 2016 — Page Flip](https://techcrunch.com/2016/06/28/amazon-introduces-page-flip-for-kindle/)
- [Fast Company — Page Flip / spatial awareness](https://www.fastcompany.com/3061347/amazons-new-page-flip-feature-makes-kindle-books-more-skimmable/)
- [Android Authority — Page Flip how-to](https://www.androidauthority.com/been-using-kindle-for-13-years-didnt-know-this-3600574/)
- [Pocket-lint — Vocabulary Builder](https://www.pocket-lint.com/how-to-use-kindle-vocabulary-builder/)
- [Pocket-lint — X-Ray](https://www.pocket-lint.com/what-is-kindle-x-ray/)
- [The Verge, 15 Dec 2025 — Ask this Book](https://www.theverge.com/news/844538/kindle-app-ask-this-book-ai-ios)
- [Audible help — Read & Listen / Immersion Reading](https://help.audible.com/s/article/listen-with-whispersync-for-voice?language=en_US)
- [Apple Books](https://www.apple.com/apple-books/) — Reading Goals
- [Apple Support — Read books in Books](https://support.apple.com/guide/iphone/read-books-iphc1af7c57/15.0/ios/15.0)
- [AppleInsider — Books controls / pages left](https://appleinsider.com/inside/ios-18/tips/inside-apple-books----the-best-app-for-book-lovers)
- [iMore — iOS 12 Books, Finished timeline, collections-as-tags](https://www.imore.com/apple-books-whats-new-ios-12)
- [Kobo eReader Features](https://sg.kobobooks.com/pages/kobo-ereader-features)
- [eWritable — Kobo 4.38, My Words, stats, OverDrive, Pocket](https://ewritable.net/brands/kobo/firmware/4-38/)

### KOReader / Thorium / Readest / Foliate

- [KOReader User Guide](https://koreader.rocks/user_guide/) — book map, skim, page browser, hidden flows, statistics, go back
- [KOReader Statistics plugin wiki](https://github.com/koreader/koreader/wiki/Statistics-plugin)
- [How-To Geek — KOReader plugins, stats, vocabulary builder](https://www.howtogeek.com/koreader-hidden-plugins-changed-how-i-read/)
- [Thorium: Where am I?](https://thorium.edrlab.org/en/docs/210_reading/212_whereami/)
- [Thorium: Moving around / history navigation](https://thorium.edrlab.org/en/docs/210_reading/211_moving/)
- [Thorium Reader home](https://thorium.edrlab.org/en/)
- [Readest](https://readest.com/)
- [Readest reading docs](https://readest.com/docs/reading)
- [readest/readest README](https://github.com/readest/readest/blob/main/README.md)
- [Foliate README](https://github.com/johnfactotum/foliate/blob/master/README.md)
- [Foliate website](https://johnfactotum.github.io/foliate/)
- [OMG Ubuntu — Foliate 3.0 copy-with-citation / copy CFI](https://www.omgubuntu.co.uk/2023/11/foliate-ebook-app-major-update)
- [Foliate wiki — annotation JSON / CFI](https://github.com/johnfactotum/foliate/wiki)

### Moon+ / Librera

- [Moon+ Reader on Google Play](https://play.google.com/store/apps/details?id=com.flyersoft.moonreader&hl=en)
- [Moon+ Reader Pro on Google Play](https://play.google.com/store/apps/details?id=com.flyersoft.moonreaderp&hl=en_US)
- [Librera on Google Play](https://play.google.com/store/apps/details?id=com.foobnix.pdf.reader&hl=en_US)
- [foobnix/LibreraReader](https://github.com/foobnix/LibreraReader)

### AI readers

- [Readwise: What is Ghostreader?](https://docs.readwise.io/reader/guides/ghostreader/overview)
- [Readwise: Chat with your documents](https://docs.readwise.io/reader/guides/ghostreader/chat)

### Haddon

- `docs/research/2026-08-13-e-reader-north-star.md`
- `docs/research/2026-08-15-product-north-star.md`
- `docs/design/citation-envelope.md`
- `docs/design/publication-model.md`
- `packages/haddon-citation/citation-envelope.ts`
- GitHub [#24](https://github.com/andrew310/haddon/issues/24), [#25](https://github.com/andrew310/haddon/issues/25), [#28](https://github.com/andrew310/haddon/issues/28)

Reuse posture: everything above is **concept**. KOReader, Foliate, Librera, Calibre are GPL/AGPL — independent reimplementation only. No code candidates in this brief.
