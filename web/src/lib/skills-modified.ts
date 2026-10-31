import type { SkillRow } from "./skills-api";

/**
 * Which ranked skills show: every one, the ones no applied proposal changed,
 * the ones one did, or the ones marked Suggested.
 */
export type ModifiedFilter = "all" | "not-modified" | "modified" | "suggested";
export const MODIFIED_FILTERS: readonly ModifiedFilter[] = [
  "all",
  "not-modified",
  "modified",
  "suggested",
];
export const MODIFIED_FILTER_KEY = "omms-skills-modified-filter";

export function modifiedCounts(
  skills: readonly Pick<SkillRow, "modified" | "suggested">[]
): Record<ModifiedFilter, number> {
  const modified = skills.filter((skill) => skill.modified).length;
  const suggested = skills.filter((skill) => skill.suggested).length;
  return { all: skills.length, "not-modified": skills.length - modified, modified, suggested };
}

export function applyModifiedFilter(skills: SkillRow[], filter: ModifiedFilter): SkillRow[] {
  if (filter === "all") return skills;
  if (filter === "suggested") return skills.filter((skill) => skill.suggested);
  return skills.filter((skill) => skill.modified === (filter === "modified"));
}

/** The saved choice. Blocked storage or an unknown value gives All. */
export function readModifiedFilter(): ModifiedFilter {
  try {
    const raw = localStorage.getItem(MODIFIED_FILTER_KEY);
    return MODIFIED_FILTERS.find((filter) => filter === raw) ?? "all";
  } catch {
    return "all";
  }
}

export function saveModifiedFilter(filter: ModifiedFilter): void {
  try {
    localStorage.setItem(MODIFIED_FILTER_KEY, filter);
  } catch {
    // Private mode or blocked site data; the choice lasts for this visit.
  }
}
