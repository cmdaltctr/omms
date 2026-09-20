import { describe, expect, it } from "bun:test";
import {
  buildCaptureSystemPrompt,
  captureSummarySchema,
  captureSummaryToolSchema,
  parseCaptureSummary,
} from "../src/core/extraction.js";

describe("shared capture extraction contract", () => {
  it("builds the system prompt for the target language", () => {
    const prompt = buildCaptureSystemPrompt("English");
    expect(prompt).toContain("technical memory recorder");
    expect(prompt).toContain("You MUST write the summary in English.");
  });

  it("parses a plain JSON payload and normalises tags", () => {
    const result = parseCaptureSummary(
      JSON.stringify({ summary: "did a thing", type: "feature", tags: ["Auth ", "Bug-Fix"] })
    );
    expect(result).toEqual({ summary: "did a thing", type: "feature", tags: ["auth", "bug-fix"] });
  });

  it("parses a fenced json code block with surrounding prose", () => {
    const result = parseCaptureSummary(
      'Here is the summary:\n```json\n{"summary":"ok","type":"discussion","tags":["a"]}\n```\nDone.'
    );
    expect(result?.summary).toBe("ok");
  });

  it("parses a bare JSON object embedded in prose", () => {
    const result = parseCaptureSummary(
      'Sure! {"summary":"embedded","type":"other","tags":[]} hope that helps'
    );
    expect(result?.summary).toBe("embedded");
  });

  it("returns null for payloads that do not satisfy the schema", () => {
    expect(parseCaptureSummary("no json here")).toBeNull();
    expect(parseCaptureSummary(JSON.stringify({ summary: "missing fields" }))).toBeNull();
    expect(
      parseCaptureSummary(JSON.stringify({ summary: "s", type: "t", tags: "not-an-array" }))
    ).toBeNull();
  });

  it("shares one schema between validation and the request description", () => {
    expect(captureSummarySchema.safeParse({ summary: "s", type: "t", tags: [] }).success).toBe(
      true
    );
    expect(captureSummaryToolSchema.required).toEqual(["summary", "type", "tags"]);
  });
});
