import { useEffect, useState } from "react";
import { skillsApi, type Proposal, type SkillsReply, type TurnSummary } from "$lib/skills-api";

/**
 * What a card holds once its detail was asked for. No value yet means the request is
 * on its way. The list carries summaries only, so the content, the diff and the
 * evidence turns come from `GET /api/skills/proposals/:id`.
 */
export type ProposalDetailState =
  { status: "failed" } | { status: "ready"; proposal: Proposal; evidence: TurnSummary[] };

type Call = (id: string) => Promise<SkillsReply<{ proposal: Proposal; evidence: TurnSummary[] }>>;

/** One request for the full proposal and its evidence turns. A refusal reads as a failed load. */
export async function loadProposalDetail(
  id: string,
  call: Call = skillsApi.proposal
): Promise<ProposalDetailState> {
  const reply = await call(id);
  if (!reply.ok) return { status: "failed" };
  return { status: "ready", proposal: reply.data.proposal, evidence: reply.data.evidence };
}

/**
 * The detail of one proposal, requested when `open` turns true and held after that.
 * A compact card makes no request. A failed load is forgotten when the card closes,
 * so Show more tries again. `initial` starts the card with a detail, for server
 * rendering in tests.
 */
export function useProposalDetail(
  id: string,
  open: boolean,
  initial: ProposalDetailState | null = null
): ProposalDetailState | null {
  const [detail, setDetail] = useState<ProposalDetailState | null>(initial);
  const ready = detail?.status === "ready";

  useEffect(() => {
    if (!open || ready) return;
    let active = true;
    void loadProposalDetail(id).then((next) => {
      if (active) setDetail(next);
    });
    return () => {
      active = false;
      setDetail((previous) => (previous?.status === "ready" ? previous : null));
    };
  }, [open, ready, id]);

  return detail;
}
