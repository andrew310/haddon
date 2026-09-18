import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import {
  ASK_AI_AUTH_FAILED,
  ASK_AI_FAILED,
  ASK_AI_MISSING_KEY,
  ASK_AI_RATE_LIMITED,
  ASK_AI_SYSTEM_PROMPT,
  XAI_MODEL,
  askAiReplyState,
  buildAskAiMessages,
  buildAskAiUserPrompt,
  buildXaiChatCompletionsBody,
  errorMessageForXaiFailure,
  parseAskAiRequest,
  replyFromAskAiResult,
  textFromChatCompletion,
} from "./ask-ai";

const passage = {
  quote: "the patient moon answered in blue",
  prefix: "Before the signal, the copper astrolabe clicked once; ",
  suffix: ", and the lesson continued after midnight.",
  href: "text/chapter-1.xhtml",
  bookTitle: "The Brass Observatory",
  bookId: "book-1",
};

describe("parseAskAiRequest", () => {
  it("accepts a quote and optional locator context", () => {
    expect(parseAskAiRequest(passage)).toEqual(passage);
  });

  it("rejects an empty quote", () => {
    expect(() => parseAskAiRequest({ quote: "   " })).toThrow(ZodError);
  });
});

describe("buildAskAiMessages", () => {
  it("sends a short system + user prompt with the quote as ground truth", () => {
    const messages = buildAskAiMessages(passage);
    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({
      role: "system",
      content: ASK_AI_SYSTEM_PROMPT,
    });
    expect(messages[0]?.content).toMatch(/do not invent page numbers/i);

    const user = messages[1]?.content ?? "";
    expect(user).toContain("Explain this passage in the book.");
    expect(user).toContain("The Brass Observatory");
    expect(user).toContain("the patient moon answered in blue");
    expect(user).toContain("copper astrolabe clicked once");
    expect(user).toContain("the lesson continued after midnight");
    expect(user).toContain("text/chapter-1.xhtml");
    expect(user).toMatch(/do not invent page numbers/i);
    expect(user).not.toContain("book-1");
  });

  it("omits blank optional context", () => {
    const user = buildAskAiUserPrompt({ quote: "hello" });
    expect(user).toContain("Quote:\nhello");
    expect(user).not.toContain("Book:");
    expect(user).not.toContain("Resource:");
    expect(user).not.toContain("immediately before");
  });
});

describe("buildXaiChatCompletionsBody", () => {
  it("targets grok-4.5 with the built messages and no live search", () => {
    const body = buildXaiChatCompletionsBody({ quote: "hello" });
    expect(body.model).toBe(XAI_MODEL);
    expect(body.model).toBe("grok-4.5");
    expect(body.max_completion_tokens).toBe(500);
    expect(body.search_parameters).toEqual({ mode: "off" });
    expect(body.messages[0]?.role).toBe("system");
    expect(body.messages[1]?.content).toContain("hello");
  });
});

describe("textFromChatCompletion", () => {
  it("reads the first assistant message", () => {
    expect(
      textFromChatCompletion({
        choices: [{ message: { content: "  The moon is a witness.  " } }],
      }),
    ).toBe("The moon is a witness.");
  });

  it("treats missing or blank content as empty", () => {
    expect(textFromChatCompletion({})).toBeNull();
    expect(
      textFromChatCompletion({ choices: [{ message: { content: "   " } }] }),
    ).toBeNull();
  });
});

describe("errorMessageForXaiFailure", () => {
  it("maps missing key and HTTP statuses without leaking secrets", () => {
    expect(errorMessageForXaiFailure(undefined, true)).toBe(ASK_AI_MISSING_KEY);
    expect(
      errorMessageForXaiFailure({
        status: 401,
        message: "Incorrect API key provided: xai-secret",
      }),
    ).toBe(ASK_AI_AUTH_FAILED);
    expect(errorMessageForXaiFailure({ status: 429 })).toBe(ASK_AI_RATE_LIMITED);
    expect(errorMessageForXaiFailure(new Error("boom"))).toBe(ASK_AI_FAILED);
  });

  it("never echoes provider error text", () => {
    const message = errorMessageForXaiFailure({
      status: 401,
      message: "Incorrect API key provided: xai-secret",
    });
    expect(message).not.toContain("xai-secret");
    expect(message).not.toMatch(/key provided/i);
  });
});

describe("replyFromAskAiResult", () => {
  it("prefers assistant text, then a safe error string", () => {
    expect(replyFromAskAiResult({ text: "  Because the moon waits.  " })).toBe(
      "Because the moon waits.",
    );
    expect(replyFromAskAiResult({ error: ASK_AI_MISSING_KEY })).toBe(
      ASK_AI_MISSING_KEY,
    );
  });
});

describe("askAiReplyState", () => {
  it("keeps no-note distinct from an in-flight Ask AI note", () => {
    expect(askAiReplyState(null)).toEqual({ kind: "none" });
    expect(askAiReplyState("")).toEqual({ kind: "pending" });
    expect(askAiReplyState("The covenant is the frame.")).toEqual({
      kind: "text",
      text: "The covenant is the frame.",
    });
  });
});
