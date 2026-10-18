import { expect, it } from "bun:test";
import { evidenceItems } from "../src/lib/profile-utils.ts";

it("keeps a list of evidence in stored order", () => {
  expect(evidenceItems({ evidence: ["first", "second"] } as never)).toEqual([
    { kind: "text", text: "first" },
    { kind: "text", text: "second" },
  ]);
});

it("treats evidence stored as one string as one item", () => {
  expect(evidenceItems({ evidence: "only one" } as never)).toEqual([
    { kind: "text", text: "only one" },
  ]);
});

it("returns no items when there is no evidence", () => {
  expect(evidenceItems({} as never)).toEqual([]);
  expect(evidenceItems({ evidence: [] } as never)).toEqual([]);
  expect(evidenceItems({ evidence: "" } as never)).toEqual([]);
});

it("marks the manual-write marker so it can show as a label", () => {
  expect(
    evidenceItems({ evidence: ["manual-write", "Use npm for JavaScript projects"] } as never)
  ).toEqual([
    { kind: "manual-write", text: "manual-write" },
    { kind: "text", text: "Use npm for JavaScript projects" },
  ]);
});

it("skips blank entries", () => {
  expect(evidenceItems({ evidence: ["a", "  ", "b"] } as never)).toEqual([
    { kind: "text", text: "a" },
    { kind: "text", text: "b" },
  ]);
});
