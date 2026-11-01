import { useId, useState } from "react";
import { Check, ChevronDown, ChevronUp, Undo2, X } from "lucide-react";
import { Button } from "$lib/components/ui/button";
import { useSettingsText } from "$lib/i18n/settings";
import { formatDate } from "$lib/format";
import { cn } from "$lib/utils";
import { skillsApi, type Proposal, type ProposalSummary, type SkillsReply } from "$lib/skills-api";
import { fill, hasMoreDetail, proposalLabel, summaryOf } from "$lib/skills-model";
import { Callout } from "./Callout";
import { HuePill } from "./HuePill";
import { ProposalDetail } from "./ProposalDetail";
import { useProposalDetail, type ProposalDetailState } from "./useProposalDetail";

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
export const markStale = <T extends Pick<ProposalSummary, "state" | "updatedAt">>(
  proposal: T,
  now: number
): T => ({
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
export function ProposalTimes({
  proposal,
}: {
  proposal: Pick<ProposalSummary, "state" | "createdAt" | "updatedAt">;
}) {
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
function DiffStat({ proposal }: { proposal: Pick<ProposalSummary, "added" | "removed"> }) {
  const s = useSettingsText();
  const { added, removed } = proposal;
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
 * the actions, all from the list summary. Show more loads the full proposal once,
 * then shows the full summary, the diff and the evidence turns. Apply, Reject and
 * Undo send only the id, so they need no detail.
 * `initiallyOpen` and `initialDetail` start the card open and loaded, for server
 * rendering in tests.
 */
export function ProposalCard({
  proposal,
  onChange,
  initiallyOpen = false,
  initialDetail = null,
}: {
  proposal: ProposalSummary;
  onChange: (next: ProposalSummary) => void;
  initiallyOpen?: boolean;
  initialDetail?: ProposalDetailState | null;
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
  const detail = useProposalDetail(proposal.id, open, initialDetail);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [savedContent, setSavedContent] = useState<string | null | undefined>(undefined);

  async function act(run: () => Promise<SkillsReply<{ proposal: Proposal }>>) {
    setWorking(true);
    setError("");
    setSavedContent(undefined);
    const reply = await run();
    setWorking(false);
    // The reply holds the full proposal; the list holds its summary. The detail the
    // card already loaded stays: an action changes the state, not the content.
    if (reply.ok) onChange(summaryOf(reply.data.proposal));
    else {
      const problem = replyProblem(reply.code, reply.error);
      setError(s(problem.message));
      if (problem.reload) {
        void skillsApi.proposal(proposal.id).then((fresh) => {
          if (fresh.ok) onChange(summaryOf(fresh.data.proposal));
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
        {open ? <ProposalDetail detail={detail} /> : null}
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
