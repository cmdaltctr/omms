import { describe, expect, it } from "bun:test";
import {
  classifyCaptureReply,
  normalizeStopReason,
  parseCaptureSummary,
} from "../src/core/extraction.js";

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

describe("capture reply classification", () => {
  it("returns null for a valid summary or a skip", () => {
    expect(classifyCaptureReply({ text: '{"type":"skip"}' })).toBeNull();
    expect(classifyCaptureReply({ text: '{"type":"feature","summary":"Added tests"}' })).toBeNull();
  });

  it("reports a reply with no text as empty-text", () => {
    expect(classifyCaptureReply({ text: "", stopReason: "stop" })).toBe("empty-text");
    expect(classifyCaptureReply({ text: "  \n", stopReason: "length" })).toBe("empty-text");
  });

  it("reports cut-off JSON after a length stop as truncated", () => {
    expect(classifyCaptureReply({ text: '{"type":"feature","summ', stopReason: "length" })).toBe(
      "truncated"
    );
    expect(classifyCaptureReply({ text: '{"type":"feat', stopReason: "max_tokens" })).toBe(
      "truncated"
    );
  });

  it("reports prose as invalid-json", () => {
    expect(classifyCaptureReply({ text: "I summarised the work.", stopReason: "stop" })).toBe(
      "invalid-json"
    );
  });

  it("reports JSON with the wrong shape as schema-mismatch", () => {
    expect(classifyCaptureReply({ text: '{"summary":"","type":"feature"}' })).toBe(
      "schema-mismatch"
    );
  });

  it("normalizes length stop reasons", () => {
    expect(normalizeStopReason("MAX_TOKENS")).toBe("length");
    expect(normalizeStopReason("end_turn")).toBe("end_turn");
    expect(normalizeStopReason(undefined)).toBeUndefined();
  });
});
