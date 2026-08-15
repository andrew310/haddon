/**
 * HADDON-041: Citation deep-link routing.
 * 
 * Portable open/resolve function that parses citation URLs and resolves them
 * using the publication/locator services.
 */

import type { CitationEnvelopeV1, PublicationLocatorV1 } from "haddon-citation"
import { parseCitationUrl, parseFragmentFromHash } from "./parse-citation-url"

export type { CitationEnvelopeV1 } from "haddon-citation"
export { parseCitationUrl, encodeCitationUrl, parseFragmentFromHash } from "./parse-citation-url"

/**
 * Resolved passage coordinates.
 */
export type ResolvedPassage = {
  href: string
  blockId?: string
  startOffset?: number
  endOffset?: number
  exact?: string
}

/**
 * Recovery evidence from ambiguous or recovered resolutions.
 */
export type RecoveryEvidence = {
  originalLocator?: PublicationLocatorV1
  strategy?: string
  candidates?: Array<{
    locator: PublicationLocatorV1
    score: number
  }>
  message?: string
}

/**
 * Citation resolution outcome.
 */
export type OpenCitationResult =
  | { status: "exact"; target: ResolvedPassage }
  | { status: "recovered"; target: ResolvedPassage; evidence: RecoveryEvidence }
  | { status: "ambiguous"; candidates: ResolvedPassage[]; evidence: RecoveryEvidence }
  | { status: "unresolved"; reason: string; evidence?: RecoveryEvidence }

/**
 * Publication session interface (WASM or JS).
 * 
 * Minimal interface for resolving citations without coupling to WASM internals.
 */
export interface PublicationSession {
  /**
   * Resolve a locator JSON string.
   * 
   * @param locatorJson - Serialized PublicationLocatorV1
   * @param policy - Resolution policy ("citation" | "navigation" | "resume")
   * @returns JSON string with resolution result
   */
  resolve_json(locatorJson: string, policy: string): string
}

/**
 * Internal resolution result from WASM.
 */
type WasmResolveResult = {
  status: string
  strategy?: string
  confidence?: string
  blockId?: string
  start?: number
  end?: number
  href?: string
  exact?: string
  reason?: string
  candidates?: Array<{
    href: string
    blockId?: string
    start?: number
    end?: number
    exact?: string
    score?: number
  }>
}

/**
 * Parse and resolve a citation URL or envelope.
 * 
 * @param citationInput - URL search params, hash, or full CitationEnvelopeV1
 * @param publication - Opened publication session
 * @param volumeId - Volume ID (optional, for URL parsing)
 * @returns Typed resolution outcome
 */
export function openCitation(
  citationInput: URLSearchParams | CitationEnvelopeV1 | string,
  publication: PublicationSession,
  volumeId = "unknown"
): OpenCitationResult {
  // Parse input into envelope
  let envelope: CitationEnvelopeV1

  if (typeof citationInput === "string") {
    // Fragment identifier
    const fragment = parseFragmentFromHash(citationInput)
    if (!fragment) {
      return {
        status: "unresolved",
        reason: "missing-selector",
      }
    }
    // Create minimal envelope with fragment
    envelope = {
      schema: "haddon.citation-envelope",
      version: 1,
      volumeId,
      sourceRevision: "unknown",
      locator: {
        schema: "haddon.publication-locator",
        version: 1,
        href: "",
        mediaType: "application/xhtml+xml",
        locations: {
          fragments: [fragment],
        },
      },
      confidence: "exact",
    }
  } else if (citationInput instanceof URLSearchParams) {
    // Parse from URL search params
    const parsed = parseCitationUrl(citationInput, volumeId)
    if (!parsed) {
      return {
        status: "unresolved",
        reason: "missing-selector",
      }
    }
    envelope = parsed
  } else {
    // Already an envelope
    envelope = citationInput
  }

  // Validate envelope
  if (!envelope.locator.text?.exact && !envelope.locator.locations.fragments) {
    return {
      status: "unresolved",
      reason: "missing-selector",
    }
  }

  // Serialize locator for WASM
  const locatorJson = JSON.stringify(envelope.locator)

  // Resolve using publication service
  let rawResult: string
  try {
    rawResult = publication.resolve_json(locatorJson, "citation")
  } catch (err) {
    return {
      status: "unresolved",
      reason: err instanceof Error ? err.message : String(err),
    }
  }

  // Parse WASM result
  let result: WasmResolveResult
  try {
    result = JSON.parse(rawResult) as WasmResolveResult
  } catch {
    return {
      status: "unresolved",
      reason: "invalid-resolution-result",
    }
  }

  // Map WASM result to OpenCitationResult
  return mapWasmResult(result, envelope)
}

/**
 * Map WASM resolution result to typed OpenCitationResult.
 */
function mapWasmResult(
  result: WasmResolveResult,
  envelope: CitationEnvelopeV1
): OpenCitationResult {
  if (result.status !== "resolved") {
    return {
      status: "unresolved",
      reason: result.reason || result.status,
      evidence: envelope.recoveryEvidence
        ? {
            originalLocator: envelope.recoveryEvidence.originalLocator,
            strategy: envelope.recoveryEvidence.strategy,
            message: envelope.recoveryEvidence.message,
          }
        : undefined,
    }
  }

  // Build resolved passage
  const target: ResolvedPassage = {
    href: result.href || envelope.locator.href,
    blockId: result.blockId,
    startOffset: result.start,
    endOffset: result.end,
    exact: result.exact || envelope.locator.text?.exact,
  }

  // Map confidence to status
  const confidence = result.confidence?.toLowerCase()
  const strategy = result.strategy

  // Check for multiple candidates first (ambiguous)
  if (result.candidates && result.candidates.length > 1) {
    return {
      status: "ambiguous",
      candidates: result.candidates.map((c) => ({
        href: c.href,
        blockId: c.blockId,
        startOffset: c.start,
        endOffset: c.end,
        exact: c.exact,
      })),
      evidence: {
        strategy: strategy || "quote-match",
        candidates: result.candidates.map((c) => ({
          locator: {
            schema: "haddon.publication-locator",
            version: 1,
            href: c.href,
            mediaType: "application/xhtml+xml",
            locations: c.blockId
              ? {
                  normalized: {
                    revision: "unknown",
                    start: {
                      blockId: c.blockId,
                      offset: { value: c.start || 0, unit: "utf16-code-unit" },
                    },
                  },
                }
              : {},
            text: c.exact ? { exact: c.exact } : undefined,
          },
          score: c.score || 0.5,
        })),
        message: `Found ${result.candidates.length} candidates with equal confidence`,
      },
    }
  }

  if (confidence === "exact") {
    return {
      status: "exact",
      target,
    }
  }

  if (confidence === "strong" || confidence === "weak") {
    // Recovered citation
    return {
      status: "recovered",
      target,
      evidence: {
        originalLocator: envelope.recoveryEvidence?.originalLocator,
        strategy: strategy || "quote-match",
        message: `Quote matched with ${confidence} confidence using ${strategy || "quote"}`,
      },
    }
  }

  // Default to exact
  return {
    status: "exact",
    target,
  }
}
