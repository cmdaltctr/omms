import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import type { ImportPathMap } from "./importer.js";

function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/") || path.startsWith("~\\")) return join(homedir(), path.slice(2));
  return path;
}

/**
 * Validate and normalise `importPathMaps` from the global config. Each entry
 * needs absolute `from` and `to` directories after `~` expansion. Throws on
 * the first invalid entry, like the rest of config validation.
 */
export function parseImportPathMaps(value: unknown): ImportPathMap[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("Invalid importPathMaps config: must be a list");
  return value.map((entry, index) => {
    const from = (entry as { from?: unknown } | null)?.from;
    const to = (entry as { to?: unknown } | null)?.to;
    if (typeof from !== "string" || typeof to !== "string" || !from.trim() || !to.trim()) {
      throw new Error(`Invalid importPathMaps config: entry ${index} needs "from" and "to"`);
    }
    const expanded = { from: expandHome(from.trim()), to: expandHome(to.trim()) };
    if (!isAbsolute(expanded.from) || !isAbsolute(expanded.to)) {
      throw new Error(`Invalid importPathMaps config: entry ${index} needs absolute paths`);
    }
    return { from: resolve(expanded.from), to: resolve(expanded.to) };
  });
}

/**
 * Validate and normalise `importIgnoredDirectories` from the global config:
 * absolute directories after `~` expansion. Throws on the first invalid entry.
 */
export function parseIgnoredDirectories(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error("Invalid importIgnoredDirectories config: must be a list");
  }
  const paths = value.map((entry, index) => {
    const expanded = typeof entry === "string" ? expandHome(entry.trim()) : "";
    if (!expanded || !isAbsolute(expanded)) {
      throw new Error(
        `Invalid importIgnoredDirectories config: entry ${index} needs an absolute path`
      );
    }
    return resolve(expanded);
  });
  // One folder written in two forms is one entry.
  return [...new Set(paths)];
}

/** Saved maps with the run's own maps on top; a run map wins for the same `from`. */
export function mergeImportPathMaps(
  saved: readonly ImportPathMap[],
  run: readonly ImportPathMap[]
): ImportPathMap[] {
  const byFrom = new Map<string, ImportPathMap>();
  for (const map of saved) byFrom.set(map.from, map);
  for (const map of run) byFrom.set(map.from, map);
  return [...byFrom.values()];
}

/**
 * The maps one import run uses: the saved `importPathMaps` with the run's
 * maps on top, run targets resolved against `cwd`.
 */
export async function runPathMaps(
  runMaps: readonly ImportPathMap[],
  cwd: string,
  saved?: readonly ImportPathMap[]
): Promise<ImportPathMap[]> {
  const savedMaps = saved ?? (await import("../config.js")).CONFIG.importPathMaps ?? [];
  return mergeImportPathMaps(
    savedMaps,
    runMaps.map((map) => ({ from: map.from, to: resolve(cwd, map.to) }))
  );
}
