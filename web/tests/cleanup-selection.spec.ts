import { expect, it } from "bun:test";
import { sameCategoryIds } from "../src/lib/cleanup-selection.ts";

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
