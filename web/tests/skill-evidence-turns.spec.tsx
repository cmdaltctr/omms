import { expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { EvidenceTurnsView, evidenceView } from "../src/lib/components/skills/EvidenceTurns.tsx";
import type { TurnSummary } from "../src/lib/skills-api.ts";

const turns = (n: number): TurnSummary[] =>
  Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    createdAt: 1000 + i,
    host: "pi",
    projectName: null,
    promptPreview: `evidence prompt ${i + 1} `,
    failedToolCalls: 0,
  }));

const render = (n: number, expanded = false, page = 1) =>
  renderToStaticMarkup(
    <EvidenceTurnsView
      turns={turns(n)}
      expanded={expanded}
      page={page}
      onToggle={() => {}}
      onPage={() => {}}
    />
  );
const shown = (html: string) => [...html.matchAll(/evidence prompt (\d+) /g)].map((m) => +m[1]!);

it("shows 3 turns and no button when there are 3 or fewer", () => {
  for (const n of [1, 3]) {
    const html = render(n);
    expect(shown(html)).toHaveLength(n);
    expect(html).not.toContain("aria-expanded");
  }
});

it("shows 3 turns and Show N more when there are more", () => {
  const four = render(4);
  expect(shown(four)).toEqual([1, 2, 3]);
  expect(four).toContain("Show 1 more");
  expect(four).toContain('aria-expanded="false"');
  // The button promises at most 3 more, even for a long list.
  expect(render(6)).toContain("Show 3 more");
  const nine = render(9);
  expect(shown(nine)).toEqual([1, 2, 3]);
  expect(nine).toContain("Show 3 more");
  expect(nine).not.toContain("Showing");
});

it("shows all 6 turns when expanded, with Show less and no pagination", () => {
  const html = render(6, true);
  expect(shown(html)).toEqual([1, 2, 3, 4, 5, 6]);
  expect(html).toContain("Show less");
  expect(html).toContain('aria-expanded="true"');
  expect(html).not.toContain("Showing");
  expect(html).not.toContain('aria-label="pagination"');
});

it("pages the expanded view 6 to a page with the shared footer when there are 7 or more", () => {
  const first = render(13, true, 1);
  expect(shown(first)).toEqual([1, 2, 3, 4, 5, 6]);
  expect(first).toContain("Showing 1 to 6 of 13 results");
  expect(first).toContain('aria-label="pagination"');
  expect(first).toContain("Show less");
  const second = render(13, true, 2);
  expect(shown(second)).toEqual([7, 8, 9, 10, 11, 12]);
  expect(second).toContain("Showing 7 to 12 of 13 results");
  const last = render(13, true, 3);
  expect(shown(last)).toEqual([13]);
  expect(render(7, true)).toContain("Showing 1 to 6 of 7 results");
});

it("keeps the shared toolbar out of the evidence list", () => {
  const html = render(13, true);
  expect(html).not.toContain("Results per page");
  expect(html).not.toContain("Sort by");
});

it("describes the view as numbers the component renders", () => {
  expect(evidenceView(turns(2), false, 1)).toMatchObject({ canExpand: false, moreCount: 0 });
  expect(evidenceView(turns(9), false, 1)).toMatchObject({ canExpand: true, moreCount: 3 });
  expect(evidenceView(turns(4), false, 1).moreCount).toBe(1);
  expect(evidenceView(turns(9), true, 2).items.map((t) => t.id)).toEqual([7, 8, 9]);
  // A page past the end falls back to the last page.
  expect(evidenceView(turns(9), true, 5).items.map((t) => t.id)).toEqual([7, 8, 9]);
});
