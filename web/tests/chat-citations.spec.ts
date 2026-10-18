import { expect, it } from "bun:test";
import { citedLabels, splitCitations } from "../src/lib/chat-citations.ts";

const labels = ["S1", "S2", "P1"];

it("splits text and citation markers into parts", () => {
  expect(splitCitations("Use npm [S1] and keep it [P1][S2].", labels)).toEqual([
    { kind: "text", text: "Use npm " },
    { kind: "cite", label: "S1" },
    { kind: "text", text: " and keep it " },
    { kind: "cite", label: "P1" },
    { kind: "cite", label: "S2" },
    { kind: "text", text: "." },
  ]);
});

it("keeps unknown markers as plain text", () => {
  expect(splitCitations("Claim [S9] and [x].", labels)).toEqual([
    { kind: "text", text: "Claim [S9] and [x]." },
  ]);
});

it("keeps markup as text", () => {
  expect(splitCitations("<b>bold</b> [S1]", labels)).toEqual([
    { kind: "text", text: "<b>bold</b> " },
    { kind: "cite", label: "S1" },
  ]);
});

it("lists cited labels in order of first use", () => {
  expect(citedLabels("A [S2] b [S1] c [S2] [S7]", labels)).toEqual(["S2", "S1"]);
});
