import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

/**
 * The Claude Code folder, in one place for every caller: the `claudeConfigDir`
 * setting, then `CLAUDE_CONFIG_DIR`, then `~/.claude`. Pure on purpose: callers
 * pass `CONFIG.claudeConfigDir`, because many tests stub `src/config.js`.
 * It sits in services so the settings snapshot can use it too.
 */

export type ClaudeFolderSource = "setting" | "env" | "default";

export interface ClaudeFolder {
  folder: string;
  source: ClaudeFolderSource;
}

/** Empty, an absolute path, or `~/...`. A relative path would depend on the web app's working directory. */
export function isValidClaudeConfigDir(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return trimmed === "" || trimmed.startsWith("~/") || isAbsolute(trimmed);
}

export function resolveClaudeFolder(
  configured: string | undefined,
  env: string | undefined = process.env.CLAUDE_CONFIG_DIR,
  home: string = homedir()
): ClaudeFolder {
  const setting = configured?.trim();
  if (setting) {
    return {
      folder: setting.startsWith("~/") ? join(home, setting.slice(2)) : setting,
      source: "setting",
    };
  }
  const fromEnv = env?.trim();
  if (fromEnv) return { folder: fromEnv, source: "env" };
  return { folder: join(home, ".claude"), source: "default" };
}

/** `<Claude folder>/projects`, where Claude Code writes its transcripts. */
export function claudeProjectsRoot(
  configured: string | undefined,
  env?: string,
  home?: string
): string {
  return join(resolveClaudeFolder(configured, env, home).folder, "projects");
}
