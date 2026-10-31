import { useEffect, useState } from "react";
import { Check, Undo2, X } from "lucide-react";
import { Button } from "$lib/components/ui/button";
import { useSettingsText } from "$lib/i18n/settings";
import { formatDate } from "$lib/format";
import { skillsApi, type Proposal, type SkillsReply, type TurnSummary } from "$lib/skills-api";
import { fill, proposalLabel } from "$lib/skills-model";
import { Callout } from "./Callout";
import { HuePill } from "./HuePill";
import { ProposalDiff } from "./ProposalDiff";
import { TurnList } from "./TurnList";

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

/**
 * One proposal. A pending proposal opens with its diff, summary and evidence
 * turns and offers Apply and Reject. Other states fold the diff behind a toggle.
 */
export function ProposalCard({
  proposal,
  onChange,
}: {
  proposal: Proposal;
  onChange: (next: Proposal) => void;
}) {
  const s = useSettingsText();
  const label = proposalLabel(proposal);
  const pending = proposal.state === "pending";
  const [open, setOpen] = useState(pending);
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
      setError(reply.error);
      if (reply.code === "changed") setSavedContent(reply.savedContent ?? null);
      // A stale answer changes the stored state; the card must show it.
      if (reply.code === "stale") onChange({ ...proposal, state: "stale" });
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
        <p className="text-sm" dir="auto">
          {proposal.summary}
        </p>
      ) : null}
      {proposal.state === "stale" ? (
        <Callout tone="warning">
          <p>{s("Stale: the file changed since this draft")}</p>
        </Callout>
      ) : null}
      {!pending ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          {s(open ? "Hide changes" : "Show changes")}
        </Button>
      ) : null}
      {open ? (
        <div className="space-y-3">
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
                <TurnList turns={evidence} />
              ) : (
                <p className="text-sm text-muted-foreground">{s("Loading…")}</p>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
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
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={working}
              onClick={() => void act(() => skillsApi.undo(proposal.id))}
            >
              <Undo2 aria-hidden="true" />
              {s("Undo")}
            </Button>
          )}
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive-label">
          {error}
        </p>
      ) : null}
      {savedContent !== undefined ? <UndoStopped savedContent={savedContent} /> : null}
    </article>
  );
}
