import type { TranslateFn } from "./i18n";
import type { ChatPlan, ChatSource } from "./chat-api";

export type CitationLetter = "S" | "P" | "K";

/** The legend shows K when skill facts are on or the open chat holds a K source. */
export function legendLetters(skillFacts: boolean, hasSkillSource: boolean): CitationLetter[] {
  return skillFacts || hasSkillSource ? ["S", "P", "K"] : ["S", "P"];
}

/** A memory that was deleted, or a skill that the ranking no longer lists. */
export function isSourceDeleted(
  source: Pick<ChatSource, "kind" | "id"> | undefined,
  missingMemoryIds: ReadonlySet<string>,
  missingSkillNames: ReadonlySet<string>
): boolean {
  if (!source) return false;
  if (source.kind === "memory") return missingMemoryIds.has(source.id);
  if (source.kind === "skill") return missingSkillNames.has(source.id);
  return false;
}

/** "Yes, last applied <date>" or "No". */
export function modifiedText(
  skill: { modified: boolean; lastAppliedAt: number | null },
  t: TranslateFn,
  formatDate: (at: number) => string
): string {
  return skill.modified && skill.lastAppliedAt !== null
    ? t("chat-skill-modified-yes", { date: formatDate(skill.lastAppliedAt) })
    : t("chat-skill-modified-no");
}

export const historyKindKey = (kind: string) => `chat-skill-kind-${kind}`;

/** The rows of "How I searched". Skill rows appear only when the saved plan holds skill fields. */
export function searchRows(plan: ChatPlan, t: TranslateFn): Array<[string, string[]]> {
  const rows: Array<[string, string[]]> = [
    [t("chat-search-phrases"), plan.queries],
    [t("chat-search-tags"), plan.tags],
    [t("chat-search-categories"), plan.profileCategories],
  ];
  if (plan.skills) rows.push([t("chat-search-skills"), plan.skills]);
  if (plan.skillIntent) {
    rows.push([t("chat-search-skill-intent"), [t(`chat-intent-${plan.skillIntent}`)]]);
  }
  return rows;
}
