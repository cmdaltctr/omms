/** A group in the category cleanup preview. */
export interface CleanupGroupView {
  /** False when the model did not check the group. */
  checked: boolean;
  name: string;
  labels: Array<{ label: string; count: number }>;
}

/** The groups that start accepted: the ones the model checked. The user can accept the rest. */
export function initiallyAccepted(groups: Array<{ checked: boolean }>): Set<number> {
  const accepted = new Set<number>();
  groups.forEach((group, index) => {
    if (group.checked) accepted.add(index);
  });
  return accepted;
}

/** A copy of `accepted` with `index` added, or removed when it is in the set. */
export function toggled(accepted: Set<number>, index: number): Set<number> {
  const next = new Set(accepted);
  if (next.has(index)) next.delete(index);
  else next.add(index);
  return next;
}

/** The category count after applying the accepted groups. */
export function categoriesAfter(
  before: number,
  groups: Array<{ labels: unknown[] }>,
  accepted: Set<number>
): number {
  return groups.reduce(
    (count, group, index) => count - (accepted.has(index) ? group.labels.length - 1 : 0),
    before
  );
}

/** The apply request body for the accepted groups, with the names the user left in the inputs. */
export function groupsToApply(
  groups: CleanupGroupView[],
  accepted: Set<number>,
  names: string[]
): Array<{ labels: string[]; name: string }> {
  return [...accepted].map((index) => ({
    labels: groups[index]!.labels.map((entry) => entry.label),
    name: names[index]!.trim(),
  }));
}
