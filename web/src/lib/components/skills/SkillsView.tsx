import { useCallback, useEffect, useState } from "react";
import { Input } from "$lib/components/ui/input";
import { useSettingsText } from "$lib/i18n/settings";
import { navigate, ROUTES } from "$lib/router";
import {
  skillsApi,
  type Proposal,
  type SkillOrder,
  type SkillRow,
  type SkillsOverview,
} from "$lib/skills-api";
import { filterSkills, recentProposals } from "$lib/skills-model";
import { Callout } from "./Callout";
import { ProposalCard } from "./ProposalCard";
import { RecordPast } from "./RecordPast";
import { SkillDetail } from "./SkillDetail";
import { SkillFolders } from "./SkillFolders";
import { SkillIdeas } from "./SkillIdeas";
import { SkillList } from "./SkillList";
import { SkillSortChoice } from "./SkillSortChoice";

const ORDER_KEY = "omms-skills-order";

function savedOrder(): SkillOrder {
  try {
    return localStorage.getItem(ORDER_KEY) === "attention" ? "attention" : "uses";
  } catch {
    return "uses";
  }
}

function saveOrder(order: SkillOrder): void {
  try {
    localStorage.setItem(ORDER_KEY, order);
  } catch {
    // Private mode or blocked site data; the choice lasts for this visit.
  }
}

const SETTINGS_CARD = `${ROUTES.settings}#settings-section-skill-learning`;

type PageProps = {
  overview: SkillsOverview | null;
  turns: number | null;
  pending: Proposal[];
  /** Up to 20 proposals that are no longer pending, so a rejected or undone new skill still shows. */
  recent: Proposal[];
  error: string;
  query: string;
  order: SkillOrder;
  onOrder: (order: SkillOrder) => void;
  onQuery: (query: string) => void;
  onOpen: (skill: SkillRow) => void;
  onPendingChange: (next: Proposal) => void;
  onRecentChange: (next: Proposal) => void;
  onReload: () => void;
};

/** The Skills page as markup: ranked skills, pending proposals, ideas and the watched folders. */
export function SkillsPage({
  overview,
  turns,
  pending,
  recent,
  error,
  query,
  order,
  onOrder,
  onQuery,
  onOpen,
  onPendingChange,
  onRecentChange,
  onReload,
}: PageProps) {
  const s = useSettingsText();
  const skills = filterSkills(overview?.skills ?? [], query);
  const folders = overview?.folders ?? [];
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

      <section className="space-y-3" aria-label={s("Skills")}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-section-title font-semibold">{s("Ranked skills")}</h2>
          <div className="flex flex-wrap items-center gap-3">
            <SkillSortChoice order={order} onChange={onOrder} />
            <Input
              type="search"
              className="max-w-xs"
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
            {s(
              query.trim()
                ? "No skill matches this name."
                : "No skills found in the watched folders."
            )}
          </p>
        ) : null}
        <SkillList skills={skills} folders={folders} onOpen={onOpen} />
      </section>

      {pending.length > 0 ? (
        <section className="space-y-3" aria-label={s("Pending proposals")}>
          <h2 className="text-section-title font-semibold">{s("Pending proposals")}</h2>
          {pending.map((proposal) => (
            <ProposalCard key={proposal.id} proposal={proposal} onChange={onPendingChange} />
          ))}
        </section>
      ) : null}

      {recent.length > 0 ? (
        <section className="space-y-3" aria-label={s("Recent proposals")}>
          <h2 className="text-section-title font-semibold">{s("Recent proposals")}</h2>
          {recent.map((proposal) => (
            <ProposalCard key={proposal.id} proposal={proposal} onChange={onRecentChange} />
          ))}
        </section>
      ) : null}

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
  const [open, setOpen] = useState<SkillRow | null>(null);
  const [order, setOrder] = useState<SkillOrder>(savedOrder);

  const load = useCallback(async () => {
    const [list, stats, proposals] = await Promise.all([
      skillsApi.overview(order),
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
  }, [order]);
  useEffect(() => {
    void load();
  }, [load]);

  if (open) {
    return (
      <SkillDetail
        skill={open}
        onBack={() => {
          setOpen(null);
          void load();
        }}
        onChanged={() => void load()}
      />
    );
  }
  return (
    <SkillsPage
      {...{ overview, turns, pending, recent, error, query, order }}
      onOrder={(next) => {
        saveOrder(next);
        setOrder(next);
      }}
      onQuery={setQuery}
      onOpen={setOpen}
      onPendingChange={(next) =>
        setPending((list) => list.map((item) => (item.id === next.id ? next : item)))
      }
      onRecentChange={(next) =>
        setRecent((list) => list.map((item) => (item.id === next.id ? next : item)))
      }
      onReload={() => void load()}
    />
  );
}
