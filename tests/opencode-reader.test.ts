import { expect, it } from "bun:test";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { removeTestDir } from "./turso-test-utils.js";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openOpencodeHistory } from "../src/importer/opencode-reader.js";
import { resolveOpencodeProject } from "../src/importer/opencode-project.js";
import { createOpencodeFixture } from "./opencode-v2-fixture.js";

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

it("marks a memorise call from the stored part state and its reply", async () => {
  const { path, directory } = fixture();
  const writer = new DatabaseSync(path);
  try {
    writer
      .prepare("INSERT INTO session VALUES (?, ?, ?, ?, ?)")
      .run("mem", "p", null, directory, 60);
    const insertMessage = writer.prepare("INSERT INTO message VALUES (?, ?, ?, ?)");
    const insertPart = writer.prepare("INSERT INTO part VALUES (?, ?, ?, ?, ?)");
    insertMessage.run("mu", "mem", 61, JSON.stringify({ role: "user" }));
    insertPart.run("mu-0", "mu", "mem", 61, JSON.stringify({ type: "text", text: "Save it" }));
    insertMessage.run("ma", "mem", 62, JSON.stringify({ role: "assistant" }));
    const args = { mode: "memorise", topic: "Rollout" };
    const parts = [
      { status: "completed", input: args, output: '{"success":true,"id":"ms-1"}' },
      { status: "completed", input: args, output: '{"success":false,"error":"no"}' },
      { status: "error", input: args, error: "boom" },
      { status: "completed", input: { mode: "recall", query: "x" }, output: "{}" },
    ];
    parts.forEach((state, index) =>
      insertPart.run(
        `ma-${index}`,
        "ma",
        "mem",
        62 + index,
        JSON.stringify({ type: "tool", tool: "memory", state })
      )
    );
  } finally {
    writer.close();
  }
  try {
    const { sessions } = await readAll(path);
    const session = sessions.find((entry) => entry.sessionId === "mem");
    const calls = session?.units[0]?.toolCalls ?? [];
    expect(calls.map((call) => call.memorise)).toEqual(["saved", "failed", "failed", undefined]);
  } finally {
    await removeTestDir(directory);
  }
});

// OpenCode 2.x tables (session_v2 and session_message).

it("lists a session that exists only in session_v2 and builds its units", async () => {
  const data = createOpencodeFixture();
  try {
    data.v2Session("only-v2", { at: 5 });
    data.v2Turn("only-v2", "u1", "a1", 10, "Fix the importer", "Updated the importer");
    data.v2Turn("only-v2", "u2", "a2", 20, "Add tests", "Added tests");
    data.close();

    const { sessions } = await readAll(data.path);

    expect(sessions.map((session) => session.sessionId)).toEqual(["only-v2"]);
    expect(sessions[0]?.units.map((unit) => unit.userPrompt)).toEqual([
      "Fix the importer",
      "Add tests",
    ]);
    expect(sessions[0]?.units[0]?.userEntryId).toBe("u1");
    expect(sessions[0]?.units[0]?.sourceEntryIds).toEqual(["a1"]);
    expect(sessions[0]?.units[0]?.textResponses).toEqual(["Updated the importer"]);
  } finally {
    await removeTestDir(data.root);
  }
});

it("does not treat a synthetic message as a prompt and ends the unit there", async () => {
  const data = createOpencodeFixture();
  try {
    data.v2Session("s");
    data.v2Turn("s", "u1", "a1", 10, "First prompt", "First reply");
    data.v2Message("s", "syn", "synthetic", 12, { text: "injected memory context" });
    data.v2Assistant("s", "a-after", 13, [{ type: "text", text: "Reply after synthetic" }]);
    data.v2Turn("s", "u2", "a2", 20, "Second prompt", "Second reply");
    data.close();

    const { sessions } = await readAll(data.path);
    const units = sessions[0]?.units ?? [];

    expect(units.map((unit) => unit.userPrompt)).toEqual(["First prompt", "Second prompt"]);
    expect(units[0]?.textResponses).toEqual(["First reply"]);
    expect(units[0]?.sourceEntryIds).toEqual(["a1"]);
    expect(JSON.stringify(sessions)).not.toContain("injected memory context");
    expect(JSON.stringify(sessions)).not.toContain("Reply after synthetic");
  } finally {
    await removeTestDir(data.root);
  }
});

it("ends the unit at a compaction message", async () => {
  const data = createOpencodeFixture();
  try {
    data.v2Session("s");
    data.v2Turn("s", "u1", "a1", 10, "First prompt", "First reply");
    data.v2Message("s", "cmp", "compaction", 12, { text: "summary of earlier work" });
    data.v2Assistant("s", "a-after", 13, [{ type: "text", text: "Reply after compaction" }]);
    data.v2Turn("s", "u2", "a2", 20, "Second prompt", "Second reply");
    data.close();

    const { sessions } = await readAll(data.path);
    const units = sessions[0]?.units ?? [];

    expect(units.map((unit) => unit.userPrompt)).toEqual(["First prompt", "Second prompt"]);
    expect(units[0]?.sourceEntryIds).toEqual(["a1"]);
    expect(units[0]?.textResponses).toEqual(["First reply"]);
    expect(JSON.stringify(sessions)).not.toContain("Reply after compaction");
    expect(JSON.stringify(sessions)).not.toContain("summary of earlier work");
  } finally {
    await removeTestDir(data.root);
  }
});

it("ignores system, idle and switch messages without ending or joining a unit", async () => {
  const data = createOpencodeFixture();
  try {
    data.v2Session("s");
    data.v2User("s", "u1", 10, "Only prompt");
    data.v2Message("s", "m-system", "system", 11, { text: "system note" });
    data.v2Message("s", "m-idle", "idle", 12, {});
    data.v2Message("s", "m-agent", "agent-switched", 13, { agent: "build" });
    data.v2Assistant("s", "a1", 14, [{ type: "text", text: "Reply one" }]);
    data.v2Message("s", "m-model", "model-switched", 15, { model: "x" });
    data.v2Assistant("s", "a2", 16, [{ type: "text", text: "Reply two" }]);
    data.v2Message("s", "m-location", "location-switched", 17, { directory: "/elsewhere" });
    data.v2Assistant("s", "a3", 18, [{ type: "text", text: "Reply three" }]);
    data.close();

    const { sessions } = await readAll(data.path);
    const units = sessions[0]?.units ?? [];

    expect(units).toHaveLength(1);
    expect(units[0]?.userPrompt).toBe("Only prompt");
    expect(units[0]?.sourceEntryIds).toEqual(["a1", "a2", "a3"]);
    expect(units[0]?.textResponses).toEqual(["Reply one", "Reply two", "Reply three"]);
    expect(JSON.stringify(sessions)).not.toContain("system note");
  } finally {
    await removeTestDir(data.root);
  }
});

it("gives a V2 tool item with state error the outcome error", async () => {
  const data = createOpencodeFixture();
  try {
    data.v2Session("s");
    data.v2User("s", "u1", 10, "Run it");
    data.v2Assistant("s", "a1", 11, [
      { type: "reasoning", text: "hidden thought" },
      { type: "text", text: "Tried it" },
      { type: "tool", name: "read", state: { status: "completed", input: "a" } },
      { type: "tool", name: "bash", state: { status: "error", input: "b", error: "boom" } },
    ]);
    data.close();

    const { sessions } = await readAll(data.path);
    const unit = sessions[0]?.units[0];

    expect(unit?.textResponses).toEqual(["Tried it"]);
    expect(unit?.toolCalls.map((call) => [call.name, call.outcome])).toEqual([
      ["read", "ok"],
      ["bash", "error"],
    ]);
    expect(unit?.toolCalls[1]?.error).toBe("boom");
    expect(JSON.stringify(sessions)).not.toContain("hidden thought");
  } finally {
    await removeTestDir(data.root);
  }
});

it("counts a V2 child session as folded into its parent", async () => {
  const data = createOpencodeFixture();
  try {
    data.v2Session("parent");
    data.v2Session("child", { parentId: "parent", at: 2 });
    data.v2Turn("parent", "u1", "a1", 10, "Parent prompt", "Parent reply");
    data.v2Turn("child", "cu", "ca", 30, "Delegated work", "Done");
    data.close();

    const { history, sessions } = await readAll(data.path);

    expect(history.childSessions).toBe(1);
    expect(history.topLevelSessions).toBe(1);
    expect(sessions.map((session) => session.sessionId)).toEqual(["parent"]);
    expect(JSON.stringify(sessions)).not.toContain("Delegated work");
  } finally {
    await removeTestDir(data.root);
  }
});

it("skips a V2 session titled omms capture and does not count it", async () => {
  const data = createOpencodeFixture();
  try {
    data.v2Session("real", { at: 1 });
    data.v2Turn("real", "u1", "a1", 10, "Real prompt", "Real reply");
    data.v2Session("capture", { title: "omms capture", at: 2 });
    data.v2Turn("capture", "cu", "ca", 20, "Internal prompt", "Internal reply");
    data.v2Session("legacy", { title: "opencode-mem capture", at: 3 });
    data.v2Turn("legacy", "lu", "la", 30, "Legacy prompt", "Legacy reply");
    data.close();

    const { history, sessions } = await readAll(data.path);

    expect(sessions.map((session) => session.sessionId)).toEqual(["real"]);
    expect(history.topLevelSessions).toBe(1);
    expect(history.childSessions).toBe(0);
  } finally {
    await removeTestDir(data.root);
  }
});

// Databases that hold both table sets, or neither.

it("reads a session held in both table sets from the V2 tables only", async () => {
  const data = createOpencodeFixture({ v1: true });
  try {
    data.v1Session("both");
    data.v1Turn("both", "u1", "a1", 10, "Prompt from V1", "Reply from V1");
    data.v2Session("both");
    data.v2Turn("both", "u1", "a1", 10, "Prompt from V2", "Reply from V2");
    data.close();

    const { sessions } = await readAll(data.path);

    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.units.map((unit) => unit.userPrompt)).toEqual(["Prompt from V2"]);
    expect(sessions[0]?.units[0]?.textResponses).toEqual(["Reply from V2"]);
    expect(JSON.stringify(sessions)).not.toContain("from V1");
  } finally {
    await removeTestDir(data.root);
  }
});

it("reads a V1 session that session_v2 does not hold from the V1 tables", async () => {
  const data = createOpencodeFixture({ v1: true });
  try {
    data.v1Session("old-only", { at: 1 });
    data.v1Turn("old-only", "u1", "a1", 10, "Old prompt", "Old reply");
    data.v2Session("new-only", { at: 2 });
    data.v2Turn("new-only", "n1", "na1", 20, "New prompt", "New reply");
    data.close();

    const { sessions } = await readAll(data.path);

    expect(sessions.map((session) => [session.sessionId, session.units[0]?.userPrompt])).toEqual([
      ["old-only", "Old prompt"],
      ["new-only", "New prompt"],
    ]);
  } finally {
    await removeTestDir(data.root);
  }
});

it("imports a database that has only the older tables as before", async () => {
  const data = createOpencodeFixture({ v2: false, v1: true });
  try {
    data.v1Session("old");
    data.v1Turn("old", "u1", "a1", 10, "Old prompt", "Old reply");
    data.close();

    const { history, sessions } = await readAll(data.path);

    expect(history.topLevelSessions).toBe(1);
    expect(sessions[0]?.units.map((unit) => unit.userPrompt)).toEqual(["Old prompt"]);
    expect(sessions[0]?.units[0]?.sourceEntryIds).toEqual(["a1"]);
  } finally {
    await removeTestDir(data.root);
  }
});

it("names the missing tables, without saying V1, when neither table set exists", async () => {
  const data = createOpencodeFixture({ v2: false });
  try {
    data.close();

    const error = await openOpencodeHistory(data.path).then(
      () => null,
      (caught: unknown) => caught
    );

    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toContain("session_v2");
    expect(message).toContain("session_message");
    expect(message).not.toContain("V1");
  } finally {
    await removeTestDir(data.root);
  }
});
