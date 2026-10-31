import { expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { HistoryEntryItem, type EntryProps } from "../src/lib/components/skills/HistoryEntry.tsx";
import { ProposalTimes } from "../src/lib/components/skills/ProposalCard.tsx";
import { SkillHistoryView } from "../src/lib/components/skills/SkillHistory.tsx";
import { pageWindow } from "../src/lib/components/paged-list/paging.ts";
import { normaliseHistory } from "../src/lib/skill-activity.ts";
import type { HistoryEntry, Proposal } from "../src/lib/skills-api.ts";
import { TIME_SORTS } from "../src/lib/skills-sorts.ts";

const entry = (over: Partial<HistoryEntry> = {}): HistoryEntry => ({
  id: "h1",
  proposalId: "p1",
  kind: "applied",
  at: Date.UTC(2026, 9, 28, 14, 3),
  summary: "Tighten the search steps.",
  appliedBy: "person",
  versionId: "v1",
  canUndo: true,
  laterAppliedCount: 0,
  added: 12,
  removed: 3,
  ...over,
});
const item = (over: Partial<EntryProps> = {}) =>
  renderToStaticMarkup(
    <HistoryEntryItem
      entry={entry()}
      confirming={false}
      working={false}
      locked={false}
      onAsk={() => {}}
      onConfirm={() => {}}
      onCancel={() => {}}
      {...over}
    />
  );

it("shows the kind badge, line counts, summary and a revert button on an applied entry", () => {
  const html = item();
  expect(html).toContain(">applied<");
  expect(html).toContain("--keyword-hue");
  expect(html).toContain("+12");
  expect(html).toContain("−3");
  expect(html).toContain('aria-label="12 lines added, 3 lines removed"');
  expect(html).toContain("Tighten the search steps.");
  expect(html).toContain("Revert to before this change");
  expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>.{0,400}Revert to before/);
  expect(html).not.toContain("Revert the newer change first.");
});

it("keeps the revert button visible but disabled with a hint when a newer change exists", () => {
  const html = item({ entry: entry({ canUndo: false }) });
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-describedby=/);
  expect(html).toContain("Revert the newer change first.");
});

it("offers no revert on entries that are not applies", () => {
  for (const kind of ["created", "rejected", "undone", "stale"] as const) {
    const html = item({ entry: entry({ kind, canUndo: false }) });
    expect(html).toContain(`>${kind}<`);
    expect(html).not.toContain("Revert to before this change");
  }
});

it("warns in the confirmation when the revert also removes later changes", () => {
  const plain = item({ confirming: true });
  expect(plain).toContain("Revert this change?");
  expect(plain).not.toContain("later change");
  expect(item({ confirming: true, entry: entry({ laterAppliedCount: 1 }) })).toContain(
    "Reverting this also removes 1 later change."
  );
  expect(item({ confirming: true, entry: entry({ laterAppliedCount: 3 }) })).toContain(
    "Reverting this also removes 3 later changes."
  );
});

it("shows a status line while the revert runs", () => {
  const html = item({ working: true, locked: true });
  expect(html).toContain('role="status"');
  expect(html).toContain("Reverting…");
});

const historyView = (total: number, entries: HistoryEntry[], notice = null as never) =>
  renderToStaticMarkup(
    <SkillHistoryView
      view={{
        ...pageWindow(1, 5, total),
        perPage: 5,
        sort: "newest",
        order: "desc",
        sorts: TIME_SORTS,
        setPage: () => {},
        setPerPage: () => {},
        setSort: () => {},
      }}
      entries={entries}
      loaded
      error=""
      confirmId={null}
      workingId={null}
      notice={notice}
      onAsk={() => {}}
      onConfirm={() => {}}
      onCancel={() => {}}
    />
  );

it("pages the timeline and says when there is no history yet", () => {
  expect(historyView(0, [])).toContain("No history yet.");
  const html = historyView(12, [entry(), entry({ id: "h2", kind: "created" })]);
  expect(html).toContain("12 entries");
  expect(html).toContain("Showing 1 to 5 of 12 results");
  expect(html).toContain("<ol");
});

it("reads a history page with missing fields as empty", () => {
  expect(normaliseHistory(undefined)).toEqual({ total: 0, entries: [] });
  const page = normaliseHistory({
    entries: [
      { id: "a", kind: "applied" },
      { id: "b", kind: "x" },
    ],
  });
  expect(page.total).toBe(1);
  expect(page.entries[0]).toMatchObject({ canUndo: false, laterAppliedCount: 0, added: 0 });
});

it("shows when a decided proposal was created and when its state changed", () => {
  const proposal = (state: Proposal["state"]) =>
    ({ state, createdAt: Date.UTC(2026, 9, 1), updatedAt: Date.UTC(2026, 9, 2) }) as Proposal;
  expect(renderToStaticMarkup(<ProposalTimes proposal={proposal("pending")} />)).toContain(
    "Created "
  );
  expect(renderToStaticMarkup(<ProposalTimes proposal={proposal("pending")} />)).not.toContain(
    "Applied"
  );
  expect(renderToStaticMarkup(<ProposalTimes proposal={proposal("applied")} />)).toContain(
    "Applied "
  );
  expect(renderToStaticMarkup(<ProposalTimes proposal={proposal("undone")} />)).toContain(
    "Undone "
  );
});
