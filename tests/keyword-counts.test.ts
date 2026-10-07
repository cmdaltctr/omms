import { expect, it } from "bun:test";
import { countKeywords } from "../src/services/keyword-counts.js";

it("counts each label once per memory and sorts by count then name", () => {
  expect(countKeywords(["npm, ci-cd", "npm", "ci-cd, npm", "docs"])).toEqual([
    { keyword: "npm", count: 3 },
    { keyword: "ci-cd", count: 2 },
    { keyword: "docs", count: 1 },
  ]);
});

it("merges labels that differ only in case or spacing", () => {
  expect(countKeywords(["OpenSpec", " openspec ", "OPENSPEC, ui"])).toEqual([
    { keyword: "openspec", count: 3 },
    { keyword: "ui", count: 1 },
  ]);
});

it("counts a label repeated inside one memory once", () => {
  expect(countKeywords(["npm, NPM, npm"])).toEqual([{ keyword: "npm", count: 1 }]);
});

it("ignores empty, null and undefined tag fields", () => {
  expect(countKeywords(["", null, undefined, " , ", "a"])).toEqual([{ keyword: "a", count: 1 }]);
});
