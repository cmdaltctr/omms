import { expect, it } from "bun:test";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { removeTestDir } from "./turso-test-utils.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openOpencodeHistory } from "../src/importer/opencode-reader.js";
import { resolveOpencodeProject } from "../src/importer/opencode-project.js";

async function readAll(path: string, filters = {}) {
  const history = await openOpencodeHistory(path, filters);
  try {
    return {
      history,
      sessions: history.sessions.map((meta) => ({
        ...meta,
        units: history.loadUnits(meta.sessionId),
      })),
    };
  } finally {
    await history.close();
  }
}

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
    const { history: reader, sessions } = await readAll(data.path);
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
    await removeTestDir(data.directory);
  }
});

it("sets each tool call's outcome and error from the stored part state", async () => {
  const { path, directory } = fixture();
  const writer = new DatabaseSync(path);
  try {
    writer
      .prepare("INSERT INTO session VALUES (?, ?, ?, ?, ?)")
      .run("tools", "p", null, directory, 50);
    const insertMessage = writer.prepare("INSERT INTO message VALUES (?, ?, ?, ?)");
    const insertPart = writer.prepare("INSERT INTO part VALUES (?, ?, ?, ?, ?)");
    insertMessage.run("tu", "tools", 51, JSON.stringify({ role: "user" }));
    insertPart.run("tu-0", "tu", "tools", 51, JSON.stringify({ type: "text", text: "Run it" }));
    insertMessage.run("ta", "tools", 52, JSON.stringify({ role: "assistant" }));
    const toolParts = [
      { type: "tool", tool: "read", state: { status: "completed", input: "a", output: "body" } },
      {
        type: "tool",
        tool: "bash",
        state: { status: "error", input: "b", error: "e".repeat(5000) },
      },
      { type: "tool", tool: "grep", state: { status: "pending", input: "c" } },
    ];
    toolParts.forEach((part, index) =>
      insertPart.run(`ta-${index}`, "ta", "tools", 52 + index, JSON.stringify(part))
    );
  } finally {
    writer.close();
  }
  try {
    const { sessions } = await readAll(path, { session: "tools" });
    const calls = sessions[0]?.units[0]?.toolCalls;

    expect(calls?.map((call) => [call.name, call.outcome])).toEqual([
      ["read", "ok"],
      ["bash", "error"],
      ["grep", "unknown"],
    ]);
    expect(calls?.[0]?.error).toBeUndefined();
    expect(calls?.[1]?.error).toBe("e".repeat(2000));
  } finally {
    await removeTestDir(directory);
  }
});

it("cuts a long read input as before and keeps the full path in path", async () => {
  const skillPath = `/tmp/skills/${"s".repeat(129)}/SKILL.md`;
  expect(skillPath.length).toBe(150);
  const { path, directory } = fixture();
  const writer = new DatabaseSync(path);
  try {
    writer
      .prepare("INSERT INTO session VALUES (?, ?, ?, ?, ?)")
      .run("read", "p", null, directory, 60);
    writer
      .prepare("INSERT INTO message VALUES (?, ?, ?, ?)")
      .run("ru", "read", 61, '{"role":"user"}');
    writer
      .prepare("INSERT INTO part VALUES (?, ?, ?, ?, ?)")
      .run("ru-0", "ru", "read", 61, JSON.stringify({ type: "text", text: "Use the skill" }));
    writer
      .prepare("INSERT INTO message VALUES (?, ?, ?, ?)")
      .run("ra", "read", 62, '{"role":"assistant"}');
    const part = {
      type: "tool",
      tool: "read",
      state: { status: "completed", input: { offset: 1, filePath: skillPath } },
    };
    writer
      .prepare("INSERT INTO part VALUES (?, ?, ?, ?, ?)")
      .run("ra-0", "ra", "read", 62, JSON.stringify(part));
  } finally {
    writer.close();
  }
  try {
    const { sessions } = await readAll(path, { session: "read" });
    const call = sessions[0]?.units[0]?.toolCalls[0];
    const formatted = JSON.stringify({ offset: 1, filePath: skillPath });
    expect(call?.input).toBe(formatted.slice(0, 100) + "...");
    expect(call?.path).toBe(skillPath);
  } finally {
    await removeTestDir(directory);
  }
});

it("rejects an incomplete V1 schema with a clear error", async () => {
  const directory = mkdtempSync(join(tmpdir(), "omms-opencode-invalid-"));
  try {
    const path = join(directory, "invalid.db");
    const db = new DatabaseSync(path);
    db.exec("CREATE TABLE session (id TEXT)");
    db.close();
    await expect(openOpencodeHistory(path)).rejects.toThrow("missing session.directory");
  } finally {
    await removeTestDir(directory);
  }
});

it("resolves maps first, then recorded directories, then worktrees", async () => {
  const data = fixture();
  try {
    const missing = join(data.directory, "deleted-worktree");
    const mapped = join(data.directory, "mapped");
    const { mkdirSync } = await import("node:fs");
    mkdirSync(mapped);
    // A map wins even when the recorded directory still exists, as it does for Pi.
    expect(
      resolveOpencodeProject(data.directory, mapped, [{ from: data.directory, to: mapped }])
    ).toBe(mapped);
    expect(resolveOpencodeProject(data.directory, null)).toBe(data.directory);
    expect(resolveOpencodeProject(missing, data.directory)).toBe(data.directory);
    expect(resolveOpencodeProject(missing, data.directory, [{ from: missing, to: mapped }])).toBe(
      mapped
    );
    expect(resolveOpencodeProject(missing, "/")).toBeNull();
    // A map to a missing target leaves the session unresolved instead of falling back.
    expect(
      resolveOpencodeProject(data.directory, data.directory, [
        { from: data.directory, to: missing },
      ])
    ).toBeNull();
  } finally {
    await removeTestDir(data.directory);
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

    const { sessions } = await readAll(path, { session: "live" });

    expect(sessions.map((session) => session.units.map((unit) => unit.userPrompt))).toEqual([
      ["Only in WAL"],
    ]);
    expect(sidecars.map(checksum)).toEqual(before);
  } finally {
    writer.close();
    await removeTestDir(directory);
  }
});

it("refuses an in-place read while a rollback journal shows a write in progress", async () => {
  const { path, directory } = fixture();
  try {
    writeFileSync(`${path}-journal`, "");
    await expect(openOpencodeHistory(path)).rejects.toMatchObject({ code: "busy" });
  } finally {
    await removeTestDir(directory);
  }
});

it("keeps the real error when switching from an in-place read to a copy fails", async () => {
  const { path, directory } = fixture();
  try {
    // The file changes while it is read in place, and no shared copy exists to reuse.
    queueMicrotask(() => utimesSync(path, new Date(), new Date(Date.now() + 5000)));
    await expect(
      openOpencodeHistory(path, {}, { shared: { key: "k", mode: "reuse" } })
    ).rejects.toMatchObject({ code: "expired" });
  } finally {
    await removeTestDir(directory);
  }
});
