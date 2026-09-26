import { expect, it } from "bun:test";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readOpencodeHistory } from "../src/importer/opencode-reader.js";
import {
  resolveOpencodeProject,
  resolveOpencodeSessions,
} from "../src/importer/opencode-project.js";

function fixture() {
  const directory = mkdtempSync(join(tmpdir(), "omms-opencode-v1-"));
  const path = join(directory, "history.db");
  const db = new DatabaseSync(path);
  db.exec(`CREATE TABLE project (id TEXT, worktree TEXT);
    CREATE TABLE session (id TEXT, project_id TEXT, parent_id TEXT, directory TEXT, time_created INTEGER);
    CREATE TABLE message (id TEXT, session_id TEXT, time_created INTEGER, data TEXT);
    CREATE TABLE part (id TEXT, message_id TEXT, session_id TEXT, time_created INTEGER, data TEXT);`);
  const add = (session: string, message: string, role: string, at: number, parts: object[]) => {
    db.prepare("INSERT INTO message VALUES (?, ?, ?, ?)").run(
      message,
      session,
      at,
      JSON.stringify({ role })
    );
    parts.forEach((part, index) =>
      db
        .prepare("INSERT INTO part VALUES (?, ?, ?, ?, ?)")
        .run(`${message}-${index}`, message, session, at + index, JSON.stringify(part))
    );
  };
  db.prepare("INSERT INTO project VALUES (?, ?)").run("p", directory);
  db.prepare("INSERT INTO session VALUES (?, ?, ?, ?, ?)").run("parent", "p", null, directory, 1);
  db.prepare("INSERT INTO session VALUES (?, ?, ?, ?, ?)").run(
    "child",
    "p",
    "parent",
    directory,
    2
  );
  add("parent", "u1", "user", 10, [
    { type: "text", text: "Fix the importer" },
    { type: "text", text: "injected memory", synthetic: true },
    { type: "file", name: "secret.env" },
  ]);
  add("parent", "a1", "assistant", 11, [
    { type: "reasoning", text: "hidden thought" },
    { type: "step-start", text: "ignore" },
    { type: "patch", text: "ignore patch" },
    { type: "text", text: "Updated the importer" },
    { type: "tool", tool: "read", state: { input: "x".repeat(200), output: "secret output" } },
  ]);
  add("parent", "u2", "user", 20, [{ type: "text", text: "Add tests" }]);
  add("parent", "a2", "assistant", 21, [{ type: "text", text: "Added tests" }]);
  add("child", "cu", "user", 30, [{ type: "text", text: "Do delegated work" }]);
  add("child", "ca", "assistant", 31, [{ type: "text", text: "Done" }]);
  db.close();
  return { path, directory };
}

it("reads top-level windows and excludes hidden or synthetic parts", async () => {
  const data = fixture();
  try {
    const reader = readOpencodeHistory(data.path);
    const sessions = [];
    for await (const session of reader.sessions) sessions.push(session);
    expect(reader.childSessions).toBe(1);
    expect(reader.topLevelSessions).toBe(1);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.units).toHaveLength(2);
    expect(sessions[0]?.units[0]?.userPrompt).toBe("Fix the importer");
    expect(sessions[0]?.units[0]?.sourceEntryIds).toEqual(["a1"]);
    expect(sessions[0]?.units[0]?.textResponses).toEqual(["Updated the importer"]);
    expect(sessions[0]?.units[0]?.toolCalls[0]?.input.length).toBe(103);
    expect(JSON.stringify(sessions)).not.toContain("secret output");
    expect(JSON.stringify(sessions)).not.toContain("hidden thought");
  } finally {
    rmSync(data.directory, { recursive: true, force: true });
  }
});

it("rejects an incomplete V1 schema with a clear error", () => {
  const directory = mkdtempSync(join(tmpdir(), "omms-opencode-invalid-"));
  try {
    const path = join(directory, "invalid.db");
    const db = new DatabaseSync(path);
    db.exec("CREATE TABLE session (id TEXT)");
    db.close();
    expect(() => readOpencodeHistory(path)).toThrow("missing session.directory");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

it("resolves deleted worktrees, maps, root worktrees, and groups unresolved counts", async () => {
  const data = fixture();
  try {
    const missing = join(data.directory, "deleted-worktree");
    const mapped = join(data.directory, "mapped");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(mapped);
    expect(
      resolveOpencodeProject(data.directory, mapped, [{ from: data.directory, to: mapped }])
    ).toBe(data.directory);
    expect(resolveOpencodeProject(missing, data.directory)).toBe(data.directory);
    expect(resolveOpencodeProject(missing, data.directory, [{ from: missing, to: mapped }])).toBe(
      mapped
    );
    expect(resolveOpencodeProject(missing, "/")).toBeNull();
    const reader = readOpencodeHistory(data.path);
    const unresolved = new Map();
    const source = (async function* () {
      for await (const session of reader.sessions) {
        yield { ...session, recordedDirectory: missing, projectWorktree: "/" };
        yield {
          ...session,
          sessionId: "another",
          recordedDirectory: missing,
          projectWorktree: "/",
        };
      }
    })();
    const resolved = [];
    for await (const session of resolveOpencodeSessions(source, [], unresolved))
      resolved.push(session);
    expect(resolved).toHaveLength(0);
    expect(unresolved.get(missing)).toMatchObject({ sessions: 2, units: 4 });
  } finally {
    rmSync(data.directory, { recursive: true, force: true });
  }
});

it("reads a session that exists only in the WAL and leaves the source files unchanged", async () => {
  const { path, directory } = fixture();
  const writer = new DatabaseSync(path);
  try {
    writer.exec(
      "PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0; PRAGMA wal_checkpoint(TRUNCATE);"
    );
    writer
      .prepare("INSERT INTO session VALUES (?, ?, ?, ?, ?)")
      .run("live", "p", null, directory, 40);
    writer
      .prepare("INSERT INTO message VALUES (?, ?, ?, ?)")
      .run("lu", "live", 41, JSON.stringify({ role: "user" }));
    writer
      .prepare("INSERT INTO part VALUES (?, ?, ?, ?, ?)")
      .run("lu-0", "lu", "live", 41, JSON.stringify({ type: "text", text: "Only in WAL" }));
    writer
      .prepare("INSERT INTO message VALUES (?, ?, ?, ?)")
      .run("la", "live", 42, JSON.stringify({ role: "assistant" }));
    const checksum = (file: string) =>
      createHash("sha256").update(readFileSync(file)).digest("hex");
    const sidecars = ["", "-wal", "-shm"].map((suffix) => path + suffix);
    expect(sidecars.every((file) => existsSync(file))).toBe(true);
    const before = sidecars.map(checksum);

    const reader = readOpencodeHistory(path, { session: "live" });
    const sessions = [];
    for await (const session of reader.sessions) sessions.push(session);

    expect(sessions.map((session) => session.units.map((unit) => unit.userPrompt))).toEqual([
      ["Only in WAL"],
    ]);
    expect(sidecars.map(checksum)).toEqual(before);
  } finally {
    writer.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
