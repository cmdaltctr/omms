/**
 * Ids of the items in every category that holds `minimum` items or more. Names match exactly.
 * Items with no category are skipped: they share no category, so they are not a group.
 */
export function sameCategoryIds(items: Array<{ _id: string; category?: string }>, minimum = 3) {
  const groups = new Map<string, string[]>();
  for (const it of items) {
    if (!it.category?.trim()) continue;
    groups.set(it.category, [...(groups.get(it.category) ?? []), it._id]);
  }
  const ids = new Set<string>();
  for (const group of groups.values()) {
    if (group.length >= minimum) for (const id of group) ids.add(id);
  }
  return ids;
}
