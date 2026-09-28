import { afterEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readOpencodeWorktrees,
  suggestMapTarget,
  suggestMapTargets,
} from "../src/importer/map-suggestions.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function root() {
  const dir = mkdtempSync(join(tmpdir(), "omms-suggest-"));
  dirs.push(dir);
  return dir;
}

function repo(path: string) {
  mkdirSync(join(path, ".git"), { recursive: true });
  return path;
}

describe("directory map suggestions", () => {
  it("suggests the main repository of a deleted sibling worktree", () => {
    const code = join(root(), "code");
    const app = repo(join(code, "app"));
    repo(join(code, "ap"));
    mkdirSync(join(code, "apple"));
    expect(suggestMapTarget(join(code, "app-feat-x"))).toBe(app);
  });

  it("suggests a known project for a nested workspace path", () => {
    const base = root();
    const app = repo(join(base, "code", "app"));
    const other = repo(join(base, "code", "other"));
    mkdirSync(join(base, "orca", "workspaces"), { recursive: true });
    const missing = join(base, "orca", "workspaces", "app", "feat-x");
    expect(suggestMapTarget(missing, { knownProjects: [other] })).toBe(app);
  });

  it("gives no suggestion for a temporary directory with no candidate", () => {
    const base = root();
    expect(suggestMapTargets([{ directory: join(base, "tmp-xyz"), sessions: 2 }])).toEqual([
      { directory: join(base, "tmp-xyz"), sessions: 2, suggestion: null },
    ]);
  });

  it("falls back to OpenCode's recorded worktree, read without writing", async () => {
    const base = root();
    const worktree = mkdirSync(join(base, "project"), { recursive: true })!;
    const dbPath = join(base, "opencode.db");
    const db = new DatabaseSync(dbPath);
    db.exec(`CREATE TABLE project (id TEXT, worktree TEXT);
      CREATE TABLE session (id TEXT, project_id TEXT, parent_id TEXT, directory TEXT, time_created INTEGER);
      CREATE TABLE message (id TEXT, session_id TEXT, time_created INTEGER, data TEXT);
      CREATE TABLE part (id TEXT, message_id TEXT, session_id TEXT, time_created INTEGER, data TEXT);`);
    db.prepare("INSERT INTO project VALUES (?, ?)").run("p", worktree);
    const missing = join(base, "zz-deleted", "sub");
    db.prepare("INSERT INTO session VALUES (?, ?, ?, ?, ?)").run("s", "p", null, missing, 1);
    db.close();
    const hash = () => createHash("sha256").update(readFileSync(dbPath)).digest("hex");
    const before = hash();
    const entries = readdirSync(base).sort();

    const worktrees = await readOpencodeWorktrees(dbPath);
    expect(suggestMapTarget(missing, { opencodeWorktree: (dir) => worktrees.get(dir) })).toBe(
      worktree
    );
    expect(hash()).toBe(before);
    expect(readdirSync(base).sort()).toEqual(entries);
  });
});
