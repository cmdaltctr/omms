import { describe, expect, it } from "bun:test";
import { citedLabels, splitCitations } from "../web/src/lib/chat-citations.ts";

describe("splitCitations", () => {
  it("turns a known [K1] marker into a citation", () => {
    expect(splitCitations("Alpha fails [K1].", ["K1"])).toEqual([
      { kind: "text", text: "Alpha fails " },
      { kind: "cite", label: "K1" },
      { kind: "text", text: "." },
    ]);
  });

  it("leaves a [K9] marker for an unknown source as text", () => {
    expect(splitCitations("See [K9].", ["K1"])).toEqual([{ kind: "text", text: "See [K9]." }]);
  });

  it("lists K labels in order of first use", () => {
    expect(citedLabels("[S1] then [K2] then [K1] then [K2]", ["S1", "K1", "K2"])).toEqual([
      "S1",
      "K2",
      "K1",
    ]);
  });
});
