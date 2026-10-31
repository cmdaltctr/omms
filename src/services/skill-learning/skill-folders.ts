import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { resolveClaudeFolder } from "../claude-folder.js";
import { defaultSkillFolders } from "./skill-config.js";

/**
 * The watched skill folders, in one place for every caller. The caller passes
 * `CONFIG`, because many tests stub `src/config.js`.
 */

/** The real path, or the path as given when it does not exist. */
export function realPathOrSelf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

/**
 * `skillFolders`, or the default folders when it is unset. Folders with the
 * same real path, such as `~/.claude/skills` linked to `~/.agents/skills`,
 * are watched once, under the first spelling.
 */
export function watchedSkillFolders(config: {
  skillFolders?: string[];
  claudeConfigDir?: string;
}): string[] {
  const folders =
    config.skillFolders ??
    defaultSkillFolders(homedir(), resolveClaudeFolder(config.claudeConfigDir).folder, existsSync);
  const seen = new Set<string>();
  return folders.filter((folder) => {
    const real = realPathOrSelf(folder);
    if (seen.has(real)) return false;
    seen.add(real);
    return true;
  });
}

/**
 * Where `skills.db` lives: the global `storagePath`, never a project value.
 * `initConfig` sets `skillStoragePath` only when a project config moved
 * `storagePath`; otherwise `storagePath` is the global one.
 */
export function skillStoragePath(config: {
  storagePath: string;
  skillStoragePath?: string;
}): string {
  return config.skillStoragePath ?? config.storagePath;
}
