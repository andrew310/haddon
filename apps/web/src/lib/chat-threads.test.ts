import { describe, expect, it } from "vitest";
import type { AnnotationStoreV1 } from "../../../demo/src/annotations";
import type { Decoration } from "../../../../packages/haddon-navigator/src/decoration-manager";
import type { PublicationLocatorV1 } from "../../../../packages/haddon-navigator/src/types";
import { speakerAvatar, threadsFromAnnotations } from "./chat-threads";

const locator = (exact: string): PublicationLocatorV1 => ({
  schema: "haddon.publication-locator",
  version: 1,
  href: "c1.xhtml",
  mediaType: "application/xhtml+xml",
  locations: {
    normalized: {
      revision: "v1",
      start: { blockId: "p1", offset: { value: 0, unit: "utf-16-code-unit" } },
    },
  },
  text: { exact },
});

const highlight = (id: string, exact: string, style = "yellow"): Decoration => ({
  id,
  locator: locator(exact),
  group: "highlights",
  style,
});

const empty: AnnotationStoreV1 = {
  schema: "haddon.annotations",
  version: 1,
  href: null,
  highlights: [],
  notes: [],
};

describe("threadsFromAnnotations", () => {
  it("makes one thread per highlight, even without a note", () => {
    const store: AnnotationStoreV1 = {
      ...empty,
      highlights: [
        highlight("h1", "first passage"),
        highlight("h2", "second passage", "pink"),
      ],
    };
    const threads = threadsFromAnnotations(store);
    expect(threads).toHaveLength(2);
    expect(threads.map((t) => t.id)).toEqual(["h1", "h2"]);
    expect(threads[1]?.color).toBe("pink");
    expect(threads[0]?.reply).toBeNull();
  });

  it("attaches an Ask AI note to its highlight instead of duplicating", () => {
    const store: AnnotationStoreV1 = {
      ...empty,
      highlights: [highlight("h1", "the ancient Near East")],
      notes: [
        {
          id: "n1",
          highlightId: "h1",
          locator: locator("the ancient Near East"),
          quote: "the ancient Near East",
          content: "AI explanation coming soon...",
        },
      ],
    };
    const threads = threadsFromAnnotations(store);
    expect(threads).toHaveLength(1);
    expect(threads[0]?.reply).toContain("coming soon");
    expect(threads[0]?.speaker).toEqual({ kind: "ai" });
  });
});

describe("speakerAvatar", () => {
  it("uses the bot face for AI", () => {
    expect(speakerAvatar({ kind: "ai" }).src).toBe("/chatheads/bot.jpg");
  });

  it("uses a commentator portrait when provided", () => {
    const avatar = speakerAvatar({
      kind: "commentator",
      name: "Calvin",
      portraitUrl: "/chatheads/calvin.jpg",
    });
    expect(avatar.src).toBe("/chatheads/calvin.jpg");
    expect(avatar.label).toBe("Calvin");
  });
});
