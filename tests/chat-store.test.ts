import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

let baseDir: string;

async function openStore(dir = baseDir) {
  const { CONFIG } = await import("../src/config.js");
  CONFIG.storagePath = baseDir;
  const { ChatStore } = await import("../src/services/chat/chat-store.js");
  const store = new ChatStore(join(dir, "chats.db"));
  await store.init();
  return store;
}

describe("chat store", () => {
  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "chat-store-"));
  });

  afterEach(async () => {
    await cleanupTursoTestDirectory(baseDir);
  });

  it("creates, lists newest first, renames, and deletes conversations", async () => {
    const store = await openStore();
    const a = await store.createConversation({ title: "First", scopeTag: "p_a" });
    const b = await store.createConversation({ title: "Second", scopeTag: null });
    expect((await store.listConversations()).map((c) => c.id)).toEqual([b.id, a.id]);

    await store.renameConversation(a.id, "Renamed");
    const list = await store.listConversations();
    expect(list[0]?.id).toBe(a.id);
    expect(list[0]?.title).toBe("Renamed");

    await store.deleteConversation(b.id);
    expect((await store.listConversations()).map((c) => c.id)).toEqual([a.id]);
    expect(await store.getConversation(b.id)).toBeNull();
  });

  it("saves messages with source snapshots and plan data, and deletes them with the conversation", async () => {
    const store = await openStore();
    const c = await store.createConversation({ title: "Q", scopeTag: "p_a" });
    await store.appendMessage(c.id, { role: "user", content: "why?" });
    await store.appendMessage(c.id, {
      role: "assistant",
      content: "Because [S1].",
      sources: [
        {
          label: "S1",
          kind: "memory",
          id: "mem_1",
          text: "Because of X",
          projectName: "omms",
          projectTag: "p_a",
          createdAt: 5,
          tags: ["x"],
          score: 0.9,
        },
      ],
      plan: { queries: ["why"], tags: ["x"], profileCategories: [], skipped: false },
      model: "m",
    });

    const full = await store.getConversation(c.id);
    expect(full?.messages.map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(full?.messages[1]?.sources[0]?.text).toBe("Because of X");
    expect(full?.messages[1]?.plan?.tags).toEqual(["x"]);

    await store.deleteConversation(c.id);
    expect(await store.countMessages()).toBe(0);
  });

  it("manages folders, refuses duplicate names ignoring case, and moves conversations", async () => {
    const store = await openStore();
    const thesis = await store.createFolder("Thesis");
    await expect(store.createFolder("  thesis ")).rejects.toThrow("exists");
    await expect(store.createFolder("   ")).rejects.toThrow();

    const inFolder = await store.createConversation({
      title: "In",
      scopeTag: null,
      folderId: thesis.id,
    });
    const loose = await store.createConversation({ title: "Loose", scopeTag: null });
    expect((await store.listFolders())[0]).toMatchObject({ name: "Thesis", conversationCount: 1 });

    await store.moveConversation(loose.id, thesis.id);
    expect((await store.listFolders())[0]?.conversationCount).toBe(2);
    await store.moveConversation(inFolder.id, null);
    const moved = (await store.listConversations()).find((c) => c.id === inFolder.id);
    expect(moved?.folderId).toBeNull();

    const other = await store.createFolder("Other");
    await expect(store.renameFolder(other.id, "THESIS")).rejects.toThrow("exists");
    await store.renameFolder(other.id, "Other work");
    expect((await store.listFolders()).map((f) => f.name).sort()).toEqual(["Other work", "Thesis"]);
  });

  it("deletes a folder with its conversations and their messages", async () => {
    const store = await openStore();
    const folder = await store.createFolder("Thesis");
    const kept = await store.createConversation({ title: "Kept", scopeTag: null });
    for (const title of ["a", "b"]) {
      const c = await store.createConversation({ title, scopeTag: null, folderId: folder.id });
      await store.appendMessage(c.id, { role: "user", content: title });
    }
    await store.appendMessage(kept.id, { role: "user", content: "kept" });

    expect(await store.deleteFolder(folder.id)).toBe(2);
    expect(await store.listFolders()).toEqual([]);
    expect((await store.listConversations()).map((c) => c.id)).toEqual([kept.id]);
    expect(await store.countMessages()).toBe(1);
  });

  it("bulk deletes in one step and deletes nothing when an id is unknown", async () => {
    const store = await openStore();
    const ids: string[] = [];
    for (const title of ["a", "b", "c"]) {
      ids.push((await store.createConversation({ title, scopeTag: null })).id);
    }
    await expect(store.bulkDeleteConversations([ids[0]!, "missing"])).rejects.toThrow("not found");
    expect(await store.listConversations()).toHaveLength(3);

    expect(await store.bulkDeleteConversations([ids[0]!, ids[2]!])).toBe(2);
    expect((await store.listConversations()).map((c) => c.id)).toEqual([ids[1]]);
  });

  it("keeps the file portable: no WAL file, no paths or emails, opens after a copy", async () => {
    const store = await openStore();
    const c = await store.createConversation({ title: "Q", scopeTag: "p_a" });
    await store.appendMessage(c.id, {
      role: "assistant",
      content: "A [S1]",
      sources: [
        {
          label: "S1",
          kind: "memory",
          id: "mem_1",
          text: "memory text",
          projectName: "omms",
          projectTag: "p_a",
          projectPath: "/Users/someone/project",
          userEmail: "someone@example.com",
        } as never,
      ],
    });
    const dbPath = join(baseDir, "chats.db");
    expect(existsSync(`${dbPath}-wal`)).toBe(false);

    const { tursoConnectionManager } = await import("../src/services/turso/connection-manager.js");
    await tursoConnectionManager.closeConnection(dbPath);
    const bytes = readFileSync(dbPath).toString("latin1");
    expect(bytes).not.toContain("/Users/someone");
    expect(bytes).not.toContain("someone@example.com");

    const copyDir = join(baseDir, "other-computer");
    mkdirSync(copyDir);
    copyFileSync(dbPath, join(copyDir, "chats.db"));
    const copied = await openStore(copyDir);
    const list = await copied.listConversations();
    expect(list.map((x) => x.title)).toEqual(["Q"]);
    const full = await copied.getConversation(list[0]!.id);
    expect(full?.messages[0]?.sources[0]).toMatchObject({ label: "S1", text: "memory text" });
  });

  it("opens a file from a newer OMMS as read-only", async () => {
    const store = await openStore();
    await store.createConversation({ title: "Q", scopeTag: null });
    const { tursoConnectionManager } = await import("../src/services/turso/connection-manager.js");
    const db = await tursoConnectionManager.getConnection(join(baseDir, "chats.db"));
    await db.run("UPDATE chat_meta SET value = '999' WHERE key = 'schema_version'");

    const newer = await openStore();
    expect(newer.isReadOnly()).toBe(true);
    expect(await newer.listConversations()).toHaveLength(1);
    await expect(newer.createConversation({ title: "x", scopeTag: null })).rejects.toThrow(
      "read-only"
    );
  });
});
