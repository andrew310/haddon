import { z } from "zod";

export const XAI_BASE_URL = "https://api.x.ai/v1";
export const XAI_MODEL = "grok-4.5";

export const ASK_AI_SYSTEM_PROMPT =
  "You explain a passage a reader highlighted in a book. Be concise and specific to the quoted text. Use the quote as ground truth. Do not invent page numbers, citations, or details that are not supported by the quote or its surrounding text.";

export const ASK_AI_MISSING_KEY =
  "Ask AI is not configured. Set XAI_API_KEY on the server.";
export const ASK_AI_AUTH_FAILED =
  "Ask AI could not authenticate with xAI. Check XAI_API_KEY.";
export const ASK_AI_RATE_LIMITED =
  "Ask AI is rate-limited. Try again in a moment.";
export const ASK_AI_EMPTY_REPLY = "Ask AI returned an empty reply.";
export const ASK_AI_FAILED = "Ask AI failed. Try again.";

export const askAiRequestSchema = z.object({
  quote: z.string().trim().min(1).max(8000),
  prefix: z.string().max(2000).optional(),
  suffix: z.string().max(2000).optional(),
  href: z.string().max(2000).optional(),
  bookTitle: z.string().max(500).optional(),
  bookId: z.string().max(200).optional(),
});

export type AskAiRequest = z.infer<typeof askAiRequestSchema>;

export type AskAiChatMessage = {
  role: "system" | "user";
  content: string;
};

export type AskAiResult =
  | { text: string; error?: undefined }
  | { text?: undefined; error: string };

export type AskAiReplyState =
  | { kind: "none" }
  | { kind: "pending" }
  | { kind: "text"; text: string };

export function parseAskAiRequest(input: unknown): AskAiRequest {
  return askAiRequestSchema.parse(input);
}

export function buildAskAiUserPrompt(input: AskAiRequest): string {
  const lines = ["Explain this passage in the book."];
  const title = input.bookTitle?.trim();
  if (title) lines.push(`Book: ${title}`);
  lines.push(`Quote:\n${input.quote.trim()}`);
  const prefix = input.prefix?.trim();
  if (prefix) lines.push(`Text immediately before the quote:\n${prefix}`);
  const suffix = input.suffix?.trim();
  if (suffix) lines.push(`Text immediately after the quote:\n${suffix}`);
  const href = input.href?.trim();
  if (href) lines.push(`Resource: ${href}`);
  lines.push("Do not invent page numbers. The quote is ground truth.");
  return lines.join("\n\n");
}

export function buildAskAiMessages(input: AskAiRequest): AskAiChatMessage[] {
  return [
    { role: "system", content: ASK_AI_SYSTEM_PROMPT },
    { role: "user", content: buildAskAiUserPrompt(input) },
  ];
}

export function buildXaiChatCompletionsBody(input: AskAiRequest) {
  return {
    model: XAI_MODEL,
    messages: buildAskAiMessages(input),
    max_completion_tokens: 500,
    temperature: 0.4,
    // xAI defaults search to on; keep the quote as the only source.
    search_parameters: { mode: "off" as const },
  };
}

export function textFromChatCompletion(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const choices = (payload as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || !choices[0] || typeof choices[0] !== "object") {
    return null;
  }
  const message = (choices[0] as { message?: unknown }).message;
  if (!message || typeof message !== "object") return null;
  const content = (message as { content?: unknown }).content;
  if (typeof content !== "string") return null;
  const trimmed = content.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function errorMessageForXaiFailure(
  err: unknown,
  missingKey = false,
): string {
  if (missingKey) return ASK_AI_MISSING_KEY;
  const status =
    typeof err === "object" && err !== null && "status" in err
      ? Number((err as { status: unknown }).status)
      : undefined;
  if (status === 401) return ASK_AI_AUTH_FAILED;
  if (status === 429) return ASK_AI_RATE_LIMITED;
  return ASK_AI_FAILED;
}

export function replyFromAskAiResult(result: AskAiResult): string {
  if (result.text?.trim()) return result.text.trim();
  return result.error?.trim() || ASK_AI_FAILED;
}

/** Empty note content means the xAI call is in flight. Null means no Ask AI note. */
export function askAiReplyState(reply: string | null): AskAiReplyState {
  if (reply == null) return { kind: "none" };
  if (reply.length === 0) return { kind: "pending" };
  return { kind: "text", text: reply };
}
