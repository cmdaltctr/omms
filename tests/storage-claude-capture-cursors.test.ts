import { afterAll, describe, expect, it } from "bun:test";
import { createClient } from "@libsql/client";
import { mkdirSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

// Characterisation of the Claude capture cursor store (storage port slice S2). Real stores in
// the isolated test home. The store takes the storage folder as an argument.
const { CONFIG } = await import("../src/config.js");
const { readClaudeCaptureCursor, writeClaudeCaptureCursor } =
  await import("../src/services/storage/claude-capture-cursors.js");

const folders: string[] = [];
function freshFolder(): string {
  // The connection manager only opens files under the active storage folder.
  mkdirSync(CONFIG.storagePath, { recursive: true });
  const folder = mkdtempSync(join(CONFIG.storagePath, "cursors-"));
  folders.push(folder);
  return folder;
}
afterAll(async () => {
  for (const folder of folders) await cleanupTursoTestDirectory(folder);
});

describe("Claude capture cursor storage", () => {
  it("(r) reads a cursor that a raw client wrote", async () => {
    const storagePath = freshFolder();
    const raw = createClient({ url: `file:${join(storagePath, "user-prompts.db")}` });
    await raw.execute(`CREATE TABLE IF NOT EXISTS claude_capture_cursors (
      session_id TEXT PRIMARY KEY,
      last_user_entry_id TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
    await raw.execute({
      sql: "INSERT INTO claude_capture_cursors (session_id, last_user_entry_id, updated_at) VALUES (?, ?, ?)",
      args: ["ses-raw", "u-9", Date.now()],
    });
    raw.close();
    expect(await readClaudeCaptureCursor("ses-raw", { storagePath })).toBe("u-9");
    expect(await readClaudeCaptureCursor("ses-none", { storagePath })).toBeNull();
  });

  it("(w) writes through the API, replaces on a second write, and a raw client sees it", async () => {
    const storagePath = freshFolder();
    await writeClaudeCaptureCursor("ses-1", "u-1", { storagePath }, 1000);
    await writeClaudeCaptureCursor("ses-1", "u-2", { storagePath }, 2000);
    const raw = createClient({ url: `file:${join(storagePath, "user-prompts.db")}` });
    const rows = (await raw.execute("SELECT * FROM claude_capture_cursors")).rows;
    raw.close();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      session_id: "ses-1",
      last_user_entry_id: "u-2",
      updated_at: 2000,
    });
  });

  it("prunes cursors that are older than 30 days when a store is first prepared", async () => {
    const storagePath = freshFolder();
    const raw = createClient({ url: `file:${join(storagePath, "user-prompts.db")}` });
    await raw.execute(`CREATE TABLE claude_capture_cursors (
      session_id TEXT PRIMARY KEY, last_user_entry_id TEXT NOT NULL, updated_at INTEGER NOT NULL
    )`);
    const day = 24 * 60 * 60 * 1000;
    await raw.execute({
      sql: "INSERT INTO claude_capture_cursors VALUES (?, ?, ?), (?, ?, ?)",
      args: ["old", "u-old", Date.now() - 31 * day, "fresh", "u-fresh", Date.now() - day],
    });
    raw.close();
    expect(await readClaudeCaptureCursor("old", { storagePath })).toBeNull();
    expect(await readClaudeCaptureCursor("fresh", { storagePath })).toBe("u-fresh");
  });

  it("(s) two storage paths keep separate rows for the same session id", async () => {
    const a = freshFolder();
    const b = freshFolder();
    await writeClaudeCaptureCursor("ses-same", "u-in-a", { storagePath: a });
    expect(await readClaudeCaptureCursor("ses-same", { storagePath: b })).toBeNull();
    await writeClaudeCaptureCursor("ses-same", "u-in-b", { storagePath: b });
    expect(await readClaudeCaptureCursor("ses-same", { storagePath: a })).toBe("u-in-a");
    expect(await readClaudeCaptureCursor("ses-same", { storagePath: b })).toBe("u-in-b");
  });
});
