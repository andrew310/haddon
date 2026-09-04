# Haddon Normalization Policy

**Status:** Design specification for HADDON-023

**Date:** 2026-09-04

**Dependencies:** HADDON-022 (semantic HTML normalizer), [normalized-document.md](normalized-document.md)

**Scope:** Normalization profiles, transformation policy, typography versus semantics separation, fixed-layout handling, spatial content fallback

**Out of scope:** Multi-format normalization (PDF, audiobook), navigator rendering preferences, application UI policy

This document defines **what** each normalization profile preserves, constrains, replaces, or refuses. It separates typography cleanup from semantic transformation and establishes explicit fallback policy for fixed-layout and spatial content.

## Decision summary

- **Decision:** Three normalization profiles — default, accessible, source-faithful — share one normalizer algorithm but differ in configuration policy and capability constraints.
- **Decision:** Typography cleanup (whitespace collapsing, Unicode handling, line-break representation) is distinct from semantic transformation (element selection, structural mapping, content omission).
- **Decision:** Fixed-layout and spatial content receive explicit fallback policy rather than silent degradation.
- **Decision:** Every profile documents what it **preserves** (semantic fidelity), **constrains** (limits for correctness), **replaces** (normalized equivalents), and **refuses** (unsupported features).
- **Decision:** Profile selection affects normalization configuration, not algorithmic behavior. All profiles use the same deterministic normalizer with different `NormalizationConfigV1` values.

## 1. Profile taxonomy

```text
                   NormalizationProfile
                            |
              +-------------+-------------+
              |             |             |
          default      accessible   source-faithful
              |             |             |
         reflow +      maximum +      preserve +
         citation      a11y            layout +
         fidelity      semantics       publisher intent
```

### 1.1 Default profile

**Purpose:** Citation-addressable, reflowable semantic reading for the majority of well-formed EPUB publications.

**Preserves:**
- Semantic block structure (sections, headings, paragraphs, lists, tables)
- Semantic inline structure (emphasis, strong, code, sub/sup, links)
- Reading order as declared in spine
- Language and direction
- EPUB structural semantics and ARIA document roles
- Links, note references, and note bodies in their source position
- Media with alt text, captions, and title attributes
- Page breaks as semantic markers

**Constrains:**
- Single reading-order linearization (no parallel columns, sidebars, or spatial layout)
- Reflowable text only (no fixed-layout preservation)
- Semantic whitespace only (HTML collapsible-whitespace rules plus pre/code preservation)

**Replaces:**
- Arbitrary CSS layout with semantic block/inline structure
- Publisher-specific visual styling with semantic roles
- HTML entity references with Unicode characters
- HTML collapsible whitespace sequences with single ASCII space
- Line breaks with U+000A
- Non-textual objects with object replacement character U+FFFC
- Ruby annotations with base-text-only projection

**Refuses:**
- Scripts, styles, and executable content
- Hidden content (HTML `hidden`, `aria-hidden="true"`)
- Fixed-layout rendition
- MathML, SVG content trees (replaced with unsupported nodes in V1)
- CSS-generated content
- Viewport-dependent spatial layout

**Configuration:**
```rust
NormalizationConfigV1 {
    whitespace: "html-and-preserve-pre",
    unicode_normalization: "none",
    hidden_content: "source-semantic",
    unknown_elements: "opaque-with-children",
    unsupported_content: "fallback-or-placeholder",
    ruby_projection: "base-only",
    media_projection: "object-replacement",
    note_bodies: "in-source-position",
    generated_css_content: "exclude",
}
```

### 1.2 Accessible profile

**Purpose:** Maximum semantic richness for screen readers, TTS, Braille, and assistive navigation.

**Preserves:** Everything from default profile, plus:
- Explicit semantic roles for navigation aids
- Table cell headers associations
- Figure/caption relationships
- Definition list structure
- Note disposition (footnote/endnote/sidebar)

**Constrains:**
- Stricter limits on nested structural depth (to prevent assistive tech stack overflow)
- More aggressive unknown-element flattening
- Mandatory alt-text warnings for images without alternatives

**Replaces:**
- Ruby with both base and annotation text in a TTS-friendly projection (future extension)
- Inline media with explicit accessible labels when available

**Refuses:**
- Same as default profile
- Decorative content more aggressively (based on ARIA `role="presentation"` or `role="none"`)

**Configuration:** Same as default with these differences:
```rust
// Future extension when accessible-specific config is needed
ruby_projection: "base-and-annotation-labeled"  // Not yet implemented
media_projection: "alt-text-primary"            // Future
```

**Note:** V1 accessible profile uses the same configuration as default. Differentiation primarily occurs in navigator rendering and TTS projection layers, not normalization.

### 1.3 Source-faithful profile

**Purpose:** Preserve publisher intent and spatial layout where semantic extraction would lose fidelity.

**Preserves:**
- Fixed-layout metadata and viewport sizing
- Spatial positioning hints (when normalized structure can represent them)
- Publisher-provided fallback chains
- More permissive handling of unknown markup

**Constrains:**
- No arbitrary script execution (same as other profiles)
- Still requires canonical reading order

**Replaces:**
- Fewer automatic conversions than default profile
- Preserves more opaque elements

**Refuses:**
- Active scripts and event handlers (security policy)
- Externally hosted resources without explicit opt-in

**Configuration:**
```rust
NormalizationConfigV1 {
    whitespace: "html-and-preserve-pre",
    unicode_normalization: "none",
    hidden_content: "preserve-unless-script",      // More permissive
    unknown_elements: "opaque-with-children",
    unsupported_content: "preserve-with-fallback", // Keep more
    ruby_projection: "structured",                  // Not yet impl
    media_projection: "structured-with-metadata",   // Future
    note_bodies: "in-source-position",
    generated_css_content: "exclude",
}
```

**Note:** V1 does not implement source-faithful fully. This profile is reserved for future fixed-layout and spatial-preservation work.

## 2. Typography versus semantic transformation

The normalizer performs two conceptually distinct operations that must not be conflated.

### 2.1 Typography cleanup (text-level normalization)

**Scope:** How raw source characters become normalized text projection.

**Operations:**
- HTML whitespace collapsing (sequences of U+0009, U+000A, U+000D, U+000C, U+0020 → single U+0020)
- Leading/trailing whitespace removal at block boundaries
- Preservation of non-breaking spaces (U+00A0) and other non-collapsible Unicode spaces
- Preformatted/code text whitespace preservation
- Entity reference decoding (already done by XML/HTML parser)
- Line-ending normalization (already done by parser)

**Does NOT include:**
- Case folding
- Unicode NFC/NFKC normalization
- Smart punctuation replacement
- Hyphenation or soft-hyphen removal
- Ligature expansion
- Diacritic stripping

**Why separated:** Typography cleanup is a reversible, deterministic, local operation on text runs. It affects source-to-normalized offset mapping (whitespace-collapse transform) but not semantic structure. Search may apply additional folding in a separate revisioned projection; citation text remains as cleaned by typography rules only.

**Configuration control:** `whitespace: "html-and-preserve-pre"`

### 2.2 Semantic transformation (structure-level normalization)

**Scope:** How source DOM elements become normalized AST nodes.

**Operations:**
- Element-to-semantic-node mapping (e.g., `<p>` → `TextBlock { role: Paragraph }`)
- Anonymous paragraph generation for mixed inline/block content
- Structural role detection from `epub:type`, `role`, and ARIA attributes
- Link and note-reference identification
- Table structure preservation
- List structure retention
- Section/heading hierarchy extraction

**Does NOT include:**
- CSS layout computation
- Viewport pagination
- Font metrics or line breaking
- Visual reordering of source elements
- Deduplication of repeated content
- Cross-resource content merging

**Why separated:** Semantic transformation creates the addressable AST that citations and locators reference. Changing this layer changes node IDs, block boundaries, and structural relationships. Changes to typography cleanup (within the same semantic structure) affect only text-segment mappings, not node identity.

**Configuration control:** `unknown_elements`, `unsupported_content`, `note_bodies`, `ruby_projection`, `media_projection`

### 2.3 Revision impact

| Change | Affects typography | Affects semantics | Breaks node IDs | Breaks text offsets |
|--------|-------------------|-------------------|-----------------|---------------------|
| Add Unicode NFC folding | Yes | No | No | Yes (in folded blocks) |
| Flatten unknown `<widget>` | No | Yes | Yes (children re-parented) | Maybe (if boundaries shift) |
| Change whitespace collapse rule | Yes | No | No | Yes (mapped ranges change) |
| Recognize new semantic role | No | Yes | No (role is metadata) | No |
| Generate anonymous paragraph | No | Yes | Yes (new synthetic node) | No (if text unchanged) |

## 3. Configuration schema and policy

### 3.1 Configuration fields

```rust
pub struct NormalizationConfigV1 {
    pub whitespace: String,
    pub unicode_normalization: String,
    pub hidden_content: String,
    pub unknown_elements: String,
    pub unsupported_content: String,
    pub ruby_projection: String,
    pub media_projection: String,
    pub note_bodies: String,
    pub generated_css_content: String,
}
```

### 3.2 Field semantics

#### `whitespace`

**Current value:** `"html-and-preserve-pre"`

**Meaning:**
- In ordinary `TextBlock` (paragraph, heading, quote, caption, term, definition): apply HTML collapsible-whitespace rules
  - Sequences of tab, newline, carriage return, form feed, space → single ASCII space
  - Leading/trailing collapsible whitespace at block boundaries is removed
  - Non-breaking space (U+00A0) and other non-collapsible Unicode spaces are preserved
- In `TextBlock { role: Preformatted }` or `TextBlock { role: Code }`: preserve all whitespace exactly as in source DOM after line-ending normalization

**Future alternatives:** `"preserve-all"`, `"aggressive-collapse-unicode"`, `"preserve-soft-hyphens"`

**Profile usage:**
- Default: `"html-and-preserve-pre"`
- Accessible: `"html-and-preserve-pre"`
- Source-faithful: `"html-and-preserve-pre"`

#### `unicode_normalization`

**Current value:** `"none"`

**Meaning:** No Unicode NFC, NFD, NFKC, or NFKD normalization is applied to citation text.

**Rationale:** Unicode normalization is a lossy transformation that can break exact-match citation recovery. Publishers may use precomposed or decomposed characters deliberately. If search or comparison requires normalization, it belongs in a separate search-projection layer with its own revision tracking.

**Future alternatives:** `"nfc"`, `"nfkc"` (only if used for search, not citation)

**Profile usage:** All profiles: `"none"`

#### `hidden_content`

**Current value:** `"source-semantic"`

**Meaning:**
- Exclude elements with HTML `hidden` attribute
- Exclude elements with `aria-hidden="true"`
- Exclude `<script>`, `<style>`, `<template>`, `<noscript>`, `<meta>`, `<link>`, `<title>` elements
- Exclude `<head>` element

Does NOT:
- Run arbitrary CSS to compute `display: none` or `visibility: hidden`
- Exclude content based on visual styling alone

**Future alternatives:**
- `"preserve-unless-script"`: Keep more hidden content, exclude only executable
- `"css-display-aware"`: Parse safe subset of CSS to detect `display: none` (requires CSS revision in stamp)

**Profile usage:**
- Default: `"source-semantic"`
- Accessible: `"source-semantic"`
- Source-faithful: `"preserve-unless-script"` (future)

#### `unknown_elements`

**Current value:** `"opaque-with-children"`

**Meaning:**
- Unknown HTML/XHTML element → `OpaqueBlock` or `OpaqueInline` preserving qualified name, safe attributes, and normalized children
- Safe attributes: `id`, `lang`, `xml:lang`, `dir`, `epub:type`, `role`, `aria-*`, `title`, `class` (declarative metadata only)
- Unsafe attributes excluded: event handlers (`onclick`, etc.), `style`, executable URLs

**Future alternatives:**
- `"flatten-to-children"`: Remove unknown wrapper entirely, keep children
- `"unsupported-with-fallback"`: Treat as `UnsupportedBlock` if user-perceivable

**Profile usage:** All profiles: `"opaque-with-children"`

#### `unsupported_content`

**Current value:** `"fallback-or-placeholder"`

**Meaning:**
- User-perceivable constructs that cannot be normalized semantically (MathML, SVG trees, canvas, embedded objects in V1) become `UnsupportedBlock` or `UnsupportedInline`
- If source provides an accessible fallback (e.g., MathML with `alttext`, `<object>` with fallback content), normalize the fallback into the `fallback` field
- If no fallback exists, generate object replacement character U+FFFC as placeholder
- Emit a normalization warning describing the unsupported feature

**Future alternatives:**
- `"preserve-with-fallback"`: Keep more structure in extensions
- `"omit-with-warning"`: Remove unsupported content entirely, warn
- `"typed-mathml"`, `"typed-svg"`: Dedicated semantic subtree for specific features

**Profile usage:**
- Default: `"fallback-or-placeholder"`
- Accessible: `"fallback-or-placeholder"` (more aggressive warnings)
- Source-faithful: `"preserve-with-fallback"` (future)

#### `ruby_projection`

**Current value:** `"base-only"`

**Meaning:**
- Ruby markup (`<ruby>`, `<rb>`, `<rt>`, `<rtc>`, `<rp>`) is normalized into `InlineNode::Ruby` with `base_text` and `annotations`
- Primary citation text projection includes only `base_text`
- Ruby annotations are excluded from primary text to avoid duplicate reading
- Ruby parentheses (`<rp>`) are excluded entirely from normalized text
- Alternate TTS or accessibility projections may include annotations

**Rationale:** Japanese furigana and similar annotations are clarifications of the base text, not independent prose. Including them in citation offsets would make "東京" and "東京とうきょう" have different text lengths, breaking stable locators.

**Future alternatives:**
- `"base-and-annotation-labeled"`: Separate projection for TTS
- `"structured"`: Keep detailed ruby semantics for specialized renderers

**Profile usage:**
- Default: `"base-only"`
- Accessible: `"base-only"` (future: `"base-and-annotation-labeled"` for TTS)
- Source-faithful: `"structured"` (future)

#### `media_projection`

**Current value:** `"object-replacement"`

**Meaning:**
- Block media (`<img>` in figure or at block level) → `MediaBlock` with no primary text contribution, addressable by node ID
- Inline media (`<img>` within text) → `MediaInline` contributing U+FFFC to primary text
- Alt text, title, and caption are retained in node metadata but do NOT replace primary media citation identity
- Media source hrefs are canonicalized relative to the current resource

**Rationale:** Alt text is accessibility metadata, not citation text. A user selecting an image should get an image locator, not a substring of alt text. Search may index alt text separately.

**Future alternatives:**
- `"alt-text-primary"`: Controversial; would make images un-citable as images
- `"structured-with-metadata"`: More detailed source set and metadata preservation

**Profile usage:**
- Default: `"object-replacement"`
- Accessible: `"object-replacement"` (alt-text still in metadata)
- Source-faithful: `"structured-with-metadata"` (future)

#### `note_bodies`

**Current value:** `"in-source-position"`

**Meaning:**
- Notes (footnotes, endnotes) are normalized in their source position (often `linear="no"` resources)
- Note references (`epub:type="noteref"`, `role="doc-noteref"`) become `InlineNode::NoteReference` with target href
- No automatic note-body inlining or popup generation (navigator policy)
- Note-to-reference relationship is derived, not deduplicated

**Rationale:** Source position preserves publisher intent and reading-order semantics. A note resource may contain multiple notes plus other content. Inlining would create ambiguous node identity and source mappings.

**Future alternatives:**
- `"inline-at-reference"`: Generate synthetic note-body blocks at reference sites (problematic for citations)
- `"omit-if-nonlinear"`: Only normalize notes in reading order (loses content)

**Profile usage:** All profiles: `"in-source-position"`

#### `generated_css_content`

**Current value:** `"exclude"`

**Meaning:**
- CSS `::before` and `::after` pseudo-element content is not part of normalized text
- List item markers (bullets, numbers) are not included in citation text
- Quotation marks, section numbers, or other CSS-generated glyphs do not contribute to normalized offsets

**Rationale:** CSS-generated content is a presentation decision, not source prose. It is not stable across theme changes, stylesheets, or viewport sizes. Citations must reference source document content only.

**Future alternatives:**
- `"include-if-semantic"`: Include generated content marked as semantic (requires CSS parsing and revision tracking)

**Profile usage:** All profiles: `"exclude"`

## 4. Fixed-layout and spatial content fallback policy

### 4.1 Scope and definitions

**Fixed-layout EPUB:** Content declared with `<meta property="rendition:layout">fixed</meta>` or page-level `properties="rendition:layout-pre-paginated"` in the package manifest.

**Spatial content:** Content relying on absolute positioning, CSS grid, CSS transforms, or image maps where semantic reading order is not determinable from DOM order alone.

### 4.2 Current V1 behavior

**Default and accessible profiles:**
- Fixed-layout resources return `NormalizationResult::Unsupported` with a warning
- Fallback resource link is provided if available in manifest (`epub:fallback` property)
- Navigator may render fixed-layout resources via source-faithful DOM or iframe backend

**Source-faithful profile (future):**
- Attempt to extract semantic reading order from fixed-layout when possible
- Preserve viewport metadata, scaling hints, and spread information
- Use `UnsupportedBlock` for regions where reading order is ambiguous
- Emit warnings about citation ambiguity in spatial content

### 4.3 Fallback decision tree

```text
Is resource fixed-layout according to package metadata?
  Yes →
    Does package declare a reflowable fallback resource?
      Yes →
        Return Unsupported { fallback: Some(fallback_link), warnings }
        Navigator may offer user choice: fixed-layout view OR normalized fallback
      No →
        Return Unsupported { fallback: None, warnings }
        Navigator uses source-faithful DOM or iframe rendition
  No →
    Is content spatially positioned (heuristic detection)?
      Yes →
        Attempt semantic extraction with warnings
        Emit "normalization.ambiguous-reading-order" warning for ambiguous regions
      No →
        Normalize normally
```

### 4.4 Explicit non-goals for V1

- ❌ Automatic fixed-layout to reflowable conversion
- ❌ Reading-order inference from CSS absolute positioning
- ❌ Image-map hot-spot extraction
- ❌ Comic book panel order detection
- ❌ Responsive layout breakpoint handling

### 4.5 Future extensions

**Potential future `rendition_layout` config:**
```rust
rendition_layout: "reflowable-only"        // Current V1 default
rendition_layout: "attempt-extraction"     // Future
rendition_layout: "preserve-spatial-hints" // Source-faithful profile
```

**Citation policy for fixed-layout:**
- Structural locators (package spine position, resource href, viewport percentage) work for fixed-layout
- Normalized text locators require reflowable fallback or source-faithful semantic extraction
- Spatial locators (x/y coordinates, viewport percentage) are out of scope for V1

## 5. Capability declarations and profile support

Each profile declares its supported capabilities through the `CapabilityDescriptor` contract (HADDON-014).

### 5.1 Default profile capabilities

```rust
CapabilityDescriptor {
    kind: ServiceKind::Normalization,
    version: "haddon.normalization/1",
    availability: CapabilityAvailability::Available,
    provider: CapabilityProvider::Core,
    scope: CapabilityScope {
        profiles: vec![PublicationProfile::Epub],
        media_types: vec![
            "application/xhtml+xml".to_string(),
            "text/html".to_string(),
        ],
        languages: vec![], // All languages
        features_required: vec![],
    },
    features: vec![
        "xhtml-ast",
        "source-map",
        "deterministic-ids",
        "sections",
        "headings",
        "paragraphs",
        "lists",
        "tables",
        "figures",
        "blockquotes",
        "code-blocks",
        "definition-lists",
        "links",
        "note-references",
        "inline-semantics",
        "ruby",
        "language",
        "direction",
    ],
    limitations: vec![
        CapabilityLimitation {
            code: "haddon.normalization.v1-vocabulary".to_string(),
            message: "MathML, SVG content, embedded objects, and CSS-generated content are not yet normalized".to_string(),
            href: None,
        },
        CapabilityLimitation {
            code: "haddon.normalization.fixed-layout-unsupported".to_string(),
            message: "Fixed-layout resources require source-faithful rendition or fallback".to_string(),
            href: None,
        },
    ],
}
```

### 5.2 Profile-specific limitations

**Accessible profile additional features:** (none in V1; differentiation is in navigator/TTS layer)

**Source-faithful profile additional features:** (reserved for future)
- `"fixed-layout-viewport-metadata"`
- `"spatial-positioning-hints"`
- `"fallback-chain-traversal"`

## 6. Configuration hash and revision tracking

Every configuration change produces a new normalization revision and invalidates cached resources.

### 6.1 Configuration digest algorithm

```rust
fn config_digest(config: &NormalizationConfigV1) -> String {
    let canonical = format!(
        "{{\"config\":{{\"generatedCssContent\":\"{}\",\"hiddenContent\":\"{}\",\"mediaProjection\":\"{}\",\"noteBodies\":\"{}\",\"rubyProjection\":\"{}\",\"unicodeNormalization\":\"{}\",\"unknownElements\":\"{}\",\"unsupportedContent\":\"{}\",\"whitespace\":\"{}\"}},\"configSchema\":\"haddon.normalization-config\",\"configVersion\":1}}",
        config.generated_css_content,
        config.hidden_content,
        config.media_projection,
        config.note_bodies,
        config.ruby_projection,
        config.unicode_normalization,
        config.unknown_elements,
        config.unsupported_content,
        config.whitespace,
    );
    let digest = Sha256::digest(canonical.as_bytes());
    base64url_lower(&digest)
}
```

**Full revision:** `haddon-normalizer/1+<config_digest>`

**Example:** `haddon-normalizer/1+3kqbxjrp4htn6fmvz2u8we9s1ca7ldgy5io0`

### 6.2 Cache key

```text
Normalized resource cache key:
  (source_revision, href, media_type, normalization.revision)

Where:
  source_revision = SHA-256 of publication source bytes
  normalization.revision = haddon-normalizer/<algorithm_rev>+<config_digest>
```

### 6.3 Locator revision validation

A `PublicationLocator` carrying `locations.normalized` is valid only when:
1. `sourceRevision` matches opened publication
2. `normalization.revision` matches current normalization stamp

Mismatched locator → attempt quote-based recovery → report confidence level

## 7. Acceptance criteria

HADDON-023 is complete when:

### 7.1 Documentation completeness

- ✅ Policy document (`docs/design/normalization-policy.md`) defines:
  - Three profiles (default, accessible, source-faithful) with preserve/constrain/replace/refuse for each
  - Typography cleanup separated from semantic transformation with revision-impact table
  - Configuration schema with field semantics and rationale
  - Fixed-layout and spatial content fallback decision tree
  - Capability declarations per profile

### 7.2 Typography/semantics separation

- ✅ Document distinguishes:
  - Text-level operations (whitespace handling, entity decoding, line endings)
  - Structure-level operations (element-to-node mapping, role detection, structural generation)
  - Revision impact of each category

### 7.3 Fixed-layout policy

- ✅ Explicit fallback policy defined:
  - Decision tree for fixed-layout detection
  - Fallback resource handling
  - Unsupported result with warnings
  - Navigator-level rendition alternatives documented

### 7.4 Configuration field documentation

- ✅ Each `NormalizationConfigV1` field documented with:
  - Current value and meaning
  - Rationale for design choice
  - Future alternatives
  - Per-profile usage

### 7.5 No implementation required for V1

- ✅ Document is a **policy specification**, not implementation
  - Accessible and source-faithful profiles are reserved for future work
  - V1 ships with default profile only
  - Configuration hooks exist in code for profile differentiation
  - No new normalizer algorithm is invented

## 8. Relationship to other specifications

| Spec | Relationship |
|------|-------------|
| [normalized-document.md](normalized-document.md) | Defines AST, IDs, source maps, and mapping laws. This document defines what GOES INTO that AST via profiles. |
| [publication-model.md](publication-model.md) | Defines `Publication`, `Manifest`, resources, and locators. Normalization is a service over resources. |
| [services-and-errors.md](services-and-errors.md) | Defines `CapabilityDescriptor` used to declare profile support. |
| [navigator-api.md](navigator-api.md) | Navigator consumes normalized AST or uses source-faithful DOM. Profile affects navigator capability negotiation. |
| ROADMAP.md HADDON-022 | Implemented the semantic HTML normalizer. This document specifies policy over that implementation. |
| ROADMAP.md HADDON-024 | Will implement lazy normalization and caching. Cache uses normalization revision from this document. |
| ROADMAP.md HADDON-036 | Future fixed-layout rendition. Source-faithful profile reserved for this work. |

## 9. Open questions and future work

### For HADDON-024 (lazy normalization and caching)

- Cache eviction policy when multiple normalization revisions exist
- Incremental normalization: can configuration changes allow partial cache reuse?

### For HADDON-036 (fixed-layout rendition)

- Source-faithful profile implementation details
- Reading-order inference heuristics for spatial content
- Citation policy for fixed-layout pages

### For HADDON-053 (accessibility baseline)

- Differentiation between accessible profile normalization vs navigator rendering
- ARIA role mapping beyond EPUB structural semantics
- Accessible MathML or SVG rendering

### For future profile extensions

- User-configurable profile settings (advanced users)
- Application-specific profiles (e.g., Klemata education mode)
- Language-specific typography rules (CJK line breaking, Arabic shaping)

### For future semantic transformations

- Table linearization for non-visual rendering (policy, not algorithm)
- Multi-column layout semantic extraction
- Responsive image source-set handling

## Appendix A: Configuration string vocabulary

### Valid `whitespace` values (V1)
- `"html-and-preserve-pre"` (current default)

### Valid `unicode_normalization` values (V1)
- `"none"` (current default)

### Valid `hidden_content` values (V1)
- `"source-semantic"` (current default)

### Valid `unknown_elements` values (V1)
- `"opaque-with-children"` (current default)

### Valid `unsupported_content` values (V1)
- `"fallback-or-placeholder"` (current default)

### Valid `ruby_projection` values (V1)
- `"base-only"` (current default)

### Valid `media_projection` values (V1)
- `"object-replacement"` (current default)

### Valid `note_bodies` values (V1)
- `"in-source-position"` (current default)

### Valid `generated_css_content` values (V1)
- `"exclude"` (current default)

## Appendix B: Profile comparison table

| Aspect | Default | Accessible | Source-faithful |
|--------|---------|------------|-----------------|
| **Primary goal** | Citation fidelity | A11y semantics | Publisher intent |
| **Layout** | Reflowable only | Reflowable only | Fixed-layout support |
| **Ruby** | Base text only | Base text (future: annotations for TTS) | Structured |
| **Unknown elements** | Opaque | Opaque (flatten more) | Opaque (keep more) |
| **Hidden content** | Source-semantic | Source-semantic | Preserve-unless-script |
| **Fixed-layout** | Unsupported | Unsupported | Attempt extraction |
| **Whitespace** | HTML rules + pre | HTML rules + pre | HTML rules + pre |
| **MathML (V1)** | Unsupported | Unsupported w/ strong warning | Unsupported |
| **SVG (V1)** | Unsupported | Unsupported | Unsupported |
| **Cache key** | (source, href, type, rev) | (source, href, type, rev) | (source, href, type, rev) |
| **V1 status** | ✅ Implemented | 🔄 Reserved (shares default) | 🔄 Reserved (future) |

## Appendix C: Example warning codes

Warnings are defined fully in HADDON-014. Examples relevant to policy:

- `normalization.fixed-layout-unsupported`: Resource requires fixed-layout rendition
- `normalization.unsupported-element`: MathML, SVG, or other unsupported feature
- `normalization.opaque-element`: Unknown element preserved as opaque (info level)
- `normalization.hidden-content-excluded`: Hidden element excluded by policy
- `normalization.ambiguous-reading-order`: Spatial content with unclear linearization
- `normalization.ruby-annotations-excluded`: Ruby annotations not in primary text (info level)
- `normalization.media-missing-alternative`: Image without alt text
- `normalization.generated-content-excluded`: CSS-generated content excluded (info level)
- `normalization.lossy-text-mapping`: Whitespace collapsed or text replaced

## Appendix D: Revision history

| Date | Ticket | Change |
|------|--------|--------|
| 2026-09-04 | HADDON-023 | Initial policy specification based on HADDON-022 implementation |
