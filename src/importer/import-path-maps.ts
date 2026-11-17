import { resolve } from "node:path";
import type { ImportPathMap } from "./importer.js";

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
