import { afterAll, beforeAll, describe, expect, it, mock } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

const baseDir = mkdtempSync(join(tmpdir(), "chat-routes-"));
const { CONFIG } = await import("../src/config.js");
CONFIG.storagePath = baseDir;

const { ChatStore } = await import("../src/services/chat/chat-store.js");
const store = new ChatStore(join(baseDir, "chats.db"));
const asked: Array<{ id: string; question: string }> = [];
// What the mocked ranking lists; null stands for a ranking that cannot be read.
let listed: string[] | null = ["alpha"];

mock.module("../src/services/chat/chat-runtime.js", () => ({
  chatStore: async () => store,
  existingMemoryIds: async (ids: string[]) => new Set(ids.filter((id) => id !== "gone")),
  listedSkillNames: async () => (listed ? new Set(listed) : null),
  chatServiceDeps: async () => ({
    store,
    model: "m",
    callTool: async (_s: string, _u: string, tool: any) =>
      tool.function.name === "plan_search"
        ? { success: true, data: { queries: ["q"], tags: [], profileCategories: [] } }
        : { success: true, data: { answer: "A [S1].", citations: ["S1"], insufficient: false } },
    retrieve: {
      searchMemories: async (query: string) => {
        asked.push({ id: "", question: query });
        return [{ id: "m1", memory: "memory", similarity: 0.8 }];
      },
      embed: async () => [1],
      profileItems: async () => [],
    },
    listTags: async () => [],
    profileCategories: async () => [],
    log: () => {},
  }),
}));

const { getOrCreateAuthToken } = await import("../src/services/auth-token.js");
const { WebServer } = await import("../src/services/web-server.js");
const server = new WebServer({ enabled: true, host: "127.0.0.1", port: 4747 });

async function call(method: string, path: string, body?: unknown) {
  const response: Response = await (server as any).handleRequest(
    new Request(`http://127.0.0.1:4747${path}`, {
      method,
      headers: { "x-omms-token": getOrCreateAuthToken(), "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  );
  return { status: response.status, json: (await response.json().catch(() => null)) as any };
}

beforeAll(async () => {
  await store.init();
});
afterAll(async () => {
  await cleanupTursoTestDirectory(baseDir);
});

describe("chat routes", () => {
  it("reports missing settings by name, never by value", async () => {
    CONFIG.memoryModel = "model-x";
    CONFIG.memoryApiUrl = "https://api.example.com/v1";
    CONFIG.memoryApiKey = "";
    const missing = await call("GET", "/api/chat/status");
    expect(missing.json.data).toMatchObject({
      ready: false,
      missing: ["memoryApiKey"],
      apiHost: "api.example.com",
    });

    CONFIG.memoryApiKey = "sk-real-SECRET-value";
    const ready = await call("GET", "/api/chat/status");
    expect(ready.json.data.ready).toBe(true);
    expect(JSON.stringify(ready.json)).not.toContain("SECRET");
  });

  it("creates, lists, gets, renames, moves, and deletes conversations", async () => {
    const folder = await call("POST", "/api/chat/folders", { name: "Thesis" });
    expect(folder.status).toBe(200);
    const created = await call("POST", "/api/chat/conversations", {
      folderId: folder.json.data.id,
      scopeTag: null,
    });
    const id = created.json.data.id;
    expect(created.json.data.folderId).toBe(folder.json.data.id);

    const list = await call("GET", "/api/chat/conversations");
    expect(list.json.data.conversations.map((c: any) => c.id)).toContain(id);
    expect(list.json.data.readOnly).toBe(false);

    expect((await call("PATCH", `/api/chat/conversations/${id}`, { title: "T" })).status).toBe(200);
    expect((await call("PATCH", `/api/chat/conversations/${id}`, { folderId: null })).status).toBe(
      200
    );
    const got = await call("GET", `/api/chat/conversations/${id}`);
    expect(got.json.data.conversation).toMatchObject({ title: "T", folderId: null });

    expect((await call("DELETE", `/api/chat/conversations/${id}`)).status).toBe(200);
    expect((await call("GET", `/api/chat/conversations/${id}`)).status).toBe(404);
  });

  it("bulk deletes, and refuses an unknown id without deleting anything", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      ids.push((await call("POST", "/api/chat/conversations", { scopeTag: null })).json.data.id);
    }
    const bad = await call("POST", "/api/chat/conversations/bulk-delete", {
      ids: [ids[0], "nope"],
    });
    expect(bad.status).toBe(404);
    expect((await call("GET", `/api/chat/conversations/${ids[0]}`)).status).toBe(200);

    const good = await call("POST", "/api/chat/conversations/bulk-delete", { ids });
    expect(good.json.data.deleted).toBe(3);
    expect((await call("POST", "/api/chat/conversations/bulk-delete", { ids: [] })).status).toBe(
      400
    );
  });

  it("lists folders with counts, renames with 409 on a duplicate, and deletes with chats", async () => {
    const a = (await call("POST", "/api/chat/folders", { name: "Alpha" })).json.data;
    const b = (await call("POST", "/api/chat/folders", { name: "Beta" })).json.data;
    await call("POST", "/api/chat/conversations", { folderId: a.id, scopeTag: null });
    await call("POST", "/api/chat/conversations", { folderId: a.id, scopeTag: null });

    const folders = await call("GET", "/api/chat/folders");
    expect(folders.json.data.find((f: any) => f.id === a.id).conversationCount).toBe(2);

    expect((await call("PATCH", `/api/chat/folders/${b.id}`, { name: "alpha" })).status).toBe(409);
    expect((await call("POST", "/api/chat/folders", { name: "BETA" })).status).toBe(409);
    expect((await call("PATCH", `/api/chat/folders/${b.id}`, { name: "Gamma" })).status).toBe(200);

    const removed = await call("DELETE", `/api/chat/folders/${a.id}`);
    expect(removed.json.data.deletedConversations).toBe(2);
    expect((await call("DELETE", `/api/chat/folders/${a.id}`)).status).toBe(404);
  });

  it("asks a question, and rejects an empty question or an unknown conversation", async () => {
    const id = (await call("POST", "/api/chat/conversations", { scopeTag: null })).json.data.id;
    const answered = await call("POST", `/api/chat/conversations/${id}/messages`, {
      question: "What did we decide?",
      scopeTag: null,
    });
    expect(answered.status).toBe(200);
    expect(answered.json.data.messages.map((m: any) => m.role)).toEqual(["user", "assistant"]);
    expect(answered.json.data.messages[1].content).toBe("A [S1].");
    const reopened = await call("GET", `/api/chat/conversations/${id}`);
    expect(reopened.json.data.missingMemoryIds).toEqual([]);

    const empty = await call("POST", `/api/chat/conversations/${id}/messages`, {
      question: "   ",
      scopeTag: null,
    });
    expect(empty.status).toBe(400);
    const unknown = await call("POST", "/api/chat/conversations/nope/messages", {
      question: "q",
      scopeTag: null,
    });
    expect(unknown.status).toBe(404);
    const badScope = await call("POST", `/api/chat/conversations/${id}/messages`, {
      question: "q",
      scopeTag: "../../etc",
    });
    expect(badScope.status).toBe(400);
  });

  it("refuses to ask when the model settings are incomplete", async () => {
    const id = (await call("POST", "/api/chat/conversations", { scopeTag: null })).json.data.id;
    CONFIG.memoryApiKey = "";
    const out = await call("POST", `/api/chat/conversations/${id}/messages`, {
      question: "q",
      scopeTag: null,
    });
    expect(out.status).toBe(409);
    expect(out.json.code).toBe("not_configured");
    CONFIG.memoryApiKey = "sk-real-SECRET-value";
  });

  it("reports skillFacts from the effective skillLearning value", async () => {
    CONFIG.skillLearning = true;
    expect((await call("GET", "/api/chat/status")).json.data.skillFacts).toBe(true);
    CONFIG.skillLearning = false;
    expect((await call("GET", "/api/chat/status")).json.data.skillFacts).toBe(false);
    CONFIG.skillLearning = undefined as never;
    expect((await call("GET", "/api/chat/status")).json.data.skillFacts).toBe(false);
  });

  describe("missingSkillNames", () => {
    async function seed() {
      const conversation = await store.createConversation({ title: "Skills", scopeTag: null });
      await store.appendMessage(conversation.id, {
        role: "assistant",
        content: "A [K1] [K2]",
        sources: [
          { label: "K1", kind: "skill", id: "alpha", text: "alpha: 1 use" },
          { label: "K2", kind: "skill", id: "gone-skill", text: "gone-skill: 1 use" },
        ],
      });
      return conversation.id;
    }

    it("lists a K source whose skill the ranking no longer lists", async () => {
      CONFIG.skillLearning = true;
      listed = ["alpha"];
      const got = await call("GET", `/api/chat/conversations/${await seed()}`);
      expect(got.json.data.missingSkillNames).toEqual(["gone-skill"]);
    });

    it("returns an empty list, with no error, when the ranking cannot be read", async () => {
      CONFIG.skillLearning = true;
      listed = null;
      const got = await call("GET", `/api/chat/conversations/${await seed()}`);
      expect(got.status).toBe(200);
      expect(got.json.data.missingSkillNames).toEqual([]);
    });

    it("returns an empty list when skill learning is off", async () => {
      CONFIG.skillLearning = false;
      listed = ["alpha"];
      const got = await call("GET", `/api/chat/conversations/${await seed()}`);
      expect(got.json.data.missingSkillNames).toEqual([]);
    });
  });
});
