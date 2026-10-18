import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

const SECRET = "sk-test-SECRET-1234567890";
let baseDir: string;

type Call = { tool: string; system: string; user: string };

async function setup(
  replies: Partial<Record<"plan_search" | "answer", unknown>> = {},
  hits = [{ id: "m1", memory: "Use npm, not bun.", similarity: 0.9, containerTag: "p_a" }]
) {
  const { CONFIG } = await import("../src/config.js");
  CONFIG.storagePath = baseDir;
  const { ChatStore } = await import("../src/services/chat/chat-store.js");
  const { askQuestion } = await import("../src/services/chat/chat-service.js");
  const store = new ChatStore(join(baseDir, "chats.db"));
  await store.init();
  const calls: Call[] = [];
  const logs: string[] = [];
  const deps = {
    store,
    model: "test-model",
    callTool: async (system: string, user: string, tool: { function: { name: string } }) => {
      calls.push({ tool: tool.function.name, system, user });
      const reply = replies[tool.function.name as "plan_search" | "answer"];
      if (reply instanceof Error) throw reply;
      return (reply as any) ?? { success: false, error: "no reply" };
    },
    retrieve: {
      searchMemories: async () => hits,
      embed: async () => [1],
      profileItems: async () => [],
    },
    listTags: async () => [{ keyword: "bun", count: 3 }],
    profileCategories: async () => ["Tooling"],
    log: (message: string, meta: Record<string, unknown>) =>
      logs.push(message + JSON.stringify(meta)),
  };
  const conversation = await store.createConversation({ title: "New chat", scopeTag: "p_a" });
  return { store, deps, calls, logs, conversation, askQuestion };
}

const goodPlan = {
  success: true,
  data: { queries: ["npm or bun"], tags: ["bun"], profileCategories: [] },
};
const goodAnswer = {
  success: true,
  data: { answer: "Use npm [S1].", citations: ["S1"], insufficient: false },
};

describe("askQuestion", () => {
  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "chat-service-"));
  });
  afterEach(async () => {
    await cleanupTursoTestDirectory(baseDir);
  });

  it("answers with checked citations and saves the question, answer, and plan", async () => {
    const t = await setup({ plan_search: goodPlan, answer: goodAnswer });
    const out = await t.askQuestion(
      t.conversation.id,
      { question: "npm or bun?", scopeTag: "p_a" },
      t.deps
    );
    expect(out.ok).toBe(true);
    const full = await t.store.getConversation(t.conversation.id);
    expect(full?.conversation.title).toBe("npm or bun?");
    expect(full?.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    const answer = full!.messages[1]!;
    expect(answer.content).toBe("Use npm [S1].");
    expect(answer.sources[0]).toMatchObject({ label: "S1", id: "m1" });
    expect(answer.plan).toMatchObject({ queries: ["npm or bun"], tags: ["bun"], skipped: false });
    expect(t.calls.map((c) => c.tool)).toEqual(["plan_search", "answer"]);
  });

  it("strips private text before the model and the store", async () => {
    const t = await setup({ plan_search: goodPlan, answer: goodAnswer });
    await t.askQuestion(
      t.conversation.id,
      { question: "why did this fail <private>token abc123</private>", scopeTag: "p_a" },
      t.deps
    );
    for (const call of t.calls) expect(call.user).not.toContain("abc123");
    const full = await t.store.getConversation(t.conversation.id);
    expect(JSON.stringify(full)).not.toContain("abc123");
  });

  it("refuses a fully private question without a model call", async () => {
    const t = await setup({ plan_search: goodPlan, answer: goodAnswer });
    const out = await t.askQuestion(
      t.conversation.id,
      { question: "<private>only secrets</private>", scopeTag: "p_a" },
      t.deps
    );
    expect(out).toMatchObject({ ok: false, status: 400, code: "private" });
    expect(t.calls).toHaveLength(0);
    expect(await t.store.countMessages()).toBe(0);
  });

  it("falls back to the question when the plan call fails, and records it", async () => {
    const t = await setup({ plan_search: new Error("timeout"), answer: goodAnswer });
    const out = await t.askQuestion(
      t.conversation.id,
      { question: "npm or bun?", scopeTag: "p_a" },
      t.deps
    );
    expect(out.ok).toBe(true);
    const full = await t.store.getConversation(t.conversation.id);
    expect(full!.messages[1]!.plan).toEqual({
      queries: ["npm or bun?"],
      tags: [],
      profileCategories: [],
      skipped: true,
    });
  });

  it("says nothing was found and makes no answer call when there are no sources", async () => {
    const t = await setup({ plan_search: goodPlan, answer: goodAnswer }, []);
    await t.askQuestion(t.conversation.id, { question: "unknown?", scopeTag: "p_a" }, t.deps);
    expect(t.calls.map((c) => c.tool)).toEqual(["plan_search"]);
    const full = await t.store.getConversation(t.conversation.id);
    expect(full!.messages[1]).toMatchObject({ notice: "no_sources", errorCode: null });
  });

  it("saves the question with an error code when the answer call fails, without the key", async () => {
    const t = await setup({
      plan_search: goodPlan,
      answer: { success: false, error: `401 bad key ${SECRET}`, httpStatus: 401 },
    });
    const out = await t.askQuestion(
      t.conversation.id,
      { question: "npm or bun?", scopeTag: "p_a" },
      t.deps
    );
    expect(JSON.stringify(out)).not.toContain(SECRET);
    const full = await t.store.getConversation(t.conversation.id);
    expect(full!.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(full!.messages[1]).toMatchObject({ errorCode: "model_http_401", content: "" });
    expect(JSON.stringify(full)).not.toContain(SECRET);
    expect(t.logs.join("\n")).not.toContain(SECRET);
  });

  it("retries a failed answer without a second copy of the question", async () => {
    const t = await setup({ plan_search: goodPlan, answer: new Error("down") });
    await t.askQuestion(t.conversation.id, { question: "npm or bun?", scopeTag: "p_a" }, t.deps);
    (t.deps as any).callTool = async (_s: string, _u: string, tool: any) =>
      tool.function.name === "plan_search" ? goodPlan : goodAnswer;
    await t.askQuestion(
      t.conversation.id,
      { question: "npm or bun?", scopeTag: "p_a", retry: true },
      t.deps
    );
    const full = await t.store.getConversation(t.conversation.id);
    expect(full!.messages.map((m) => [m.role, m.errorCode])).toEqual([
      ["user", null],
      ["assistant", null],
    ]);
  });

  it("answers the stored question on retry, not the text in the request", async () => {
    const t = await setup({ plan_search: goodPlan, answer: new Error("down") });
    await t.askQuestion(t.conversation.id, { question: "npm or bun?", scopeTag: "p_a" }, t.deps);
    const seen: string[] = [];
    (t.deps as any).callTool = async (_s: string, user: string, tool: any) => {
      seen.push(user);
      return tool.function.name === "plan_search" ? goodPlan : goodAnswer;
    };
    await t.askQuestion(
      t.conversation.id,
      { question: "something else entirely", scopeTag: "p_a", retry: true },
      t.deps
    );
    expect(seen.join("\n")).toContain("npm or bun?");
    expect(seen.join("\n")).not.toContain("something else entirely");
    const full = await t.store.getConversation(t.conversation.id);
    expect(full!.messages[0]!.content).toBe("npm or bun?");
  });

  it("logs no question, answer, or source text", async () => {
    const t = await setup({ plan_search: goodPlan, answer: goodAnswer });
    await t.askQuestion(t.conversation.id, { question: "npm or bun?", scopeTag: "p_a" }, t.deps);
    const logs = t.logs.join("\n");
    expect(logs.length).toBeGreaterThan(0);
    expect(logs).not.toContain("npm or bun");
    expect(logs).not.toContain("Use npm");
  });

  it("returns 404 for an unknown conversation", async () => {
    const t = await setup();
    const out = await t.askQuestion("missing", { question: "q", scopeTag: null }, t.deps);
    expect(out).toMatchObject({ ok: false, status: 404 });
  });
});
