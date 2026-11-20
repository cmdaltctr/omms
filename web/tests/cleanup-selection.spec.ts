import { expect, it } from "bun:test";
import { sameCategoryIds, selectedFirst, withToggled } from "../src/lib/cleanup-selection.ts";

const item = (id: string, category?: string) => ({ _id: id, category });

it("selects the items of every category that holds three or more", () => {
  const items = [
    item("a1", "git"),
    item("a2", "git"),
    item("a3", "git"),
    item("b1", "style"),
    item("b2", "style"),
  ];
  expect([...sameCategoryIds(items)].sort()).toEqual(["a1", "a2", "a3"]);
});

it("does not treat items without a category as one category", () => {
  const items = [
    item("n1"),
    item("n2", ""),
    item("n3", undefined),
    item("n4", "   "),
    item("g1", "git"),
  ];
  expect([...sameCategoryIds(items)]).toEqual([]);
});

it("still selects a real category when uncategorised items sit beside it", () => {
  const items = [item("n1"), item("n2"), item("n3"), item("g1", "git"), item("g2", "git")];
  expect([...sameCategoryIds(items)]).toEqual([]);
  expect([...sameCategoryIds([...items, item("g3", "git")])].sort()).toEqual(["g1", "g2", "g3"]);
});

it("matches category names exactly", () => {
  const items = [item("a", "Git"), item("b", "git"), item("c", "git ")];
  expect([...sameCategoryIds(items)]).toEqual([]);
});

it("adds or removes one value and leaves the original set alone", () => {
  const before = new Set(["a"]);
  expect(withToggled(before, "b", true)).toEqual(new Set(["a", "b"]));
  expect(withToggled(before, "a", false)).toEqual(new Set());
  expect(before).toEqual(new Set(["a"]));
});

it("puts categories with a selected item first, and selected items first inside each", () => {
  const groups = [
    { key: "alpha", items: [item("a1"), item("a2")] },
    { key: "beta", items: [item("b1"), item("b2"), item("b3")] },
    { key: "gamma", items: [item("c1")] },
  ];
  const ordered = selectedFirst(groups, new Set(["b3", "c1"]));
  expect(ordered.map((g) => g.key)).toEqual(["beta", "gamma", "alpha"]);
  expect(ordered[0]!.items.map((i) => i._id)).toEqual(["b3", "b1", "b2"]);
  expect(ordered[2]!.items.map((i) => i._id)).toEqual(["a1", "a2"]);
});

it("keeps the original order when nothing or everything is selected", () => {
  const groups = [
    { key: "alpha", items: [item("a1"), item("a2")] },
    { key: "beta", items: [item("b1")] },
  ];
  const flat = (gs: typeof groups) => gs.flatMap((g) => g.items.map((i) => i._id));
  expect(flat(selectedFirst(groups, new Set()))).toEqual(["a1", "a2", "b1"]);
  expect(flat(selectedFirst(groups, new Set(["a1", "a2", "b1"])))).toEqual(["a1", "a2", "b1"]);
});
