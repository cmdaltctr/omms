import { afterEach, expect, it } from "bun:test";
import { DatabaseSync } from "node:sqlite";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertImportSourceUnchanged,
  browseImportSources,
  defaultClaudeSourcePath,
  defaultImportSourcePath,
  readImportSourceToken,
  validateImportSource,
} from "../src/importer/import-sources.js";
import { defaultClaudeProjectsRoot } from "../src/importer/claude-reader.js";
import {
  DiscoveryLimitError,
  discoverPiSessions,
  readFirstLine,
} from "../src/importer/discovery.js";
import { resolveImportProject } from "../src/importer/import-project.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const header = (id: string | null, cwd = "/tmp") =>
  JSON.stringify({ type: "session", version: 3, ...(id ? { id } : {}), cwd }) + "\n";

function workspace() {
  const root = mkdtempSync(join(tmpdir(), "omms-sources-"));
  dirs.push(root);
  const sessions = join(root, "sessions");
  mkdirSync(join(sessions, "nested"), { recursive: true });
  writeFileSync(join(sessions, "nested", "a.jsonl"), header("sess-a"));
  writeFileSync(join(sessions, "b.jsonl"), header(null));
  writeFileSync(join(root, "notes.txt"), "not history");
  const db = join(root, "history.db");
  const sqlite = new DatabaseSync(db);
  sqlite.exec("CREATE TABLE session (id TEXT)");
  sqlite.close();
  writeFileSync(db + ".bak", "not sqlite");
  return { root, sessions, db };
}

it("accepts Pi folders, Pi session files, and SQLite files, and pins their identity", () => {
  const { sessions, db } = workspace();
  const folder = validateImportSource("pi", sessions);
  expect(folder.kind).toBe("pi-folder");
  expect(folder.displayPath).toBe(realpathSync.native(sessions));
  expect(validateImportSource("pi", join(sessions, "b.jsonl")).kind).toBe("pi-file");
  const database = validateImportSource("opencode", db);
  expect(database.kind).toBe("opencode-db");
  expect(readImportSourceToken(database.sourceToken, "opencode").realPath).toBe(
    realpathSync.native(db)
  );
  expect(() => readImportSourceToken(database.sourceToken, "pi")).toThrow("other host");
  expect(() => readImportSourceToken(`${database.sourceToken}x`, "opencode")).toThrow(
    "no longer valid"
  );
});

it("refuses relative paths, '..' segments, and wrong formats without returning contents", () => {
  const { root, sessions } = workspace();
  expect(() => validateImportSource("pi", "sessions")).toThrow("absolute");
  expect(() => validateImportSource("pi", `${sessions}/../sessions`)).toThrow("'..'");
  expect(() => validateImportSource("pi", join(root, "notes.txt"))).toThrow(
    "Pi sessions folder or one .jsonl"
  );
  writeFileSync(join(root, "fake.jsonl"), "secret transcript line\n");
  let message = "";
  try {
    validateImportSource("pi", join(root, "fake.jsonl"));
  } catch (error) {
    message = (error as Error).message;
  }
  expect(message).toBe("The file is not a Pi session file");
  expect(() => validateImportSource("opencode", join(root, "history.db.bak"))).toThrow(
    "OpenCode database"
  );
  expect(() => validateImportSource("opencode", sessions)).toThrow("OpenCode database");
});

it("accepts a Claude Code transcripts folder, signed like the Pi folder kind", () => {
  const { root, sessions, db } = workspace();
  const folder = validateImportSource("claude-code", sessions);
  expect(folder.kind).toBe("claude-projects");
  expect(folder.displayPath).toBe(realpathSync.native(sessions));
  const identity = readImportSourceToken(folder.sourceToken, "claude-code");
  expect(identity).toMatchObject({ host: "claude-code", kind: "claude-projects" });
  expect(() => readImportSourceToken(folder.sourceToken, "pi")).toThrow("another host");
  // A Pi folder token is not a Claude Code source either.
  const pi = validateImportSource("pi", sessions).sourceToken;
  expect(() => readImportSourceToken(pi, "claude-code")).toThrow("another host");
  // Files, OpenCode databases, and missing paths are refused.
  expect(() => validateImportSource("claude-code", db)).toThrow("Claude Code transcripts folder");
  expect(() => validateImportSource("claude-code", join(sessions, "b.jsonl"))).toThrow(
    "Claude Code transcripts folder"
  );
  expect(() => validateImportSource("claude-code", join(root, "missing"))).toThrow(
    "Path not found"
  );
});

it("defaults a Claude Code source to the reader's ~/.claude/projects", () => {
  expect(defaultClaudeSourcePath()).toBe(defaultClaudeProjectsRoot());
  expect(defaultImportSourcePath("claude-code")).toBe(defaultClaudeProjectsRoot());
  expect(defaultImportSourcePath("opencode")).not.toBe(defaultClaudeProjectsRoot());
});

it("agrees with the reader on the setting and on CLAUDE_CONFIG_DIR", () => {
  const saved = process.env.CLAUDE_CONFIG_DIR;
  try {
    process.env.CLAUDE_CONFIG_DIR = "/env/claude";
    expect(defaultClaudeSourcePath()).toBe("/env/claude/projects");
    expect(defaultClaudeSourcePath()).toBe(defaultClaudeProjectsRoot());
    expect(defaultClaudeSourcePath("/data/claude")).toBe("/data/claude/projects");
    expect(defaultClaudeSourcePath("/data/claude")).toBe(defaultClaudeProjectsRoot("/data/claude"));
    expect(defaultImportSourcePath("claude-code", "/data/claude")).toBe("/data/claude/projects");
  } finally {
    if (saved === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = saved;
  }
});

it("accepts a symlinked root or ancestor through its real path, like a mounted volume", () => {
  const { root, sessions } = workspace();
  const linked = join(root, "linked-volume");
  symlinkSync(root, linked);
  const result = validateImportSource("pi", join(linked, "sessions"));
  expect(result.displayPath).toBe(realpathSync.native(sessions));
});

it("refuses a source replaced after validation", () => {
  const { root, sessions } = workspace();
  const token = validateImportSource("pi", sessions).sourceToken;
  const identity = readImportSourceToken(token, "pi");
  renameSync(sessions, join(root, "old"));
  mkdirSync(sessions);
  expect(() => assertImportSourceUnchanged(identity)).toThrow("changed");
});

it("browses one folder, shows eligible entries only, and hides symlinks", () => {
  const { root, sessions } = workspace();
  symlinkSync(join(sessions, "b.jsonl"), join(sessions, "link.jsonl"));
  const pi = browseImportSources("pi", sessions);
  expect(pi.entries.map((entry) => [entry.name, entry.kind])).toEqual([
    ["nested", "folder"],
    ["b.jsonl", "pi-file"],
  ]);
  expect(pi.parent).toBe(realpathSync.native(root));
  const opencode = browseImportSources("opencode", root);
  expect(opencode.entries.map((entry) => entry.name)).toEqual(["sessions", "history.db"]);
  // A Claude Code source is a folder, so files are never offered.
  const claude = browseImportSources("claude-code", sessions);
  expect(claude.entries.map((entry) => [entry.name, entry.kind])).toEqual([["nested", "folder"]]);
});

it("opens the Claude Code folder picker in the folder from the setting", () => {
  const { root } = workspace();
  mkdirSync(join(root, "claude", "projects", "-proj"), { recursive: true });
  const claude = browseImportSources("claude-code", undefined, join(root, "claude"));
  expect(claude.path).toBe(realpathSync.native(join(root, "claude", "projects")));
  expect(claude.entries.map((entry) => entry.name)).toEqual(["-proj"]);
});

it("discovers a file root as one session, keys by relative path, and skips symlinks", () => {
  const { sessions } = workspace();
  symlinkSync(join(sessions, "b.jsonl"), join(sessions, "link.jsonl"));
  const folder = discoverPiSessions({ root: sessions });
  expect(folder.sessions.map((session) => [session.key, session.sessionId]).sort()).toEqual([
    ["b.jsonl", null],
    ["nested/a.jsonl", "sess-a"],
  ]);
  const file = discoverPiSessions({ root: join(sessions, "nested", "a.jsonl") });
  expect(file.sessions.map((session) => session.key)).toEqual(["a.jsonl"]);
});

it("reads at most the first 64 KB of a file for its header", () => {
  const { root } = workspace();
  const big = join(root, "big.jsonl");
  writeFileSync(big, "x".repeat(200 * 1024) + "\n" + header("late"));
  expect(readFirstLine(big).length).toBe(64 * 1024);
  expect(discoverPiSessions({ root: big }).unrecognized[0]?.reason).toBe("malformed header");
});

it("resolves maps first, recorded directories next, then an OpenCode worktree", () => {
  const { root, sessions } = workspace();
  const missing = join(root, "gone");
  expect(resolveImportProject(sessions, [{ from: sessions, to: root }])).toEqual({
    directory: root,
    via: "mapped",
  });
  expect(resolveImportProject(sessions)).toEqual({ directory: sessions, via: "recorded" });
  expect(resolveImportProject(missing, [], root)).toEqual({ directory: root, via: "worktree" });
  expect(resolveImportProject(missing, [], "/")).toEqual({ directory: null, via: "unresolved" });
  // Pi passes no worktree, so a missing directory stays unresolved.
  expect(resolveImportProject(missing)).toEqual({ directory: null, via: "unresolved" });
  expect(resolveImportProject(sessions, [{ from: sessions, to: missing }])).toEqual({
    directory: null,
    via: "unresolved",
  });
});

it("stops a folder walk that is too deep, too wide, or holds too many session files", () => {
  const { root, sessions } = workspace();
  const limits = { maxDepth: 32, maxFolders: 5_000, maxFiles: 20_000 };
  expect(discoverPiSessions({ root: sessions, limits }).sessions).toHaveLength(2);
  mkdirSync(join(root, "a", "b", "c"), { recursive: true });
  expect(() => discoverPiSessions({ root, limits: { ...limits, maxDepth: 2 } })).toThrow(
    DiscoveryLimitError
  );
  expect(() => discoverPiSessions({ root, limits: { ...limits, maxFolders: 2 } })).toThrow(
    "too large to scan"
  );
  expect(() => discoverPiSessions({ root: sessions, limits: { ...limits, maxFiles: 1 } })).toThrow(
    DiscoveryLimitError
  );
});

it("accepts a real Pi sessions folder with deeply nested subagent runs by default", () => {
  const { sessions } = workspace();
  // The shape Pi writes for subagent runs: seven levels below the sessions folder.
  const nested = join(sessions, "--project--", "run", "id", "run-0", "session", "id2", "run-0");
  mkdirSync(nested, { recursive: true });
  writeFileSync(join(nested, "deep.jsonl"), header("sess-deep"));
  const found = discoverPiSessions({ root: sessions });
  expect(found.sessions.map((session) => session.sessionId)).toContain("sess-deep");
});
