import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

const logs: unknown[][] = [];
mock.module("../src/services/logger.js", () => ({ log: (...args: unknown[]) => logs.push(args) }));

let directory: string;

beforeEach(async () => {
  logs.length = 0;
  directory = mkdtempSync(join(tmpdir(), "omms-ai-checked-store-"));
  const { CONFIG } = await import("../src/config.js");
  CONFIG.storagePath = directory;
});

afterEach(async () => {
  await cleanupTursoTestDirectory(directory);
});

async function store() {
  return import("../src/services/storage/profiles/ai-checked.js");
}

async function rows() {
  const { tursoConnectionManager } = await import("../src/services/turso/connection-manager.js");
  const db = await tursoConnectionManager.getConnection(join(directory, "user-profiles.db"));
  return db.all("SELECT * FROM profile_ai_checked ORDER BY profile_id, item_key");
}

const sorted = (keys: Set<string>) => [...keys].sort();

describe("AI Cleanup checked marks", () => {
  it("marks keys and reads them back for one profile", async () => {
    const s = await store();
    await s.markAiChecked("p1", ["a", "b"], 1_000);
    expect(sorted(await s.readAiCheckedKeys("p1"))).toEqual(["a", "b"]);
  });

  it("keeps the marks of one profile from another", async () => {
    const s = await store();
    await s.markAiChecked("p1", ["a"]);
    expect(sorted(await s.readAiCheckedKeys("p2"))).toEqual([]);
  });

  it("marks again without error and keeps one row per key", async () => {
    const s = await store();
    await s.markAiChecked("p1", ["a"], 1_000);
    await s.markAiChecked("p1", ["a"], 2_000);
    const stored = await rows();
    expect(stored).toHaveLength(1);
    expect(Number(stored[0]!.checked_at)).toBe(2_000);
  });

  it("deletes only the named keys", async () => {
    const s = await store();
    await s.markAiChecked("p1", ["a", "b", "c"]);
    await s.markAiChecked("p2", ["a"]);
    await s.deleteAiCheckedKeys("p1", ["a", "c"]);
    expect(sorted(await s.readAiCheckedKeys("p1"))).toEqual(["b"]);
    expect(sorted(await s.readAiCheckedKeys("p2"))).toEqual(["a"]);
  });

  it("prunes the rows of one profile that match no live key, and no row of another", async () => {
    const s = await store();
    await s.markAiChecked("p1", ["a", "b", "c"]);
    await s.markAiChecked("p2", ["x", "y"]);
    await s.pruneAiCheckedTo("p1", ["b", "zz"]);
    expect(sorted(await s.readAiCheckedKeys("p1"))).toEqual(["b"]);
    expect(sorted(await s.readAiCheckedKeys("p2"))).toEqual(["x", "y"]);
  });

  it("handles more keys than one SQL statement may bind", async () => {
    const s = await store();
    const keys = Array.from({ length: 2500 }, (_, i) => `k${i}`);
    await s.markAiChecked("p1", keys);
    await s.pruneAiCheckedTo("p1", keys.slice(0, 1200));
    expect((await s.readAiCheckedKeys("p1")).size).toBe(1200);
    await s.deleteAiCheckedKeys("p1", keys.slice(0, 1100));
    expect((await s.readAiCheckedKeys("p1")).size).toBe(100);
  });

  it("creates the table on first use in a fresh folder", async () => {
    const s = await store();
    expect((await s.readAiCheckedKeys("p1")).size).toBe(0);
    expect(await rows()).toEqual([]);
  });

  it("adds the table to a database that an older version created", async () => {
    const { tursoConnectionManager } = await import("../src/services/turso/connection-manager.js");
    const db = await tursoConnectionManager.getConnection(join(directory, "user-profiles.db"));
    // The previous version had the profile tables but no marks table.
    await db.execute(
      "CREATE TABLE user_profiles (id TEXT PRIMARY KEY, user_id TEXT, profile_data TEXT)"
    );
    await db.execute("INSERT INTO user_profiles VALUES ('p1', 'u1', '{}')");
    const s = await store();
    await s.markAiChecked("p1", ["a"]);
    expect(sorted(await s.readAiCheckedKeys("p1"))).toEqual(["a"]);
    expect(await db.all("SELECT id FROM user_profiles")).toHaveLength(1);
  });

  it("stores hashes and times only, and logs no key", async () => {
    const s = await store();
    await s.markAiChecked("p1", ["0123abcd"], 5);
    const stored = await rows();
    expect(Object.keys(stored[0]!).sort()).toEqual(["checked_at", "item_key", "profile_id"]);
    expect(JSON.stringify(logs)).not.toContain("0123abcd");
  });
});
