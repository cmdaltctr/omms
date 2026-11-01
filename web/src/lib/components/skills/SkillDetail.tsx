import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Loader, Sparkles } from "lucide-react";
import { Button } from "$lib/components/ui/button";
import { useSettingsText } from "$lib/i18n/settings";
import { formatDate } from "$lib/format";
import {
  skillsApi,
  type ProposalSummary,
  type SkillsReply,
  type SkillDetailData,
  type SkillMode,
  type SkillRow,
} from "$lib/skills-api";
import { dayRows, normaliseDays } from "$lib/skill-activity";
import { countText } from "$lib/skills-model";
import { Callout } from "./Callout";
import { DraftNotice, useDraftNotice } from "./DraftNotice";
import { HuePill } from "./HuePill";
import { ModeChoice } from "./ModeChoice";
import { ModifiedMark } from "./ModifiedMark";
import { UsesChart } from "./charts/UsesChart";
import { ProposalList, SKILL_PROPOSALS_LIST_KEY } from "./ProposalList";
import { FailureGroups } from "./FailureGroups";
import { SkillHistory } from "./SkillHistory";
import { SkillTurns } from "./SkillTurns";

/** The load error to show after a reply. */
export const nextLoadError = (reply: SkillsReply<unknown>): string => (reply.ok ? "" : reply.error);

/**
 * What follows an apply, reject or undo made on a proposal card. The card
 * updates at once. The history reloads, and so does the detail, so the green
 * tick and date in the header follow the new state.
 */
export function proposalChanged(
  next: ProposalSummary,
  actions: {
    setDetail: (update: (previous: SkillDetailData | null) => SkillDetailData | null) => void;
    bumpHistory: () => void;
    reload: () => void;
  }
): void {
  actions.setDetail((previous) =>
    previous
      ? { ...previous, proposals: previous.proposals.map((p) => (p.id === next.id ? next : p)) }
      : previous
  );
  // Apply, reject and undo add a history entry.
  actions.bumpHistory();
  actions.reload();
}

/** One skill: its path, counts, daily uses, mode, a draft button, proposals, history and turns. */
export function SkillDetail({
  skill,
  onBack,
  onChanged,
}: {
  skill: SkillRow;
  onBack: () => void;
  onChanged: () => void;
}) {
  const s = useSettingsText();
  const [detail, setDetail] = useState<SkillDetailData | null>(null);
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<SkillMode>(skill.mode);
  const [modeError, setModeError] = useState("");
  const notice = useDraftNotice();
  // A change anywhere on this view reloads the history and the turns as well.
  const [reloadKey, setReloadKey] = useState(0);

  // The turns list loads its own pages, so this load asks for one turn only.
  const load = useCallback(async () => {
    const reply = await skillsApi.skill(skill.path, skill.name, { limit: 1, offset: 0 });
    if (reply.ok) setDetail(reply.data);
    setLoadError(nextLoadError(reply));
  }, [skill.path, skill.name]);
  const reloadAll = () => {
    setReloadKey((key) => key + 1);
    void load();
    onChanged();
  };
  useEffect(() => {
    void load();
  }, [load]);

  async function draft() {
    setBusy(true);
    notice.clear();
    const reply = await skillsApi.draftImprovement(skill.path ?? skill.name);
    setBusy(false);
    notice.show(reply);
    if (reply.ok) reloadAll();
  }

  async function chooseMode(next: SkillMode) {
    if (!skill.path) return;
    setModeError("");
    const reply = await skillsApi.setMode(skill.path, next);
    if (reply.ok) {
      setMode(next);
      onChanged();
    } else setModeError(reply.error);
  }

  const replaceProposal = (next: ProposalSummary) =>
    proposalChanged(next, {
      setDetail,
      bumpHistory: () => setReloadKey((key) => key + 1),
      reload: () => void load(),
    });

  const proposals = detail?.proposals ?? [];
  // The reloaded row carries the tick; until it loads, the row from the list stands in.
  const shown = detail?.skill ?? skill;
  return (
    <div className="space-y-8">
      <div className="space-y-3">
        <Button type="button" variant="ghost" size="sm" onClick={onBack}>
          <ArrowLeft className="rtl:-scale-x-100" aria-hidden="true" />
          {s("All skills")}
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="min-w-0 break-words text-section-title font-semibold">{skill.name}</h2>
          {shown.modified && shown.lastAppliedAt !== null ? (
            <ModifiedMark at={shown.lastAppliedAt} />
          ) : null}
          {skill.suggested ? <HuePill label={s("Suggested")} colourKey="Suggested" /> : null}
          <HuePill label={s(mode === "manual" ? "Manual" : "Automatic")} colourKey={mode} />
        </div>
        {skill.path ? (
          <p dir="ltr" className="break-all font-mono text-xs text-start text-muted-foreground">
            {skill.path}
          </p>
        ) : (
          <Callout tone="info">
            <p>{s("Not in a watched folder")}</p>
          </Callout>
        )}
        <dl className="grid max-w-xl grid-cols-1 gap-3 text-sm sm:grid-cols-3">
          {[
            [s("Uses in 30 days"), countText(skill.uses)],
            [s("Failed turns"), countText(skill.failedTurns)],
            [s("Last use"), skill.lastUsedAt ? formatDate(skill.lastUsedAt) : s("Never")],
          ].map(([term, value]) => (
            <div key={term} className="rounded-xl border border-border bg-card px-3 py-2.5">
              <dt className="text-xs text-muted-foreground">{term}</dt>
              <dd className="font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      </div>

      {detail ? (
        <UsesChart
          className="max-w-3xl"
          rows={dayRows(normaliseDays(detail.daily))}
          title={s("Uses in the last 30 days")}
        />
      ) : null}

      {skill.path ? (
        <section className="space-y-3" aria-label={s("Mode")}>
          <h3 className="text-section-title font-semibold">{s("Mode")}</h3>
          <ModeChoice mode={mode} disabled={busy} onChoose={(next) => void chooseMode(next)} />
          {modeError ? (
            <p role="alert" className="text-sm text-destructive-label">
              {modeError}
            </p>
          ) : null}
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <Button type="button" size="sm" disabled={busy} onClick={() => void draft()}>
              <Sparkles aria-hidden="true" />
              {s("Draft improvement")}
            </Button>
            {busy ? (
              <span role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader className="size-4 animate-spin" aria-hidden="true" />
                {s("Drafting… This can take a few minutes.")}
              </span>
            ) : null}
          </div>
          <DraftNotice notice={notice.value} />
        </section>
      ) : null}

      <section className="space-y-3" aria-labelledby="skill-proposals-title">
        <h3 id="skill-proposals-title" className="text-section-title font-semibold">
          {s("Proposals")}
        </h3>
        {loadError ? (
          <p role="alert" className="text-sm text-destructive-label">
            {loadError}
          </p>
        ) : proposals.length === 0 ? (
          <p className="text-sm text-muted-foreground">{s("No proposals yet.")}</p>
        ) : (
          <ProposalList
            storageKey={SKILL_PROPOSALS_LIST_KEY}
            proposals={proposals}
            onChange={replaceProposal}
          />
        )}
      </section>

      <SkillHistory skill={skill} reloadKey={reloadKey} onChanged={reloadAll} />

      <FailureGroups skill={skill} reloadKey={reloadKey} />

      <SkillTurns skill={skill} reloadKey={reloadKey} />
    </div>
  );
}
