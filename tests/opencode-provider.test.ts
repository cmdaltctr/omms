import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import {
  generateStructuredOutput,
  getOpencodeHost,
  isProviderConnected,
  parseJsonReply,
  resolveOpencodeModelRef,
  setConnectedProviders,
  setStructuredOutputTimeoutMsForTests,
} from "../src/adapters/opencode/opencode-provider.js";
import {
  rememberOpencodeSessionModel,
  setOpencodeHost,
} from "../src/adapters/opencode/opencode-host.js";
import { createFakeV2Context } from "./fake-v2-context.js";

const schema = z.object({
  topic: z.string(),
  count: z.number(),
});

/** Run one structured-output call against a fake V2 context that replies with `reply`. */
function run(
  reply: string | (() => string | Promise<string>),
  extra: Partial<Parameters<typeof generateStructuredOutput<z.infer<typeof schema>>>[0]> = {}
) {
  const fake = createFakeV2Context({
    generateText: typeof reply === "function" ? () => reply() : reply,
  });
  const result = generateStructuredOutput({
    host: fake.ctx,
    providerID: "github-copilot",
    modelID: "gpt-4o-mini",
    systemPrompt: "system rules",
    userPrompt: "user turn",
    schema,
    ...extra,
  });
  return { fake, result };
}

describe("connected providers state", () => {
  afterEach(() => {
    setConnectedProviders([]);
  });

  it("setConnectedProviders + isProviderConnected reflect known providers", () => {
    setConnectedProviders(["anthropic", "github-copilot"]);
    expect(isProviderConnected("anthropic")).toBe(true);
    expect(isProviderConnected("github-copilot")).toBe(true);
    expect(isProviderConnected("openai")).toBe(false);
  });

  it("setConnectedProviders replaces previous state on each call", () => {
    setConnectedProviders(["anthropic"]);
    setConnectedProviders(["openai"]);
    expect(isProviderConnected("anthropic")).toBe(false);
    expect(isProviderConnected("openai")).toBe(true);
  });
});

describe("OpenCode host re-export", () => {
  afterEach(() => {
    setOpencodeHost(undefined);
  });

  it("getOpencodeHost returns the host that setOpencodeHost stored", () => {
    expect(getOpencodeHost()).toBeUndefined();
    const fake = createFakeV2Context();
    setOpencodeHost(fake.ctx);
    expect(getOpencodeHost()).toBe(fake.ctx);
  });
});

describe("generateStructuredOutput", () => {
  beforeEach(() => {
    setStructuredOutputTimeoutMsForTests(undefined);
  });

  afterEach(() => {
    setStructuredOutputTimeoutMsForTests(undefined);
  });

  it("returns the parsed, validated object from the generated text", async () => {
    const { result } = run('{"topic":"auth","count":3}');
    expect(await result).toEqual({ topic: "auth", count: 3 });
  });

  it("sends system prompt, user prompt and the JSON schema in one prompt", async () => {
    const { fake, result } = run('{"topic":"auth","count":3}');
    await result;

    expect(fake.calls.generate).toHaveLength(1);
    const { prompt, model } = fake.calls.generate[0]!;
    expect(model).toEqual({ providerID: "github-copilot", id: "gpt-4o-mini" });
    expect(prompt).toContain("system rules");
    expect(prompt).toContain("user turn");
    expect(prompt).toContain("Return only one JSON object");
    expect(prompt).toContain('"required":["topic","count"]');
    expect(prompt.indexOf("system rules")).toBeLessThan(prompt.indexOf("user turn"));
    expect(prompt.indexOf("user turn")).toBeLessThan(prompt.indexOf("Return only one JSON object"));
  });

  it("parses a reply wrapped in a fenced JSON block", async () => {
    const { result } = run('```json\n{"topic":"auth","count":3}\n```');
    expect(await result).toEqual({ topic: "auth", count: 3 });
  });

  it("parses a reply with prose around the outer braces", async () => {
    const { result } = run('Here you go: {"topic":"auth","count":3} Hope that helps.');
    expect(await result).toEqual({ topic: "auth", count: 3 });
  });

  it("rejects a reply that has no JSON object", async () => {
    const { result } = run("I cannot do that.");
    await expect(result).rejects.toThrow(/did not return a JSON object/);
  });

  it("rejects an empty or blank reply as empty", async () => {
    const { result } = run("");
    await expect(result).rejects.toThrow(/returned an empty reply/);
  });

  it("rejects when the reply does not match the schema", async () => {
    const { result } = run('{"topic":42}');
    await expect(result).rejects.toThrow();
  });

  it("propagates a failed generation request", async () => {
    const { result } = run(() => {
      throw new Error("provider is down");
    });
    await expect(result).rejects.toThrow("provider is down");
  });

  it("reports the parsed reply to onReply before validation, even when validation fails", async () => {
    const replies: unknown[] = [];
    const { result } = run('{"topic":42}', { onReply: (reply) => replies.push(reply) });
    await expect(result).rejects.toThrow();

    expect(replies).toEqual([{ partTypes: ["text"], structuredOutput: { topic: 42 } }]);
  });

  it("ignores an onReply callback that throws", async () => {
    const { result } = run('{"topic":"auth","count":3}', {
      onReply: () => {
        throw new Error("diagnostics failed");
      },
    });
    expect(await result).toEqual({ topic: "auth", count: 3 });
  });

  it("times out when the generation never returns", async () => {
    setStructuredOutputTimeoutMsForTests(50);
    const { result } = run(() => new Promise<string>(() => {}));
    await expect(result).rejects.toThrow(/structured-output timed out after 50ms/);
  });

  it("does not time out a reply that arrives in time", async () => {
    setStructuredOutputTimeoutMsForTests(500);
    const { result } = run(async () => '{"topic":"auth","count":3}');
    expect(await result).toEqual({ topic: "auth", count: 3 });
  });
});

describe("parseJsonReply", () => {
  it("parses a plain JSON reply", () => {
    expect(parseJsonReply(' {"a":1} ')).toEqual({ a: 1 });
  });

  it("parses a fenced block without a language tag", () => {
    expect(parseJsonReply('```\n{"a":1}\n```')).toEqual({ a: 1 });
  });

  it("reports invalid JSON inside braces as no JSON object, without the reply text", () => {
    const reply = 'Here: {"summary": my private note}';
    let error: unknown;
    try {
      parseJsonReply(reply);
    } catch (caught) {
      error = caught;
    }
    // Node's SyntaxError quotes part of the reply; the log must never carry it.
    expect(String(error)).toContain("did not return a JSON object");
    expect(String(error)).not.toContain("private");
  });
});

describe("resolveOpencodeModelRef / inherit", () => {
  const originalStateHome = process.env.XDG_STATE_HOME;
  let tempRoot: string | undefined;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), "opencode-mem-inherit-"));
    process.env.XDG_STATE_HOME = tempRoot;
  });

  afterEach(() => {
    rememberOpencodeSessionModel(undefined);
    if (originalStateHome === undefined) {
      delete process.env.XDG_STATE_HOME;
    } else {
      process.env.XDG_STATE_HOME = originalStateHome;
    }
    if (tempRoot) {
      rmSync(tempRoot, { recursive: true, force: true });
      tempRoot = undefined;
    }
  });

  function writeModelJson(recent: Array<{ providerID: string; modelID: string }>): void {
    const stateDir = join(tempRoot!, "opencode");
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(stateDir, "model.json"), JSON.stringify({ recent }));
  }

  it("passes concrete model ids through unchanged", () => {
    expect(resolveOpencodeModelRef({ providerID: "local", modelID: "h100/qwen:latest" })).toEqual({
      providerID: "local",
      modelID: "h100/qwen:latest",
    });
  });

  it("prefers the recorded prompt model when modelID is inherit", () => {
    expect(
      resolveOpencodeModelRef({
        providerID: "local",
        modelID: "inherit",
        prompt: { providerId: "anthropic", modelId: "claude-haiku-4-5-20251001" },
      })
    ).toEqual({
      providerID: "anthropic",
      modelID: "claude-haiku-4-5-20251001",
    });
  });

  it("falls back to OpenCode recent model.json when inherit has no prompt model", () => {
    writeModelJson([
      { providerID: "openai", modelID: "gpt-4o-mini" },
      { providerID: "local", modelID: "h100/qwen:latest" },
    ]);
    expect(resolveOpencodeModelRef({ providerID: "local", modelID: "inherit" })).toEqual({
      providerID: "local",
      modelID: "h100/qwen:latest",
    });
  });

  it("uses the latest session model the plugin saw before model.json", () => {
    writeModelJson([{ providerID: "local", modelID: "h100/qwen:latest" }]);
    rememberOpencodeSessionModel({ providerID: "zai-coding-plan", id: "glm-5.3-flash" });
    expect(resolveOpencodeModelRef({ providerID: "local", modelID: "inherit" })).toEqual({
      providerID: "zai-coding-plan",
      modelID: "glm-5.3-flash",
    });
  });

  it("uses the latest session model when OpenCode has no model.json", () => {
    rememberOpencodeSessionModel({ providerID: "zai-coding-plan", id: "glm-5.3-flash" });
    rememberOpencodeSessionModel({ providerID: "anthropic", id: "claude-test" });
    expect(resolveOpencodeModelRef({ providerID: "local", modelID: "inherit" })).toEqual({
      providerID: "anthropic",
      modelID: "claude-test",
    });
  });

  it("still prefers the prompt's own model over the latest session model", () => {
    rememberOpencodeSessionModel({ providerID: "zai-coding-plan", id: "glm-5.3-flash" });
    expect(
      resolveOpencodeModelRef({
        providerID: "local",
        modelID: "inherit",
        prompt: { providerId: "anthropic", modelId: "claude-test" },
      })
    ).toEqual({ providerID: "anthropic", modelID: "claude-test" });
  });

  it("throws a clear error when inherit has no prompt model and no recent list", () => {
    expect(() => resolveOpencodeModelRef({ providerID: "local", modelID: "inherit" })).toThrow(
      /no session model was recorded and no recent OpenCode model is available/
    );
  });

  it("expands inherit before generate.text so OpenCode never sees modelID=inherit", async () => {
    writeModelJson([{ providerID: "local", modelID: "h100/qwen:latest" }]);
    const fake = createFakeV2Context({ generateText: '{"topic":"auth","count":3}' });

    const result = await generateStructuredOutput({
      host: fake.ctx,
      providerID: "local",
      modelID: "inherit",
      systemPrompt: "system",
      userPrompt: "user",
      schema,
    });

    expect(result).toEqual({ topic: "auth", count: 3 });
    expect(fake.calls.generate).toHaveLength(1);
    expect(fake.calls.generate[0]!.model).toEqual({ providerID: "local", id: "h100/qwen:latest" });
  });
});
