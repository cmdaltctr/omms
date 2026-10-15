import { describe, expect, it } from "bun:test";
import { ommsStatusLabel, STATUS_GLYPHS } from "../src/services/status-glyphs.js";

describe("OMMS footer status label", () => {
  it("shows one glyph per state after `omms: `", () => {
    expect(ommsStatusLabel("warming")).toBe("omms: ⧖");
    expect(ommsStatusLabel("connected")).toBe("omms: ✔");
    expect(ommsStatusLabel("recalling")).toBe("omms: ↻");
    expect(ommsStatusLabel("capturing")).toBe("omms: ✎");
    expect(ommsStatusLabel("error")).toBe("omms: ✘");
  });

  it("keeps the words on the two states that need an action", () => {
    expect(ommsStatusLabel("web app off")).toBe("omms: ✘ web app off");
    expect(ommsStatusLabel("not installed")).toBe("omms: ✘ not installed");
  });

  it("never asks for emoji presentation", () => {
    const labels = [
      ...Object.keys(STATUS_GLYPHS).map((state) =>
        ommsStatusLabel(state as keyof typeof STATUS_GLYPHS)
      ),
      ommsStatusLabel("web app off"),
      ommsStatusLabel("not installed"),
    ];
    for (const label of labels) expect(label).not.toContain("️");
  });
});
