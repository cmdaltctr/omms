import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, parse, resolve, sep } from "node:path";
import type { UnresolvedDirectory } from "../services/backfill-state.js";

const PROJECT_MARKERS = [".git", "package.json", "pyproject.toml", "Cargo.toml", "go.mod"];

export type MapConfidence = "exact" | "name" | "guess";
export type IgnoreReason = "temporary" | "node_modules" | "app-data" | "skills";
export type MapSuggestion =
  | { kind: "map"; target: string; confidence: MapConfidence }
  | { kind: "ignore"; reason: IgnoreReason };

/** A project the user has history for. Store projects carry their recorded paths and remote. */
export interface KnownProject {
  path: string;
  /** Other directories the memory store recorded for the same project. */
  candidates?: readonly string[];
  /** The git remote the memory store recorded for the project. */
  remote?: string | null;
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isProject(path: string): boolean {
  return PROJECT_MARKERS.some((marker) => existsSync(join(path, marker)));
}

function isInside(path: string, folder: string): boolean {
  return path === folder || path.startsWith(folder.endsWith(sep) ? folder : `${folder}${sep}`);
}

/**
 * The main working tree of a linked Git worktree, from the `gitdir:` line of
 * its `.git` file; the folder itself otherwise. Null when a linked worktree's
 * main tree is gone. Reads one file and starts no `git` process.
 */
function projectRoot(path: string): string | null {
  let gitFile: string;
  try {
    if (!statSync(join(path, ".git")).isFile()) return path;
    gitFile = readFileSync(join(path, ".git"), "utf8");
  } catch {
    return path;
  }
  const gitdir = /^gitdir:\s*(.+)$/m.exec(gitFile)?.[1]?.trim();
  if (!gitdir) return path;
  const marker = `${sep}.git${sep}worktrees${sep}`;
  const at = resolve(path, gitdir).indexOf(marker);
  if (at < 0) return path;
  const main = resolve(path, gitdir).slice(0, at);
  return isDirectory(main) && isProject(main) ? main : null;
}

function childDirectories(parent: string, cache?: Map<string, string[]>): string[] {
  const cached = cache?.get(parent);
  if (cached) return cached;
  let children: string[];
  try {
    children = readdirSync(parent, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(parent, entry.name));
  } catch {
    children = [];
  }
  cache?.set(parent, children);
  return children;
}

/** `app` is a leading part of `app`, `app-feat-x`, and `app-feat-x-2`, not of `apple`. */
function isLeadingPart(candidate: string, name: string): boolean {
  return name === candidate || name.startsWith(`${candidate}-`);
}

function nameParts(name: string): string[] {
  return name
    .toLowerCase()
    .split(/[-_.]+/)
    .filter(Boolean);
}

/**
 * True when every part of `candidate` matches, in order, one part of
 * `missing` or the initials of two or more consecutive parts, and at least two
 * parts match exactly: `om-pi-subagents` for `opinionated-modular-pi-subagents-system`.
 */
function isRenameOf(candidate: string, missing: string): boolean {
  const want = nameParts(missing);
  let next = 0;
  let exact = 0;
  for (const part of nameParts(candidate)) {
    let matched = false;
    for (let at = next; at < want.length && !matched; at++) {
      if (want[at] === part) {
        exact++;
        next = at + 1;
        matched = true;
        continue;
      }
      for (let end = at + 2; end <= want.length; end++) {
        const initials = want
          .slice(at, end)
          .map((word) => word[0])
          .join("");
        if (initials !== part) continue;
        next = end;
        matched = true;
        break;
      }
    }
    if (!matched) return false;
  }
  return exact >= 2;
}

/** Folders that never hold a project worth mapping. Pure path checks. */
function notProjectReason(missing: string, home: string): IgnoreReason | null {
  if (missing.split(/[\\/]/).includes("node_modules")) return "node_modules";
  if (isInside(missing, join(home, "Library", "Application Support"))) return "app-data";
  const skills = [join(home, ".agents", "skills"), join(home, ".claude", "skills")];
  if (skills.some((folder) => isInside(missing, folder))) return "skills";
  // A home folder never sits in a temporary folder outside tests, so a path
  // inside it is never temporary.
  if (isInside(missing, home)) return null;
  const temporary = ["/tmp", "/private/tmp", "/private/var/folders", tmpdir()];
  return temporary.some((folder) => isInside(missing, folder)) ? "temporary" : null;
}

export interface MapSuggestionContext {
  /** Existing project directories the user has history for; their parents are searched too. */
  knownProjects?: readonly KnownProject[];
  /** OpenCode's recorded project worktree for a session directory, read without writing. */
  opencodeWorktree?: (directory: string) => string | null | undefined;
  /** The user's home folder; the search never climbs above it. Defaults to `homedir()`. */
  home?: string;
  /** Folder listings already read in this request. */
  cache?: Map<string, string[]>;
}

/** The one distinct target in `targets`, after resolving linked worktrees; null otherwise. */
function onlyTarget(targets: Iterable<string>, missing: string): string | null {
  const found = new Set<string>();
  for (const target of targets) {
    if (target === missing || !isDirectory(target)) continue;
    const root = projectRoot(target);
    if (root) found.add(root);
  }
  return found.size === 1 ? [...found][0]! : null;
}

/** Rule 2: the one existing project with the git remote the store recorded for `missing`. */
function sameRemote(missing: string, known: readonly KnownProject[]): string | null {
  const remotes = new Set(
    known
      .filter((project) => project.path === missing || project.candidates?.includes(missing))
      .map((project) => project.remote)
      .filter((remote): remote is string => Boolean(remote))
  );
  if (!remotes.size) return null;
  const matches = known.filter((project) => project.remote && remotes.has(project.remote));
  return onlyTarget(
    matches.map((project) => project.path),
    missing
  );
}

/**
 * Rule 4: the main repository of a deleted worktree, by the longest leading
 * part of the directory's name or one of its parents' names.
 */
function deletedWorktree(
  missing: string,
  searchRoots: ReadonlySet<string>,
  blocked: ReadonlySet<string>,
  home: string,
  cache?: Map<string, string[]>
): string | null {
  let ancestor = missing;
  while (dirname(ancestor) !== ancestor && ancestor !== home) {
    const name = basename(ancestor);
    const parents = new Set([dirname(ancestor), ...searchRoots]);
    let best: { name: string; root: string } | null = null;
    for (const parent of parents) {
      if (blocked.has(parent)) continue;
      for (const candidate of childDirectories(parent, cache)) {
        if (candidate === ancestor || !isLeadingPart(basename(candidate), name)) continue;
        if (!isProject(candidate)) continue;
        const root = projectRoot(candidate);
        if (!root) continue;
        if (!best || basename(candidate).length > best.name.length) {
          best = { name: basename(candidate), root };
        }
      }
    }
    if (best) return best.root;
    ancestor = dirname(ancestor);
  }
  return null;
}

/** Rule 6: the one project beside `missing` or beside a known project whose name is a rename of it. */
function renameGuess(
  missing: string,
  searchRoots: ReadonlySet<string>,
  blocked: ReadonlySet<string>,
  cache?: Map<string, string[]>
): string | null {
  const name = basename(missing);
  const candidates: string[] = [];
  for (const parent of new Set([dirname(missing), ...searchRoots])) {
    if (blocked.has(parent)) continue;
    for (const candidate of childDirectories(parent, cache)) {
      if (isRenameOf(basename(candidate), name) && isProject(candidate)) candidates.push(candidate);
    }
  }
  return onlyTarget(candidates, missing);
}

type MapResult = Extract<MapSuggestion, { kind: "map" }>;

/** Rules 4 to 6 for one missing directory, first result wins. */
function suggestByName(
  missing: string,
  context: MapSuggestionContext,
  home: string
): MapResult | null {
  const known = context.knownProjects ?? [];
  const searchRoots = new Set<string>();
  for (const project of known) {
    if (isDirectory(project.path)) searchRoots.add(dirname(project.path));
  }
  // Never list the filesystem root or the folder that holds every home folder,
  // and stop at the home folder itself: broad scans suggest unrelated folders.
  const blocked = new Set([parse(missing).root, dirname(home)]);
  const worktree = deletedWorktree(missing, searchRoots, blocked, home, context.cache);
  if (worktree) return { kind: "map", target: worktree, confidence: "name" };
  const moved = onlyTarget(
    known
      .flatMap((project) => [project.path, ...(project.candidates ?? [])])
      .filter((path) => basename(path) === basename(missing)),
    missing
  );
  if (moved) return { kind: "map", target: moved, confidence: "name" };
  const renamed = renameGuess(missing, searchRoots, blocked, context.cache);
  if (renamed) return { kind: "map", target: renamed, confidence: "guess" };
  return null;
}

/**
 * Suggest what to do with a directory that no longer exists. Rules run in
 * order and the first result wins: (1) ignore a folder that is not a project,
 * (2) the project with the same stored git remote, (3) OpenCode's recorded
 * project folder, or rules 2 and 4 to 6 on it when it is gone too, (4) the
 * main repository of a deleted worktree, (5) the one known project with the
 * same folder name, (6) a rename guess by name parts and initials. Returns
 * null when no rule gives a result. Reads folders and `.git` files only.
 */
export function suggestMapTarget(
  missing: string,
  context: MapSuggestionContext = {}
): MapSuggestion | null {
  const home = context.home ?? homedir();
  const reason = notProjectReason(missing, home);
  if (reason) return { kind: "ignore", reason };
  const known = context.knownProjects ?? [];
  const byRemote = (path: string): MapResult | null => {
    const target = sameRemote(path, known);
    return target ? { kind: "map", target, confidence: "exact" } : null;
  };
  const remote = byRemote(missing);
  if (remote) return remote;
  const recorded = context.opencodeWorktree?.(missing);
  if (recorded && recorded !== "/") {
    if (isDirectory(recorded)) return { kind: "map", target: recorded, confidence: "exact" };
    // One level deep: the recorded folder is gone too.
    const followed = byRemote(recorded) ?? suggestByName(recorded, context, home);
    if (followed) return followed;
  }
  return suggestByName(missing, context, home);
}

export interface SuggestedDirectory extends UnresolvedDirectory {
  suggestion: MapSuggestion | null;
}

export function suggestMapTargets(
  directories: readonly UnresolvedDirectory[],
  context: MapSuggestionContext = {}
): SuggestedDirectory[] {
  const withCache = { ...context, cache: context.cache ?? new Map<string, string[]>() };
  return directories.map((item) => ({
    ...item,
    // Sessions with no recorded directory have nothing to map.
    suggestion: item.directory ? suggestMapTarget(item.directory, withCache) : null,
  }));
}

/**
 * OpenCode's recorded project worktree for each session directory, through
 * the importer's read-only reader. OpenCode's database is never written.
 */
export async function readOpencodeWorktrees(dbPath: string): Promise<Map<string, string>> {
  const { openOpencodeHistory } = await import("./opencode-reader.js");
  const history = await openOpencodeHistory(dbPath);
  try {
    const worktrees = new Map<string, string>();
    for (const session of history.sessions) {
      if (session.recordedDirectory && session.projectWorktree) {
        worktrees.set(session.recordedDirectory, session.projectWorktree);
      }
    }
    return worktrees;
  } finally {
    await history.close();
  }
}

/**
 * The memory store's projects with their recorded paths and git remote, read
 * once through the shard inventory. Empty when there is no store or the read
 * fails, so the other sources still give suggestions. Never creates a store.
 */
export async function readStoreProjects(currentDirectory: string): Promise<KnownProject[]> {
  try {
    const { CONFIG } = await import("../config.js");
    if (!existsSync(join(CONFIG.storagePath, "metadata.db"))) return [];
    const { shardInventoryService } = await import("../services/shard-inventory-service.js");
    const inventory = await shardInventoryService.listShards(currentDirectory);
    return inventory.shards.flatMap((group) => {
      const candidates = group.projectPathCandidates.map((candidate) => resolve(candidate.path));
      const path = group.projectPath ? resolve(group.projectPath) : candidates[0];
      return path ? [{ path, candidates, remote: group.gitRepoUrl }] : [];
    });
  } catch {
    return [];
  }
}

/**
 * The Directory maps list: saved maps, ignored directories, and each host's
 * unresolved directories from its latest run, with suggestions. Paths and
 * counts only.
 */
export async function directoryMapsView(
  options: { opencodeDbPath?: string; knownProjects?: readonly KnownProject[] } = {}
) {
  const { CONFIG } = await import("../config.js");
  const { readUnresolvedDirectories } = await import("../services/backfill-state.js");
  const { DEFAULT_OPENCODE_DB } = await import("./opencode-reader.js");
  const saved = new Set(CONFIG.importPathMaps.map((map) => map.from));
  // Older config stubs in tests have no list.
  const ignored = CONFIG.importIgnoredDirectories ?? [];
  const hidden = new Set([...saved, ...ignored]);
  let worktrees = new Map<string, string>();
  const dbPath = options.opencodeDbPath ?? DEFAULT_OPENCODE_DB;
  if (existsSync(dbPath)) {
    worktrees = await readOpencodeWorktrees(dbPath).catch(() => new Map<string, string>());
  }
  const knownProjects = [
    ...(options.knownProjects ?? []),
    ...CONFIG.importPathMaps.map((map) => ({ path: map.to })),
    ...[...worktrees.values()].map((path) => ({ path })),
  ];
  const host = async (name: "pi" | "opencode" | "claude-code") => {
    const pending = (await readUnresolvedDirectories(name)).filter(
      (item) => !hidden.has(item.directory)
    );
    return suggestMapTargets(pending, {
      knownProjects,
      ...(name === "opencode" ? { opencodeWorktree: (dir: string) => worktrees.get(dir) } : {}),
    });
  };
  return {
    saved: CONFIG.importPathMaps,
    ignored,
    pi: await host("pi"),
    opencode: await host("opencode"),
    "claude-code": await host("claude-code"),
  };
}
