import { expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { flipSort, syncPaged } from "../src/lib/components/paged-list/paging.ts";
import { markStale, ProposalCard } from "../src/lib/components/skills/ProposalCard.tsx";
import { nextLoadError } from "../src/lib/components/skills/SkillDetail.tsx";
import { SkillHistoryView } from "../src/lib/components/skills/SkillHistory.tsx";
import { pageWindow } from "../src/lib/components/paged-list/paging.ts";
import type { HistoryEntry, Proposal } from "../src/lib/skills-api.ts";
import { PROPOSAL_SORTS, TIME_SORTS } from "../src/lib/skills-sorts.ts";

const proposal = (over: Partial<Proposal> = {}): Proposal => ({
  id: "p1",
  kind: "improve",
  skillName: "alpha",
  skillPath: "/skills/alpha/SKILL.md",
  content: "body",
  diff: null,
  summary: "Tighten it.",
  evidenceTurnIds: [],
  state: "applied",
  appliedBy: "person",
  createdAt: 1000,
  updatedAt: 2000,
  ...over,
});

it("returns to page 1 when the reset key goes A, B, A", () => {
  let paged = { page: 3, key: "A" };
  paged = syncPaged(paged, "B");
  expect(paged).toEqual({ page: 1, key: "B" });
  paged = syncPaged(paged, "A");
  expect(paged).toEqual({ page: 1, key: "A" });
  // The same key keeps the page.
  expect(syncPaged({ page: 3, key: "A" }, "A")).toEqual({ page: 3, key: "A" });
});

it("moves a stale card's update time to the time of the answer", () => {
  const next = markStale(proposal({ state: "pending", updatedAt: 2000 }), 9000);
  expect(next).toMatchObject({ state: "stale", updatedAt: 9000, createdAt: 1000 });
});

it("clears the load error when a later load succeeds", () => {
  expect(nextLoadError({ ok: true, code: "ok", data: {} })).toBe("");
  expect(nextLoadError({ ok: false, code: "error", error: "Boom" })).toBe("Boom");
});

it("flips between Newest and Oldest so the label always matches the direction", () => {
  for (const sorts of [TIME_SORTS, PROPOSAL_SORTS]) {
    // Choosing Oldest starts ascending; the button must go back to Newest, descending.
    expect(flipSort(sorts, "oldest", "asc")).toEqual({ sort: "newest", order: "desc" });
    expect(flipSort(sorts, "newest", "desc")).toEqual({ sort: "oldest", order: "asc" });
  }
});

it("flips the direction of a sort that has no opposite, such as State", () => {
  expect(flipSort(PROPOSAL_SORTS, "state", "asc")).toEqual({ sort: "state", order: "desc" });
  expect(flipSort(PROPOSAL_SORTS, "state", "desc")).toEqual({ sort: "state", order: "asc" });
});

const undoButton = (html: string) =>
  html.match(/<button[^>]*>(?:(?!<\/button>).)*Undo<\/button>/)?.[0] ?? "";

it("disables Undo with a hint when a newer applied change superseded the proposal", () => {
  const html = renderToStaticMarkup(
    <ProposalCard proposal={proposal({ canUndo: false })} onChange={() => {}} />
  );
  expect(undoButton(html)).toContain('disabled=""');
  expect(html).toContain("Revert the newer change first.");
});

it("keeps Undo on when the server says it works, or says nothing (a fresh apply)", () => {
  for (const canUndo of [true, undefined]) {
    const html = renderToStaticMarkup(
      <ProposalCard proposal={proposal({ canUndo })} onChange={() => {}} />
    );
    expect(undoButton(html)).not.toContain('disabled=""');
    expect(html).not.toContain("Revert the newer change first.");
  }
});

const applied: HistoryEntry = {
  id: "h1",
  proposalId: "p1",
  kind: "applied",
  at: Date.UTC(2026, 9, 28, 14, 3),
  summary: "Tighten it.",
  appliedBy: "person",
  versionId: "v1",
  canUndo: true,
  laterAppliedCount: 0,
  added: 1,
  removed: 0,
};

const history = (refreshing?: boolean) =>
  renderToStaticMarkup(
    <SkillHistoryView
      view={{
        ...pageWindow(1, 5, 12),
        perPage: 5,
        sort: "newest",
        order: "desc",
        sorts: TIME_SORTS,
        setPage: () => {},
        setPerPage: () => {},
        setSort: () => {},
      }}
      entries={[applied]}
      loaded
      {...(refreshing === undefined ? {} : { refreshing })}
      error=""
      confirmId={null}
      workingId={null}
      notice={null}
      onAsk={() => {}}
      onConfirm={() => {}}
      onCancel={() => {}}
    />
  );

it("disables Revert on the old entries while a new history page loads", () => {
  const revert = (html: string) =>
    html.match(/<button[^>]*>(?:(?!<\/button>).)*Revert to before this change<\/button>/)?.[0] ??
    "";
  expect(revert(history(true))).toContain('disabled=""');
  expect(history(true)).toContain('aria-busy="true"');
  expect(revert(history(false))).not.toContain('disabled=""');
});
