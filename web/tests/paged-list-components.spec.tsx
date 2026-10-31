import { expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PagedFooter } from "../src/lib/components/paged-list/PagedFooter.tsx";
import { PagedList } from "../src/lib/components/paged-list/PagedList.tsx";
import { PagedListControls } from "../src/lib/components/paged-list/PagedListControls.tsx";
import { pageWindow } from "../src/lib/components/paged-list/paging.ts";
import type { PagingView } from "../src/lib/components/paged-list/use-paging.ts";
import { TIME_SORTS, type TimeSort } from "../src/lib/skills-sorts.ts";

const view = (page: number, total: number, over: Partial<PagingView<TimeSort>> = {}) => ({
  ...pageWindow(page, over.perPage ?? 5, total),
  perPage: 5,
  sort: "newest" as TimeSort,
  order: "desc" as const,
  sorts: TIME_SORTS,
  setPage: () => {},
  setPerPage: () => {},
  setSort: () => {},
  ...over,
});

it("lays out Show, Custom and Sort by with their labels and the total on the right", () => {
  const html = renderToStaticMarkup(
    <PagedListControls view={view(1, 25)} totalLabel="25 skills" />
  );
  expect(html).toContain(">Show<");
  expect(html).toContain(">results<");
  expect(html).toContain(">Custom:<");
  expect(html).toContain(">Sort by<");
  expect(html).toContain('aria-label="Results per page"');
  expect(html).toContain('aria-label="Custom results per page"');
  expect(html).toContain('aria-label="Sort by"');
  expect(html).toContain('aria-label="Sort ascending"');
  expect(html).toContain("Newest");
  expect(html).toContain("25 skills");
  const ascending = renderToStaticMarkup(
    <PagedListControls view={view(1, 25, { order: "asc" })} totalLabel="" />
  );
  expect(ascending).toContain('aria-label="Sort descending"');
});

it("shows a custom page size in the size menu", () => {
  const html = renderToStaticMarkup(
    <PagedListControls view={view(1, 25, { perPage: 7 })} totalLabel="" />
  );
  expect(html).toContain('value="7"');
  expect(html).toMatch(/aria-label="Results per page"[^>]*>.*?>7</);
});

it("says which rows show and marks the current page", () => {
  const html = renderToStaticMarkup(<PagedFooter view={view(2, 25)} />);
  expect(html).toContain("Showing 6 to 10 of 25 results");
  expect(html).toContain('aria-label="pagination"');
  expect(button(html, "Go to page 2")).toContain('aria-current="page"');
  expect(button(html, "Go to page 1")).not.toContain("aria-current");
  expect(html).toContain('aria-label="Go to page 5"');
  expect(html).not.toContain('disabled=""');
});

it("renders no footer when the list fits on one page", () => {
  expect(renderToStaticMarkup(<PagedFooter view={view(1, 5)} />)).toBe("");
  expect(renderToStaticMarkup(<PagedFooter view={view(1, 0)} />)).toBe("");
});

/** The opening tag of the button with this accessible name. */
const button = (html: string, label: string) =>
  html.match(new RegExp(`<button[^>]*aria-label="${label}"[^>]*>`))?.[0] ?? "";

it("disables Previous on the first page and Next on the last, out of the tab order", () => {
  const first = renderToStaticMarkup(<PagedFooter view={view(1, 25)} />);
  expect(button(first, "Go to previous page")).toContain('disabled=""');
  expect(button(first, "Go to previous page")).toContain('aria-disabled="true"');
  expect(button(first, "Go to next page")).not.toContain('disabled=""');
  const last = renderToStaticMarkup(<PagedFooter view={view(5, 25)} />);
  expect(button(last, "Go to next page")).toContain('disabled=""');
  expect(button(last, "Go to previous page")).not.toContain('disabled=""');
  expect(last).toContain("Showing 21 to 25 of 25 results");
});

it("puts the toolbar, the rows and the footer in one block", () => {
  const html = renderToStaticMarkup(
    <PagedList view={view(1, 12)} totalLabel="12 turns">
      <ul>
        <li>row</li>
      </ul>
    </PagedList>
  );
  expect(html.indexOf("Results per page")).toBeLessThan(html.indexOf("<li>row</li>"));
  expect(html.indexOf("<li>row</li>")).toBeLessThan(html.indexOf("Showing 1 to 5 of 12 results"));
});
