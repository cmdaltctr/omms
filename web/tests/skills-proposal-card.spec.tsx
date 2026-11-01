import { afterEach, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { usePagedList } from "../src/lib/components/paged-list/index.ts";
import { PER_PAGE_PRESETS } from "../src/lib/components/paged-list/paging.ts";
import { initialView, viewToSave } from "../src/lib/components/paged-list/use-paging.ts";
import { ProposalCard } from "../src/lib/components/skills/ProposalCard.tsx";
import {
  PENDING_LIST_KEY,
  ProposalList,
  RECENT_LIST_KEY,
  SKILL_PROPOSALS_LIST_KEY,
} from "../src/lib/components/skills/ProposalList.tsx";
import { PagedList } from "../src/lib/components/paged-list/index.ts";
import type { Proposal, ProposalSummary } from "../src/lib/skills-api.ts";
import { diffStat, hasMoreDetail } from "../src/lib/skills-model.ts";
import { PROPOSAL_SORTS } from "../src/lib/skills-sorts.ts";

const LONG = "Tighten the search steps and name the tool order. ".repeat(5);
const DIFF = "@@ -1,3 +1,3 @@\n keep\n-old line\n-older line\n+new line\n+newer line\n+newest line";

/** A listed proposal: the summary, with the server's line counts and no content or diff. */
const proposal = (over: Partial<ProposalSummary> = {}): ProposalSummary => ({
  id: "p1",
  kind: "improve",
  skillName: "openspec-archive-change",
  skillPath: "/skills/openspec-archive-change/SKILL.md",
  summary: LONG,
  evidenceTurnIds: [1, 2],
  state: "pending",
  appliedBy: null,
  createdAt: 1,
  updatedAt: 2,
  added: 3,
  removed: 2,
  hasDiff: true,
  ...over,
});
/** What the detail route returns for it. An open card shows this. */
const full: Proposal = {
  id: "p1",
  kind: "improve",
  skillName: "openspec-archive-change",
  skillPath: "/skills/openspec-archive-change/SKILL.md",
  content: "new body",
  diff: DIFF,
  summary: LONG,
  evidenceTurnIds: [1, 2],
  state: "pending",
  appliedBy: null,
  createdAt: 1,
  updatedAt: 2,
};
const many = (n: number) => Array.from({ length: n }, (_, i) => proposal({ id: `p${i}` }));
const card = (over: Partial<ProposalSummary> = {}, initiallyOpen = false) =>
  renderToStaticMarkup(
    <ProposalCard
      proposal={proposal(over)}
      initiallyOpen={initiallyOpen}
      initialDetail={initiallyOpen ? { status: "ready", proposal: full, evidence: [] } : null}
      onChange={() => {}}
    />
  );
const articles = (html: string) => (html.match(/<article/g) ?? []).length;
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

const g = globalThis as { localStorage?: unknown };
afterEach(() => {
  delete g.localStorage;
});

it("pages the two proposal lists 3 to a page by default", () => {
  for (const storageKey of ["omms-list-pending", "omms-list-recent"]) {
    const html = renderToStaticMarkup(
      <ProposalList storageKey={storageKey} proposals={many(5)} onChange={() => {}} />
    );
    expect(articles(html)).toBe(3);
    expect(html).toContain("Showing 1 to 3 of 5 results");
    expect(html).toMatch(/aria-label="Results per page"[^>]*>.*?truncate">3</);
  }
});

function PlainList({ n }: { n: number }) {
  const { view, pageItems } = usePagedList({
    storageKey: "omms-list-plain",
    items: many(n),
    sorts: PROPOSAL_SORTS,
  });
  return (
    <PagedList view={view} totalLabel="">
      {pageItems.map((p) => (
        <article key={p.id} />
      ))}
    </PagedList>
  );
}

it("keeps 5 to a page on a list that sets no default", () => {
  const html = renderToStaticMarkup(<PlainList n={7} />);
  expect(articles(html)).toBe(5);
  expect(html).toContain("Showing 1 to 5 of 7 results");
  expect(initialView("k", PROPOSAL_SORTS).perPage).toBe(5);
  expect(initialView("k", PROPOSAL_SORTS, 3).perPage).toBe(3);
});

it("lists 3 first among the page-size presets", () => {
  expect([...PER_PAGE_PRESETS]).toEqual([3, 5, 10, 25, 50, 100]);
});

it("lets a saved page size win over the default of 3", () => {
  const store = new Map<string, string>([
    ["omms-list-pending", JSON.stringify({ perPage: 10, sort: "newest", order: "desc" })],
  ]);
  g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem() {} };
  expect(initialView("omms-list-pending", PROPOSAL_SORTS, 3).perPage).toBe(10);
  expect(initialView("omms-list-recent", PROPOSAL_SORTS, 3).perPage).toBe(3);
  const html = renderToStaticMarkup(
    <ProposalList storageKey="omms-list-pending" proposals={many(12)} onChange={() => {}} />
  );
  expect(articles(html)).toBe(10);
});

it("counts added and removed lines from the proposal diff", () => {
  expect(diffStat(full)).toEqual({ added: 3, removed: 2 });
  // A new skill has no diff; every line of its content is new.
  expect(diffStat({ diff: null, content: "a\nb\nc" })).toEqual({ added: 3, removed: 0 });
  expect(diffStat({ diff: null, content: "" })).toEqual({ added: 0, removed: 0 });
});

it("offers more only when something is hidden", () => {
  const bare = { hasDiff: false, added: 0, removed: 0, evidenceTurnIds: [], summary: "Short." };
  expect(hasMoreDetail(proposal(bare))).toBe(false);
  expect(hasMoreDetail(proposal({ ...bare, summary: "x".repeat(161) }))).toBe(true);
  expect(hasMoreDetail(proposal({ ...bare, summary: "one\ntwo\nthree" }))).toBe(true);
  expect(hasMoreDetail(proposal({ ...bare, summary: "one\ntwo" }))).toBe(false);
  expect(hasMoreDetail(proposal({ ...bare, hasDiff: true, added: 3, removed: 2 }))).toBe(true);
  // A new skill has no diff; its content lines count as added.
  expect(hasMoreDetail(proposal({ ...bare, added: 3 }))).toBe(true);
  expect(hasMoreDetail(proposal({ ...bare, evidenceTurnIds: [4] }))).toBe(true);
});

it("collapses a card to header, clamped summary, diffstat, actions and Show more", () => {
  const html = card();
  expect(html).toContain("openspec-archive-change");
  expect(html).toContain(">pending<");
  expect(html).toContain("Improvement");
  expect(html).toContain("Created");
  expect(html).toContain("line-clamp-2");
  // The full summary stays in the markup for screen readers.
  expect(html).toContain(LONG.trim());
  expect(text(html)).toContain("+3 −2 lines");
  expect(html).not.toContain("data-line");
  expect(html).not.toContain("Evidence turns");
  expect(html).toContain(">Apply<");
  expect(html).toContain(">Reject<");
  expect(html).toMatch(/<button[^>]*aria-expanded="false"[^>]*aria-controls="[^"]+"[^>]*>/);
  expect(html).toContain("Show more");
  expect(html).not.toContain("Show less");
  expect(html).not.toContain("Show changes");
  const id = html.match(/aria-controls="([^"]+)"/)![1];
  expect(html).toContain(`id="${id}"`);
});

it("expands to the full summary, the diff, the evidence turns and Show less", () => {
  const html = card({}, true);
  expect(html).not.toContain("line-clamp-2");
  expect(html).toContain('data-line="del"');
  expect(html).toContain('data-line="add"');
  expect(html).toContain("Evidence turns");
  expect(html).toMatch(/<button[^>]*aria-expanded="true"[^>]*>/);
  expect(html).toContain("Show less");
  expect(html).not.toContain("Show more");
  expect(html).toContain(">Apply<");
  // One diff only, not the diff plus a folded copy.
  expect(html.match(/data-line="hunk"/g)).toHaveLength(1);
});

it("keeps Undo and the stale notice in view while collapsed", () => {
  const applied = card({ state: "applied", appliedBy: "person" });
  expect(applied).toContain(">Undo<");
  expect(applied).toContain("Show more");
  expect(applied).not.toContain("data-line");
  const stale = card({ state: "stale" });
  expect(stale).toContain("Stale: the file changed since this draft");
});

it("shows no button when the card has nothing to reveal", () => {
  const html = card({
    hasDiff: false,
    added: 0,
    removed: 0,
    evidenceTurnIds: [],
    summary: "Short.",
  });
  expect(html).not.toContain("aria-expanded");
  expect(html).not.toContain("Show more");
  expect(html).not.toContain("+0");
});

it("saves a page size only when the reader chose one", () => {
  const view = { perPage: 3, sort: "newest", order: "desc" } as const;
  expect(viewToSave(view, false)).toEqual({ sort: "newest", order: "desc" });
  expect(viewToSave(view, true)).toEqual({ perPage: 3, sort: "newest", order: "desc" });
});

it("follows a new default when the saved entry holds only a sort", () => {
  const store = new Map<string, string>([["k", JSON.stringify({ sort: "newest", order: "desc" })]]);
  g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem() {} };
  expect(initialView("k", PROPOSAL_SORTS, 3).perPage).toBe(3);
  expect(initialView("k", PROPOSAL_SORTS, 7).perPage).toBe(7);
});

it("starts the proposal lists at 3 even when an old key saved 5", () => {
  const store = new Map<string, string>([
    ["omms-list-pending", JSON.stringify({ perPage: 5, sort: "newest", order: "desc" })],
    ["omms-list-recent", JSON.stringify({ perPage: 5, sort: "newest", order: "desc" })],
    ["omms-list-skill-proposals", JSON.stringify({ perPage: 5, sort: "newest", order: "desc" })],
  ]);
  g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem() {} };
  for (const key of [PENDING_LIST_KEY, RECENT_LIST_KEY, SKILL_PROPOSALS_LIST_KEY]) {
    expect(initialView(key, PROPOSAL_SORTS, 3).perPage).toBe(3);
  }
  expect(PENDING_LIST_KEY).not.toBe("omms-list-pending");
  expect(RECENT_LIST_KEY).not.toBe("omms-list-recent");
  expect(SKILL_PROPOSALS_LIST_KEY).toBe("omms-list-skill-proposals-v2");
});
