import { describe, expect, it, mock } from "bun:test";
import {
  buildCaptureSystemPrompt,
  captureSummarySchema,
  captureSummaryToolSchema,
  parseCaptureSummary,
} from "../src/core/extraction.js";

describe("shared capture extraction contract", () => {
  it("builds the system prompt for the target language", () => {
    const prompt = buildCaptureSystemPrompt("English");
    expect(prompt).toContain("technical memory recorder");
    expect(prompt).toContain("You MUST write the summary in English.");
  });

  it("parses a plain JSON payload and normalises tags", () => {
    const result = parseCaptureSummary(
      JSON.stringify({ summary: "did a thing", type: "feature", tags: ["Auth ", "Bug-Fix"] })
    );
    expect(result).toEqual({ summary: "did a thing", type: "feature", tags: ["auth", "bug-fix"] });
  });

  it("parses a fenced json code block with surrounding prose", () => {
    const result = parseCaptureSummary(
      'Here is the summary:\n```json\n{"summary":"ok","type":"discussion","tags":["a"]}\n```\nDone.'
    );
    expect(result?.summary).toBe("ok");
  });

  it("parses a bare JSON object embedded in prose", () => {
    const result = parseCaptureSummary(
      'Sure! {"summary":"embedded","type":"other","tags":[]} hope that helps'
    );
    expect(result?.summary).toBe("embedded");
  });

  it("returns null for payloads that do not satisfy the schema", () => {
    expect(parseCaptureSummary("no json here")).toBeNull();
    expect(parseCaptureSummary(JSON.stringify({ summary: "missing fields" }))).toBeNull();
    expect(
      parseCaptureSummary(JSON.stringify({ summary: "s", type: "t", tags: "not-an-array" }))
    ).toBeNull();
  });

  it("shares one schema between validation and the request description", () => {
    expect(captureSummarySchema.safeParse({ summary: "s", type: "t", tags: [] }).success).toBe(
      true
    );
    expect(captureSummaryToolSchema.required).toEqual(["summary", "type", "tags"]);
  });
});

mock.module("../src/config.js", () => ({ CONFIG: { autoCaptureLanguage: "en" } }));
const { createPiCaptureProvider } = await import("../src/adapters/pi/provider.js");

describe("Pi extraction diagnostics", () => {
  function run(reply: { content: Array<{ type: string; text?: string }>; stopReason?: string }) {
    const diagnostics: Record<string, unknown> = {};
    const provider = createPiCaptureProvider(() => ({
      provider: "openai-codex",
      modelId: "gpt-5.6-luna",
      complete: async () => reply,
    }));
    const result = provider.summarize({
      context: "ctx",
      sessionId: "s",
      projectDirectory: "/p",
      userPrompt: "hi",
      diagnostics,
    });
    return { result, diagnostics };
  }

  it("records a reasoning-only reply as empty-text with its block types", async () => {
    const { result, diagnostics } = run({
      content: [{ type: "thinking", text: "hmm" }],
      stopReason: "stop",
    });
    await expect(result).rejects.toThrow("invalid summary payload");
    expect(diagnostics).toMatchObject({
      path: "host-model",
      provider: "openai-codex",
      model: "gpt-5.6-luna",
      stopReason: "stop",
      blockTypes: ["thinking"],
      rawReply: "",
      failureReason: "empty-text",
    });
    expect(String(diagnostics.userPrompt)).toContain("ctx");
  });

  it("records a length stop with cut-off JSON as truncated", async () => {
    const { result, diagnostics } = run({
      content: [{ type: "text", text: '{"summary":"Added ret' }],
      stopReason: "length",
    });
    await expect(result).rejects.toThrow("invalid summary payload");
    expect(diagnostics).toMatchObject({ stopReason: "length", failureReason: "truncated" });
  });

  it("records an error stop as call-error", async () => {
    const { result, diagnostics } = run({ content: [], stopReason: "error" });
    await expect(result).rejects.toThrow("Pi extraction call failed");
    expect(diagnostics.failureReason).toBe("call-error");
  });

  it("leaves no failure reason on a valid reply", async () => {
    const { result, diagnostics } = run({
      content: [{ type: "text", text: '{"summary":"Did it","type":"feature","tags":[]}' }],
      stopReason: "stop",
    });
    await expect(result).resolves.toMatchObject({ summary: "Did it" });
    expect(diagnostics.failureReason).toBeUndefined();
  });
});

describe("Pi capture prompt", () => {
  it("asks the model for a single JSON object, since the Pi bridge gets plain text back", async () => {
    let sent = "";
    const provider = createPiCaptureProvider(() => ({
      provider: "p",
      modelId: "m",
      complete: async (context) => {
        sent = context.messages[0]?.content ?? "";
        return { content: [{ type: "text", text: '{"type":"skip"}' }], stopReason: "stop" };
      },
    }));
    await provider.summarize({
      context: "ctx",
      sessionId: "s",
      projectDirectory: "/p",
      userPrompt: "hi",
    });
    expect(sent).toContain("Reply with only one JSON object");
    expect(sent).toContain('"required":["summary","type","tags"]');
    expect(sent).not.toContain('type="skip"');
  });
});
