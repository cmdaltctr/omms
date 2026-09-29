import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, parse } from "node:path";
import type { UnresolvedDirectory } from "../services/backfill-state.js";

const PROJECT_MARKERS = [".git", "package.json", "pyproject.toml", "Cargo.toml", "go.mod"];

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

export interface MapSuggestionContext {
  /** Existing project directories the user has history for; their parents are searched too. */
  knownProjects?: readonly string[];
  /** OpenCode's recorded project worktree for a session directory, read without writing. */
  opencodeWorktree?: (directory: string) => string | null | undefined;
  /** The user's home folder; the search never climbs above it. Defaults to `homedir()`. */
  home?: string;
  /** Folder listings already read in this request. */
  cache?: Map<string, string[]>;
}

/**
 * Suggest an existing target for a directory that no longer exists: first the
 * main repository of a deleted worktree, by the longest leading part of the
 * directory's name or one of its parents' names, then OpenCode's recorded
 * project worktree. Returns null when there is no candidate.
 */
export function suggestMapTarget(
  missing: string,
  context: MapSuggestionContext = {}
): string | null {
  const searchRoots = new Set<string>();
  for (const project of context.knownProjects ?? []) {
    if (!isDirectory(project)) continue;
    searchRoots.add(dirname(project));
  }
  // Never list the filesystem root or the folder that holds every home folder,
  // and stop at the home folder itself: broad scans suggest unrelated folders.
  const home = context.home ?? homedir();
  const blocked = new Set([parse(missing).root, dirname(home)]);
  let ancestor = missing;
  while (dirname(ancestor) !== ancestor && ancestor !== home) {
    const name = basename(ancestor);
    const parents = new Set([dirname(ancestor), ...searchRoots]);
    let best: string | null = null;
    for (const parent of parents) {
      if (blocked.has(parent)) continue;
      for (const candidate of childDirectories(parent, context.cache)) {
        if (candidate === ancestor || !isLeadingPart(basename(candidate), name)) continue;
        if (!isProject(candidate)) continue;
        if (!best || basename(candidate).length > basename(best).length) best = candidate;
      }
    }
    if (best) return best;
    ancestor = dirname(ancestor);
  }
  const worktree = context.opencodeWorktree?.(missing);
  if (worktree && worktree !== "/" && isDirectory(worktree)) return worktree;
  return null;
}

export interface SuggestedDirectory extends UnresolvedDirectory {
  suggestion: string | null;
}

export function suggestMapTargets(
  directories: readonly UnresolvedDirectory[],
  context: MapSuggestionContext = {}
): SuggestedDirectory[] {
  const withCache = { ...context, cache: context.cache ?? new Map<string, string[]>() };
  return directories.map((item) => ({
    ...item,
    suggestion: suggestMapTarget(item.directory, withCache),
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
 * The Directory maps list: saved maps and each host's unresolved directories
 * from its latest run, with suggestions. Paths and counts only.
 */
export async function directoryMapsView(
  options: { opencodeDbPath?: string; knownProjects?: readonly string[] } = {}
) {
  const { CONFIG } = await import("../config.js");
  const { readUnresolvedDirectories } = await import("../services/backfill-state.js");
  const { DEFAULT_OPENCODE_DB } = await import("./opencode-reader.js");
  const saved = new Set(CONFIG.importPathMaps.map((map) => map.from));
  let worktrees = new Map<string, string>();
  const dbPath = options.opencodeDbPath ?? DEFAULT_OPENCODE_DB;
  if (existsSync(dbPath)) {
    worktrees = await readOpencodeWorktrees(dbPath).catch(() => new Map<string, string>());
  }
  const knownProjects = [
    ...(options.knownProjects ?? []),
    ...CONFIG.importPathMaps.map((map) => map.to),
    ...worktrees.values(),
  ];
  const host = async (name: "pi" | "opencode" | "claude-code") => {
    const pending = (await readUnresolvedDirectories(name)).filter(
      (item) => !saved.has(item.directory)
    );
    return suggestMapTargets(pending, {
      knownProjects,
      ...(name === "opencode" ? { opencodeWorktree: (dir: string) => worktrees.get(dir) } : {}),
    });
  };
  return {
    saved: CONFIG.importPathMaps,
    pi: await host("pi"),
    opencode: await host("opencode"),
    "claude-code": await host("claude-code"),
  };
}
