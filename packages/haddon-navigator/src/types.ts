/**
 * Types for HADDON-032 visible-location tracking.
 * Based on navigator-api.md sections 4, 7, and 18.
 */

/**
 * Publication locator V1 (schema "haddon.publication-locator", version 1).
 * Durable location is a PublicationLocatorV1. Never persist viewport page indices.
 */
export interface PublicationLocatorV1 {
  readonly schema: "haddon.publication-locator";
  readonly version: 1;
  readonly href: string;
  readonly mediaType: string;
  readonly title?: string;
  readonly locations: LocatorLocations;
  readonly text?: LocatorText;
  readonly extensions?: Readonly<Record<string, unknown>>;
}

export interface LocatorLocations {
  readonly fragments?: readonly string[];
  readonly epubCfi?: string;
  readonly cssSelector?: string;
  readonly domRange?: DomRangeSelector;
  readonly normalized?: NormalizedRangeSelector;
  readonly progression?: number;
  readonly totalProgression?: number;
  readonly position?: number;
}

export interface LocatorText {
  readonly exact: string;
  readonly prefix?: string;
  readonly suffix?: string;
}

export interface DomRangeSelector {
  readonly start: DomPointSelector;
  readonly end?: DomPointSelector;
}

export interface DomPointSelector {
  readonly cssSelector: string;
  readonly textNodeIndex: number;
  readonly offset?: TextOffset;
}

export interface NormalizedRangeSelector {
  readonly revision: string;
  readonly start: NormalizedPointSelector;
  readonly end?: NormalizedPointSelector;
}

export interface NormalizedPointSelector {
  readonly blockId: string;
  readonly offset: TextOffset;
}

export interface TextOffset {
  readonly value: number;
  readonly unit: "utf-16-code-unit";
}

/**
 * Visible location V1 - the primary snapshot/event location type (navigator-api.md §4).
 */
export interface VisibleLocationV1 {
  /** Durable collapsed locator at the logical reading edge of the viewport. */
  readonly current: PublicationLocatorV1;
  /** Ordered visible spans; one span can never cross hrefs. */
  readonly segments: readonly VisibleSegmentV1[];
  readonly rendition: RenditionPositionV1;
  readonly layoutRevision: number;
}

export interface VisibleSegmentV1 {
  readonly href: string;
  /** A ranged locator when both boundaries are known; otherwise collapsed. */
  readonly locator: PublicationLocatorV1;
  readonly visibility: "partial" | "complete";
}

export interface RenditionPositionV1 {
  readonly layout: RenditionLayout;
  readonly resourceProgression?: number;
  readonly publicationProgression?: number;
  readonly viewportPageIndex?: number;
  readonly viewportPageCount?: number;
  readonly spreadIndex?: number;
  readonly spreadCount?: number;
}

export type RenditionLayout = "scrolled" | "paginated" | "fixed";

/**
 * Layout mode configuration for HADDON-034.
 */
export interface LayoutModeConfig {
  readonly mode: RenditionLayout;
  readonly columnGap?: number;
  readonly columnWidth?: number;
  readonly direction?: "ltr" | "rtl";
}

export type LocationChangeCause =
  | "initial"
  | "command"
  | "link"
  | "scroll"
  | "selection"
  | "resize"
  | "insets"
  | "preferences"
  | "backend-switch"
  | "recovery";

/**
 * Backend-internal visible target (navigator-api.md §18, HADDON-032).
 * Backends report this and the navigator converts it to VisibleLocationV1.
 */
export interface BackendVisibleTarget {
  /** Resource href for this visible content. */
  readonly href: string;
  /** First visible boundary in logical reading order. */
  readonly firstBoundary: VisibleBoundary;
  /** Last visible boundary in logical reading order (may equal first). */
  readonly lastBoundary: VisibleBoundary;
  /** Whether the entire resource is visible. */
  readonly complete: boolean;
}

export interface VisibleBoundary {
  /** Normalized block ID (from data-haddon-id). */
  readonly blockId: string;
  /** UTF-16 offset within the block's text content. */
  readonly offset: number;
  /** Optional DOM path for mapping back to source. */
  readonly domPath?: DomPath;
}

export interface DomPath {
  readonly cssSelector: string;
  readonly textNodeIndex: number;
  readonly charOffset: number;
}

/**
 * Viewport snapshot (navigator-api.md §7).
 */
export interface ViewportSnapshot {
  readonly width: number;
  readonly height: number;
  readonly insets: ViewportInsets;
  readonly contentWidth: number;
  readonly contentHeight: number;
  readonly devicePixelRatio: number;
  readonly layoutRevision: number;
}

export interface ViewportInsets {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

/**
 * Result types for visibility operations.
 */
export type VisibilityResult =
  | { readonly status: "complete"; readonly location: VisibleLocationV1 }
  | { readonly status: "partial"; readonly location: VisibleLocationV1; readonly warnings: readonly string[] }
  | { readonly status: "ambiguous"; readonly reason: string }
  | { readonly status: "unavailable"; readonly reason: string };

/**
 * Haddon warning structure.
 */
export interface PublicationWarning {
  readonly code: string;
  readonly severity: "info" | "caution" | "critical";
  readonly stage: string;
  readonly message: string;
  readonly href?: string;
  readonly recovery?: string;
}
