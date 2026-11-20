import { createHash } from "node:crypto";
import { profileItemIdentityKey, type Section } from "./ai-cleanup-apply.js";
import type { AIMapping, CleanupDiff, IndexedProfile } from "./ai-cleanup.js";
import type { UserProfileData } from "./types.js";

/**
 * A memory that AI Cleanup looked at and kept is "checked". The mark is a hash of what
 * identifies the memory: its section, category key, description and steps. An edit of the
 * text or the category gives a new hash, so the mark ends with no extra code. Frequency is
 * left out, so a new observation keeps the mark. The hash holds no memory text.
 */
export function aiCheckedKey(section: Section, item: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify({ section, identity: profileItemIdentityKey(item) }))
    .digest("hex");
}

/**
 * The ids of one batch that the model neither merged nor removed. An id the mapping does
 * not name counts as kept. A reply with no valid mapping keeps nothing, because an empty
 * mapping cannot be told from a real "keep everything" answer.
 */
export function keptIdsOfBatch(
  batch: IndexedProfile,
  mapping: AIMapping,
  mappingValid: boolean
): string[] {
  if (!mappingValid) return [];
  const changed = new Set<string>([...mapping.merged.flat(), ...mapping.removed]);
  return [...batch.preferences, ...batch.patterns, ...batch.workflows]
    .map((item) => item.id)
    .filter((id) => !changed.has(id));
}

const SECTION_BY_PREFIX: Record<string, Section> = {
  pref: "preferences",
  pat: "patterns",
  wf: "workflows",
};

/** The keys of position ids (`pref_3`) in `profile`. Unknown ids are left out. */
export function aiCheckedKeysForIds(profile: UserProfileData, ids: Iterable<string>): string[] {
  const keys: string[] = [];
  for (const id of ids) {
    const [prefix, position] = id.split("_");
    const section = SECTION_BY_PREFIX[prefix ?? ""];
    const item = section ? profile[section][Number.parseInt(position ?? "", 10)] : undefined;
    if (section && item) keys.push(aiCheckedKey(section, item));
  }
  return keys;
}

/**
 * What Apply changes in the marks. The items of every proposed change that the user did not
 * tick are marked: the model looked at them and the user kept them. Ticked changes mark
 * nothing, also when Apply skips them. A ticked merge can write back the text of the keeper
 * or of another member, so the marks of the keeper and of the saved item are deleted.
 */
export function marksAfterApply(
  job: { old: UserProfileData; changes: CleanupDiff; mergedItems?: Record<string, unknown> },
  accepted: { merged?: unknown[]; removed?: unknown[] }
): { mark: string[]; unmark: string[] } {
  const tickedMerges = new Set(
    (accepted.merged ?? []).filter(Array.isArray).map((ids) => ids.join(","))
  );
  const tickedRemovals = new Set(accepted.removed ?? []);
  const unticked: string[] = [];
  const keepers: string[] = [];
  const saved: string[] = [];
  for (const merge of job.changes.merged) {
    const keeper = merge.ids[0] ?? "";
    if (!tickedMerges.has(merge.ids.join(","))) {
      unticked.push(...merge.ids);
      continue;
    }
    keepers.push(keeper);
    const section = SECTION_BY_PREFIX[keeper.split("_")[0] ?? ""];
    const item = job.mergedItems?.[keeper];
    if (section && item) saved.push(aiCheckedKey(section, item));
  }
  for (const removal of job.changes.removed) {
    if (!tickedRemovals.has(removal.id)) unticked.push(removal.id);
  }
  return {
    mark: aiCheckedKeysForIds(job.old, unticked),
    unmark: [...aiCheckedKeysForIds(job.old, keepers), ...saved],
  };
}

/** The key of every item of `profile`. */
export function aiCheckedKeysOf(profile: UserProfileData): string[] {
  return Object.values(SECTION_BY_PREFIX).flatMap((section) =>
    profile[section].map((item) => aiCheckedKey(section, item))
  );
}

/** The position ids of the items in `profile` whose key is in `keys`. */
export function aiCheckedIdsOf(profile: UserProfileData, keys: Set<string>): string[] {
  const ids: string[] = [];
  for (const [prefix, section] of Object.entries(SECTION_BY_PREFIX)) {
    profile[section].forEach((item, index) => {
      if (keys.has(aiCheckedKey(section, item))) ids.push(`${prefix}_${index}`);
    });
  }
  return ids;
}
