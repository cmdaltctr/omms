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
  readImportSourceToken,
  validateImportSource,
} from "../src/importer/import-sources.js";
import { discoverPiSessions, readFirstLine } from "../src/importer/discovery.js";
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
  expect(folder.displayPath).toBe(realpathSync(sessions));
  expect(validateImportSource("pi", join(sessions, "b.jsonl")).kind).toBe("pi-file");
  const database = validateImportSource("opencode", db);
  expect(database.kind).toBe("opencode-db");
  expect(readImportSourceToken(database.sourceToken, "opencode").realPath).toBe(realpathSync(db));
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

it("accepts a symlinked root or ancestor through its real path, like a mounted volume", () => {
  const { root, sessions } = workspace();
  const linked = join(root, "linked-volume");
  symlinkSync(root, linked);
  const result = validateImportSource("pi", join(linked, "sessions"));
  expect(result.displayPath).toBe(realpathSync(sessions));
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
  expect(pi.parent).toBe(realpathSync(root));
  const opencode = browseImportSources("opencode", root);
  expect(opencode.entries.map((entry) => entry.name)).toEqual(["sessions", "history.db"]);
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
