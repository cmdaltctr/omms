import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { SkillIndex } from "../services/skill-learning/skill-index.js";
import type { SkillOperationResult } from "./skill-operations.js";

/** Helpers that `skill-operations.ts` and `skill-agent-modes.ts` share. */

export function reply(
  mode: string,
  success: boolean,
  code: string,
  text: string,
  data?: Record<string, unknown>
): SkillOperationResult {
  return data ? { success, mode, code, text, data } : { success, mode, code, text };
}

export function expandHome(path: string): string {
  return path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}

/**
 * The `SKILL.md` path for a skill name or path, or the reply that explains
 * why there is none: no skill of that name, or more than one.
 */
export function resolveSkillPath(
  mode: string,
  skill: string,
  index: SkillIndex
): { path: string } | SkillOperationResult {
  if (/[/\\]/.test(skill)) return { path: resolve(expandHome(skill)) };
  const matches = index.entries.filter((e) => e.name === skill);
  if (matches.length === 0) {
    return reply(
      mode,
      false,
      "not-found",
      `No watched skill is named ${skill}. Run list to see the watched skills.`
    );
  }
  if (matches.length > 1) {
    const paths = matches.map((e) => `- ${e.path}`).join("\n");
    return reply(
      mode,
      false,
      "ambiguous",
      `More than one skill is named ${skill}. Give skill as one of these paths:\n${paths}`,
      { paths: matches.map((e) => e.path) }
    );
  }
  return { path: matches[0]!.path };
}

/** `folder` when it is one of the watched folders, or the reply that lists them. */
export function watchedTarget(
  mode: string,
  folders: readonly string[],
  folder: string | undefined
): { folder: string } | SkillOperationResult {
  const watched = folders.map((f) => resolve(expandHome(f)));
  const target = folder ? resolve(expandHome(folder)) : null;
  if (target && watched.includes(target)) return { folder: target };
  const known = watched.map((f) => `- ${f}`).join("\n") || "(none)";
  return reply(mode, false, "not-watched", `Give folder as one of the watched folders:\n${known}`);
}
