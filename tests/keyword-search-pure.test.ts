import { describe, expect, it } from "bun:test";
import { applyKeywordBoost, buildKeywordQuery } from "../src/services/turso/keyword-search.js";

describe("buildKeywordQuery", () => {
  it("lower-cases and splits an identifier into its parts", () => {
    expect(buildKeywordQuery("why did we write ADR-023")).toBe('"write" OR "adr" OR "023"');
  });

  it("drops one-character words", () => {
    expect(buildKeywordQuery("a b c deploy x")).toBe('"deploy"');
  });

  it("quotes every term and removes repeats", () => {
    expect(buildKeywordQuery("deploy Deploy DEPLOY")).toBe('"deploy"');
  });

  it("returns null when no usable term is left", () => {
    expect(buildKeywordQuery("")).toBeNull();
    expect(buildKeywordQuery(undefined)).toBeNull();
    expect(buildKeywordQuery("a - ? !! the of")).toBeNull();
  });

  it("never turns query text into index syntax", () => {
    const query = buildKeywordQuery('"deploy" * (NEAR AND OR NOT) title:secret');
    expect(query).not.toBeNull();
    // Every term sits in its own pair of quotes, joined only by OR.
    for (const part of (query as string).split(" OR ")) {
      expect(part).toMatch(/^"[\p{L}\p{N}]+"$/u);
    }
  });

  it("caps the number of terms", () => {
    const words = Array.from({ length: 60 }, (_, index) => `word${index}`).join(" ");
    expect((buildKeywordQuery(words) as string).split(" OR ")).toHaveLength(24);
  });
});

describe("applyKeywordBoost", () => {
  it("adds keywordBoost times the share of the best score", () => {
    expect(applyKeywordBoost(0.5, 2, 4, 0.2)).toBeCloseTo(0.6, 10);
    expect(applyKeywordBoost(0.5, 4, 4, 0.2)).toBeCloseTo(0.7, 10);
  });

  it("changes nothing when keywordBoost is 0", () => {
    expect(applyKeywordBoost(0.5, 4, 4, 0)).toBe(0.5);
  });

  it("changes nothing without a keyword match", () => {
    expect(applyKeywordBoost(0.5, 0, 4, 0.3)).toBe(0.5);
    expect(applyKeywordBoost(0.5, 3, 0, 0.3)).toBe(0.5);
  });

  it("never passes 1", () => {
    expect(applyKeywordBoost(0.95, 4, 4, 0.5)).toBe(1);
  });

  it("never adds more than keywordBoost", () => {
    // A score above the best score must not lift the boost past the setting.
    expect(applyKeywordBoost(0.1, 9, 3, 0.2)).toBeCloseTo(0.3, 10);
  });
});
