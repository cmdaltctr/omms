import { categoryKey } from "./profile-category.js";
import type { CleanupDiff } from "./ai-cleanup.js";
import type { UserProfileData } from "./types.js";

export type Section = "preferences" | "patterns" | "workflows";

const SECTION_BY_PREFIX: Record<string, Section> = {
  pref: "preferences",
  pat: "patterns",
  wf: "workflows",
};

/** What a finished cleanup job keeps for Apply. Ids are positions in `old`. */
export interface CleanupJobResult {
  old: UserProfileData;
  changes: CleanupDiff;
  mergedItems: Record<string, unknown>;
}

export interface AcceptedCleanup {
  merged?: string[][];
  removed?: string[];
}

/**
 * What one applied change replaced, as stored. Undo reverses it. A merge holds the original
 * items and the merged item that was written. A removal holds the original item.
 */
export type RestoreEntry =
  | { kind: "merge"; section: Section; originals: unknown[]; merged: unknown }
  | { kind: "remove"; section: Section; original: unknown };

export interface AppliedCleanup {
  profile: UserProfileData;
  applied: number;
  skipped: number;
  restore: RestoreEntry[];
}

/**
 * Puts the ticked changes of a job into `current`, which may be newer than the profile
 * the job read. Each item is found by section, category, description and steps, so
 * learning's counters do not break a match. A change is skipped when one of its items is
 * gone. Every other item stays exactly as stored. Ticked ids that are not changes of
 * the job are ignored.
 */
export function applyCleanupEdits(
  current: UserProfileData,
  job: CleanupJobResult,
  accepted: AcceptedCleanup
): AppliedCleanup {
  const profile: UserProfileData = {
    ...current,
    preferences: [...current.preferences],
    patterns: [...current.patterns],
    workflows: [...current.workflows],
  };
  const merges = new Map(job.changes.merged.map((m) => [m.ids.join(","), m.ids]));
  const removals = new Set(job.changes.removed.map((r) => r.id));
  const used = new Set<string>();
  const restore: RestoreEntry[] = [];
  let applied = 0;
  let skipped = 0;

  for (const ticked of accepted.merged ?? []) {
    const ids = Array.isArray(ticked) ? merges.get(ticked.join(",")) : undefined;
    if (!ids || ids.length < 2) continue;
    const mergedItem = job.mergedItems[ids[0]!];
    const found = mergedItem ? locate(profile, job.old, ids, used) : null;
    if (!found) {
      skipped++;
      continue;
    }
    const items = profile[found.section] as unknown[];
    const written = { ...(mergedItem as object) };
    restore.push({
      kind: "merge",
      section: found.section,
      originals: found.indices.map((index) => items[index]),
      merged: written,
    });
    items[found.indices[0]!] = written;
    for (const index of found.indices.slice(1).sort((a, b) => b - a)) items.splice(index, 1);
    for (const id of ids) used.add(id);
    applied++;
  }

  for (const id of accepted.removed ?? []) {
    if (typeof id !== "string" || !removals.has(id)) continue;
    const found = locate(profile, job.old, [id], used);
    if (!found) {
      skipped++;
      continue;
    }
    const [removed] = profile[found.section].splice(found.indices[0]!, 1);
    restore.push({ kind: "remove", section: found.section, original: removed });
    used.add(id);
    applied++;
  }

  return { profile, applied, skipped, restore };
}

/**
 * Finds each id's item from `old` in `profile`, at a distinct position, all in one
 * section. Returns null when an item is gone or an earlier change already used it.
 */
function locate(
  profile: UserProfileData,
  old: UserProfileData,
  ids: string[],
  used: Set<string>
): { section: Section; indices: number[] } | null {
  const section = sectionOf(ids[0]!);
  if (!section) return null;
  const items = profile[section] as unknown[];
  const indices: number[] = [];
  for (const id of ids) {
    if (used.has(id) || sectionOf(id) !== section) return null;
    const source = old[section][positionOf(id)];
    if (!source) return null;
    const key = profileItemIdentityKey(source);
    const index = items.findIndex(
      (item, i) => !indices.includes(i) && profileItemIdentityKey(item) === key
    );
    if (index < 0) return null;
    indices.push(index);
  }
  return { section, indices };
}

function sectionOf(id: string): Section | undefined {
  return SECTION_BY_PREFIX[id.split("_")[0] ?? ""];
}

function positionOf(id: string): number {
  return Number.parseInt(id.split("_")[1] ?? "", 10);
}

/**
 * The fields that identify a profile item. Counters and vectors are left out. The category
 * counts by its key, because every save keeps one visible spelling per category and may
 * rewrite the spelling of a stored item.
 */
export function profileItemIdentityKey(item: any): string {
  return JSON.stringify({
    category: item.category == null ? null : categoryKey(String(item.category)),
    description: item.description ?? null,
    steps: Array.isArray(item.steps) ? item.steps : null,
  });
}
