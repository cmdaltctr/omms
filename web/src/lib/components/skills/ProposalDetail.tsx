import { Loader } from "lucide-react";
import { useSettingsText } from "$lib/i18n/settings";
import { EvidenceTurns } from "./EvidenceTurns";
import { ProposalDiff } from "./ProposalDiff";
import type { ProposalDetailState } from "./useProposalDetail";

/**
 * What an open proposal card shows. `content` is the full line diff, or the content of
 * a new skill; it goes in the card's inner card, below the summary. While the request
 * runs it shows a status line. When the request failed it says so; the card keeps its
 * buttons. `evidence` is the evidence turns, below the inner card.
 */
export function ProposalDetail({
  detail,
  part,
}: {
  detail: ProposalDetailState | null;
  part: "content" | "evidence";
}) {
  const s = useSettingsText();
  if (part === "evidence") {
    if (detail?.status !== "ready" || detail.proposal.evidenceTurnIds.length === 0) return null;
    return (
      <div className="space-y-2">
        <h4 className="text-sm font-medium">{s("Evidence turns")}</h4>
        <EvidenceTurns turns={detail.evidence} />
      </div>
    );
  }
  if (detail === null) {
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader className="size-3.5 animate-spin" aria-hidden="true" />
        {s("Loading the proposal…")}
      </p>
    );
  }
  if (detail.status === "failed") {
    return (
      <p role="alert" className="text-sm text-destructive-label">
        {s("The proposal could not be loaded. Select Show less, then Show more to try again.")}
      </p>
    );
  }
  const { proposal } = detail;
  return proposal.diff ? (
    <ProposalDiff diff={proposal.diff} label={s("Changes to SKILL.md")} />
  ) : (
    <pre
      dir="ltr"
      className="max-h-96 overflow-auto rounded-lg border border-border bg-background p-2 font-mono text-xs"
    >
      {proposal.content}
    </pre>
  );
}
