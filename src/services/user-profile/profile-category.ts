const RESERVED_EXPLICIT = "explicit";

/** Hidden identity for category spellings; never used as a visible label. */
export function categoryKey(label: string): string {
  return label.replace(/[_-]/g, " ").replace(/\s+/g, " ").trim().toLowerCase() || "general";
}

/** Tidy spacing without losing capitals in acronyms or proper names. */
export function tidyCategory(label: string): string {
  const tidy = label.replace(/_/g, " ").replace(/\s+/g, " ").trim();
  if (!tidy) return "General";
  if (tidy === "explicit" || /\p{Lu}/u.test(tidy)) return tidy;
  return tidy.charAt(0).toUpperCase() + tidy.slice(1);
}

/** Choose one label per key across preferences and patterns, keeping all other data. */
export function canonicaliseCategories<
  T extends { preferences: { category: string }[]; patterns: { category: string }[] },
>(profile: T): T {
  const spellings = new Map<string, Map<string, number>>();
  for (const item of [...profile.preferences, ...profile.patterns]) {
    const key = categoryKey(item.category);
    const counts = spellings.get(key) ?? new Map<string, number>();
    counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
    spellings.set(key, counts);
  }

  const labels = new Map<string, string>();
  for (const [key, counts] of spellings) {
    // "explicit" is a reserved discriminator in mergeItems; no spelling may displace it.
    if (key === RESERVED_EXPLICIT) {
      labels.set(key, RESERVED_EXPLICIT);
      continue;
    }
    // Stable sorting keeps the first seen spelling when all tie-breaks are equal.
    const ranked = [...counts].sort(
      ([a, aCount], [b, bCount]) =>
        Number(/[_-]/.test(a)) - Number(/[_-]/.test(b)) ||
        bCount - aCount ||
        Number(/^\p{Lu}/u.test(b)) - Number(/^\p{Lu}/u.test(a))
    );
    labels.set(key, tidyCategory(ranked[0]![0]));
  }

  const rewrite = <I extends { category: string }>(items: I[]): I[] =>
    items.map((item) => ({ ...item, category: labels.get(categoryKey(item.category))! }));
  return {
    ...profile,
    preferences: rewrite(profile.preferences),
    patterns: rewrite(profile.patterns),
  };
}
