import { afterEach, expect, it } from "bun:test";
import {
  clampPage,
  getPageRange,
  paginate,
  parseCustomSize,
  readView,
  saveView,
  serverWindow,
  sizeOptions,
  sortItems,
} from "../src/lib/components/paged-list/paging.ts";
import { PROPOSAL_SORTS, SKILL_SORTS } from "../src/lib/skills-sorts.ts";

const g = globalThis as { localStorage?: unknown };
const original = g.localStorage;
afterEach(() => {
  g.localStorage = original;
});

it("slides a window of page numbers with gaps, always showing the first and last page", () => {
  expect(getPageRange(1, 1)).toEqual([]);
  expect(getPageRange(1, 5)).toEqual([1, 2, 3, 4, 5]);
  expect(getPageRange(1, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  expect(getPageRange(1, 11)).toEqual([1, 2, 3, 4, 5, "...", 11]);
  expect(getPageRange(6, 11)).toEqual([1, "...", 5, 6, 7, "...", 11]);
  expect(getPageRange(11, 11)).toEqual([1, "...", 7, 8, 9, 10, 11]);
});

it("keeps the page inside the list when the data shrinks", () => {
  expect(clampPage(4, 12, 5)).toBe(3);
  expect(clampPage(0, 12, 5)).toBe(1);
  expect(clampPage(2, 0, 5)).toBe(1);
  const page = paginate(
    Array.from({ length: 12 }, (_, i) => i),
    9,
    5
  );
  expect(page).toMatchObject({ page: 3, pageCount: 3, from: 11, to: 12, total: 12 });
  expect(page.items).toEqual([10, 11]);
  expect(paginate([], 1, 5)).toMatchObject({ from: 0, to: 0, pageCount: 1, items: [] });
});

it("clamps a custom size to 1–200 and snaps back on text that is not a size", () => {
  expect(parseCustomSize("7", 5)).toBe(7);
  expect(parseCustomSize("999", 5)).toBe(200);
  expect(parseCustomSize("0", 5)).toBe(5);
  expect(parseCustomSize("-3", 10)).toBe(10);
  expect(parseCustomSize("abc", 10)).toBe(10);
  expect(parseCustomSize("", 25)).toBe(25);
});

it("shows a custom size in the menu in its sorted place", () => {
  expect(sizeOptions(5)).toEqual([3, 5, 10, 25, 50, 100]);
  expect(sizeOptions(3)).toEqual([3, 5, 10, 25, 50, 100]);
  expect(sizeOptions(7)).toEqual([3, 5, 7, 10, 25, 50, 100]);
  expect(sizeOptions(200)).toEqual([3, 5, 10, 25, 50, 100, 200]);
});

it("sorts both ways and keeps rows that tie in their input order", () => {
  const rows = [
    { id: "a", n: 2 },
    { id: "b", n: 1 },
    { id: "c", n: 2 },
    { id: "d", n: 1 },
  ];
  const by = (a: { n: number }, b: { n: number }) => a.n - b.n;
  expect(sortItems(rows, by, "asc").map((r) => r.id)).toEqual(["b", "d", "a", "c"]);
  expect(sortItems(rows, by, "desc").map((r) => r.id)).toEqual(["a", "c", "b", "d"]);
  expect(rows.map((r) => r.id)).toEqual(["a", "b", "c", "d"]);
});

it("asks the server for the matching window from the end for an oldest-first view", () => {
  expect(serverWindow(1, 5, 12, false)).toEqual({ offset: 0, limit: 5 });
  expect(serverWindow(3, 5, 12, false)).toEqual({ offset: 10, limit: 5 });
  expect(serverWindow(1, 5, 12, true)).toEqual({ offset: 7, limit: 5 });
  expect(serverWindow(3, 5, 12, true)).toEqual({ offset: 0, limit: 2 });
  expect(serverWindow(1, 5, 0, true)).toEqual({ offset: 0, limit: 5 });
});

it("saves the page size per list and survives blocked storage", () => {
  const store = new Map<string, string>();
  g.localStorage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
  };
  saveView("list-a", { perPage: 25, sort: "name", order: "asc" });
  expect(readView("list-a")).toEqual({ perPage: 25, sort: "name", order: "asc" });
  expect(readView("list-b")).toBeNull();
  store.set("list-c", "{not json");
  expect(readView("list-c")).toBeNull();
  g.localStorage = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };
  expect(readView("list-a")).toBeNull();
  expect(() => saveView("list-a", { perPage: 5 })).not.toThrow();
});

it("starts each skill and proposal sort in its natural direction", () => {
  const first = Object.fromEntries(SKILL_SORTS.map((o) => [o.value, o.first]));
  expect(first).toEqual({
    uses: "desc",
    attention: "desc",
    name: "asc",
    lastUsed: "desc",
    failed: "desc",
    lastModified: "desc",
  });
  expect(PROPOSAL_SORTS.map((o) => o.value)).toEqual(["newest", "oldest", "state", "skill"]);
  const name = SKILL_SORTS.find((o) => o.value === "name")!;
  const rows = [{ name: "beta" }, { name: "Alpha" }] as Parameters<typeof name.compare>[0][];
  expect(sortItems(rows, name.compare, "asc").map((r) => r.name)).toEqual(["Alpha", "beta"]);
});
