import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

let baseDir: string;

describe("AI session manager", () => {
  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "ai-sessions-"));
  });

  afterEach(async () => {
    await cleanupTursoTestDirectory(baseDir);
  });

  // Chat and skill drafting delete their session after each call (chat-runtime callTool).
  it("leaves no text of a deleted session in the file bytes", async () => {
    const { CONFIG } = await import("../src/config.js");
    CONFIG.storagePath = baseDir;
    const { AISessionManager } = await import("../src/services/ai/session/ai-session-manager.js");
    const sessions = new AISessionManager();
    const marker = "DRAFTMARK4c2e81";
    const session = await sessions.createSession({ provider: "openai-chat", sessionId: "chat_1" });
    await sessions.addMessage({
      aiSessionId: session.id,
      sequence: 0,
      role: "user",
      content: `${marker}-prompt`,
    });
    await sessions.addMessage({
      aiSessionId: session.id,
      sequence: 1,
      role: "assistant",
      content: `${marker}-reply`,
    });
    const fileHasMarker = () =>
      readFileSync(join(baseDir, "ai-sessions.db")).toString("latin1").includes(marker);
    expect(fileHasMarker()).toBe(true);

    await sessions.deleteSession("chat_1", "openai-chat");

    expect(await sessions.getMessages(session.id)).toEqual([]);
    expect(fileHasMarker()).toBe(false);
  });

  // The retention is read when a session starts (design D5a "S"), so a reload reaches it.
  it("reads the session retention from the live config", async () => {
    const { CONFIG } = await import("../src/config.js");
    CONFIG.storagePath = baseDir;
    const saved = CONFIG.aiSessionRetentionDays;
    const day = 24 * 60 * 60 * 1000;
    const { AISessionManager } = await import("../src/services/ai/session/ai-session-manager.js");
    const sessions = new AISessionManager();
    try {
      CONFIG.aiSessionRetentionDays = 2;
      const first = await sessions.createSession({ provider: "openai-chat", sessionId: "r_1" });
      expect(first.expiresAt - first.createdAt).toBe(2 * day);
      CONFIG.aiSessionRetentionDays = 5;
      const second = await sessions.createSession({ provider: "openai-chat", sessionId: "r_2" });
      expect(second.expiresAt - second.createdAt).toBe(5 * day);
    } finally {
      CONFIG.aiSessionRetentionDays = saved;
    }
  });

  // Files written before secure_delete was on can still hold deleted text in free pages.
  it("clears text left in free pages by an older file when it opens", async () => {
    const { CONFIG } = await import("../src/config.js");
    CONFIG.storagePath = baseDir;
    const path = join(baseDir, "ai-sessions.db");
    const marker = "OLDTEXT9b7d33";
    const { createClient } = await import("@libsql/client");
    const old = createClient({ url: `file:${path}` });
    await old.execute("CREATE TABLE leftover (body TEXT)");
    for (let i = 0; i < 20; i++) {
      await old.execute({ sql: "INSERT INTO leftover VALUES (?)", args: [marker.repeat(50)] });
    }
    await old.execute("DELETE FROM leftover");
    old.close();
    const fileHasMarker = () => readFileSync(path).toString("latin1").includes(marker);
    expect(fileHasMarker()).toBe(true);

    const { AISessionManager } = await import("../src/services/ai/session/ai-session-manager.js");
    await new AISessionManager().getMessages("none");

    expect(fileHasMarker()).toBe(false);
  });

  // Another process can hold the file past busy_timeout; the cleanup must not fail the AI call.
  it("still opens when the free-page VACUUM fails", async () => {
    const { CONFIG } = await import("../src/config.js");
    CONFIG.storagePath = baseDir;
    const path = join(baseDir, "ai-sessions.db");
    const { createClient } = await import("@libsql/client");
    const old = createClient({ url: `file:${path}` });
    await old.execute("CREATE TABLE leftover (body TEXT)");
    for (let i = 0; i < 20; i++) {
      await old.execute({ sql: "INSERT INTO leftover VALUES (?)", args: ["x".repeat(500)] });
    }
    await old.execute("DELETE FROM leftover");
    old.close();
    const { tursoConnectionManager } = await import("../src/services/turso/connection-manager.js");
    const db = await tursoConnectionManager.getConnection(path);
    const execute = db.execute.bind(db);
    const vacuums: string[] = [];
    spyOn(db, "execute").mockImplementation(async (sql, args) => {
      if (sql === "VACUUM") {
        vacuums.push(sql);
        throw new Error("SQLITE_BUSY: database is locked");
      }
      return execute(sql, args);
    });

    const { AISessionManager } = await import("../src/services/ai/session/ai-session-manager.js");
    expect(await new AISessionManager().getMessages("none")).toEqual([]);
    expect(vacuums).toEqual(["VACUUM"]);
  });
});
