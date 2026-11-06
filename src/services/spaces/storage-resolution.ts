import { homedir } from "node:os";
import { join } from "node:path";
import { resolveDefaultStoragePath } from "../legacy-migration.js";

/** The OMMS folder, normally `~/.omms`. It holds `spaces.json`, `spaces/` and `backups/`. */
export function ommsHomeDir(): string {
  return join(homedir(), ".omms");
}

/** Expands a leading `~` to the home folder. */
export function expandPath(path: string): string {
  if (path.startsWith("~/")) {
    return join(homedir(), path.slice(2));
  }
  if (path === "~") {
    return homedir();
  }
  return path;
}

/** The global store folder: the config's `storagePath`, or the default `~/.omms/data`. */
export function storagePathFrom(fileConfig: { storagePath?: string }): string {
  return fileConfig.storagePath ? expandPath(fileConfig.storagePath) : resolveDefaultStoragePath();
}

/**
 * Keeps skills.db and the embedding model cache in the global storage path when a
 * project config or the active space moves `storagePath` (ADR-036, ADR-041).
 */
export function withSkillStorage<T extends { storagePath: string }>(
  config: T,
  global: { storagePath?: string }
): T {
  const path = storagePathFrom(global);
  return { ...config, skillStoragePath: path === config.storagePath ? undefined : path };
}
