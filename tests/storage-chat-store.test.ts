import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createClient } from "@libsql/client";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

// Characterisation of the chat store (storage port slice S5). Real stores in the isolated
// test home; no mocks. The runtime opens one store per storage folder, read on every call.
const config = await import("../src/config.js");
const { initConfig, refreshConfigIfChanged } = config;
const { ChatStore } = await import("../src/services/storage/chat-store.js");
const { chatStore } = await import("../src/services/chat/chat-runtime.js");
const { tursoConnectionManager } = await import("../src/services/turso/connection-manager.js");
const { createStoredSpace, spaceFiles, switchStoredSpace } =
  await import("../src/services/spaces/registry-store.js");

const files = spaceFiles(join(homedir(), ".omms"));
const defaultFolder = join(homedir(), ".omms", "data");
let project: string;
const folders: string[] = [];

// The version 1 tables, as today's code writes them.
const V1_TABLES = [
  `CREATE TABLE chat_folders (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, name_key TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
  `CREATE TABLE chat_conversations (
    id TEXT PRIMARY KEY, folder_id TEXT REFERENCES chat_folders(id) ON DELETE CASCADE,
    title TEXT NOT NULL, scope_tag TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`,
  `CREATE TABLE chat_messages (
    id TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
    role TEXT NOT NULL, content TEXT NOT NULL, sources_json TEXT, plan_json TEXT, model TEXT,
    error_code TEXT, notice TEXT, created_at INTEGER NOT NULL)`,
];

/** A new storage folder, made the active one so the connection manager opens files in it. */
function freshFolder(): string {
  const folder = mkdtempSync(join(tmpdir(), "omms-storage-chat-"));
  folders.push(folder);
  config.CONFIG.storagePath = folder;
  return folder;
}

async function rawRows(dbPath: string, sql: string) {
  const raw = createClient({ url: `file:${dbPath}` });
  try {
    return (await raw.execute(sql)).rows;
  } finally {
    raw.close();
  }
}

async function seedConversation(dbPath: string, withMeta: string | null) {
  const raw = createClient({ url: `file:${dbPath}` });
  if (withMeta !== null) {
    await raw.execute("CREATE TABLE chat_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    await raw.execute({
      sql: "INSERT INTO chat_meta (key, value) VALUES ('schema_version', ?)",
      args: [withMeta],
    });
  }
  for (const sql of V1_TABLES) await raw.execute(sql);
  await raw.execute(
    "INSERT INTO chat_conversations (id, folder_id, title, scope_tag, created_at, updated_at) VALUES ('c1', NULL, 'Raw chat', 'p_a', 10, 20)"
  );
  await raw.execute(
    `INSERT INTO chat_messages (id, conversation_id, role, content, sources_json, plan_json, model, error_code, notice, created_at)
     VALUES ('m1', 'c1', 'assistant', 'Answer [S1]', '[{"label":"S1","kind":"memory","id":"mem_1","text":"t"}]', NULL, 'glm', NULL, NULL, 15)`
  );
  raw.close();
}

function fileHash(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

beforeAll(() => {
  project = mkdtempSync(join(tmpdir(), "omms-storage-chat-project-"));
  mkdirSync(join(homedir(), ".config", "omms"), { recursive: true });
  writeFileSync(
    join(homedir(), ".config", "omms", "omms.jsonc"),
    JSON.stringify({ embeddingDimensions: 4 })
  );
  initConfig(project);
});
afterAll(async () => {
  config.CONFIG.storagePath = defaultFolder;
  await cleanupTursoTestDirectory(files.spacesRoot);
  await cleanupTursoTestDirectory(project);
  for (const folder of folders) await cleanupTursoTestDirectory(folder);
  rmSync(files.registryPath, { force: true });
});

describe("chat store storage", () => {
  it("(r) reads conversations and messages that a raw client wrote", async () => {
    const dbPath = join(freshFolder(), "chats.db");
    await seedConversation(dbPath, "1");
    const store = new ChatStore(dbPath);
    await store.init();
    expect(store.isReadOnly()).toBe(false);
    expect(await store.listConversations()).toEqual([
      {
        id: "c1",
        folderId: null,
        title: "Raw chat",
        scopeTag: "p_a",
        createdAt: 10,
        updatedAt: 20,
      },
    ]);
    const full = await store.getConversation("c1");
    expect(full?.messages).toEqual([
      {
        id: "m1",
        conversationId: "c1",
        role: "assistant",
        content: "Answer [S1]",
        sources: [{ label: "S1", kind: "memory", id: "mem_1", text: "t" }],
        plan: null,
        model: "glm",
        errorCode: null,
        notice: null,
        createdAt: 15,
      },
    ]);
    expect(await store.countMessages()).toBe(1);
    await tursoConnectionManager.closeConnection(dbPath);
  });

  it("(w) writes through the API and a raw client sees the same rows", async () => {
    const dbPath = join(freshFolder(), "chats.db");
    const store = new ChatStore(dbPath);
    await store.init();
    const folder = await store.createFolder("Work");
    const c = await store.createConversation({ title: "Q", scopeTag: "p_b", folderId: folder.id });
    const m = await store.appendMessage(c.id, { role: "user", content: "hello", model: "m" });
    await tursoConnectionManager.closeConnection(dbPath);

    expect(await rawRows(dbPath, "SELECT key, value FROM chat_meta")).toEqual([
      { key: "schema_version", value: "1" } as never,
    ]);
    expect(await rawRows(dbPath, "SELECT * FROM chat_folders")).toEqual([
      expect.objectContaining({ id: folder.id, name: "Work", name_key: "work" }),
    ]);
    expect(await rawRows(dbPath, "SELECT * FROM chat_conversations")).toEqual([
      expect.objectContaining({ id: c.id, folder_id: folder.id, title: "Q", scope_tag: "p_b" }),
    ]);
    expect(await rawRows(dbPath, "SELECT * FROM chat_messages")).toEqual([
      expect.objectContaining({
        id: m.id,
        conversation_id: c.id,
        role: "user",
        content: "hello",
        sources_json: null,
        plan_json: null,
        model: "m",
        created_at: m.createdAt,
      }),
    ]);
    const names = await rawRows(
      dbPath,
      "SELECT name FROM sqlite_master WHERE name LIKE 'chat_%' ORDER BY name"
    );
    expect(names.map((row) => row.name)).toEqual([
      "chat_conversations",
      "chat_conversations_folder",
      "chat_folders",
      "chat_messages",
      "chat_messages_conversation",
      "chat_meta",
    ]);
  });

  it("(s) a space switch gives the new space its own chats.db and leaves the old one unchanged", async () => {
    config.CONFIG.storagePath = defaultFolder;
    await (await chatStore(config.CONFIG)).createConversation({ title: "in A", scopeTag: null });
    await tursoConnectionManager.closeConnection(join(defaultFolder, "chats.db"));
    const hashA = fileHash(join(defaultFolder, "chats.db"));

    const space = await createStoredSpace(files, "Chat B");
    await switchStoredSpace(files, space.id);
    refreshConfigIfChanged(project);
    const spaceFolder = join(files.spacesRoot, space.id);
    expect(config.CONFIG.storagePath).toBe(spaceFolder);

    expect(await (await chatStore(config.CONFIG)).listConversations()).toEqual([]);
    await (await chatStore(config.CONFIG)).createConversation({ title: "in B", scopeTag: null });
    expect(
      (await (await chatStore(config.CONFIG)).listConversations()).map((c) => c.title)
    ).toEqual(["in B"]);
    expect(existsSync(join(spaceFolder, "chats.db"))).toBe(true);
    expect(fileHash(join(defaultFolder, "chats.db"))).toBe(hashA);

    await switchStoredSpace(files, "default");
    refreshConfigIfChanged(project);
    expect(config.CONFIG.storagePath).toBe(defaultFolder);
    expect(
      (await (await chatStore(config.CONFIG)).listConversations()).map((c) => c.title)
    ).toEqual(["in A"]);
    await tursoConnectionManager.closeConnection(join(spaceFolder, "chats.db"));
    const inB = await rawRows(
      join(spaceFolder, "chats.db"),
      "SELECT title FROM chat_conversations"
    );
    expect(inB.map((row) => row.title)).toEqual(["in B"]);
  });

  it("(u) a file with no schema version upgrades to version 1 and keeps its rows", async () => {
    const dbPath = join(freshFolder(), "chats.db");
    await seedConversation(dbPath, null);
    const store = new ChatStore(dbPath);
    await store.init();
    expect(store.isReadOnly()).toBe(false);
    expect((await store.listConversations()).map((c) => c.title)).toEqual(["Raw chat"]);
    expect(await store.countMessages()).toBe(1);
    await tursoConnectionManager.closeConnection(dbPath);
    expect(
      await rawRows(dbPath, "SELECT value FROM chat_meta WHERE key = 'schema_version'")
    ).toEqual([{ value: "1" } as never]);
  });

  it("(u) a file from a newer schema stays untouched and refuses writes", async () => {
    const dbPath = join(freshFolder(), "chats.db");
    const raw = createClient({ url: `file:${dbPath}` });
    await raw.execute("CREATE TABLE chat_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
    await raw.execute("INSERT INTO chat_meta (key, value) VALUES ('schema_version', '2')");
    await raw.execute(
      "CREATE TABLE chat_conversations (id TEXT PRIMARY KEY, title TEXT, extra TEXT)"
    );
    await raw.execute(
      "INSERT INTO chat_conversations (id, title, extra) VALUES ('n1', 'Newer', 'x')"
    );
    raw.close();
    const before = fileHash(dbPath);

    const store = new ChatStore(dbPath);
    await store.init();
    expect(store.isReadOnly()).toBe(true);
    await expect(store.createConversation({ title: "x", scopeTag: null })).rejects.toMatchObject({
      code: "read_only",
    });
    await expect(store.createFolder("x")).rejects.toMatchObject({ code: "read_only" });
    await tursoConnectionManager.closeConnection(dbPath);

    expect(fileHash(dbPath)).toBe(before);
    const names = await rawRows(dbPath, "SELECT name FROM sqlite_master ORDER BY name");
    expect(names.map((row) => row.name)).toEqual([
      "chat_conversations",
      "chat_meta",
      "sqlite_autoindex_chat_conversations_1",
      "sqlite_autoindex_chat_meta_1",
    ]);
  });
});
