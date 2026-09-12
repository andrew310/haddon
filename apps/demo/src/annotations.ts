import type { Decoration } from "../../../packages/haddon-navigator/src/decoration-manager";
import type { PublicationLocatorV1 } from "../../../packages/haddon-navigator/src/types";

export const ANNOTATION_SCHEMA = "haddon.annotations" as const;
export const ANNOTATION_VERSION = 1 as const;

export type MarginNoteRecord = {
  id: string;
  locator: PublicationLocatorV1;
  quote: string;
  content: string;
  highlightId?: string;
};

export type AnnotationStoreV1 = {
  schema: typeof ANNOTATION_SCHEMA;
  version: typeof ANNOTATION_VERSION;
  href?: string | null;
  highlights: Decoration[];
  notes: MarginNoteRecord[];
};

export function emptyAnnotations(): AnnotationStoreV1 {
  return {
    schema: ANNOTATION_SCHEMA,
    version: ANNOTATION_VERSION,
    href: null,
    highlights: [],
    notes: [],
  };
}

function isDecoration(value: unknown): value is Decoration {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.group === "string" &&
    typeof record.locator === "object" &&
    record.locator !== null
  );
}

function isNote(value: unknown): value is MarginNoteRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.quote === "string" &&
    typeof record.content === "string" &&
    typeof record.locator === "object" &&
    record.locator !== null
  );
}

export function parseAnnotations(raw: string | null): AnnotationStoreV1 {
  if (!raw) return emptyAnnotations();
  try {
    const parsed = JSON.parse(raw) as Partial<AnnotationStoreV1>;
    if (parsed.schema !== ANNOTATION_SCHEMA || parsed.version !== ANNOTATION_VERSION) {
      return emptyAnnotations();
    }
    return {
      schema: ANNOTATION_SCHEMA,
      version: ANNOTATION_VERSION,
      href: typeof parsed.href === "string" ? parsed.href : null,
      highlights: Array.isArray(parsed.highlights)
        ? parsed.highlights.filter(isDecoration)
        : [],
      notes: Array.isArray(parsed.notes) ? parsed.notes.filter(isNote) : [],
    };
  } catch {
    return emptyAnnotations();
  }
}

export function loadAnnotations(
  storageKey: string,
  storage: Pick<Storage, "getItem"> | null = typeof window === "undefined"
    ? null
    : window.localStorage,
): AnnotationStoreV1 {
  if (!storage) return emptyAnnotations();
  return parseAnnotations(storage.getItem(storageKey));
}

export function saveAnnotations(
  storageKey: string,
  store: AnnotationStoreV1,
  storage: Pick<Storage, "setItem"> | null = typeof window === "undefined"
    ? null
    : window.localStorage,
): void {
  if (!storage) return;
  const payload: AnnotationStoreV1 = {
    schema: ANNOTATION_SCHEMA,
    version: ANNOTATION_VERSION,
    href: store.href ?? null,
    highlights: store.highlights.filter((decoration) => decoration.group === "highlights"),
    notes: store.notes,
  };
  storage.setItem(storageKey, JSON.stringify(payload));
}
