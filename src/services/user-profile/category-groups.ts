import { createHash } from "node:crypto";
import { canonicaliseCategories, categoryKey } from "./profile-category.js";

/** Average cosine similarity at which two groups of category names count as one meaning. */
export const CATEGORY_GROUP_THRESHOLD = 0.8;

const RESERVED_EXPLICIT = "explicit";

export interface CategoryLabelCount {
  label: string;
  count: number;
}

export interface CategoryLabelVector extends CategoryLabelCount {
  vector: number[];
}

export interface CategoryGroup {
  /** Stable for the same set of labels, so a preview and its apply agree. */
  id: string;
  labels: CategoryLabelCount[];
}

type CategoryProfile = {
  preferences: { category: string }[];
  patterns: { category: string }[];
};

/** Distinct labels across preferences and patterns after the spelling rules, most used first. */
export function collectCategoryLabels(profile: CategoryProfile): CategoryLabelCount[] {
  const canonical = canonicaliseCategories(profile);
  const counts = new Map<string, number>();
  for (const item of [...canonical.preferences, ...canonical.patterns]) {
    counts.set(item.category, (counts.get(item.category) ?? 0) + 1);
  }
  return [...counts]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  return normA && normB ? dot / Math.sqrt(normA * normB) : 0;
}

export function groupId(labels: CategoryLabelCount[]): string {
  const keys = labels.map((entry) => categoryKey(entry.label)).sort();
  return createHash("sha256").update(JSON.stringify(keys)).digest("hex").slice(0, 12);
}

/**
 * Average-linkage clustering of one connected component. Two clusters merge while
 * the mean similarity over all their member pairs reaches the threshold, so a
 * chain A-B-C does not pull A and C together through B.
 */
function clusterComponent(
  members: number[],
  sim: (i: number, j: number) => number,
  threshold: number
): number[][] {
  let clusters = members.map((member) => [member]);
  const pairSim = new Map<string, number>();
  const key = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
  for (let a = 0; a < clusters.length; a++) {
    for (let b = a + 1; b < clusters.length; b++) {
      pairSim.set(key(a, b), sim(members[a]!, members[b]!));
    }
  }
  const ids = clusters.map((_, index) => index);
  const byId = new Map(ids.map((id, index) => [id, clusters[index]!]));
  let nextId = ids.length;
  for (;;) {
    let best = -Infinity;
    let pair: [number, number] | null = null;
    const live = [...byId.keys()];
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const value = pairSim.get(key(live[i]!, live[j]!))!;
        if (value > best) {
          best = value;
          pair = [live[i]!, live[j]!];
        }
      }
    }
    if (!pair || best < threshold) break;
    const [a, b] = pair;
    const sizeA = byId.get(a)!.length;
    const sizeB = byId.get(b)!.length;
    const merged = nextId++;
    for (const other of live) {
      if (other === a || other === b) continue;
      const value =
        (sizeA * pairSim.get(key(a, other))! + sizeB * pairSim.get(key(b, other))!) /
        (sizeA + sizeB);
      pairSim.set(key(merged, other), value);
    }
    byId.set(merged, [...byId.get(a)!, ...byId.get(b)!]);
    byId.delete(a);
    byId.delete(b);
  }
  clusters = [...byId.values()];
  return clusters.filter((cluster) => cluster.length >= 2);
}

/**
 * Groups category names that mean the same thing. Only labels joined by at least one
 * pair at or above the threshold can share a group, so clustering runs per connected
 * component of that graph. A group needs two labels; `explicit` never joins one.
 */
export function groupCategoryLabels(
  labels: CategoryLabelVector[],
  threshold: number = CATEGORY_GROUP_THRESHOLD
): CategoryGroup[] {
  const usable = labels.filter((entry) => categoryKey(entry.label) !== RESERVED_EXPLICIT);
  const cache = new Map<string, number>();
  const sim = (i: number, j: number) => {
    const cacheKey = i < j ? `${i}:${j}` : `${j}:${i}`;
    let value = cache.get(cacheKey);
    if (value === undefined) {
      value = cosine(usable[i]!.vector, usable[j]!.vector);
      cache.set(cacheKey, value);
    }
    return value;
  };

  const parent = usable.map((_, index) => index);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i]!)));
  for (let i = 0; i < usable.length; i++) {
    for (let j = i + 1; j < usable.length; j++) {
      if (sim(i, j) >= threshold) parent[find(i)] = find(j);
    }
  }
  const components = new Map<number, number[]>();
  usable.forEach((_, index) => {
    const root = find(index);
    components.set(root, [...(components.get(root) ?? []), index]);
  });

  const groups: CategoryGroup[] = [];
  for (const members of components.values()) {
    if (members.length < 2) continue;
    for (const cluster of clusterComponent(members, sim, threshold)) {
      const entries = cluster
        .map((index) => ({ label: usable[index]!.label, count: usable[index]!.count }))
        .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
      groups.push({ id: groupId(entries), labels: entries });
    }
  }
  const total = (group: CategoryGroup) => group.labels.reduce((sum, entry) => sum + entry.count, 0);
  return groups.sort(
    (a, b) => total(b) - total(a) || a.labels[0]!.label.localeCompare(b.labels[0]!.label)
  );
}

export type CategorySection = "preferences" | "patterns";

/** One item renamed by a cleanup. The description is stored as a hash, never as text. */
export interface CategoryRename {
  section: CategorySection;
  descriptionSha256: string;
  from: string;
  to: string;
}

type DescribedItem = { category: string; description: string };
type DescribedProfile = { preferences: DescribedItem[]; patterns: DescribedItem[] };

const SECTIONS: CategorySection[] = ["preferences", "patterns"];

export function descriptionHash(description: string): string {
  return createHash("sha256").update(description).digest("hex");
}

/** Renames between two versions of one profile whose items are in the same order. */
export function recordRenames(before: DescribedProfile, after: DescribedProfile): CategoryRename[] {
  const renames: CategoryRename[] = [];
  for (const section of SECTIONS) {
    before[section].forEach((item, index) => {
      const next = after[section][index];
      if (next && next.category !== item.category) {
        renames.push({
          section,
          descriptionSha256: descriptionHash(item.description),
          from: item.category,
          to: next.category,
        });
      }
    });
  }
  return renames;
}

/**
 * Puts the old category back on each renamed item that still exists with the
 * category the cleanup gave it. Items added or merged later are left alone.
 */
export function restoreRenames<T extends DescribedProfile>(
  current: T,
  renames: CategoryRename[]
): { profile: T; restored: number; notFound: number } {
  const profile = {
    ...current,
    preferences: current.preferences.map((item) => ({ ...item })),
    patterns: current.patterns.map((item) => ({ ...item })),
  };
  const used = new Set<string>();
  let restored = 0;
  for (const rename of renames) {
    const index = profile[rename.section].findIndex(
      (item, position) =>
        !used.has(`${rename.section}:${position}`) &&
        item.category === rename.to &&
        descriptionHash(item.description) === rename.descriptionSha256
    );
    if (index < 0) continue;
    used.add(`${rename.section}:${index}`);
    profile[rename.section][index]!.category = rename.from;
    restored++;
  }
  return { profile, restored, notFound: renames.length - restored };
}
