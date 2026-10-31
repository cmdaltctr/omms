import { PagedList, usePagedList } from "$lib/components/paged-list";
import { useSettingsText } from "$lib/i18n/settings";
import { formatDate } from "$lib/format";
import type { FolderRow, SkillRow } from "$lib/skills-api";
import { countText, fill } from "$lib/skills-model";
import { SKILL_SORTS } from "$lib/skills-sorts";
import { HuePill } from "./HuePill";

/** The folder that holds a skill: the watched folder whose path starts its path. */
export function folderOf(skill: SkillRow, folders: FolderRow[]): string | null {
  if (!skill.path) return null;
  const home = folders
    .filter((folder) => skill.path!.startsWith(folder.path))
    .sort((a, b) => b.path.length - a.path.length)[0];
  return home?.path ?? null;
}

/** Skill rows. Each row opens one skill. */
export function SkillList({
  skills,
  folders,
  onOpen,
}: {
  skills: SkillRow[];
  folders: FolderRow[];
  onOpen: (skill: SkillRow) => void;
}) {
  const s = useSettingsText();
  return (
    <ul className="space-y-3">
      {skills.map((skill) => {
        const folder = folderOf(skill, folders);
        return (
          <li key={skill.path ?? `name:${skill.name}`}>
            <button
              type="button"
              onClick={() => onOpen(skill)}
              className="w-full min-w-0 space-y-1.5 rounded-xl border border-border bg-card px-3 py-2.5 text-start transition-colors duration-150 hover:bg-interactive-hover focus-visible:outline-2 focus-visible:outline-ring"
            >
              <span className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 break-words text-sm font-semibold">{skill.name}</span>
                {skill.suggested ? <HuePill label={s("Suggested")} colourKey="Suggested" /> : null}
                <HuePill
                  label={s(skill.mode === "manual" ? "Manual" : "Automatic")}
                  colourKey={skill.mode}
                />
                {skill.notInWatchedFolder ? (
                  <HuePill label={s("Not in a watched folder")} colourKey="not-watched" />
                ) : null}
              </span>
              <span className="block text-xs text-muted-foreground">
                {folder ? (
                  <>
                    <bdi dir="ltr" className="break-all">
                      {folder}
                    </bdi>
                    {" · "}
                  </>
                ) : null}
                {s("Uses")} {countText(skill.uses)} · {s("Failed turns")}{" "}
                {countText(skill.failedTurns)} · {s("Attention")} {skill.attention.toFixed(2)} ·{" "}
                {s("Last use")} {skill.lastUsedAt ? formatDate(skill.lastUsedAt) : s("Never")}
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * The ranked skills, sorted in the browser and paged five to a page. A new
 * filter returns the list to page 1.
 */
export function RankedSkills({
  skills,
  folders,
  query,
  onOpen,
}: {
  skills: SkillRow[];
  folders: FolderRow[];
  query: string;
  onOpen: (skill: SkillRow) => void;
}) {
  const s = useSettingsText();
  const { view, pageItems } = usePagedList({
    storageKey: "omms-list-skills",
    items: skills,
    sorts: SKILL_SORTS,
    resetKey: query.trim().toLowerCase(),
  });
  return (
    <PagedList
      view={view}
      totalLabel={fill(s(view.total === 1 ? "{count} skill" : "{count} skills"), {
        count: view.total,
      })}
    >
      <SkillList skills={pageItems} folders={folders} onOpen={onOpen} />
    </PagedList>
  );
}
