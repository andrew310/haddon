/**
 * Haddon Citation Envelope Types (Version 1)
 * 
 * Portable TypeScript types for citation storage and deep linking.
 * See docs/design/citation-envelope.md for the full specification.
 */

// ============================================================================
// Citation Envelope V1
// ============================================================================

/**
 * Haddon Citation Envelope Version 1
 * 
 * Wraps a PublicationLocatorV1 with volume/edition identity and recovery state.
 * This is the canonical storage and URL representation for citations across
 * Haddon, Klemata, and future Kadmos.
 */
export type CitationEnvelopeV1 = {
  /** Schema identifier for migration detection. */
  schema: "haddon.citation-envelope"
  /** Schema version. Must be 1 for V1 documents. */
  version: 1
  
  /** Klemata's stable identity for the conceptual volume. */
  volumeId: string
  
  /** Stable identity for the edition when Klemata has one. */
  editionId?: string
  
  /** 
   * SHA-256 fingerprint of the canonical EPUB bytes in Klemata's blob store.
   * Hex-encoded lowercase, 64 characters.
   */
  sourceRevision: string
  
  /** 
   * The publication locator identifying the citation target.
   * Reuses haddon.publication-locator version 1 unchanged.
   */
  locator: PublicationLocatorV1
  
  /** 
   * Recovery confidence when resolving this citation.
   * - exact: locator was resolved without ambiguity
   * - recovered: quote/context matched after normalized structure changed
   * - ambiguous: multiple candidates matched with equal confidence
   * - unresolved: citation could not be resolved in this source revision
   */
  confidence: "exact" | "recovered" | "ambiguous" | "unresolved"
  
  /** 
   * Human-readable label for UI presentation.
   * Optional. When present, used for link text, tooltips, or decoration labels.
   */
  label?: string
  
  /** 
   * Recovery evidence when confidence is not "exact".
   * Preserved to enable auditing, re-resolution, or manual override.
   */
  recoveryEvidence?: RecoveryEvidence
  
  /** 
   * Application-specific extensions.
   * Haddon core and Klemata may store workflow state here.
   */
  extensions?: Record<string, JsonValue>
}

/**
 * Evidence collected during citation recovery.
 * Preserved when confidence is "recovered", "ambiguous", or "unresolved".
 */
export type RecoveryEvidence = {
  /** The original locator that failed exact resolution. */
  originalLocator?: PublicationLocatorV1
  
  /** Recovery strategy that produced this result. */
  strategy?: "quote-match" | "fragment-fallback" | "progression-estimate" | "manual"
  
  /** 
   * Alternative candidates when confidence is "ambiguous".
   * Each candidate includes its locator and a quality score [0, 1].
   */
  candidates?: Array<{
    locator: PublicationLocatorV1
    score: number
  }>
  
  /** Human-readable recovery message. */
  message?: string
}

// ============================================================================
// Publication Locator V1 (reused from haddon.publication-locator)
// ============================================================================

/**
 * PublicationLocatorV1 from haddon.publication-locator version 1.
 * See crates/core/src/publication/locator.rs for the canonical definition.
 */
export type PublicationLocatorV1 = {
  schema: "haddon.publication-locator"
  version: 1
  href: string
  mediaType: string
  title?: string
  locations: LocatorLocations
  text?: LocatorText
  extensions?: Record<string, JsonValue>
}

export type LocatorLocations = {
  fragments?: string[]
  epubCfi?: string
  cssSelector?: string
  domRange?: DomRangeSelector
  normalized?: NormalizedRangeSelector
  progression?: number
  totalProgression?: number
  position?: number
}

export type LocatorText = {
  exact: string
  prefix?: string
  suffix?: string
}

export type DomRangeSelector = {
  start: DomPointSelector
  end?: DomPointSelector
}

export type DomPointSelector = {
  cssSelector: string
  textNodeIndex: number
  offset?: TextOffset
}

export type NormalizedRangeSelector = {
  revision: string
  start: NormalizedPointSelector
  end?: NormalizedPointSelector
}

export type NormalizedPointSelector = {
  blockId: string
  offset: TextOffset
}

export type TextOffset = {
  value: number
  unit: "utf16-code-unit"
}

// ============================================================================
// Utilities
// ============================================================================

export type JsonValue = 
  | string 
  | number 
  | boolean 
  | null 
  | JsonValue[] 
  | { [key: string]: JsonValue }

/**
 * Detect a V1 citation envelope.
 */
export function isCitationEnvelopeV1(value: unknown): value is CitationEnvelopeV1 {
  return (
    typeof value === "object" &&
    value !== null &&
    "schema" in value &&
    value.schema === "haddon.citation-envelope" &&
    "version" in value &&
    value.version === 1
  )
}

/**
 * Detect any citation envelope (forward-compatible).
 */
export function isCitationEnvelope(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "schema" in value &&
    value.schema === "haddon.citation-envelope" &&
    "version" in value &&
    typeof value.version === "number" &&
    value.version >= 1
  )
}

/**
 * Parse a citation envelope from JSON.
 * Throws if the JSON is invalid or the version is unsupported.
 */
export function parseCitationEnvelope(json: string): CitationEnvelopeV1 {
  const value = JSON.parse(json)
  if (!isCitationEnvelopeV1(value)) {
    if (isCitationEnvelope(value)) {
      throw new Error(
        `Unsupported citation envelope version: ${(value as any).version}`
      )
    }
    throw new Error("Invalid citation envelope: missing schema or version")
  }
  
  // Validate required fields
  if (!value.volumeId) {
    throw new Error("Invalid citation envelope: volumeId is required")
  }
  if (!value.sourceRevision) {
    throw new Error("Invalid citation envelope: sourceRevision is required")
  }
  if (!value.locator) {
    throw new Error("Invalid citation envelope: locator is required")
  }
  if (!value.confidence) {
    throw new Error("Invalid citation envelope: confidence is required")
  }
  
  return value
}

/**
 * Serialize a citation envelope to JSON.
 */
export function serializeCitationEnvelope(envelope: CitationEnvelopeV1): string {
  return JSON.stringify(envelope, null, 2)
}

// ============================================================================
// Migration Stub (for future V2)
// ============================================================================

/**
 * Union of all citation envelope versions.
 * Extend this when V2 is introduced.
 */
export type CitationEnvelope = CitationEnvelopeV1 // | CitationEnvelopeV2 | ...

/**
 * Migrate a citation envelope to the latest version.
 * Currently a no-op (only V1 exists).
 */
export function migrateCitationEnvelope(
  envelope: CitationEnvelope
): CitationEnvelopeV1 {
  switch (envelope.version) {
    case 1:
      return envelope
    default:
      throw new Error(
        `Unsupported citation envelope version: ${(envelope as any).version}`
      )
  }
}
