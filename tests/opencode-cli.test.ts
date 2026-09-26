import { expect, it, setDefaultTimeout } from "bun:test";
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseImportArgs } from "../src/cli/index.js";
import { removeTestDir } from "./turso-test-utils.js";

setDefaultTimeout(30_000);

it("parses the shared import flags for both hosts and rejects invalid limits", () => {
  const { host, args } = parseImportArgs([
    "import-opencode-history",
    "--dry-run",
    "--map",
    "/gone=/new",
    "--max-sessions=2",
    "--profile-batch",
    "5",
    "--skip-memories",
    "--provider",
    "openai-chat",
    "--model",
    "small",
  ]);
  expect(host).toBe("opencode");
  expect(args).toMatchObject({
    dryRun: true,
    maxSessions: 2,
    profileBatch: 5,
    skipMemories: true,
    scope: "current-project",
    pathMaps: [{ from: "/gone", to: "/new" }],
    provider: "openai-chat",
    model: "small",
  });
  expect(parseImportArgs(["import-pi-history", "--root", "/sessions"]).args.source).toBe(
    "/sessions"
  );
  expect(() => parseImportArgs(["import-opencode-history", "--max-sessions", "0"])).toThrow(
    "positive integer"
  );
  expect(() => parseImportArgs(["import-pi-history", "--db", "x.db"])).toThrow("Unknown option");
  expect(() => parseImportArgs(["import-nothing"])).toThrow("import-pi-history");
});

it("treats a date-only --until as the end of that day", () => {
  const dateOnly = parseImportArgs([
    "import-opencode-history",
    "--since",
    "2026-03-31",
    "--until",
    "2026-03-31",
  ]).args;
  expect(dateOnly.since).toBe(Date.parse("2026-03-31T00:00:00.000Z"));
  expect(dateOnly.until).toBe(Date.parse("2026-03-31T23:59:59.999Z"));
  const exact = parseImportArgs(["import-pi-history", "--until=2026-03-31T12:00:00Z"]).args;
  expect(exact.until).toBe(Date.parse("2026-03-31T12:00:00Z"));
});

it("prints help and exact dry-run counts without creating a memory store", async () => {
  const root = mkdtempSync(join(tmpdir(), "omms-cli-"));
  try {
    const dbPath = join(root, "history.db");
    const db = new DatabaseSync(dbPath);
    db.exec(`CREATE TABLE project (id TEXT, worktree TEXT);
      CREATE TABLE session (id TEXT, project_id TEXT, parent_id TEXT, directory TEXT, time_created INTEGER);
      CREATE TABLE message (id TEXT, session_id TEXT, time_created INTEGER, data TEXT);
      CREATE TABLE part (id TEXT, message_id TEXT, session_id TEXT, time_created INTEGER, data TEXT);`);
    db.prepare("INSERT INTO project VALUES (?, ?)").run("p", root);
    db.prepare("INSERT INTO session VALUES (?, ?, ?, ?, ?)").run("s", "p", null, root, 1);
    for (const [id, role, time, text] of [
      ["u", "user", 10, "Fix tests"],
      ["a", "assistant", 11, "Done"],
    ] as const) {
      db.prepare("INSERT INTO message VALUES (?, ?, ?, ?)").run(
        id,
        "s",
        time,
        JSON.stringify({ role })
      );
      db.prepare("INSERT INTO part VALUES (?, ?, ?, ?, ?)").run(
        `p-${id}`,
        id,
        "s",
        time,
        JSON.stringify({ type: "text", text })
      );
    }
    db.close();
    const cli = join(import.meta.dir, "../src/cli/index.ts");
    const env = { ...process.env, HOME: root, OMMS_SKIP_LEGACY_MIGRATION: "1" };
    const help = Bun.spawnSync(["bun", cli, "import-opencode-history", "--help"], {
      cwd: root,
      env,
    });
    expect(help.exitCode).toBe(0);
    expect(help.stdout.toString()).toContain("--api-key-env");
    const preview = Bun.spawnSync(
      ["bun", cli, "import-opencode-history", "--dry-run", "--db", dbPath],
      { cwd: root, env }
    );
    expect(preview.exitCode).toBe(0);
    expect(preview.stdout.toString()).toContain("1 sessions, 1 units");
    expect(preview.stdout.toString()).toContain("memory units: 1 pending");
    expect(preview.stdout.toString()).toContain("profile prompts: 1 pending");
    expect(existsSync(join(root, ".omms", "data"))).toBe(false);
    const real = Bun.spawnSync(["bun", cli, "import-opencode-history", "--db", dbPath], {
      cwd: root,
      env,
    });
    expect(real.exitCode).not.toBe(0);
    expect(real.stderr.toString()).toContain("Missing memoryModel");
    expect(existsSync(join(root, ".omms", "data"))).toBe(false);
    const secret = "test-key-must-stay-private";
    const badProvider = Bun.spawnSync(
      [
        "bun",
        cli,
        "import-opencode-history",
        "--db",
        dbPath,
        "--provider",
        "unknown",
        "--model",
        "cheap",
        "--api-url",
        "https://example.invalid",
        "--api-key-env",
        "OMMS_IMPORT_TEST_KEY",
      ],
      { cwd: root, env: { ...env, OMMS_IMPORT_TEST_KEY: secret } }
    );
    expect(badProvider.exitCode).not.toBe(0);
    expect(badProvider.stdout.toString() + badProvider.stderr.toString()).not.toContain(secret);
  } finally {
    await removeTestDir(root);
  }
});

it("previews Pi history from the CLI with the same options", async () => {
  const root = mkdtempSync(join(tmpdir(), "omms-cli-pi-"));
  try {
    const { makeProjectDir, writeV3Session } = await import("./pi-import-fixtures.js");
    const project = makeProjectDir(root, "project");
    const sessions = join(root, "sessions");
    mkdirSync(sessions);
    writeV3Session({
      file: join(sessions, "s.jsonl"),
      sessionId: "s",
      cwd: project,
      windows: [{ userText: "Improve importer", assistantText: "Done" }],
    });
    const cli = join(import.meta.dir, "../src/cli/index.ts");
    const env = { ...process.env, HOME: root, OMMS_SKIP_LEGACY_MIGRATION: "1" };
    const preview = Bun.spawnSync(
      ["bun", cli, "import-pi-history", "--dry-run", "--skip-memories", "--root", sessions],
      { cwd: project, env }
    );
    const output = preview.stdout.toString();
    expect(preview.exitCode).toBe(0);
    expect(output).toContain("Pi history import (dry-run)");
    expect(output).toContain("memory units: 0 pending");
    expect(output).toContain("profile prompts: 1 pending");
    expect(existsSync(join(root, ".omms", "data"))).toBe(false);
  } finally {
    await removeTestDir(root);
  }
});

it("runs the installed bin through a node_modules/.bin symlink under Node", async () => {
  const root = mkdtempSync(join(tmpdir(), "omms-cli-symlink-"));
  try {
    const cli = join(import.meta.dir, "../dist/cli/index.js");
    const link = join(root, "om-memory-system");
    symlinkSync(cli, link);
    const env = { ...process.env, HOME: root, OMMS_SKIP_LEGACY_MIGRATION: "1" };
    const help = Bun.spawnSync(["node", link, "import-opencode-history", "--help"], {
      cwd: root,
      env,
    });
    expect(help.exitCode).toBe(0);
    expect(help.stdout.toString()).toContain("import-opencode-history");
    expect(help.stdout.toString()).toContain("--api-key-env");
  } finally {
    await removeTestDir(root);
  }
});
