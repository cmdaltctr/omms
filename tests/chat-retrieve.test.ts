import { describe, expect, it } from "bun:test";
import {
  MAX_MEMORY_SOURCES,
  MAX_PROFILE_SOURCES,
  retrieveSources,
  type MemoryHit,
  type ProfileCandidate,
} from "../src/services/chat/chat-retrieve.js";

const plan = { queries: ["q1", "q2"], tags: ["bun", "npm"], profileCategories: [], skipped: false };

function hit(id: string, similarity: number): MemoryHit {
  return { id, memory: `text ${id}`, similarity, tags: ["t"], containerTag: "p_a" };
}

function deps(
  results: Record<string, MemoryHit[]>,
  profile: ProfileCandidate[] = [],
  calls: Array<{ query: string; scope: string | null }> = []
) {
  return {
    searchMemories: async (query: string, scope: string | null) => {
      calls.push({ query, scope });
      return results[query] ?? [];
    },
    embed: async () => [1, 0],
    profileItems: async () => profile,
  };
}

describe("retrieveSources", () => {
  it("searches once per query and once with the tags, in the given scope", async () => {
    const calls: Array<{ query: string; scope: string | null }> = [];
    await retrieveSources("question", plan, "p_a", deps({}, [], calls));
    expect(calls).toEqual([
      { query: "q1", scope: "p_a" },
      { query: "q2", scope: "p_a" },
      { query: "bun npm", scope: "p_a" },
    ]);

    const allCalls: Array<{ query: string; scope: string | null }> = [];
    await retrieveSources("question", { ...plan, tags: [] }, null, deps({}, [], allCalls));
    expect(allCalls).toEqual([
      { query: "q1", scope: null },
      { query: "q2", scope: null },
    ]);
  });

  it("merges by id, keeps the best score, and sorts by score", async () => {
    const out = await retrieveSources(
      "question",
      plan,
      "p_a",
      deps({ q1: [hit("a", 0.5), hit("b", 0.7)], q2: [hit("a", 0.9)] })
    );
    expect(out.memories.map((m) => [m.id, m.score])).toEqual([
      ["a", 0.9],
      ["b", 0.7],
    ]);
    expect(out.memories[0]).toMatchObject({ kind: "memory", text: "text a", projectTag: "p_a" });
  });

  it("keeps at most 12 memories", async () => {
    const many = Array.from({ length: 20 }, (_, i) => hit(`m${i}`, i / 20));
    const out = await retrieveSources("question", plan, "p_a", deps({ q1: many }));
    expect(MAX_MEMORY_SOURCES).toBe(12);
    expect(out.memories).toHaveLength(12);
    expect(out.memories[0]?.id).toBe("m19");
  });

  it("takes profile items in the chosen categories plus the closest by vector, at most 6", async () => {
    const profile: ProfileCandidate[] = [
      {
        section: "preferences",
        index: 0,
        category: "Tooling",
        description: "npm",
        centroid: [0, 1],
      },
      { section: "patterns", index: 0, category: "Other", description: "close", centroid: [1, 0] },
      { section: "patterns", index: 1, category: "Other", description: "far", centroid: [0, 1] },
      ...Array.from({ length: 8 }, (_, i) => ({
        section: "workflows" as const,
        index: i,
        category: "Tooling",
        description: `wf${i}`,
      })),
    ];
    const out = await retrieveSources(
      "question",
      { ...plan, profileCategories: ["Tooling"] },
      "p_a",
      deps({}, profile)
    );
    expect(MAX_PROFILE_SOURCES).toBe(6);
    expect(out.profile).toHaveLength(6);
    expect(out.profile.map((p) => p.text)).toContain("npm");
    expect(out.profile.map((p) => p.text)).not.toContain("far");

    const noCategory = await retrieveSources("question", plan, "p_a", deps({}, profile));
    expect(noCategory.profile.map((p) => p.text)).toEqual(["close"]);
    expect(noCategory.profile[0]).toMatchObject({ kind: "profile", section: "patterns" });
  });
});
