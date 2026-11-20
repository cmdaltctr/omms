type Selectable = { _id: string; category?: string; frequency?: number };

/**
 * What a shortcut picks: the ids to tick, and how many memories its rule matched but
 * left out because AI Cleanup already checked them.
 */
export type Pick = { ids: Set<string>; skipped: number };

const NONE = new Set<string>();

/** Leaves the checked ids out of `matched` and counts them. */
function unchecked(matched: Iterable<string>, checked: Set<string>): Pick {
  const ids = new Set<string>();
  let skipped = 0;
  for (const id of matched) {
    if (checked.has(id)) skipped++;
    else ids.add(id);
  }
  return { ids, skipped };
}

function lowFrequencyMatches(items: Selectable[], limit: number): string[] {
  return items.filter((it) => (it.frequency || 0) <= limit).map((it) => it._id);
}

/**
 * Ids of the items in every category that holds `minimum` items or more. Names match exactly.
 * Items with no category are skipped: they share no category, so they are not a group.
 * Checked items count toward the size of a category.
 */
function sameCategoryMatches(items: Selectable[], minimum: number): string[] {
  const groups = new Map<string, string[]>();
  for (const it of items) {
    if (!it.category?.trim()) continue;
    groups.set(it.category, [...(groups.get(it.category) ?? []), it._id]);
  }
  return [...groups.values()].filter((group) => group.length >= minimum).flat();
}

/** Low Freq: unchecked items seen `limit` times or fewer. */
export function lowFrequencyIds(items: Selectable[], checked = NONE, limit = 3): Pick {
  return unchecked(lowFrequencyMatches(items, limit), checked);
}

/** Same Category: unchecked items of every category that holds `minimum` items or more. */
export function sameCategoryIds(items: Selectable[], checked = NONE, minimum = 3): Pick {
  return unchecked(sameCategoryMatches(items, minimum), checked);
}

/** Clean All: Low Freq and Same Category together, unchecked items only. */
export function cleanAllIds(items: Selectable[], checked = NONE): Pick {
  const matched = new Set([...lowFrequencyMatches(items, 3), ...sameCategoryMatches(items, 3)]);
  return unchecked(matched, checked);
}

/** Select All: every item, checked or not, for a full recheck. */
export function allIds(items: Selectable[]): Pick {
  return { ids: new Set(items.map((it) => it._id)), skipped: 0 };
}

/** A copy of `set` with `value` added when `checked`, or removed when not. */
export function withToggled<T>(set: Set<T>, value: T, checked: boolean): Set<T> {
  const next = new Set(set);
  if (checked) next.add(value);
  else next.delete(value);
  return next;
}

/**
 * Groups and their items with the selected ones first, so a shortcut's picks are
 * on screen without scrolling. Both sorts are stable, so the rest keeps its order.
 */
export function selectedFirst<T extends { _id: string }, G extends { items: T[] }>(
  groups: G[],
  selected: Set<string>
): G[] {
  const picked = (it: T) => (selected.has(it._id) ? 0 : 1);
  return groups
    .map((g) => ({ ...g, items: [...g.items].sort((a, b) => picked(a) - picked(b)) }))
    .sort((a, b) => Math.min(1, ...a.items.map(picked)) - Math.min(1, ...b.items.map(picked)));
}
