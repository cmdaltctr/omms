export interface KeywordCount {
  keyword: string;
  count: number;
}

/**
 * Counts labels across stored `tags` fields (comma-separated). Labels are matched
 * case-insensitively, the same rule the keyword filter uses, and each memory counts
 * a label once. Sorted by count, then name.
 */
export function countKeywords(tagFields: Array<string | null | undefined>): KeywordCount[] {
  const counts = new Map<string, number>();
  for (const field of tagFields) {
    if (!field) continue;
    const labels = new Set(
      field
        .split(",")
        .map((label) => label.trim().toLowerCase())
        .filter(Boolean)
    );
    for (const label of labels) counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts]
    .map(([keyword, count]) => ({ keyword, count }))
    .sort((a, b) => b.count - a.count || a.keyword.localeCompare(b.keyword));
}
