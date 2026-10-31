import { useCallback, useEffect, useState } from "react";
import { Input } from "$lib/components/ui/input";
import { useSettingsText } from "$lib/i18n/settings";
import { navigate, ROUTES, usePath } from "$lib/router";
import {
  skillsApi,
  type Proposal,
  type SkillRow,
  type SkillsOverview,
  type TopSkill,
} from "$lib/skills-api";
import { filterSkills, recentProposals } from "$lib/skills-model";
import {
  applyModifiedFilter,
  modifiedCounts,
  readModifiedFilter,
  saveModifiedFilter,
  type ModifiedFilter,
} from "$lib/skills-modified";
import { Callout } from "./Callout";
import { SkillActivitySection } from "./charts/SkillActivity";
import { ModifiedFilterControl } from "./ModifiedFilterControl";
import { PENDING_LIST_KEY, ProposalList, RECENT_LIST_KEY } from "./ProposalList";
import { RecordPast } from "./RecordPast";
import { SkillDetail } from "./SkillDetail";
import { SkillFolders } from "./SkillFolders";
import { SkillIdeas } from "./SkillIdeas";
import { RankedSkills } from "./SkillList";

const SETTINGS_CARD = `${ROUTES.settings}#settings-section-skill-learning`;

type PageProps = {
  overview: SkillsOverview | null;
  turns: number | null;
  pending: Proposal[];
  /** Every proposal that is no longer pending, newest first, so a rejected or undone new skill still shows. */
  recent: Proposal[];
  error: string;
  query: string;
  /** Which ranked skills show by modification. Defaults to All. */
  modifiedFilter?: ModifiedFilter;
  /** Bumped after each reload, so the Activity charts load again. */
  reloadKey?: number;
  onQuery: (query: string) => void;
  onModifiedFilter?: (filter: ModifiedFilter) => void;
  onOpen: (skill: SkillRow) => void;
  onPendingChange: (next: Proposal) => void;
  onRecentChange: (next: Proposal) => void;
  onReload: () => void;
};

/**
 * Why the ranked list is empty. A name filter wins: `nameMatches` counts the
 * skills the name matches before the tab hides any. Then the tab the reader chose.
 */
function emptyMessage(
  query: string,
  nameMatches: number,
  loaded: number,
  filter: ModifiedFilter
): string {
  if (query.trim()) {
    return nameMatches === 0
      ? "No skill matches this name."
      : "No skill matches this name in this tab.";
  }
  if (loaded > 0 && filter === "modified") return "No skill has been modified yet.";
  if (loaded > 0 && filter === "not-modified") return "Every skill has been modified.";
  if (loaded > 0 && filter === "suggested") return "No skill is suggested for a change yet.";
  return "No skills found in the watched folders.";
}

/** The Skills page as markup: ranked skills, pending proposals, ideas and the watched folders. */
export function SkillsPage({
  overview,
  turns,
  pending,
  recent,
  error,
  query,
  modifiedFilter = "all",
  reloadKey = 0,
  onQuery,
  onModifiedFilter = () => {},
  onOpen,
  onPendingChange,
  onRecentChange,
  onReload,
}: PageProps) {
  const s = useSettingsText();
  const loaded = overview?.skills ?? [];
  const nameMatches = filterSkills(loaded, query);
  const skills = applyModifiedFilter(nameMatches, modifiedFilter);
  const folders = overview?.folders ?? [];
  const openTop = (top: TopSkill) => {
    const row = (overview?.skills ?? []).find((skill) =>
      top.path ? skill.path === top.path : skill.name === top.name
    );
    if (row) onOpen(row);
  };
  return (
    <div className="space-y-8">
      <div className="max-w-3xl space-y-2 text-sm text-muted-foreground">
        <p>
          {s(
            "Skill learning watches how your agents use your skills on Pi, OpenCode and Claude Code. It ranks each skill by use and failed tool calls, and drafts better versions from real turns."
          )}
        </p>
        <p>
          {s(
            "Every draft is a proposal with a diff. Nothing changes a SKILL.md file until you apply it, unless you set that skill to Automatic. Undo restores the previous version."
          )}
        </p>
      </div>
      {overview && !overview.recording ? (
        <Callout tone="info">
          <p>{s("Nothing is recorded yet. Agent turns are recorded only after you turn it on.")}</p>
          <a
            className="underline"
            href={SETTINGS_CARD}
            onClick={(event) => {
              event.preventDefault();
              navigate(SETTINGS_CARD);
            }}
          >
            {s("Open the Skill learning card")}
          </a>
        </Callout>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive-label">
          {error}
        </p>
      ) : null}

      <SkillActivitySection
        proposals={[...pending, ...recent]}
        onOpen={openTop}
        reloadKey={reloadKey}
      />

      <section
        id="skills-section-ranked"
        className="scroll-mt-4 space-y-3"
        aria-label={s("Skills")}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-section-title font-semibold">{s("Ranked skills")}</h2>
          <div className="flex flex-wrap items-center gap-3">
            {loaded.length > 0 ? (
              <ModifiedFilterControl
                value={modifiedFilter}
                counts={modifiedCounts(loaded)}
                onChange={onModifiedFilter}
              />
            ) : null}
            <Input
              type="search"
              className="w-72 max-w-full"
              value={query}
              aria-label={s("Filter skills by name")}
              placeholder={s("Filter skills by name")}
              onChange={(event) => onQuery(event.target.value)}
            />
          </div>
        </div>
        {overview && overview.recording && turns === 0 ? (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">{s("No turns are recorded yet.")}</p>
            <RecordPast onEnd={onReload} />
          </div>
        ) : null}
        {overview && skills.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {s(emptyMessage(query, nameMatches.length, loaded.length, modifiedFilter))}
          </p>
        ) : null}
        {skills.length > 0 ? (
          <RankedSkills
            skills={skills}
            folders={folders}
            query={query}
            modifiedFilter={modifiedFilter}
            onOpen={onOpen}
          />
        ) : null}
      </section>

      <section
        id="skills-section-pending"
        className="scroll-mt-4 space-y-3"
        aria-label={s("Pending proposals")}
      >
        <h2 className="text-section-title font-semibold">{s("Pending proposals")}</h2>
        {pending.length > 0 ? (
          <ProposalList
            storageKey={PENDING_LIST_KEY}
            proposals={pending}
            onChange={onPendingChange}
          />
        ) : (
          <p className="text-sm text-muted-foreground">{s("No proposals are waiting.")}</p>
        )}
      </section>

      <section
        id="skills-section-recent"
        className="scroll-mt-4 space-y-3"
        aria-label={s("Recent proposals")}
      >
        <h2 className="text-section-title font-semibold">{s("Recent proposals")}</h2>
        {recent.length > 0 ? (
          <>
            <p className="text-sm text-muted-foreground">
              {s(
                "Each card shows when the proposal was created and when it was last applied, rejected or undone."
              )}
            </p>
            <ProposalList
              storageKey={RECENT_LIST_KEY}
              proposals={recent}
              onChange={onRecentChange}
            />
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            {s("No proposals have been decided yet.")}
          </p>
        )}
      </section>

      {overview?.recording ? <SkillIdeas folders={folders} onDrafted={onReload} /> : null}

      <SkillFolders folders={folders} onChanged={onReload} />
    </div>
  );
}

/** Loads the page data. One skill opens as its own view, with a way back. */
export function SkillsView() {
  const [overview, setOverview] = useState<SkillsOverview | null>(null);
  const [turns, setTurns] = useState<number | null>(null);
  const [pending, setPending] = useState<Proposal[]>([]);
  const [recent, setRecent] = useState<Proposal[]>([]);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [modifiedFilter, setModifiedFilter] = useState<ModifiedFilter>(readModifiedFilter);
  const [open, setOpen] = useState<SkillRow | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const load = useCallback(async () => {
    const [list, stats, proposals] = await Promise.all([
      skillsApi.overview(),
      skillsApi.stats(),
      skillsApi.proposals(),
    ]);
    if (list.ok) {
      setOverview(list.data);
      setError("");
    } else setError(list.error);
    if (stats.ok) setTurns(stats.data.turns);
    if (proposals.ok) {
      const all = proposals.data.proposals;
      setPending(all.filter((p) => p.state === "pending"));
      setRecent(recentProposals(all));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  // A reload after a change also refreshes the Activity charts.
  const reload = () => {
    setReloadKey((key) => key + 1);
    void load();
  };

  // A sidebar link to a section leaves the open skill and shows the page.
  const path = usePath();
  useEffect(() => {
    if (path.includes("#skills-section-")) setOpen(null);
  }, [path]);

  if (open) {
    return (
      <SkillDetail
        skill={open}
        onBack={() => {
          setOpen(null);
          reload();
        }}
        onChanged={() => void load()}
      />
    );
  }
  return (
    <SkillsPage
      {...{ overview, turns, pending, recent, error, query, modifiedFilter, reloadKey }}
      onQuery={setQuery}
      onModifiedFilter={(next) => {
        setModifiedFilter(next);
        saveModifiedFilter(next);
      }}
      onOpen={setOpen}
      onPendingChange={(next) =>
        setPending((list) => list.map((item) => (item.id === next.id ? next : item)))
      }
      onRecentChange={(next) =>
        setRecent((list) => list.map((item) => (item.id === next.id ? next : item)))
      }
      onReload={reload}
    />
  );
}
