import { profileItemIdentityKey } from "./ai-cleanup-apply.js";
import type { RestoreEntry, Section } from "./ai-cleanup-apply.js";
import type { UserProfileData } from "./types.js";

export interface UndoResult {
  profile: UserProfileData;
  restored: number;
  notFound: number;
}

const SECTIONS: Section[] = ["preferences", "patterns", "workflows"];

function keyOf(section: Section, item: unknown): string {
  return `${section}|${profileItemIdentityKey(item)}`;
}

/**
 * Reverses the changes of one automatic cleanup in `current`, which may be newer than the
 * profile the run saved. A merge is undone by taking out the merged item and putting its
 * originals back. A removal is undone by putting the original back. A change counts as
 * not found, and is left alone, when the merged item is gone or was reworded, or when an
 * original is already in the profile. Every other item stays as stored.
 */
export function undoCleanupEdits(current: UserProfileData, entries: RestoreEntry[]): UndoResult {
  const profile: UserProfileData = {
    ...current,
    preferences: [...current.preferences],
    patterns: [...current.patterns],
    workflows: [...current.workflows],
  };
  // How many items of each identity the profile holds now. A restored item is not added,
  // so two identical originals of the record both come back.
  const present = new Map<string, number>();
  for (const section of SECTIONS) {
    for (const item of profile[section]) {
      const key = keyOf(section, item);
      present.set(key, (present.get(key) ?? 0) + 1);
    }
  }
  const claimed = new Set<unknown>();
  let restored = 0;
  let notFound = 0;

  for (const entry of entries) {
    const items = profile[entry.section] as unknown[];
    if (entry.kind === "remove") {
      if ((present.get(keyOf(entry.section, entry.original)) ?? 0) > 0) {
        notFound++;
        continue;
      }
      const back = { ...(entry.original as object) };
      items.push(back);
      claimed.add(back);
      restored++;
      continue;
    }

    const mergedKey = keyOf(entry.section, entry.merged);
    const index = items.findIndex(
      (item) => !claimed.has(item) && keyOf(entry.section, item) === mergedKey
    );
    const blocked = entry.originals.some((original) => {
      const key = keyOf(entry.section, original);
      return (present.get(key) ?? 0) - (key === mergedKey ? 1 : 0) > 0;
    });
    if (index < 0 || blocked) {
      notFound++;
      continue;
    }
    const back = entry.originals.map((original) => ({ ...(original as object) }));
    items.splice(index, 1, ...back);
    for (const item of back) claimed.add(item);
    present.set(mergedKey, (present.get(mergedKey) ?? 1) - 1);
    restored++;
  }

  return { profile, restored, notFound };
}
