import { createServerFn } from "@tanstack/react-start";

import {
  ASK_AI_EMPTY_REPLY,
  buildXaiChatCompletionsBody,
  errorMessageForXaiFailure,
  parseAskAiRequest,
  textFromChatCompletion,
  XAI_BASE_URL,
  type AskAiResult,
} from "./ask-ai";

export const askAboutPassage = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => parseAskAiRequest(input))
  .handler(async ({ data }): Promise<AskAiResult> => {
    const apiKey = process.env.XAI_API_KEY?.trim();
    if (!apiKey) {
      return { error: errorMessageForXaiFailure(undefined, true) };
    }

    const { default: OpenAI } = await import("openai");
    const client = new OpenAI({
      apiKey,
      baseURL: XAI_BASE_URL,
    });

    try {
      const completion = await client.chat.completions.create(
        buildXaiChatCompletionsBody(data) as Parameters<
          typeof client.chat.completions.create
        >[0],
      );
      const text = textFromChatCompletion(completion);
      if (!text) return { error: ASK_AI_EMPTY_REPLY };
      return { text };
    } catch (err) {
      return { error: errorMessageForXaiFailure(err) };
    }
  });
