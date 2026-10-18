import { describe, expect, it } from "bun:test";
import { rankFusion, RRF_K } from "../src/services/turso/rank-fusion.js";

interface Row {
  id: string;
  similarity: number;
  keywordScore?: number;
}

const row = (id: string, similarity: number, keywordScore?: number): Row => ({
  id,
  similarity,
  keywordScore,
});
const ids = (rows: Row[]) => rows.map((r) => r.id);
const options = { threshold: 0.5, limit: 10 };

describe("rankFusion", () => {
  it("returns the meaning list in order when no memory has a word match", () => {
    const rows = [row("a", 0.6), row("b", 0.9), row("c", 0.7)];
    expect(ids(rankFusion(rows, options))).toEqual(["b", "c", "a"]);
  });

  it("drops memories below the threshold when they have no word match", () => {
    const rows = [row("a", 0.9), row("low", 0.2)];
    expect(ids(rankFusion(rows, options))).toEqual(["a"]);
  });

  it("lets a word match below the threshold enter the results", () => {
    const rows = [row("a", 0.9), row("word", 0.2, 3)];
    expect(ids(rankFusion(rows, options))).toEqual(["a", "word"]);
  });

  it("ranks a memory in both lists above one that is in a single list", () => {
    // "both" is 2nd by meaning and 1st by words; "top" is 1st by meaning only.
    const rows = [row("top", 0.95), row("both", 0.8, 5), row("other", 0.7)];
    expect(ids(rankFusion(rows, options))[0]).toBe("both");
  });

  it("uses reciprocal rank with the published constant", () => {
    expect(RRF_K).toBe(60);
    // Rank 1 in both lists beats rank 1 in one list: 2/61 against 1/61.
    const rows = [row("both", 0.9, 4), row("meaning", 0.8), row("word", 0.1, 3)];
    expect(ids(rankFusion(rows, options))).toEqual(["both", "meaning", "word"]);
  });

  it("keeps each result's own similarity", () => {
    const rows = [row("a", 0.9), row("word", 0.2, 3)];
    const fused = rankFusion(rows, options);
    expect(fused.map((r) => r.similarity)).toEqual([0.9, 0.2]);
  });

  it("breaks ties by id so repeated searches agree", () => {
    // One memory only in each list, same rank: equal fused scores.
    const rows = [row("b", 0.9), row("a", 0.1, 3)];
    expect(ids(rankFusion(rows, options))).toEqual(["a", "b"]);
  });

  it("returns at most limit results", () => {
    const rows = Array.from({ length: 30 }, (_, index) => row(`m${index}`, 0.9 - index * 0.001));
    expect(rankFusion(rows, { threshold: 0.5, limit: 10 })).toHaveLength(10);
  });

  it("caps the word list", () => {
    const rows = Array.from({ length: 6 }, (_, index) => row(`w${index}`, 0.1, 10 - index));
    const fused = rankFusion(rows, { threshold: 0.5, limit: 10, wordLimit: 3 });
    expect(ids(fused)).toEqual(["w0", "w1", "w2"]);
  });

  it("ignores a keyword score of 0", () => {
    const rows = [row("a", 0.9), row("zero", 0.1, 0)];
    expect(ids(rankFusion(rows, options))).toEqual(["a"]);
  });

  it("returns nothing for no results", () => {
    expect(rankFusion([], options)).toEqual([]);
  });
});
