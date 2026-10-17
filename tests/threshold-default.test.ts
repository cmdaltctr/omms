import { describe, expect, it } from "bun:test";
import { defaultSimilarityThreshold } from "../src/utils/threshold-default.js";

describe("defaultSimilarityThreshold", () => {
  it("gives the measured embedder and its aliases 0.5 in any case", () => {
    expect(defaultSimilarityThreshold("qwen3-embedding:0.6b")).toBe(0.5);
    expect(defaultSimilarityThreshold("QWEN3-EMBEDDING:0.6B")).toBe(0.5);
    expect(defaultSimilarityThreshold("Qwen/Qwen3-Embedding-0.6B")).toBe(0.5);
    expect(defaultSimilarityThreshold("qwen/qwen3-embedding-0.6b-gguf:Q8_0")).toBe(0.5);
  });

  it("gives every other embedder, an empty name, and an unknown name 0.6", () => {
    expect(defaultSimilarityThreshold("Xenova/nomic-embed-text-v1")).toBe(0.6);
    expect(defaultSimilarityThreshold("")).toBe(0.6);
    expect(defaultSimilarityThreshold("some/future-embedder")).toBe(0.6);
    expect(defaultSimilarityThreshold(undefined)).toBe(0.6);
  });
});
