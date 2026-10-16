import { expect, it } from "bun:test";
import {
  categoriesAfter,
  groupsToApply,
  initiallyAccepted,
  toggled,
} from "../src/lib/category-cleanup-groups.ts";

const group = (checked: boolean, ...labels: string[]) => ({
  checked,
  name: labels[0]!,
  labels: labels.map((label) => ({ label, count: 1 })),
});

it("starts only the groups the model checked as accepted", () => {
  const groups = [group(true, "a", "b"), group(false, "c", "d"), group(true, "e", "f", "g")];
  expect([...initiallyAccepted(groups)]).toEqual([0, 2]);
});

it("starts nothing accepted when the model checked no group", () => {
  expect([...initiallyAccepted([group(false, "a", "b"), group(false, "c", "d")])]).toEqual([]);
});

it("counts the categories after only for the accepted groups", () => {
  const groups = [group(true, "a", "b"), group(false, "c", "d", "e"), group(true, "f", "g")];
  expect(categoriesAfter(100, groups, initiallyAccepted(groups))).toBe(98);
  expect(categoriesAfter(100, groups, new Set([0, 1, 2]))).toBe(96);
  expect(categoriesAfter(100, groups, new Set())).toBe(100);
});

it("sends an unchecked group only after the user accepts it", () => {
  const groups = [group(true, "a", "b"), group(false, "c", "d")];
  const names = ["Alpha", "Gamma"];
  const accepted = initiallyAccepted(groups);
  expect(groupsToApply(groups, accepted, names)).toEqual([{ labels: ["a", "b"], name: "Alpha" }]);
  const ticked = toggled(accepted, 1);
  expect(groupsToApply(groups, ticked, names)).toEqual([
    { labels: ["a", "b"], name: "Alpha" },
    { labels: ["c", "d"], name: "Gamma" },
  ]);
  expect(groupsToApply(groups, toggled(ticked, 1), names)).toEqual([
    { labels: ["a", "b"], name: "Alpha" },
  ]);
});

it("does not change the set it toggles", () => {
  const before = new Set([0]);
  toggled(before, 1);
  expect([...before]).toEqual([0]);
});
