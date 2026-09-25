import { expect, it } from "bun:test";
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseImportArgs } from "../src/cli/index.js";

it("parses import flags and rejects invalid limits", () => {
  const parsed = parseImportArgs([
    "import-opencode-history",
    "--dry-run",
    "--map",
    "/gone=/new",
    "--max-sessions",
    "2",
    "--profile-batch",
    "5",
    "--skip-memories",
    "--provider",
    "openai-chat",
    "--model",
    "small",
  ]);
  expect(parsed.options).toMatchObject({
    dryRun: true,
    maxSessions: 2,
    profileBatch: 5,
    skipMemories: true,
    pathMaps: [{ from: "/gone", to: "/new" }],
  });
  expect(parsed.model.model).toBe("small");
  expect(() => parseImportArgs(["import-opencode-history", "--max-sessions", "0"])).toThrow(
    "positive integer"
  );
});

it("prints help and exact dry-run counts without creating a memory store", () => {
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
    expect(preview.stdout.toString()).toContain("Memory units: 1 pending");
    expect(preview.stdout.toString()).toContain("Profile prompts: 1 pending");
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
    rmSync(root, { recursive: true, force: true });
  }
});

it("runs the installed bin through a node_modules/.bin symlink under Node", () => {
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
    rmSync(root, { recursive: true, force: true });
  }
});
