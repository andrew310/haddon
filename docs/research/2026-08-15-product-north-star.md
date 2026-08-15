# Haddon product north star

**Date:** 2026-08-15

**Status:** Product brief. The engine contracts in `2026-08-13-e-reader-north-star.md` still stand.

Haddon is its own product. It predates Klemata. Klemata is one host. Kadmos is the later write-side.

## The product

An e-reader where you work with AI research assistants inside the book.

- As you read, names and references can be preloaded so the passage has context.
- Highlight a span and ask the AI to explain it.
- Optionally reflow the surface by beat instead of paragraph flow.
- Highlights and those conversations become a personal knowledge base as the library grows.

Kadmos (the Word/DOCX engine at `andrew310/docx-engine`) is the write-side of that same knowledge base. Down the line, typing in Word suggests citations from what you have already read, highlighted, and discussed.

## The join

The join is a durable citation, not a shared UI.

A highlight, a chat turn, a suggested Word citation, and a Klemata deep link all point at the same thing: volume identity, source revision, a `PublicationLocator`, and the quote. Layout can change. Beat reflow can change. The citation cannot.

## What this does not change this month

- Week 1 is still HADDON-032: location that survives resize, theme, and font.
- First product slice after that is highlight-and-explain.
- Named-entity preload, library RAG, beat reflow, Klemata embed, and Kadmos citation suggest are later hosts of the same envelope.
- Do not merge Haddon and Kadmos into one repo to start. Share the citation schema when both sides can consume it.

## Load-bearing rule

You may rearrange the reading surface. You may not let that rewrite citation identity. Last month's highlight and its thread have to still resolve.

## Reference trees

`repos/` (Readium, Thorium, Calibre, MuPDF, and the rest) is a local research library, not product. Keep those checkouts on a reference branch or only on disk. Do not subtree them onto `main`, `haddon-m1-slim`, or any cloud-agent starting ref.
