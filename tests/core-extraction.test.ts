import { describe, expect, it } from "bun:test";
import { parseCaptureSummary } from "../src/core/extraction.js";

describe("capture summary parsing", () => {
  it("accepts a bare skip reply", () => {
    expect(parseCaptureSummary('{"type":"skip"}')).toEqual({
      summary: "",
      type: "skip",
      tags: [],
    });
  });

  it("rejects a non-skip reply without a meaningful summary", () => {
    expect(parseCaptureSummary('{"type":"feature"}')).toBeNull();
    expect(parseCaptureSummary('{"type":"feature","summary":"  ","tags":[]}')).toBeNull();
  });

  it("still parses fenced and embedded JSON", () => {
    expect(parseCaptureSummary('```json\n{"type":"skip"}\n```')?.type).toBe("skip");
    expect(parseCaptureSummary('Reply: {"type":"feature","summary":"Added tests"}.')?.summary).toBe(
      "Added tests"
    );
  });
});
