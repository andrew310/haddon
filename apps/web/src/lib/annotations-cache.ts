import {
  emptyAnnotations,
  parseAnnotations,
  toAnnotationPayload,
  type AnnotationStoreV1,
} from "../../../demo/src/annotations";

export const WEB_ANNOTATIONS_KEY_PREFIX = "haddon:web:annotations:";

export function webAnnotationsStorageKey(bookId: string): string {
  return `${WEB_ANNOTATIONS_KEY_PREFIX}${bookId}`;
}

export function annotationsHaveContent(store: AnnotationStoreV1): boolean {
  return Boolean(store.href) || store.highlights.length > 0 || store.notes.length > 0;
}

export type ServerAnnotationsLoad =
  | { ok: true; found: boolean; store: AnnotationStoreV1 }
  | { ok: false };

export type ServerAnnotationsDto =
  | { ok: true; found: boolean; payload: string }
  | { ok: false };

export function annotationStoreToPayload(store: AnnotationStoreV1): string {
  return JSON.stringify(toAnnotationPayload(store));
}

export function serverAnnotationsFromDto(
  dto: ServerAnnotationsDto,
): ServerAnnotationsLoad {
  if (!dto.ok) return { ok: false };
  return {
    ok: true,
    found: dto.found,
    store: parseAnnotations(dto.payload),
  };
}

export type MergedAnnotations = {
  store: AnnotationStoreV1;
  source: "server" | "local";
  persistToServer: boolean;
};

function localOrEmpty(local: AnnotationStoreV1): AnnotationStoreV1 {
  return annotationsHaveContent(local) ? local : emptyAnnotations();
}

/** Server envelope wins when Postgres answered with a row; otherwise keep the local cache. */
export function mergeAnnotationSources(
  server: ServerAnnotationsLoad,
  local: AnnotationStoreV1,
): MergedAnnotations {
  if (!server.ok) {
    return {
      store: localOrEmpty(local),
      source: "local",
      persistToServer: false,
    };
  }

  if (server.found) {
    return {
      store: server.store,
      source: "server",
      persistToServer: false,
    };
  }

  const store = localOrEmpty(local);
  return {
    store,
    source: "local",
    persistToServer: annotationsHaveContent(store),
  };
}
