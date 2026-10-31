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

// A fixed copy of the gate-off plan text and of today's log keys.
const GATE_OFF_PLAN_SYSTEM = [
  "You plan a search over one user's saved memories of past coding sessions and their profile.",
  "Return 1 to 3 short search phrases that would find memories answering the question.",
  "Resolve follow-up questions with the earlier turns, so each phrase stands alone.",
  "Pick tags and profile categories only from the lists given. Pick none when none fit.",
  "Call plan_search. Do not answer the question.",
].join(" ");
const GATE_OFF_PLAN_USER = [
  "Earlier turns: none",
  "Tags (count): bun (3)",
  "Profile categories: Tooling",
  "Question: npm or bun?",
].join("\n\n");
const TODAY_LOG_KEYS = [
  "answerChars",
  "categories",
  "cited",
  "conversationId",
  "ms",
  "outcome",
  "planSkipped",
  "queries",
  "sources",
  "tags",
];

const SKILL_ROWS = [
  {
    name: "alpha",
    path: "/Users/sam/.agents/skills/alpha/SKILL.md",
    uses: 10,
    failedTurns: 4,
    attention: 0.4,
    modified: false,
    lastAppliedAt: null,
  },
  {
    name: "beta",
    path: "/work/skills/beta/SKILL.md",
    uses: 5,
    failedTurns: 0,
    attention: 0.14,
    modified: true,
    lastAppliedAt: Date.UTC(2026, 9, 5),
  },
];

async function skillDeps(over: Record<string, unknown> = {}) {
  const { makeScrubContext } = await import("../src/services/chat/chat-skills.js");
  return {
    scrub: makeScrubContext({}, { home: "/Users/sam", user: "sam" }),
    rank: async () => SKILL_ROWS,
    history: async () => [
      {
        kind: "applied" as const,
        at: Date.UTC(2026, 9, 5),
        summary: "Edited /Users/sam/.agents/skills/alpha/SKILL.md for sam@example.com",
        appliedBy: "person",
      },
    ],
    ...over,
  };
}

const skillPlan = (data: Record<string, unknown>) => ({
  success: true,
  data: { queries: ["skills"], tags: [], profileCategories: [], ...data },
});
const skillAnswer = {
  success: true,
  data: { answer: "Alpha fails often [K1].", citations: ["K1"], insufficient: false },
};

describe("askQuestion with the skill gate off", () => {
  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "chat-service-"));
  });
  afterEach(async () => {
    await cleanupTursoTestDirectory(baseDir);
  });

  it("sends, saves and logs exactly what today's code does", async () => {
    const t = await setup({ plan_search: goodPlan, answer: goodAnswer });
    await t.askQuestion(t.conversation.id, { question: "npm or bun?", scopeTag: "p_a" }, t.deps);
    expect(t.calls[0]).toMatchObject({
      tool: "plan_search",
      system: GATE_OFF_PLAN_SYSTEM,
      user: GATE_OFF_PLAN_USER,
    });
    const system = t.calls[1]!.system;
    expect(system.toLowerCase()).not.toContain("skill");
    const full = await t.store.getConversation(t.conversation.id);
    const message = full!.messages[1]!;
    expect(Object.keys(message.plan!).sort()).toEqual([
      "profileCategories",
      "queries",
      "skipped",
      "tags",
    ]);
    expect(message.sources.map((source) => source.kind)).toEqual(["memory"]);
    const record = t.logs.find((line) => line.startsWith("chat: question answered"))!;
    const meta = JSON.parse(record.slice("chat: question answered".length));
    expect(Object.keys(meta).sort()).toEqual(TODAY_LOG_KEYS);
    expect(t.logs).toHaveLength(1);
  });
});

describe("askQuestion with the skill gate on", () => {
  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "chat-service-"));
  });
  afterEach(async () => {
    await cleanupTursoTestDirectory(baseDir);
  });

  it("gives the plan the skill names and saves K sources with the answer", async () => {
    const t = await setup({
      plan_search: skillPlan({ skills: ["ALPHA"], skillIntent: "none" }),
      answer: skillAnswer,
    });
    (t.deps as any).skills = await skillDeps();
    await t.askQuestion(t.conversation.id, { question: "about alpha?", scopeTag: "p_a" }, t.deps);
    expect(t.calls[0]!.user).toContain("Skills: alpha, beta");
    const full = await t.store.getConversation(t.conversation.id);
    const message = full!.messages[1]!;
    expect(message.sources.map((source) => source.label)).toEqual(["S1", "K1"]);
    expect(message.sources[1]).toMatchObject({ kind: "skill", id: "alpha" });
    expect(message.sources[1]!.skill).toMatchObject({ name: "alpha", uses: 10, failedTurns: 4 });
    expect(message.plan).toMatchObject({ skills: ["alpha"], skillIntent: "none" });
    expect(message.content).toBe("Alpha fails often [K1].");
  });

  it("makes the answer call when only skill sources are found", async () => {
    const t = await setup(
      { plan_search: skillPlan({ skillIntent: "needs-work" }), answer: skillAnswer },
      []
    );
    (t.deps as any).skills = await skillDeps();
    await t.askQuestion(
      t.conversation.id,
      { question: "which need work?", scopeTag: "p_a" },
      t.deps
    );
    expect(t.calls.map((c) => c.tool)).toEqual(["plan_search", "answer"]);
    const full = await t.store.getConversation(t.conversation.id);
    expect(full!.messages[1]!.sources.map((source) => source.id)).toEqual(["alpha"]);
    expect(full!.messages[1]!.notice).toBeNull();
  });

  it("keeps 12 places for memories when 6 skill sources are found", async () => {
    const hits = Array.from({ length: 15 }, (_, i) => ({
      id: `m${i}`,
      memory: `memory ${i}`,
      similarity: 0.9 - i / 100,
      containerTag: "p_a",
    }));
    const t = await setup(
      { plan_search: skillPlan({ skillIntent: "most-used" }), answer: skillAnswer },
      hits
    );
    const many = Array.from({ length: 8 }, (_, i) => ({
      ...SKILL_ROWS[0]!,
      name: `skill-${i}`,
      uses: 20 - i,
    }));
    (t.deps as any).skills = await skillDeps({ rank: async () => many });
    await t.askQuestion(t.conversation.id, { question: "most used?", scopeTag: "p_a" }, t.deps);
    const full = await t.store.getConversation(t.conversation.id);
    const kinds = full!.messages[1]!.sources.map((source) => source.kind);
    expect(kinds.filter((kind) => kind === "memory")).toHaveLength(12);
    expect(kinds.filter((kind) => kind === "skill")).toHaveLength(6);
  });

  it("matches a skill name in the question when the plan call fails", async () => {
    const t = await setup({ plan_search: new Error("timeout"), answer: skillAnswer }, []);
    (t.deps as any).skills = await skillDeps();
    await t.askQuestion(
      t.conversation.id,
      { question: "What changed in Alpha?", scopeTag: "p_a" },
      t.deps
    );
    const full = await t.store.getConversation(t.conversation.id);
    expect(full!.messages[1]!.sources.map((source) => source.id)).toEqual(["alpha"]);
    expect(full!.messages[1]!.plan!.skills).toBeUndefined();
  });

  for (const [label, error] of [
    ["a newer skills.db", Object.assign(new Error("newer"), { code: "newer_schema" })],
    ["a reader that throws", new Error("boom")],
  ] as const) {
    it(`answers without skill facts for ${label}`, async () => {
      const t = await setup({ plan_search: goodPlan, answer: goodAnswer });
      (t.deps as any).skills = await skillDeps({
        rank: async () => {
          throw error;
        },
      });
      await t.askQuestion(t.conversation.id, { question: "npm or bun?", scopeTag: "p_a" }, t.deps);
      expect(t.calls[0]).toMatchObject({
        system: GATE_OFF_PLAN_SYSTEM,
        user: GATE_OFF_PLAN_USER,
      });
      const full = await t.store.getConversation(t.conversation.id);
      const message = full!.messages[1]!;
      expect(message.sources.every((source) => source.kind === "memory")).toBe(true);
      expect(message.plan!.skillFacts).toBe("unavailable");
      const records = t.logs.filter((line) => line.startsWith("chat: skill facts unavailable"));
      expect(records).toHaveLength(1);
      expect(records[0]).toContain(label === "a newer skills.db" ? "newer_schema" : "read_failed");
      expect(records[0]).not.toContain("boom");
    });
  }

  it("keeps the home folder, user name, paths and emails out of chats.db", async () => {
    const t = await setup({
      plan_search: skillPlan({ skills: ["alpha"] }),
      answer: skillAnswer,
    });
    (t.deps as any).skills = await skillDeps();
    await t.askQuestion(t.conversation.id, { question: "about alpha?", scopeTag: "p_a" }, t.deps);
    const { tursoConnectionManager } = await import("../src/services/turso/connection-manager.js");
    const db = await tursoConnectionManager.getConnection(join(baseDir, "chats.db"));
    const rows = await db.all(
      "SELECT sources_json, plan_json FROM chat_messages WHERE role = 'assistant'"
    );
    const raw = JSON.stringify(rows);
    expect(raw).toContain('\\"kind\\":\\"skill\\"');
    expect(raw).toContain("alpha");
    for (const leak of ["/Users/", "sam@", ".agents/skills", "SKILL.md"]) {
      expect(raw).not.toContain(leak);
    }
    for (const call of t.calls) {
      expect(call.user).not.toContain("/Users/");
      expect(call.user).not.toContain("sam@");
    }
  });

  it("drops a skill named after the OS user", async () => {
    const t = await setup({ plan_search: skillPlan({ skills: ["sam"] }), answer: skillAnswer }, []);
    (t.deps as any).skills = await skillDeps({
      rank: async () => [{ ...SKILL_ROWS[0]!, name: "sam", path: "/Users/sam/SKILL.md" }],
    });
    await t.askQuestion(t.conversation.id, { question: "about sam?", scopeTag: "p_a" }, t.deps);
    expect(t.calls[0]!.user).not.toContain("sam,");
    expect(t.calls[0]!.user).toContain("Skills: none");
    const full = await t.store.getConversation(t.conversation.id);
    expect(JSON.stringify(full)).not.toContain('"id":"sam"');
  });
});
