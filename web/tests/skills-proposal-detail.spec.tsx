import { expect, it, mock } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ProposalCard } from "../src/lib/components/skills/ProposalCard.tsx";
import { loadProposalDetail } from "../src/lib/components/skills/useProposalDetail.ts";
import type { Proposal, ProposalSummary, TurnSummary } from "../src/lib/skills-api.ts";

/**
 * The proposal list holds summaries. The card loads the content, the diff and the
 * evidence turns when the reader selects Show more (TDR-059, task 3.3).
 */

const DIFF = "@@ -1,3 +1,3 @@\n keep\n-old line\n-older line\n+new line\n+newer line\n+newest line";

const summary = (over: Partial<ProposalSummary> = {}): ProposalSummary => ({
  id: "p1",
  kind: "improve",
  skillName: "openspec-archive-change",
  skillPath: "/skills/openspec-archive-change/SKILL.md",
  summary: "Tighten the steps.",
  evidenceTurnIds: [4],
  state: "pending",
  appliedBy: null,
  createdAt: 1,
  updatedAt: 2,
  added: 3,
  removed: 2,
  hasDiff: true,
  ...over,
});
const full = (over: Partial<Proposal> = {}): Proposal => ({
  id: "p1",
  kind: "improve",
  skillName: "openspec-archive-change",
  skillPath: "/skills/openspec-archive-change/SKILL.md",
  content: "BODY-OF-THE-FILE",
  diff: DIFF,
  summary: "Tighten the steps.",
  evidenceTurnIds: [4],
  state: "pending",
  appliedBy: null,
  createdAt: 1,
  updatedAt: 2,
  ...over,
});
const turn: TurnSummary = {
  id: 4,
  createdAt: 3,
  host: "pi",
  projectName: "demo",
  promptPreview: "search the docs for the archive step",
  failedToolCalls: 1,
};
const ready = (proposal: Proposal = full()) => ({
  status: "ready" as const,
  proposal,
  evidence: [turn],
});

const render = (
  over: Partial<ProposalSummary> = {},
  options: { open?: boolean; detail?: Parameters<typeof ProposalCard>[0]["initialDetail"] } = {}
) =>
  renderToStaticMarkup(
    <ProposalCard
      proposal={summary(over)}
      initiallyOpen={options.open ?? false}
      initialDetail={options.detail}
      onChange={() => {}}
    />
  );
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

it("shows the list counts on a compact card and never the diff or the evidence", () => {
  const html = render();
  expect(text(html)).toContain("3 lines added, 2 lines removed");
  expect(html).toContain("Show more");
  expect(html).toContain('aria-expanded="false"');
  // Even if a detail were held, a closed card shows none of it.
  const closed = render({}, { detail: ready() });
  expect(closed).not.toContain("new line");
  expect(closed).not.toContain("search the docs");
  expect(closed).not.toContain("BODY-OF-THE-FILE");
});

it("shows the full diff and the evidence turns once the card is open and loaded", () => {
  const html = render({}, { open: true, detail: ready() });
  expect(html).toContain('aria-expanded="true"');
  expect(text(html)).toContain("+new line");
  expect(text(html)).toContain("-old line");
  expect(text(html)).toContain("search the docs for the archive step");
  expect(html).not.toContain("BODY-OF-THE-FILE");
});

it("shows the content of a new skill, which has no diff", () => {
  const html = render(
    { kind: "new", hasDiff: false, added: 1, removed: 0, evidenceTurnIds: [] },
    { open: true, detail: ready(full({ kind: "new", diff: null, evidenceTurnIds: [] })) }
  );
  expect(html).toContain("BODY-OF-THE-FILE");
  expect(html).not.toContain("Evidence turns");
});

it("says that the proposal is loading, and keeps Apply and Reject", () => {
  const html = render({}, { open: true });
  expect(html).toContain('role="status"');
  expect(text(html)).toContain("Loading the proposal…");
  expect(html).not.toContain("new line");
  expect(text(html)).toContain("Apply");
  expect(text(html)).toContain("Reject");
});

it("says that the proposal could not load, and keeps Apply and Reject", () => {
  const html = render({}, { open: true, detail: { status: "failed" } });
  expect(html).toContain('role="alert"');
  expect(text(html)).toContain("The proposal could not be loaded.");
  expect(text(html)).toContain("Apply");
  expect(text(html)).toContain("Reject");
});

it("loads the detail by the proposal id and reports a failed load", async () => {
  const call = mock(async (id: string) => ({
    ok: true as const,
    code: "ok",
    data: { proposal: full({ id }), evidence: [turn] },
  }));
  expect(await loadProposalDetail("p9", call)).toEqual({
    status: "ready",
    proposal: full({ id: "p9" }),
    evidence: [turn],
  });
  expect(call).toHaveBeenCalledTimes(1);
  expect(call).toHaveBeenCalledWith("p9");
  const refused = mock(async () => ({ ok: false as const, code: "not-found", error: "No such" }));
  expect(await loadProposalDetail("p9", refused)).toEqual({ status: "failed" });
});
