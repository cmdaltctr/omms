import { afterEach, describe, expect, it, mock } from "bun:test";
import type { ChatCompletionTool } from "../src/services/ai/tools/tool-schema.js";

const logged: unknown[] = [];
mock.module("../src/services/logger.js", () => ({
  log: (message: string, data?: unknown) => logged.push({ message, data }),
}));

const { OpenAIChatCompletionProvider } =
  await import("../src/services/ai/providers/openai-chat-completion.js");
const { AnthropicMessagesProvider } =
  await import("../src/services/ai/providers/anthropic-messages.js");
const { GoogleGeminiProvider } = await import("../src/services/ai/providers/google-gemini.js");

// Stands in for conversation content that a reply can echo back.
const secret = "conversation-secret-sk-proj-abcdefghijklmnop";

const toolSchema: ChatCompletionTool = {
  type: "function",
  function: {
    name: "save_memories",
    description: "Save memories",
    parameters: { type: "object", properties: {}, required: [] },
  },
};

class FakeSessionManager {
  private readonly messages: any[] = [];
  getSession(): any {
    return null;
  }
  createSession(): any {
    return { id: "session-1" };
  }
  getMessages(): any[] {
    return this.messages;
  }
  getLastSequence(): number {
    return this.messages.length - 1;
  }
  addMessage(message: any): void {
    this.messages.push(message);
  }
  updateSession(): void {}
}

const config = {
  model: "m",
  apiUrl: "https://example.invalid/v1",
  apiKey: "k",
  maxIterations: 1,
  iterationTimeout: 5000,
};

function replyWith(body: unknown) {
  globalThis.fetch = (async () =>
    ({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => body,
      text: async () => JSON.stringify(body),
    }) as Response) as unknown as typeof fetch;
}

function expectNoReplyText(result: { error?: string }) {
  expect(JSON.stringify(logged)).not.toContain(secret);
  expect(JSON.stringify(logged)).not.toContain("I summaris");
  expect(result.error ?? "").not.toContain(secret);
  expect(result.error ?? "").not.toContain("I summaris");
}

describe("providers never log model reply text", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
    logged.length = 0;
  });

  it("OpenAI chat: a response without choices", async () => {
    replyWith({ output: `I summarised ${secret}` });
    const provider = new OpenAIChatCompletionProvider(config, new FakeSessionManager() as any);
    const result = await provider.executeToolCall("s", "u", toolSchema, "id");
    expect(result.success).toBe(false);
    expect(logged.length).toBeGreaterThan(0);
    expectNoReplyText(result);
  });

  it("OpenAI chat: tool arguments that are not JSON", async () => {
    replyWith({
      choices: [
        {
          message: {
            role: "assistant",
            tool_calls: [
              {
                id: "c1",
                type: "function",
                function: { name: "save_memories", arguments: `I summarised ${secret}` },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    });
    const provider = new OpenAIChatCompletionProvider(config, new FakeSessionManager() as any);
    const result = await provider.executeToolCall("s", "u", toolSchema, "id");
    expect(result.success).toBe(false);
    expectNoReplyText(result);
  });

  it("Anthropic: tool input that fails validation", async () => {
    replyWith({
      content: [
        {
          type: "tool_use",
          id: "t1",
          name: "save_memories",
          input: { preferences: [{ category: secret }] },
        },
      ],
      stop_reason: "tool_use",
    });
    const provider = new AnthropicMessagesProvider(config, new FakeSessionManager() as any);
    const result = await provider.executeToolCall("s", "u", toolSchema, "id");
    expect(result.success).toBe(false);
    expect(logged.length).toBeGreaterThan(0);
    expectNoReplyText(result);
  });

  it("Gemini: function arguments that fail validation", async () => {
    replyWith({
      candidates: [
        {
          content: {
            role: "model",
            parts: [
              {
                functionCall: {
                  name: "save_memories",
                  args: { preferences: [{ category: secret }] },
                },
              },
            ],
          },
          finishReason: "STOP",
        },
      ],
    });
    const provider = new GoogleGeminiProvider(config, new FakeSessionManager() as any);
    const result = await provider.executeToolCall("s", "u", toolSchema, "id");
    expect(result.success).toBe(false);
    expectNoReplyText(result);
  });
});
