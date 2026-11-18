import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

// Characterisation of the AI session store (storage port slice S4). It pins what the store does
// today so the move into src/services/storage/ cannot change it: reads, writes, a space switch,
// the reset registration and the retention prune. Every store here is real, in a temp folder.

const DAY = 24 * 60 * 60 * 1000;
let baseDir: string;
let otherDir: string;
let savedPath: string;
let savedRetention: number;

async function loadConfig() {
  return (await import("../src/config.js")).CONFIG;
}

async function loadStore() {
  return await import("../src/services/storage/ai-sessions.js");
}

/** Reads a table through a second, raw libSQL client, so the test does not trust the store. */
async function rawRows(folder: string, sql: string): Promise<Record<string, unknown>[]> {
  const client = createClient({ url: `file:${join(folder, "ai-sessions.db")}` });
  try {
    return (await client.execute(sql)).rows as unknown as Record<string, unknown>[];
  } finally {
    client.close();
  }
}

function fileHash(folder: string): string {
  return createHash("sha256")
    .update(readFileSync(join(folder, "ai-sessions.db")))
    .digest("hex");
}

describe("AI session store (characterisation)", () => {
  beforeEach(async () => {
    baseDir = mkdtempSync(join(tmpdir(), "ai-sessions-a-"));
    otherDir = mkdtempSync(join(tmpdir(), "ai-sessions-b-"));
    const config = await loadConfig();
    savedPath = config.storagePath;
    savedRetention = config.aiSessionRetentionDays;
    config.storagePath = baseDir;
    const { aiSessionManager } = await loadStore();
    aiSessionManager.reset();
  });

  afterEach(async () => {
    const config = await loadConfig();
    config.storagePath = savedPath;
    config.aiSessionRetentionDays = savedRetention;
    await cleanupTursoTestDirectory(baseDir);
    await cleanupTursoTestDirectory(otherDir);
  });

  // The old path stays as a re-export, so the providers and tests that import it get the same store.
  it("keeps the old module path as a re-export of the same store", async () => {
    const moved = await loadStore();
    const shim = await import("../src/services/ai/session/ai-session-manager.js");
    expect(shim.aiSessionManager).toBe(moved.aiSessionManager);
    expect(shim.AISessionManager).toBe(moved.AISessionManager);
  });

  // (r) read through the public API
  it("reads a created session and its messages back through the public API", async () => {
    const { aiSessionManager } = await loadStore();
    expect(await aiSessionManager.getSession("s1", "openai-chat")).toBeNull();

    const created = await aiSessionManager.createSession({
      provider: "openai-chat",
      sessionId: "s1",
      conversationId: "conv-1",
      metadata: { note: "kept" },
    });
    expect(created.sessionId).toBe("s1");
    expect(created.provider).toBe("openai-chat");
    expect(created.conversationId).toBe("conv-1");
    expect(created.metadata).toEqual({ note: "kept" });
    expect(await aiSessionManager.getSession("s1", "anthropic-messages")).toBeNull();

    expect(await aiSessionManager.getLastSequence(created.id)).toBe(-1);
    await aiSessionManager.addMessage({
      aiSessionId: created.id,
      sequence: 1,
      role: "assistant",
      content: "second",
    });
    await aiSessionManager.addMessage({
      aiSessionId: created.id,
      sequence: 0,
      role: "user",
      content: "first",
      toolCalls: [{ id: "t1", type: "function", function: { name: "f", arguments: "{}" } }],
    });
    const messages = await aiSessionManager.getMessages(created.id);
    expect(messages.map((m) => m.content)).toEqual(["first", "second"]);
    expect(messages[0]?.toolCalls).toHaveLength(1);
    expect(await aiSessionManager.getLastSequence(created.id)).toBe(1);

    await aiSessionManager.updateSession("s1", "openai-chat", { metadata: { note: "changed" } });
    expect((await aiSessionManager.getSession("s1", "openai-chat"))?.metadata).toEqual({
      note: "changed",
    });

    await aiSessionManager.clearMessages(created.id);
    expect(await aiSessionManager.getMessages(created.id)).toEqual([]);
    await aiSessionManager.deleteSession("s1", "openai-chat");
    expect(await aiSessionManager.getSession("s1", "openai-chat")).toBeNull();
  });

  // (w) write through the API, read back with a raw client
  it("writes the documented columns to ai-sessions.db", async () => {
    const { aiSessionManager } = await loadStore();
    const created = await aiSessionManager.createSession({
      provider: "google-gemini",
      sessionId: "w1",
      conversationId: "conv-w",
      metadata: { a: 1 },
    });
    await aiSessionManager.addMessage({
      aiSessionId: created.id,
      sequence: 0,
      role: "user",
      content: "hello",
      toolCallId: "call-9",
    });

    const sessions = await rawRows(baseDir, "SELECT * FROM ai_sessions");
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({
      id: created.id,
      provider: "google-gemini",
      session_id: "w1",
      conversation_id: "conv-w",
      metadata: '{"a":1}',
    });
    expect(Number(sessions[0]?.expires_at) - Number(sessions[0]?.created_at)).toBe(
      savedRetention * DAY
    );
    const messages = await rawRows(baseDir, "SELECT * FROM ai_messages");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      ai_session_id: created.id,
      sequence: 0,
      role: "user",
      content: "hello",
      tool_call_id: "call-9",
    });
    const tables = await rawRows(
      baseDir,
      "SELECT name FROM sqlite_master WHERE type IN ('table','index') AND name LIKE '%ai_%' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    );
    expect(tables.map((row) => row.name)).toEqual([
      "ai_messages",
      "ai_sessions",
      "idx_ai_messages_role",
      "idx_ai_messages_session",
      "idx_ai_sessions_expires_at",
      "idx_ai_sessions_provider",
      "idx_ai_sessions_session_id",
    ]);
  });

  // (s) space switch
  it("keeps each space's sessions in its own folder across a switch", async () => {
    const config = await loadConfig();
    const { resetStoreHandles } = await import("../src/services/spaces/store-handles.js");
    const { aiSessionManager } = await loadStore();

    await aiSessionManager.createSession({ provider: "openai-chat", sessionId: "in-A" });
    config.storagePath = otherDir;
    await resetStoreHandles();

    expect(await aiSessionManager.getSession("in-A", "openai-chat")).toBeNull();
    await aiSessionManager.createSession({ provider: "openai-chat", sessionId: "in-B" });
    await resetStoreHandles();
    const aHashWhileInB = fileHash(baseDir);

    // Neither folder gained a stray file, and each holds only its own session.
    expect(readdirSync(baseDir).filter((n) => n.endsWith(".db"))).toEqual(["ai-sessions.db"]);
    expect(readdirSync(otherDir).filter((n) => n.endsWith(".db"))).toEqual(["ai-sessions.db"]);
    expect(
      (await rawRows(otherDir, "SELECT session_id FROM ai_sessions")).map((r) => r.session_id)
    ).toEqual(["in-B"]);

    config.storagePath = baseDir;
    await resetStoreHandles();
    expect((await aiSessionManager.getSession("in-A", "openai-chat"))?.sessionId).toBe("in-A");
    expect(await aiSessionManager.getSession("in-B", "openai-chat")).toBeNull();
    await resetStoreHandles();
    expect(fileHash(baseDir)).toBe(aHashWhileInB);
  });

  // (h) reset registration and the path after a reset
  it("stays registered as ai-sessions and opens the new path after a reset", async () => {
    const config = await loadConfig();
    const { registeredStoreResets } = await import("../src/services/spaces/store-handles.js");
    const { aiSessionManager, AISessionManager } = await loadStore();
    expect(registeredStoreResets()).toContain("ai-sessions");

    const handle = aiSessionManager as unknown as { dbPath: string };
    await aiSessionManager.getSession("x", "openai-chat");
    expect(handle.dbPath).toBe(join(baseDir, "ai-sessions.db"));

    config.storagePath = otherDir;
    aiSessionManager.reset();
    expect(handle.dbPath).toBe(join(otherDir, "ai-sessions.db"));
    await aiSessionManager.getSession("x", "openai-chat");
    expect(handle.dbPath).toBe(join(otherDir, "ai-sessions.db"));
    expect(readdirSync(otherDir)).toContain("ai-sessions.db");

    // A manager built after the switch reads the new folder too.
    expect((new AISessionManager() as unknown as { dbPath: string }).dbPath).toBe(
      join(otherDir, "ai-sessions.db")
    );
  });

  // retention: set per session from the live config, and a prune removes expired sessions
  it("prunes sessions past their retention and reads the retention on each call", async () => {
    const config = await loadConfig();
    const { aiSessionManager } = await loadStore();

    config.aiSessionRetentionDays = 1;
    const short = await aiSessionManager.createSession({
      provider: "openai-chat",
      sessionId: "short",
    });
    config.aiSessionRetentionDays = 30;
    const long = await aiSessionManager.createSession({
      provider: "openai-chat",
      sessionId: "long",
    });
    expect(short.expiresAt - short.createdAt).toBe(DAY);
    expect(long.expiresAt - long.createdAt).toBe(30 * DAY);
    await aiSessionManager.addMessage({
      aiSessionId: short.id,
      sequence: 0,
      role: "user",
      content: "m",
    });

    // Nothing has expired yet.
    expect(await aiSessionManager.cleanupExpiredSessions()).toBe(0);

    const now = spyOn(Date, "now").mockReturnValue(Date.now() + 2 * DAY);
    try {
      // An expired session is hidden from a lookup before the prune removes it.
      expect(await aiSessionManager.getSession("short", "openai-chat")).toBeNull();
      expect(await aiSessionManager.cleanupExpiredSessions()).toBe(1);
    } finally {
      now.mockRestore();
    }

    expect(
      (await rawRows(baseDir, "SELECT session_id FROM ai_sessions")).map((r) => r.session_id)
    ).toEqual(["long"]);
    expect(await aiSessionManager.getSession("long", "openai-chat")).not.toBeNull();
    expect(await rawRows(baseDir, "SELECT * FROM ai_messages")).toEqual([]);
  });
});
