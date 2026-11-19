import {
  appliedProposalRows,
  rankingRows,
  skillModeRows,
  type SkillsDb,
} from "../storage/skills/turn-queries.js";
import type { SkillMode } from "../storage/skills/proposals.js";
import type { SkillIndex } from "./skill-index.js";
import type { SkillStore } from "../storage/skills/store.js";

export const RANKING_WINDOW_MS = 30 * 86_400_000;
/** A skill needs this many uses in the window before it can be Suggested. */
export const SUGGEST_MIN_USES = 5;
/** A skill also needs this attention score before it can be Suggested. */
export const SUGGEST_MIN_ATTENTION = 0.3;

export const SKILL_ORDERS = ["uses", "attention"] as const;
export type SkillOrder = (typeof SKILL_ORDERS)[number];

export interface SkillRanking {
  name: string;
  /** Full path of its `SKILL.md`, or null when no watched folder holds it. */
  path: string | null;
  /** Shown as **Not in a watched folder**; such a skill gets no draft. */
  notInWatchedFolder: boolean;
  /** Turns in the last 30 days that used the skill. */
  uses: number;
  /** Of those turns, the ones with a failed tool call after the skill was used. */
  failedTurns: number;
  /** (failed turns + 1) / (uses + 2), rounded to 2 decimals. 0 to 1; higher needs more care. */
  attention: number;
  lastUsedAt: number | null;
  mode: SkillMode;
  /** 5 uses, attention of 0.3, and a failed turn since the skill's last proposal or review. */
  suggested: boolean;
  /** True while at least one proposal of this skill is applied (an undone one does not count). */
  modified: boolean;
  /** `updated_at` of the newest applied proposal, or null when the skill is not modified. */
  lastAppliedAt: number | null;
}

/**
 * The applied proposals as one query: the newest apply time per path, and per
 * name for proposals with no path (the rule `skillHistory` uses).
 */
async function appliedTimes(db: SkillsDb) {
  const rows = await appliedProposalRows(db);
  const byPath = new Map<string, number>();
  const byName = new Map<string, number>();
  for (const row of rows) {
    const at = Number(row.at);
    if (row.skill_path != null) {
      const path = String(row.skill_path);
      byPath.set(path, Math.max(byPath.get(path) ?? 0, at));
    } else {
      const name = String(row.skill_name);
      byName.set(name, Math.max(byName.get(name) ?? 0, at));
    }
  }
  return (path: string | null, name: string) =>
    (path === null ? byName.get(name) : byPath.get(path)) ?? null;
}

function modeOf(value: unknown): SkillMode {
  return value === "automatic" ? "automatic" : "manual";
}

const modifiedFields = (at: number | null) => ({ modified: at !== null, lastAppliedAt: at });

/** (failed + 1) / (uses + 2): a skill with little evidence stays near the middle. */
export function attentionScore(failedTurns: number, uses: number): number {
  return Math.round(((failedTurns + 1) / (uses + 2)) * 100) / 100;
}

/**
 * Every watched skill and every recorded skill, with its 30-day counts.
 * Sorted by use count, highest first, then name; order `attention` sorts by
 * attention first, then uses, then name. Watched skills with no use are
 * listed with zero counts. Counting happens in SQL.
 */
export async function rankSkills(
  store: SkillStore,
  index: SkillIndex,
  now: number,
  order: SkillOrder = "uses"
): Promise<SkillRanking[]> {
  const db = await store.existingDb();
  const entries = index.entries.map((e) => ({ name: e.name, path: e.path }));
  const rankings: SkillRanking[] = [];
  const seen = new Set<string>();
  const appliedAt = db ? await appliedTimes(db) : () => null;
  if (db) {
    const rows = await rankingRows(db, JSON.stringify(entries), now - RANKING_WINDOW_MS);
    for (const row of rows) {
      const path = row.path == null ? null : String(row.path);
      const uses = Number(row.uses);
      const failedTurns = Number(row.failed_turns);
      const attention = attentionScore(failedTurns, uses);
      if (path) seen.add(path);
      rankings.push({
        name: String(row.name),
        path,
        notInWatchedFolder: path === null,
        uses,
        failedTurns,
        attention,
        lastUsedAt: row.last_used_at == null ? null : Number(row.last_used_at),
        mode: modeOf(row.mode),
        suggested:
          path !== null &&
          uses >= SUGGEST_MIN_USES &&
          attention >= SUGGEST_MIN_ATTENTION &&
          Number(row.failed_since_proposal) > 0,
        ...modifiedFields(appliedAt(path, String(row.name))),
      });
    }
  }
  const unused = index.entries.filter((e) => !seen.has(e.path));
  const modes = new Map<string, SkillMode>();
  if (db && unused.length > 0) {
    const rows = await skillModeRows(db, JSON.stringify(unused.map((e) => e.path)));
    for (const row of rows) modes.set(String(row.skill_path), modeOf(row.mode));
  }
  for (const entry of unused) {
    rankings.push({
      name: entry.name,
      path: entry.path,
      notInWatchedFolder: false,
      uses: 0,
      failedTurns: 0,
      attention: attentionScore(0, 0),
      lastUsedAt: null,
      mode: modes.get(entry.path) ?? "manual",
      suggested: false,
      ...modifiedFields(appliedAt(entry.path, entry.name)),
    });
  }
  const byUses = (a: SkillRanking, b: SkillRanking) =>
    b.uses - a.uses || a.name.localeCompare(b.name);
  return rankings.sort(
    order === "attention" ? (a, b) => b.attention - a.attention || byUses(a, b) : byUses
  );
}
