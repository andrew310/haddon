import type { AnnotationStoreV1, MarginNoteRecord } from "../../../demo/src/annotations";

export type ChatSpeaker =
  | { kind: "ai" }
  | { kind: "commentator"; name: string; portraitUrl?: string };

export type ChatThread = {
  id: string;
  quote: string;
  reply: string | null;
  speaker: ChatSpeaker;
  color?: string;
};

function speakerFromNote(note: MarginNoteRecord | undefined): ChatSpeaker {
  if (!note) return { kind: "ai" };
  const extra = note as MarginNoteRecord & {
    speaker?: ChatSpeaker;
  };
  return extra.speaker ?? { kind: "ai" };
}

/** One chathead per highlight (and leftover notes). Newest last. */
export function threadsFromAnnotations(store: AnnotationStoreV1): ChatThread[] {
  const notesByHighlight = new Map<string, MarginNoteRecord>();
  for (const note of store.notes) {
    if (note.highlightId) notesByHighlight.set(note.highlightId, note);
  }

  const usedNoteIds = new Set<string>();
  const threads: ChatThread[] = [];

  for (const highlight of store.highlights) {
    const note = notesByHighlight.get(highlight.id);
    if (note) usedNoteIds.add(note.id);
    threads.push({
      id: highlight.id,
      quote: highlight.locator.text?.exact || note?.quote || "Highlighted passage",
      reply: note?.content ?? null,
      speaker: speakerFromNote(note),
      color: highlight.style,
    });
  }

  for (const note of store.notes) {
    if (usedNoteIds.has(note.id)) continue;
    threads.push({
      id: note.id,
      quote: note.quote,
      reply: note.content,
      speaker: speakerFromNote(note),
    });
  }

  return threads;
}

export function speakerAvatar(speaker: ChatSpeaker): { src?: string; label: string } {
  if (speaker.kind === "commentator") {
    return { src: speaker.portraitUrl, label: speaker.name };
  }
  return { src: "/chatheads/bot.jpg", label: "Ask AI" };
}
