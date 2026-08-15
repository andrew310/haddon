/**
 * Locator service implementation for the demo app.
 * Bridges between visibility tracker and WASM publication session.
 */

import type { LocatorService } from "../../../packages/haddon-navigator/src/visibility-tracker";
import type { PublicationLocatorV1 } from "../../../packages/haddon-navigator/src/types";

type WasmModule = typeof import("../../../packages/wasm/pkg/haddon_wasm");
type PublicationSession = InstanceType<WasmModule["PublicationSession"]>;

export class WasmLocatorService implements LocatorService {
  constructor(private session: PublicationSession) {}

  async createLocator(
    href: string,
    blockId: string,
    startOffset: number,
    endOffset?: number
  ): Promise<PublicationLocatorV1> {
    // Create a locator with normalized selector
    const locator: PublicationLocatorV1 = {
      schema: "haddon.publication-locator",
      version: 1,
      href,
      mediaType: "application/xhtml+xml",
      locations: {
        normalized: {
          revision: "v1", // TODO: Get actual revision from session
          start: {
            blockId,
            offset: {
              value: startOffset,
              unit: "utf16-code-unit",
            },
          },
          end: endOffset !== undefined && endOffset !== startOffset
            ? {
                blockId,
                offset: {
                  value: endOffset,
                  unit: "utf16-code-unit",
                },
              }
            : undefined,
        },
      },
    };

    // TODO: Use session to resolve and enrich the locator with additional evidence
    return locator;
  }

  async refreshLocator(locator: PublicationLocatorV1): Promise<PublicationLocatorV1> {
    // For now, return as-is. Full implementation would re-resolve through the session
    // to refresh progression, total_progression, and verify the target still exists.
    return locator;
  }
}
