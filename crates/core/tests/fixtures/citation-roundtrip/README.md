# Citation round-trip EPUB fixture

This directory is the project-owned source tree for a deliberately small EPUB 3 fixture. The integration test packages these files in a fixed order with fixed ZIP metadata. It synthesizes the required `mimetype` entry as the first, uncompressed entry so the source tree stays focused on editable publication resources.

## Fixture contract

- `chapter-1.xhtml` and `chapter-2.xhtml` are the only linear spine resources.
- `notes.xhtml` is an auxiliary `linear="no"` spine resource containing one footnote and backlink.
- `nav.xhtml` contains a nested table of contents, landmarks, and a page list.
- Stable element IDs cover chapters, headings, page breaks, the citation target, links, the image, and the note pair.
- The exact quote is `the patient moon answered in blue`, with prefix `Before the signal, the copper astrolabe clicked once; ` and suffix `, and the lesson continued after midnight.`.
- The content includes ordinary cross-document fragment links, emphasis, an inline Greek language change, and an SVG image with alt text.
- `dial.haddon` is an intentionally foreign resource whose manifest fallback is `dial-fallback.svg`.

## Intentional current-model gaps

`parse_epub` can open this fixture and preserve its basic title, author, linear chapter text, emphasis, and footnote text. Its current public model does not expose manifest resources, fallback chains, navigation documents, stable element IDs, links, language changes, images/alt text, page breaks, or source-to-normalized location mappings, so the integration test checks those source contracts directly rather than pretending they survived normalization.

The parser also does not currently inspect the spine's `linear` attribute, so it returns the auxiliary notes resource as a third chapter. The integration test intentionally does not lock in that behavior; it verifies the two ordered linear chapters and the extracted note instead.
