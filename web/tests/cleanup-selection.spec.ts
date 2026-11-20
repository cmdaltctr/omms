import { expect, it } from "bun:test";
import {
  allIds,
  cleanAllIds,
  lowFrequencyIds,
  sameCategoryIds,
  selectedFirst,
  withToggled,
} from "../src/lib/cleanup-selection.ts";

const item = (id: string, category?: string) => ({ _id: id, category });

it("selects the items of every category that holds three or more", () => {
  const items = [
    item("a1", "git"),
    item("a2", "git"),
    item("a3", "git"),
    item("b1", "style"),
    item("b2", "style"),
  ];
  expect([...sameCategoryIds(items).ids].sort()).toEqual(["a1", "a2", "a3"]);
});

it("does not treat items without a category as one category", () => {
  const items = [
    item("n1"),
    item("n2", ""),
    item("n3", undefined),
    item("n4", "   "),
    item("g1", "git"),
  ];
  expect([...sameCategoryIds(items).ids]).toEqual([]);
});

it("still selects a real category when uncategorised items sit beside it", () => {
  const items = [item("n1"), item("n2"), item("n3"), item("g1", "git"), item("g2", "git")];
  expect([...sameCategoryIds(items).ids]).toEqual([]);
  expect([...sameCategoryIds([...items, item("g3", "git")]).ids].sort()).toEqual([
    "g1",
    "g2",
    "g3",
  ]);
});

it("matches category names exactly", () => {
  const items = [item("a", "Git"), item("b", "git"), item("c", "git ")];
  expect([...sameCategoryIds(items).ids]).toEqual([]);
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

const mem = (id: string, frequency: number, category?: string) => ({
  _id: id,
  frequency,
  category,
});

it("Low Freq picks unchecked memories of frequency 3 or less and counts the checked ones", () => {
  const items = Array.from({ length: 1000 }, (_, i) => mem(`m${i}`, i < 800 ? 3 : 4));
  const checked = new Set(items.slice(0, 500).map((it) => it._id));
  const result = lowFrequencyIds(items, checked);
  expect(result.ids.size).toBe(300);
  expect(result.ids.has("m500")).toBe(true);
  expect(result.ids.has("m0")).toBe(false);
  expect(result.skipped).toBe(500);
});

it("Same Category counts every memory of a category but picks only unchecked ones", () => {
  const items = [
    mem("a1", 9, "git"),
    mem("a2", 9, "git"),
    mem("a3", 9, "git"),
    mem("a4", 9, "git"),
    mem("a5", 9, "git"),
    mem("b1", 9, "style"),
    mem("b2", 9, "style"),
  ];
  const result = sameCategoryIds(items, new Set(["a1", "a2", "a3"]));
  expect([...result.ids].sort()).toEqual(["a4", "a5"]);
  expect(result.skipped).toBe(3);
});

it("Same Category skips a category of 2 memories", () => {
  const items = [mem("b1", 9, "style"), mem("b2", 9, "style")];
  expect(sameCategoryIds(items, new Set()).ids.size).toBe(0);
});

it("Clean All combines Low Freq and Same Category and counts each skipped memory once", () => {
  const items = [
    mem("low", 1, "solo"),
    mem("lowChecked", 1, "git"),
    mem("g2", 9, "git"),
    mem("g3", 9, "git"),
    mem("highSolo", 9, "other"),
    mem("highChecked", 9, "pair"),
  ];
  const checked = new Set(["lowChecked", "highChecked"]);
  const result = cleanAllIds(items, checked);
  expect([...result.ids].sort()).toEqual(["g2", "g3", "low"]);
  // lowChecked matches both rules and counts once; highChecked matches neither.
  expect(result.skipped).toBe(1);
});

it("Select All picks every memory, checked ones too, and skips none", () => {
  const items = [mem("a", 1), mem("b", 9)];
  const result = allIds(items);
  expect([...result.ids]).toEqual(["a", "b"]);
  expect(result.skipped).toBe(0);
});

it("gives the old results when nothing is checked", () => {
  const items = [mem("a", 1, "git"), mem("b", 5, "git"), mem("c", 9, "git"), mem("d", 9)];
  expect([...lowFrequencyIds(items).ids]).toEqual(["a"]);
  expect([...sameCategoryIds(items).ids].sort()).toEqual(["a", "b", "c"]);
  expect(lowFrequencyIds(items).skipped).toBe(0);
});
