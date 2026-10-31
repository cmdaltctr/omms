import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

/**
 * Skill learning settings (ADR-036), kept out of `src/config.ts` to save its
 * lines. Pure on purpose: callers pass the file config, and the loaded
 * `CONFIG` is never imported here, because many tests stub `src/config.js`.
 */

/** The raw keys as they appear in a config file, before any check. */
export interface SkillFileConfig {
  skillLearning?: unknown;
  skillLearningRedact?: unknown;
  skillFolders?: unknown;
}

export interface SkillConfig {
  /** Record full turns into `skills.db`. Off by default. */
  skillLearning: boolean;
  /** Remove `<private>` text and secrets before a turn is stored. On by default. Global only. */
  skillLearningRedact: boolean;
  /** Folders OMMS reads skills from. Unset means `defaultSkillFolders`. Global only. */
  skillFolders: string[] | undefined;
}

function expandHome(path: string, homeDir: string): string {
  return path.startsWith("~/") || path.startsWith("~\\") ? join(homeDir, path.slice(2)) : path;
}

function checkedBoolean(value: unknown, key: string, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new Error(`Invalid ${key} config`);
  return value;
}

/**
 * Validate `skillFolders`: absolute paths or paths that start with `~/`,
 * expanded and de-duplicated. Throws on the first invalid entry, like the
 * other list settings. Whether a folder exists is checked when the setting is
 * saved, not here, so a folder on a drive that is not mounted does not break
 * the config.
 */
function parseSkillFolders(value: unknown, homeDir: string): string[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("Invalid skillFolders config: must be a list");
  const folders = value.map((entry, index) => {
    const trimmed = typeof entry === "string" ? entry.trim() : "";
    const expanded = expandHome(trimmed, homeDir);
    if (!trimmed || !isAbsolute(expanded)) {
      throw new Error(
        `Invalid skillFolders config: entry ${index} needs an absolute path or a path that starts with ~/`
      );
    }
    return resolve(expanded);
  });
  return [...new Set(folders)];
}

/** The three settings from a merged file config, with defaults applied. */
export function normaliseSkillConfig(
  fileConfig: SkillFileConfig,
  homeDir: string = homedir()
): SkillConfig {
  return {
    skillLearning: checkedBoolean(fileConfig.skillLearning, "skillLearning", false),
    skillLearningRedact: checkedBoolean(
      fileConfig.skillLearningRedact,
      "skillLearningRedact",
      true
    ),
    skillFolders: parseSkillFolders(fileConfig.skillFolders, homeDir),
  };
}

/**
 * The first `skillFolders` entry, as written, that is not an existing folder,
 * or null when every entry is one. The Settings save refuses a missing folder
 * and names it. `isFolder` is passed in so the caller owns the file system access.
 */
export function missingSkillFolder(
  folders: readonly string[],
  isFolder: (path: string) => boolean,
  homeDir: string = homedir()
): string | null {
  return folders.find((folder) => !isFolder(resolve(expandHome(folder.trim(), homeDir)))) ?? null;
}

/**
 * What a project config may change. A checked-in project file must not start
 * recording conversations, so it can only turn `skillLearning` off. Its
 * `skillLearningRedact` and `skillFolders` are always ignored.
 * `ignoredTurnOn` tells the caller to log a project value of `true`.
 */
export function projectSkillOverride(project: SkillFileConfig): {
  override: { skillLearning?: false };
  ignoredTurnOn: boolean;
} {
  return {
    override: project.skillLearning === false ? { skillLearning: false } : {},
    ignoredTurnOn: project.skillLearning === true,
  };
}

/**
 * The folders to watch when `skillFolders` is unset: `~/.agents/skills` and
 * `<Claude Code folder>/skills`, each only when it exists. `exists` is passed
 * in so the caller owns the file system access.
 */
export function defaultSkillFolders(
  homeDir: string,
  claudeFolder: string,
  exists: (path: string) => boolean
): string[] {
  return [join(homeDir, ".agents", "skills"), join(claudeFolder, "skills")].filter(exists);
}
