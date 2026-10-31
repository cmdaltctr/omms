import { useEffect, useId, useState } from "react";
import { Check, ChevronDown, ChevronUp, Undo2, X } from "lucide-react";
import { Button } from "$lib/components/ui/button";
import { useSettingsText } from "$lib/i18n/settings";
import { formatDate } from "$lib/format";
import { cn } from "$lib/utils";
import { skillsApi, type Proposal, type SkillsReply, type TurnSummary } from "$lib/skills-api";
import { diffStat, fill, hasMoreDetail, proposalLabel } from "$lib/skills-model";
import { Callout } from "./Callout";
import { HuePill } from "./HuePill";
import { ProposalDiff } from "./ProposalDiff";
import { EvidenceTurns } from "./EvidenceTurns";

/**
 * What the card shows for a failed apply or undo. When the server could not
 * save the new state it rolled the file back, so the card shows a fixed
 * translatable message and loads the proposal again.
 */
export function replyProblem(code: string, error: string): { message: string; reload: boolean } {
  if (code === "state-write-failed") {
    return {
      message: "The state could not be saved, so SKILL.md is as it was. Try again.",
      reload: true,
    };
  }
  return { message: error, reload: false };
}

/** Undo refused because the file changed by hand; shows the content OMMS saved. */
export function UndoStopped({ savedContent }: { savedContent: string | null }) {
  const s = useSettingsText();
  return (
    <div className="space-y-1.5">
      <p className="text-sm">
        {s("Undo stopped because the file changed. This is the content OMMS saved:")}
      </p>
      {savedContent === null ? (
        <p className="text-sm text-muted-foreground">{s("No content was saved.")}</p>
      ) : (
        <pre
          dir="ltr"
          className="max-h-72 overflow-auto rounded-lg border border-border bg-background p-2 font-mono text-xs"
        >
          {savedContent}
        </pre>
      )}
    </div>
  );
}

/** The proposal as the server now holds it after a "stale" answer. */
export const markStale = (proposal: Proposal, now: number): Proposal => ({
  ...proposal,
  state: "stale",
  updatedAt: now,
});

const DECIDED = {
  applied: "Applied {date}",
  rejected: "Rejected {date}",
  undone: "Undone {date}",
  stale: "Stale since {date}",
} as const;

/** When the proposal was drafted and, once decided, when its state last changed. */
export function ProposalTimes({ proposal }: { proposal: Proposal }) {
  const s = useSettingsText();
  const decided = proposal.state === "pending" ? null : DECIDED[proposal.state];
  return (
    <span className="flex flex-wrap gap-x-2 text-xs text-muted-foreground">
      <span>{fill(s("Created {date}"), { date: formatDate(proposal.createdAt) })}</span>
      {decided ? <span>{fill(s(decided), { date: formatDate(proposal.updatedAt) })}</span> : null}
    </span>
  );
}

/** Lines added and removed, as a small chip. Screen readers get the long sentence. */
function DiffStat({ proposal }: { proposal: Proposal }) {
  const s = useSettingsText();
  const { added, removed } = diffStat(proposal);
  if (added === 0 && removed === 0) return null;
  return (
    <span
      dir="ltr"
      className="inline-flex w-fit items-center gap-1 rounded-[7px] border border-border bg-background px-2 font-mono text-xs tabular-nums leading-5"
    >
      <span className="sr-only">
        {fill(s("{added} lines added, {removed} lines removed"), { added, removed })}
      </span>
      <span aria-hidden="true" className="text-status-success">
        +{added}
      </span>
      <span aria-hidden="true" className="text-destructive-label">
        −{removed}
      </span>
      <span aria-hidden="true" className="text-muted-foreground">
        {s("lines")}
      </span>
    </span>
  );
}

/**
 * One proposal. It starts compact: header, a two-line summary, a diffstat and
 * the actions. Show more opens the full summary, the diff and the evidence turns.
 * `initiallyOpen` starts the card open, for server rendering in tests.
 */
export function ProposalCard({
  proposal,
  onChange,
  initiallyOpen = false,
}: {
  proposal: Proposal;
  onChange: (next: Proposal) => void;
  initiallyOpen?: boolean;
}) {
  const s = useSettingsText();
  const label = proposalLabel(proposal);
  const pending = proposal.state === "pending";
  const hintId = useId();
  const detailsId = useId();
  // The list says false when a newer applied change superseded this one.
  // A proposal applied just now carries no flag and can be undone.
  const canUndo = proposal.canUndo !== false;
  const [open, setOpen] = useState(initiallyOpen);
  const Chevron = open ? ChevronUp : ChevronDown;
  const [evidence, setEvidence] = useState<TurnSummary[] | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [savedContent, setSavedContent] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (!open || evidence || proposal.evidenceTurnIds.length === 0) return;
    let active = true;
    void skillsApi.proposal(proposal.id).then((reply) => {
      if (active && reply.ok) setEvidence(reply.data.evidence);
    });
    return () => {
      active = false;
    };
  }, [open, evidence, proposal.id, proposal.evidenceTurnIds.length]);

  async function act(run: () => Promise<SkillsReply<{ proposal: Proposal }>>) {
    setWorking(true);
    setError("");
    setSavedContent(undefined);
    const reply = await run();
    setWorking(false);
    if (reply.ok) onChange(reply.data.proposal);
    else {
      const problem = replyProblem(reply.code, reply.error);
      setError(s(problem.message));
      if (problem.reload) {
        void skillsApi.proposal(proposal.id).then((fresh) => {
          if (fresh.ok) onChange(fresh.data.proposal);
        });
      }
      if (reply.code === "changed") setSavedContent(reply.savedContent ?? null);
      // A stale answer changes the stored state; the card must show it.
      if (reply.code === "stale") onChange(markStale(proposal, Date.now()));
    }
  }

  return (
    <article className="min-w-0 space-y-3 rounded-xl border border-border bg-card p-3">
      <header className="flex flex-wrap items-center gap-2">
        <h3 className="min-w-0 break-words text-sm font-semibold">{proposal.skillName}</h3>
        <HuePill label={s(label)} colourKey={label} />
        <HuePill
          label={s(proposal.kind === "new" ? "New skill" : "Improvement")}
          colourKey={proposal.kind}
        />
        <ProposalTimes proposal={proposal} />
      </header>
      {proposal.summary ? (
        <p className={cn("break-words text-sm", open ? "" : "line-clamp-2")} dir="auto">
          {proposal.summary}
        </p>
      ) : null}
      <DiffStat proposal={proposal} />
      {proposal.state === "stale" ? (
        <Callout tone="warning">
          <p>{s("Stale: the file changed since this draft")}</p>
        </Callout>
      ) : null}
      <div id={detailsId} hidden={!open} className="space-y-3">
        {open ? (
          <>
            {proposal.diff ? (
              <ProposalDiff diff={proposal.diff} label={s("Changes to SKILL.md")} />
            ) : (
              <pre
                dir="ltr"
                className="max-h-96 overflow-auto rounded-lg border border-border bg-background p-2 font-mono text-xs"
              >
                {proposal.content}
              </pre>
            )}
            {proposal.evidenceTurnIds.length > 0 ? (
              <div className="space-y-2">
                <h4 className="text-sm font-medium">{s("Evidence turns")}</h4>
                {evidence ? (
                  <EvidenceTurns turns={evidence} />
                ) : (
                  <p className="text-sm text-muted-foreground">{s("Loading…")}</p>
                )}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
      {pending || proposal.state === "applied" ? (
        <div className="flex flex-wrap gap-2">
          {pending ? (
            <>
              <Button
                type="button"
                size="sm"
                disabled={working}
                onClick={() => void act(() => skillsApi.apply(proposal.id))}
              >
                <Check aria-hidden="true" />
                {s("Apply")}
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                disabled={working}
                onClick={() => void act(() => skillsApi.reject(proposal.id))}
              >
                <X aria-hidden="true" />
                {s("Reject")}
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={working || !canUndo}
                aria-describedby={canUndo ? undefined : hintId}
                onClick={() => void act(() => skillsApi.undo(proposal.id))}
              >
                <Undo2 aria-hidden="true" />
                {s("Undo")}
              </Button>
              {canUndo ? null : (
                <span id={hintId} className="self-center text-xs text-muted-foreground">
                  {s("Revert the newer change first.")}
                </span>
              )}
            </>
          )}
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive-label">
          {error}
        </p>
      ) : null}
      {savedContent !== undefined ? <UndoStopped savedContent={savedContent} /> : null}
      {hasMoreDetail(proposal) ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-expanded={open}
          aria-controls={detailsId}
          onClick={() => setOpen((value) => !value)}
        >
          <Chevron aria-hidden="true" />
          {s(open ? "Show less" : "Show more")}
        </Button>
      ) : null}
    </article>
  );
}
