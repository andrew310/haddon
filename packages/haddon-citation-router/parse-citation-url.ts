/**
 * Parse citation URLs into CitationEnvelopeV1.
 * 
 * Supports query parameters, base64-encoded envelopes, and fragments.
 */

import type {
  CitationEnvelopeV1,
  PublicationLocatorV1,
} from "haddon-citation"

/**
 * Parse a citation from URL search parameters.
 * 
 * Supports:
 * - `envelope={base64}` - Full CitationEnvelopeV1
 * - Individual parameters: sourceRevision, href, exact, prefix, suffix, fragment
 * 
 * @param params - URLSearchParams from window.location.search
 * @param volumeId - Volume ID (from route or context)
 * @returns CitationEnvelopeV1 or null if no citation is present
 */
export function parseCitationUrl(
  params: URLSearchParams,
  volumeId: string
): CitationEnvelopeV1 | null {
  // Try base64-encoded envelope first
  const envelopeParam = params.get("envelope")
  if (envelopeParam) {
    try {
      const decoded = atob(envelopeParam)
      const parsed = JSON.parse(decoded) as CitationEnvelopeV1
      if (
        parsed.schema === "haddon.citation-envelope" &&
        parsed.version === 1
      ) {
        return parsed
      }
    } catch {
      // Fall through to query params
    }
  }

  // Try query parameters
  const sourceRevision = params.get("sourceRevision")
  const href = params.get("href")
  const exact = params.get("exact")
  const prefix = params.get("prefix")
  const suffix = params.get("suffix")
  const fragment = params.get("fragment")

  // Must have either exact quote or fragment
  if (!exact && !fragment) {
    return null
  }

  // sourceRevision is required
  if (!sourceRevision) {
    return null
  }

  // Build locator
  const locations: PublicationLocatorV1["locations"] = {}
  if (fragment) {
    locations.fragments = [fragment]
  }

  const locator: PublicationLocatorV1 = {
    schema: "haddon.publication-locator",
    version: 1,
    href: href || "",
    mediaType: "application/xhtml+xml",
    locations,
  }

  if (exact) {
    locator.text = {
      exact,
      ...(prefix ? { prefix } : {}),
      ...(suffix ? { suffix } : {}),
    }
  }

  // Build envelope
  return {
    schema: "haddon.citation-envelope",
    version: 1,
    volumeId,
    sourceRevision,
    locator,
    confidence: "exact",
  }
}

/**
 * Encode a CitationEnvelopeV1 into URL search parameters.
 * 
 * Uses query parameters for simple citations, base64 for complex ones.
 * 
 * @param envelope - CitationEnvelopeV1 to encode
 * @param useBase64 - Force base64 encoding (default: auto-detect)
 * @returns URLSearchParams
 */
export function encodeCitationUrl(
  envelope: CitationEnvelopeV1,
  useBase64 = false
): URLSearchParams {
  const params = new URLSearchParams()

  // Check if this is a simple citation
  const isSimple =
    !envelope.locator.locations.normalized &&
    !envelope.locator.locations.domRange &&
    !envelope.locator.locations.epubCfi &&
    !envelope.locator.locations.cssSelector &&
    !envelope.recoveryEvidence &&
    (!envelope.extensions || Object.keys(envelope.extensions).length === 0)

  if (!useBase64 && isSimple) {
    // Use query parameters for simple citations
    params.set("sourceRevision", envelope.sourceRevision)
    if (envelope.locator.href) {
      params.set("href", envelope.locator.href)
    }
    if (envelope.locator.text?.exact) {
      params.set("exact", envelope.locator.text.exact)
      if (envelope.locator.text.prefix) {
        params.set("prefix", envelope.locator.text.prefix)
      }
      if (envelope.locator.text.suffix) {
        params.set("suffix", envelope.locator.text.suffix)
      }
    }
    if (
      envelope.locator.locations.fragments &&
      envelope.locator.locations.fragments.length > 0
    ) {
      params.set("fragment", envelope.locator.locations.fragments[0])
    }
  } else {
    // Use base64 for complex citations
    const json = JSON.stringify(envelope)
    const encoded = btoa(json)
    params.set("envelope", encoded)
  }

  return params
}

/**
 * Parse a fragment identifier from URL hash.
 * 
 * @param hash - URL hash (e.g., "#citation-target")
 * @returns Fragment identifier without the leading #
 */
export function parseFragmentFromHash(hash: string): string | null {
  if (!hash || hash.length <= 1) return null
  return hash.startsWith("#") ? hash.slice(1) : hash
}
