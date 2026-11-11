/**
 * OMMS talks to OpenCode only through the V2 plugin context (`ctx.generate`,
 * `ctx.session.context`, `ctx.model.list`). These tests drive each of those three
 * paths against the fake V2 context and check what OMMS sends and returns.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { z } from "zod";
import { createOpenCodeAutoCaptureHost } from "../src/adapters/opencode/auto-capture-host.js";
import {
  getOpencodeHost,
  listOpencodeModels,
  setOpencodeHost,
} from "../src/adapters/opencode/opencode-host.js";
import { generateStructuredOutput } from "../src/adapters/opencode/opencode-provider.js";
import { listOpencodeSettingsModels } from "../src/importer/settings-models.js";
import { createFakeV2Context } from "./fake-v2-context.js";

describe("structured output through the V2 context", () => {
  const schema = z.object({ summary: z.string(), tags: z.array(z.string()) });

  it("makes exactly one generate.text call and never touches a session", async () => {
    const fake = createFakeV2Context({ generateText: '{"summary":"done","tags":["v2"]}' });

    const result = await generateStructuredOutput({
      host: fake.ctx,
      providerID: "anthropic",
      modelID: "claude-haiku",
      systemPrompt: "system",
      userPrompt: "user",
      schema,
    });

    expect(result).toEqual({ summary: "done", tags: ["v2"] });
    expect(fake.calls.generate).toHaveLength(1);
    expect(fake.calls.prompt).toEqual([]);
    expect(fake.calls.synthetic).toEqual([]);
    expect(fake.calls.interrupt).toEqual([]);
    expect(fake.calls.context).toEqual([]);
    expect(fake.calls.get).toEqual([]);
  });

  it("sends only prompt and model, with the model as { providerID, id }", async () => {
    const fake = createFakeV2Context({ generateText: '{"summary":"done","tags":[]}' });

    await generateStructuredOutput({
      host: fake.ctx,
      providerID: "anthropic",
      modelID: "claude-haiku",
      systemPrompt: "system",
      userPrompt: "user",
      schema,
    });

    const input = fake.calls.generate[0]!;
    expect(Object.keys(input).sort()).toEqual(["model", "prompt"]);
    expect(input.model).toEqual({ providerID: "anthropic", id: "claude-haiku" });
    expect(typeof input.prompt).toBe("string");
  });

  it("rejects a reply that fails the schema, still with one call", async () => {
    const fake = createFakeV2Context({ generateText: '{"summary":1}' });

    await expect(
      generateStructuredOutput({
        host: fake.ctx,
        providerID: "anthropic",
        modelID: "claude-haiku",
        systemPrompt: "system",
        userPrompt: "user",
        schema,
      })
    ).rejects.toThrow();
    expect(fake.calls.generate).toHaveLength(1);
  });
});

describe("capture reads a conversation from session.context", () => {
  const messages = [
    { id: "u-1", type: "user", content: [{ type: "text", text: "fix the bug" }] },
    { id: "m-1", type: "model-switched" },
    { id: "g-1", type: "idle" },
    {
      id: "a-1",
      type: "assistant",
      content: [
        { type: "text", text: "Looking at it." },
        {
          type: "tool",
          name: "read",
          state: { status: "completed", input: { path: "src/a.ts" } },
        },
      ],
    },
    { id: "s-1", type: "agent-switched" },
    {
      id: "a-2",
      type: "assistant",
      content: [
        {
          type: "tool",
          name: "bash",
          state: { status: "error", input: { command: "false" }, error: "exit code 1" },
        },
        { type: "text", text: "Fixed it." },
      ],
    },
    { id: "u-2", type: "user", content: [{ type: "text", text: "now add a test" }] },
    { id: "a-3", type: "assistant", content: [{ type: "text", text: "after the next user turn" }] },
    { id: "y-1", type: "synthetic", content: [{ type: "text", text: "synthetic prompt" }] },
    { id: "a-4", type: "assistant", content: [{ type: "text", text: "after synthetic" }] },
    { id: "sys-1", type: "system", content: [{ type: "text", text: "system note" }] },
    { id: "a-5", type: "assistant", content: [{ type: "text", text: "after system" }] },
  ];

  function captureHost(sessionMessages = messages) {
    const fake = createFakeV2Context({ messages: { "session-1": sessionMessages } });
    return { fake, capture: createOpenCodeAutoCaptureHost(fake.ctx) };
  }

  it("collects assistant text and tool items, including a failed tool", async () => {
    const { fake, capture } = captureHost();

    const conversation = await capture.getConversation("session-1", "u-1");

    expect(fake.calls.context).toEqual(["session-1"]);
    expect(conversation).toEqual({
      textResponses: ["Looking at it.", "Fixed it."],
      toolCalls: [
        { name: "read", input: 'path: "src/a.ts"', outcome: "ok", path: "src/a.ts" },
        { name: "bash", input: 'command: "false"', outcome: "error", error: "exit code 1" },
      ],
      sourceEntryIds: ["a-1", "a-2"],
    });
  });

  it("stops at the next user message", async () => {
    const { capture } = captureHost();
    const conversation = await capture.getConversation("session-1", "u-1");
    expect(JSON.stringify(conversation)).not.toContain("after the next user turn");
  });

  it("stops at a synthetic message", async () => {
    const { capture } = captureHost([messages[0]!, messages[3]!, messages[8]!, messages[9]!]);
    const conversation = await capture.getConversation("session-1", "u-1");
    expect(conversation?.textResponses).toEqual(["Looking at it."]);
    expect(conversation?.sourceEntryIds).toEqual(["a-1"]);
  });

  it("stops at a system message", async () => {
    const { capture } = captureHost([messages[0]!, messages[3]!, messages[10]!, messages[11]!]);
    const conversation = await capture.getConversation("session-1", "u-1");
    expect(conversation?.textResponses).toEqual(["Looking at it."]);
    expect(conversation?.sourceEntryIds).toEqual(["a-1"]);
  });

  it("reads the reply after a later prompt from that prompt only", async () => {
    const { capture } = captureHost();
    const conversation = await capture.getConversation("session-1", "u-2");
    expect(conversation?.textResponses).toEqual(["after the next user turn"]);
    expect(conversation?.sourceEntryIds).toEqual(["a-3"]);
  });

  it("returns null for an unknown prompt id", async () => {
    const { capture } = captureHost();
    expect(await capture.getConversation("session-1", "missing")).toBeNull();
  });

  it("returns null when the session has no messages", async () => {
    const fake = createFakeV2Context();
    const capture = createOpenCodeAutoCaptureHost(fake.ctx);
    expect(await capture.getConversation("empty-session", "u-1")).toBeNull();
  });
});

describe("Settings model list from model.list()", () => {
  afterEach(() => {
    setOpencodeHost(undefined);
  });

  it("groups the listed models by provider as { provider, model, name } rows", async () => {
    const fake = createFakeV2Context({
      // Interleaved providers: the rows must come back grouped, in first-seen order.
      models: [
        { providerID: "anthropic", id: "claude", name: "Claude" },
        { providerID: "openai", id: "gpt", name: "GPT" },
        { providerID: "anthropic", id: "claude-fast", name: "Claude Fast" },
      ],
    });

    const listed = await listOpencodeSettingsModels(() => listOpencodeModels(fake.ctx));

    expect(listed).toEqual({
      available: true,
      models: [
        { provider: "anthropic", model: "claude", name: "Claude" },
        { provider: "anthropic", model: "claude-fast", name: "Claude Fast" },
        { provider: "openai", model: "gpt", name: "GPT" },
      ],
    });
    expect(fake.calls.modelList).toBe(1);
  });

  it("falls back to the model id when a model has no name", async () => {
    const fake = createFakeV2Context({
      models: [
        { providerID: "anthropic", id: "claude" },
        { providerID: "openai", id: "gpt", name: "" },
      ],
    });

    const listed = await listOpencodeSettingsModels(() => listOpencodeModels(fake.ctx));

    expect(listed.models).toEqual([
      { provider: "anthropic", model: "claude", name: "claude" },
      { provider: "openai", model: "gpt", name: "gpt" },
    ]);
  });

  it("reports the list as unavailable when model.list() fails", async () => {
    const fake = createFakeV2Context();
    fake.ctx.model.list = async () => {
      throw new Error("OpenCode is not ready");
    };

    const listed = await listOpencodeSettingsModels(() => listOpencodeModels(fake.ctx), null);

    expect(listed.available).toBe(false);
    expect(listed.models).toBeUndefined();
    expect(typeof listed.reason).toBe("string");
  });
});

describe("OpenCode host holder", () => {
  afterEach(() => {
    setOpencodeHost(undefined);
  });

  it("returns the host set in setup and undefined after a reset", () => {
    const fake = createFakeV2Context();
    setOpencodeHost(fake.ctx);
    expect(getOpencodeHost()).toBe(fake.ctx);
    setOpencodeHost(undefined);
    expect(getOpencodeHost()).toBeUndefined();
  });
});
