import os from "node:os";
import { redactTraceText, type CaptureDiagnosticsConfig } from "../capture-diagnostics.js";
import type { SkillHistoryEntry } from "../skill-learning/history.js";
import type { SkillRanking } from "../skill-learning/ranking.js";
import { MAX_PLAN_SKILLS } from "./chat-plan.js";
import type { ChatSource, SkillIntent } from "./chat-types.js";

export { MAX_PLAN_SKILLS };

export type { SkillIntent };

/** Skill sources per question. Memories (12) and profile items (6) have their own limits. */
export const MAX_SKILL_SOURCES = 6;
export const MAX_SUMMARY_CHARS = 200;
export const MAX_HISTORY_ENTRIES = 5;
const MIN_MATCH_NAME_CHARS = 3;
const MIN_USER_NAME_CHARS = 3;

/** The only names the chat offers, accepts or saves. */
export const SAFE_SKILL_NAME = /^[A-Za-z0-9][\w.:-]{0,63}$/;

/** The part of a ranking row that the chat uses. The `path` is read here and never copied out. */
export type SkillRow = Pick<
  SkillRanking,
  "name" | "path" | "uses" | "failedTurns" | "attention" | "modified" | "lastAppliedAt"
>;

type HistoryInput = Pick<SkillHistoryEntry, "kind" | "at" | "summary" | "appliedBy">;

/** Why skill facts could not be read. Logged as a code; never as text. */
export type SkillFactsFailure = "newer_schema" | "read_failed";

export class SkillFactsError extends Error {
  constructor(readonly code: SkillFactsFailure) {
    super(code);
  }
}

/** How the chat reads skill facts. Built only while `skillLearning` is on. */
export interface ChatSkillsDep {
  scrub: ScrubContext;
  /** Ranking rows in any order. Throws when `skills.db` is newer or unreadable. */
  rank: () => Promise<SkillRow[]>;
  /** History entries of one skill, newest first. */
  history: (row: SkillRow) => Promise<HistoryInput[]>;
}

export interface ScrubContext {
  home: string;
  user: string;
  diagnostics: CaptureDiagnosticsConfig;
}

/** Reads the home folder and OS user name when none are given. Pass config values in; do not import `CONFIG`. */
export function makeScrubContext(
  diagnostics: CaptureDiagnosticsConfig,
  names: { home?: string; user?: string } = {}
): ScrubContext {
  return {
    home: names.home ?? os.homedir(),
    user: names.user ?? os.userInfo().username,
    diagnostics,
  };
}

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// Characters that end an unquoted path token.
const STOP = "\\s\"'`<>(),;";
const UNIX_PATH = new RegExp(`(?<=^|[\\s"'\`(\\[<=,;])\\/[^${STOP}/]+(?:\\/[^${STOP}/]*)+`, "g");
const TILDE_PATH = new RegExp(`(?<=^|[\\s"'\`(\\[<=,;])~\\/[^${STOP}]+`, "g");
const HOME_PATH = new RegExp(`\\[home\\][\\\\/][^${STOP}]*`, "g");
// Folders may hold spaces; the last segment may not, so prose after the path stays.
const WINDOWS_PATH = /(?<![A-Za-z0-9])[A-Za-z]:\\(?:[^\\/:*?"<>|\r\n`']+\\)*[^\s\\/:*?"<>|`']*/g;
const WINDOWS_SLASH_PATH = new RegExp(`(?<![A-Za-z0-9])[A-Za-z]:\\/[^${STOP}]+`, "g");
const FILE_URL = new RegExp(`file:[^${STOP}]*`, "gi");
const WEB_URL = new RegExp(`https?:\\/\\/[^${STOP}]+`, "gi");
const EMAIL = /(?:[A-Za-z0-9._%+-]|\[user\])+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/**
 * A summary made safe to send and to save: no `<private>` text, no secrets, no
 * home folder, OS user name, absolute path or email address, and at most 200
 * characters. It runs whatever `skillLearningRedact` says.
 */
export function scrubSummary(text: string, ctx: ScrubContext): string {
  let out = text;
  if (ctx.home) out = out.replaceAll(ctx.home, "[home]");
  if (ctx.user.length >= MIN_USER_NAME_CHARS) {
    out = out.replace(
      new RegExp(`(?<![A-Za-z0-9])${escape(ctx.user)}(?![A-Za-z0-9])`, "gi"),
      "[user]"
    );
  }
  out = out.replace(FILE_URL, "[path]");
  out = out.replace(WEB_URL, (url) =>
    url.replace(/^(https?:\/\/)[^/@\s]*@/i, "$1").replace(/\?[^#]*/, "")
  );
  out = redactTraceText(out, ctx.diagnostics);
  out = out
    .replace(HOME_PATH, "[path]")
    .replace(WINDOWS_PATH, "[path]")
    .replace(WINDOWS_SLASH_PATH, "[path]")
    .replace(TILDE_PATH, "[path]")
    .replace(UNIX_PATH, "[path]");
  out = out.replace(EMAIL, "[email]");
  out = out.replace(/\s+/g, " ").trim();
  return out.length > MAX_SUMMARY_CHARS ? `${out.slice(0, MAX_SUMMARY_CHARS - 1).trimEnd()}…` : out;
}

function isSafeName(name: string, ctx: ScrubContext): boolean {
  return SAFE_SKILL_NAME.test(name) && scrubSummary(name, ctx) === name;
}

/**
 * Rows with a safe name, one per name, most used first, at most 100. When two
 * rows share a name, the one with the most uses wins; the first wins a tie.
 */
export function safeSkillRows<T extends SkillRow>(rows: readonly T[], ctx: ScrubContext): T[] {
  const byName = new Map<string, T>();
  for (const row of rows) {
    if (!isSafeName(row.name, ctx)) continue;
    const seen = byName.get(row.name);
    if (!seen || row.uses > seen.uses) byName.set(row.name, row);
  }
  return [...byName.values()].sort((a, b) => b.uses - a.uses).slice(0, MAX_PLAN_SKILLS);
}

/**
 * Up to six rows: named skills first in plan order, then the rows the intent
 * picks. `rows` must come from `safeSkillRows`.
 */
export function selectSkills<T extends SkillRow>(
  rows: readonly T[],
  named: readonly string[],
  intent: SkillIntent
): T[] {
  const byKey = new Map(rows.map((row) => [row.name.toLowerCase(), row]));
  const picked: T[] = [];
  const add = (row: T | undefined) => {
    if (row && !picked.includes(row)) picked.push(row);
  };
  for (const name of named) add(byKey.get(name.toLowerCase()));
  if (intent === "needs-work") {
    rows
      .filter((row) => row.failedTurns >= 1)
      .sort((a, b) => b.attention - a.attention || b.uses - a.uses || a.name.localeCompare(b.name))
      .forEach(add);
  } else if (intent === "most-used") {
    rows
      .filter((row) => row.uses >= 1)
      .sort((a, b) => b.uses - a.uses)
      .forEach(add);
  }
  return picked.slice(0, MAX_SKILL_SOURCES);
}

/**
 * Skill names that appear in the question as a whole token, ignoring case, in
 * order of first mention. Names under 3 characters are skipped. A name is not
 * matched inside a longer name such as `s-web-search-v2`.
 */
export function matchSkillNames(question: string, names: readonly string[]): string[] {
  const found: Array<{ name: string; at: number }> = [];
  for (const name of names) {
    if (name.length < MIN_MATCH_NAME_CHARS) continue;
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}_:-])${escape(name)}(?![\\p{L}\\p{N}_:-])`, "iu");
    const at = question.search(pattern);
    if (at >= 0) found.push({ name, at });
  }
  return found.sort((a, b) => a.at - b.at).map((hit) => hit.name);
}

const isoDate = (at: number) => new Date(at).toISOString().slice(0, 10);

/**
 * The `K` source for one skill. The label comes later from `numberSources`.
 * `history` is newest first; the newest 5 entries are kept. No path, version
 * id or undo flag leaves this function.
 */
export function buildSkillSource(
  row: SkillRow,
  history: readonly HistoryInput[],
  ctx: ScrubContext
): ChatSource {
  const entries = history.slice(0, MAX_HISTORY_ENTRIES).map((entry) => ({
    kind: entry.kind,
    at: entry.at,
    summary: scrubSummary(entry.summary, ctx),
    appliedBy: entry.appliedBy,
  }));
  const uses = `${row.uses} ${row.uses === 1 ? "use" : "uses"}`;
  const failed = `${row.failedTurns} failed ${row.failedTurns === 1 ? "turn" : "turns"}`;
  const modified = row.modified
    ? `Modified: yes${row.lastAppliedAt === null ? "" : ` (last applied ${isoDate(row.lastAppliedAt)})`}`
    : "Modified: no";
  const lines = entries.map(
    (entry) =>
      `- ${isoDate(entry.at)} ${entry.kind}${entry.appliedBy ? ` by ${entry.appliedBy}` : ""}: ${entry.summary}`
  );
  const text = [
    `${row.name}: ${uses}, ${failed}, attention ${row.attention.toFixed(2)} (30 days, all projects)`,
    modified,
    ...lines,
  ].join("\n");
  return {
    label: "",
    kind: "skill",
    id: row.name,
    text,
    skill: {
      name: row.name,
      uses: row.uses,
      failedTurns: row.failedTurns,
      attention: row.attention,
      modified: row.modified,
      lastAppliedAt: row.lastAppliedAt,
      history: entries,
    },
  };
}

/** The reason code for a failed read. */
export function failureCode(error: unknown): SkillFactsFailure {
  return (error as { code?: unknown } | null)?.code === "newer_schema"
    ? "newer_schema"
    : "read_failed";
}

/** The safe skill rows, or the reason they could not be read. */
export async function readSkillRows(
  skills: ChatSkillsDep
): Promise<{ rows: SkillRow[] } | { failure: SkillFactsFailure }> {
  try {
    return { rows: safeSkillRows(await skills.rank(), skills.scrub) };
  } catch (error) {
    return { failure: failureCode(error) };
  }
}

/**
 * The `K` sources for one question. The plan's names come first, or the names
 * found in the question when the plan was skipped. Throws when history cannot be read.
 */
export async function skillSourcesFor(
  skills: ChatSkillsDep,
  rows: readonly SkillRow[],
  plan: { skipped: boolean; skills?: string[]; skillIntent?: SkillIntent },
  question: string
): Promise<ChatSource[]> {
  const named = plan.skipped
    ? matchSkillNames(
        question,
        rows.map((row) => row.name)
      )
    : (plan.skills ?? []);
  const picked = selectSkills(rows, named, plan.skillIntent ?? "none");
  return Promise.all(
    picked.map(async (row) => buildSkillSource(row, await skills.history(row), skills.scrub))
  );
}
