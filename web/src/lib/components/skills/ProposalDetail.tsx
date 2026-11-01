import { Loader } from "lucide-react";
import { useSettingsText } from "$lib/i18n/settings";
import { EvidenceTurns } from "./EvidenceTurns";
import { ProposalDiff } from "./ProposalDiff";
import type { ProposalDetailState } from "./useProposalDetail";

/**
 * What an open proposal card shows below its summary: the full line diff, or the
 * content of a new skill, and the evidence turns. While the request runs it shows a
 * status line. When the request failed it says so; the card keeps its buttons.
 */
export function ProposalDetail({ detail }: { detail: ProposalDetailState | null }) {
  const s = useSettingsText();
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
  const { proposal, evidence } = detail;
  return (
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
          <EvidenceTurns turns={evidence} />
        </div>
      ) : null}
    </>
  );
}
