import { afterEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { CONFIG } from "../src/config.js";
import {
  directoryMapsView,
  readOpencodeWorktrees,
  readStoreProjects,
  suggestMapTarget,
  suggestMapTargets,
} from "../src/importer/map-suggestions.js";
import { recordUnresolvedDirectories } from "../src/services/backfill-state.js";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch (error) {
      // Windows can hold a closed SQLite file for a moment (EBUSY). A leftover temp folder is harmless there.
      if (process.platform !== "win32") throw error;
    }
  }
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

/** A linked worktree of `main`: a `.git` file pointing into the main repository. */
function linkedWorktree(main: string, path: string) {
  mkdirSync(join(main, ".git", "worktrees", basename(path)), { recursive: true });
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, ".git"), `gitdir: ${join(main, ".git", "worktrees", basename(path))}\n`);
  return path;
}

const map = (target: string, confidence: string) => ({ kind: "map", target, confidence });

describe("directory map suggestions", () => {
  it("suggests the main repository of a deleted sibling worktree", () => {
    const home = root();
    const code = join(home, "code");
    const app = repo(join(code, "app"));
    repo(join(code, "ap"));
    mkdirSync(join(code, "apple"));
    expect(suggestMapTarget(join(code, "app-feat-x"), { home })).toEqual(map(app, "name"));
  });

  it("suggests a known project for a nested workspace path", () => {
    const base = root();
    const app = repo(join(base, "code", "app"));
    const other = repo(join(base, "code", "other"));
    mkdirSync(join(base, "orca", "workspaces"), { recursive: true });
    const missing = join(base, "orca", "workspaces", "app", "feat-x");
    expect(suggestMapTarget(missing, { knownProjects: [{ path: other }], home: base })).toEqual(
      map(app, "name")
    );
  });

  it("gives no suggestion for a directory with no candidate", () => {
    const base = root();
    const directories = [{ directory: join(base, "tmp-xyz"), sessions: 2 }];
    expect(suggestMapTargets(directories, { home: base })).toEqual([
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
    const opencodeWorktree = (dir: string) => worktrees.get(dir);
    expect(suggestMapTarget(missing, { opencodeWorktree, home: base })).toEqual(
      map(worktree, "exact")
    );
    expect(hash()).toBe(before);
    expect(readdirSync(base).sort()).toEqual(entries);
  });
});

describe("the suggestion search stays local", () => {
  it("never suggests a folder from the filesystem root or beside the home folder", () => {
    const base = root();
    const home = join(base, "home", "me");
    mkdirSync(home, { recursive: true });
    // A project next to the home folder, and one directly under the "root".
    repo(join(base, "home", "tmp"));
    repo(join(base, "scratch"));
    const context = { home };
    // Walking up from a missing folder under home must not scan beside home.
    expect(suggestMapTarget(join(home, "tmp-gone", "x"), context)).toBeNull();
    // A missing folder beside home must not scan the folder that holds home.
    // (The test home sits in a temporary folder, so it may be proposed for Ignore.)
    expect(suggestMapTarget(join(base, "home", "tmp-feat"), context)?.kind).not.toBe("map");
    // Still finds a real sibling inside home.
    const app = repo(join(home, "code", "app"));
    expect(suggestMapTarget(join(home, "code", "app-feat-x"), context)).toEqual(map(app, "name"));
  });
});

describe("the suggestion rules", () => {
  it("proposes to ignore folders that are not projects, with the reason", () => {
    const home = root();
    const reason = (path: string) => suggestMapTarget(path, { home });
    expect(reason("/private/tmp/pi-verify-repo")).toEqual({ kind: "ignore", reason: "temporary" });
    expect(reason("/tmp/scratch")).toEqual({ kind: "ignore", reason: "temporary" });
    expect(reason(join(home, ".pi", "agent", "npm", "node_modules", "pi-mcp-adapter"))).toEqual({
      kind: "ignore",
      reason: "node_modules",
    });
    expect(reason(join(home, "Library", "Application Support", "Open Design", "x"))).toEqual({
      kind: "ignore",
      reason: "app-data",
    });
    expect(reason(join(home, ".agents", "skills", "s-pi-agent-build"))).toEqual({
      kind: "ignore",
      reason: "skills",
    });
    expect(reason(join(home, ".claude", "skills", "s-x"))).toEqual({
      kind: "ignore",
      reason: "skills",
    });
    expect(reason(join(home, "code", "notes"))).toBeNull();
  });

  it("maps to the one existing project with the same stored remote", () => {
    const home = root();
    const old = join(home, "old", "tool");
    const renamed = repo(join(home, "new", "tool-renamed"));
    const remote = "git@example.com:me/tool.git";
    const knownProjects = [
      { path: old, candidates: [old], remote },
      { path: renamed, candidates: [renamed], remote },
    ];
    expect(suggestMapTarget(old, { home, knownProjects })).toEqual(map(renamed, "exact"));
    const fork = repo(join(home, "new", "tool-fork"));
    knownProjects.push({ path: fork, candidates: [fork], remote });
    expect(suggestMapTarget(old, { home, knownProjects })).toBeNull();
  });

  it("follows OpenCode's recorded folder when it is missing too", () => {
    const home = root();
    const recorded = join(home, "clients", "team", "shop-2025");
    const moved = join(home, "projects", "templates", "shop-2025");
    mkdirSync(moved, { recursive: true });
    const missing = join(home, ".local", "share", "opencode", "worktree", "72a8", "feat-google");
    const context = {
      home,
      knownProjects: [{ path: moved }],
      opencodeWorktree: (dir: string) => (dir === missing ? recorded : undefined),
    };
    expect(suggestMapTarget(missing, context)).toEqual(map(moved, "name"));
  });

  it("maps a deleted worktree to the main repository, not a live linked worktree", () => {
    const home = root();
    const app = repo(join(home, "code", "app"));
    linkedWorktree(app, join(home, "code", "app-feat-x"));
    expect(suggestMapTarget(join(home, "code", "app-feat-x-2"), { home })).toEqual(
      map(app, "name")
    );
  });

  it("maps a moved folder to the one known project with its name", () => {
    const home = root();
    const missing = join(home, "clients", "shop-2025");
    const moved = join(home, "projects", "templates", "shop-2025");
    mkdirSync(moved, { recursive: true });
    expect(suggestMapTarget(missing, { home, knownProjects: [{ path: moved }] })).toEqual(
      map(moved, "name")
    );
    const second = join(home, "archive", "shop-2025");
    mkdirSync(second, { recursive: true });
    const knownProjects = [{ path: moved }, { path: second }];
    expect(suggestMapTarget(missing, { home, knownProjects })).toBeNull();
  });

  it("guesses a rename by name parts and initials", () => {
    const home = root();
    const ext = join(home, "ext");
    const renamed = repo(join(ext, "om-pi-subagents"));
    repo(join(ext, "om-pi"));
    const missing = join(ext, "opinionated-modular-pi-subagents-system-ompss");
    expect(suggestMapTarget(missing, { home })).toEqual(map(renamed, "guess"));
    // `om-pi` matches only one part exactly, and `ompts-todo` matches no part list.
    rmSync(renamed, { recursive: true });
    expect(suggestMapTarget(missing, { home })).toBeNull();
    repo(join(ext, "om-pi-todo"));
    expect(suggestMapTarget(join(ext, "ompts-todo"), { home })).toBeNull();
  });

  it("uses the first rule that gives a result", () => {
    const home = root();
    const missing = join(home, "clients", "shop");
    const renamed = repo(join(home, "new", "shop-renamed"));
    const sameName = join(home, "projects", "shop");
    mkdirSync(sameName, { recursive: true });
    const remote = "git@example.com:me/shop.git";
    const knownProjects = [
      { path: missing, candidates: [missing], remote },
      { path: renamed, remote },
      { path: sameName },
    ];
    // Same remote (rule 2) wins over the moved-folder name match (rule 5).
    expect(suggestMapTarget(missing, { home, knownProjects })).toEqual(map(renamed, "exact"));
    // Not a project (rule 1) wins over a deleted-worktree name match (rule 4).
    const modules = join(home, "code", "node_modules");
    repo(join(modules, "app"));
    expect(suggestMapTarget(join(modules, "app-feat-x"), { home })).toEqual({
      kind: "ignore",
      reason: "node_modules",
    });
  });
});

describe("the Directory maps view", () => {
  const previous = {
    storagePath: CONFIG.storagePath,
    ignored: CONFIG.importIgnoredDirectories,
    maps: CONFIG.importPathMaps,
  };
  afterEach(() => {
    CONFIG.storagePath = previous.storagePath;
    CONFIG.importIgnoredDirectories = previous.ignored;
    CONFIG.importPathMaps = previous.maps;
  });

  it("drops ignored directories from every host list and returns them", async () => {
    const storage = mkdtempSync(join(tmpdir(), "omms-maps-view-"));
    try {
      CONFIG.storagePath = storage;
      CONFIG.importPathMaps = [];
      CONFIG.importIgnoredDirectories = ["/x/scratch"];
      await recordUnresolvedDirectories("pi", [
        { directory: "/x/scratch", sessions: 6 },
        { directory: "/x/kept", sessions: 4 },
      ]);
      await recordUnresolvedDirectories("claude-code", [{ directory: "/x/scratch", sessions: 1 }]);
      const view = await directoryMapsView({ opencodeDbPath: join(storage, "none.db") });
      expect(view.ignored).toEqual(["/x/scratch"]);
      expect(view.pi.map((item) => item.directory)).toEqual(["/x/kept"]);
      expect(view["claude-code"]).toEqual([]);
    } finally {
      await cleanupTursoTestDirectory(storage);
    }
  });
});

describe("known projects from the memory store", () => {
  const previous = { storagePath: CONFIG.storagePath, dimensions: CONFIG.embeddingDimensions };
  afterEach(() => {
    CONFIG.storagePath = previous.storagePath;
    CONFIG.embeddingDimensions = previous.dimensions;
  });

  /** Every file under `dir` with its modification time and size. */
  function fileStamps(dir: string): Record<string, string> {
    const stamps: Record<string, string> = {};
    for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const path = join(entry.parentPath, entry.name);
      const stat = statSync(path);
      stamps[path] = `${stat.mtimeMs}:${stat.size}`;
    }
    return stamps;
  }

  it("reads paths and remotes without writing the store or Git metadata", async () => {
    const base = mkdtempSync(join(tmpdir(), "omms-suggest-store-"));
    try {
      const home = join(base, "home");
      const old = join(home, "old", "tool");
      const renamed = repo(join(home, "new", "tool-renamed"));
      linkedWorktree(renamed, join(home, "new", "tool-renamed-feat-x"));
      CONFIG.storagePath = join(base, "storage");
      CONFIG.embeddingDimensions = 2;
      expect(await readStoreProjects(renamed)).toEqual([]);
      expect(existsSync(CONFIG.storagePath)).toBe(false);

      const { getProjectTagInfo } = await import("../src/services/tags.js");
      const { tursoShardManager } = await import("../src/services/turso/shard-manager.js");
      const { tursoConnectionManager } =
        await import("../src/services/turso/connection-manager.js");
      const { tursoVectorSearch } = await import("../src/services/turso/vector-search.js");
      const remote = "git@example.com:me/tool.git";
      for (const [index, projectPath] of [old, renamed].entries()) {
        const tag = getProjectTagInfo(projectPath);
        const shard = await tursoShardManager.createShard("project", `${index}`.repeat(16), 0);
        const db = await tursoConnectionManager.getConnection(shard.dbPath);
        await tursoVectorSearch.insertVector(db, {
          id: `mem_${index}`,
          content: "note",
          vector: new Float32Array([1, 0]),
          containerTag: tag.tag,
          type: "project",
          createdAt: 100,
          updatedAt: 100,
          projectPath,
          projectName: tag.projectName,
          displayName: tag.displayName,
          gitRepoUrl: remote,
        });
        await tursoShardManager.incrementVectorCount(shard.id);
      }
      // The web server's memory routes open the store first; its startup gate is not part of this read.
      const { ensureTursoReady } = await import("../src/services/turso/ready.js");
      await ensureTursoReady();
      const before = { store: fileStamps(CONFIG.storagePath), git: fileStamps(home) };

      const knownProjects = await readStoreProjects(renamed);
      expect(knownProjects).toEqual(
        expect.arrayContaining([
          { path: old, candidates: [old], remote },
          { path: renamed, candidates: [renamed], remote },
        ])
      );
      const suggestions = suggestMapTargets(
        [
          { directory: old, sessions: 1 },
          { directory: join(home, "new", "tool-renamed-feat-x-2"), sessions: 1 },
        ],
        { home, knownProjects }
      );
      expect(suggestions.map((item) => item.suggestion)).toEqual([
        map(renamed, "exact"),
        map(renamed, "name"),
      ]);
      expect(fileStamps(home)).toEqual(before.git);
      // Existing store files stay unchanged; a read may open a SQLite side file.
      const after = fileStamps(CONFIG.storagePath);
      for (const [path, stamp] of Object.entries(before.store)) expect(after[path]).toBe(stamp);
    } finally {
      await cleanupTursoTestDirectory(base);
    }
  });
});
