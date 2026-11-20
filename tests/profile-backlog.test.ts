import { expect, it } from "bun:test";
import { ProfileModelError } from "../src/core/profile-failure.js";
import { drainProfileBacklog } from "../src/importer/profile-backlog.js";

function stores(count: number) {
  const waiting = Array.from({ length: count }, (_, index) => ({
    id: `p${index}`,
    content: `Prompt number ${index} about the project`,
    createdAt: index,
  }));
  const batches: string[][] = [];
  const promptStore = {
    async countUnanalyzedForUserLearning() {
      return waiting.length;
    },
    async getPromptsForUserLearning(limit: number) {
      return [...waiting].sort((a, b) => a.createdAt - b.createdAt).slice(0, limit) as any;
    },
    async markMultipleAsUserLearningCaptured(ids: string[]) {
      for (const id of ids)
        waiting.splice(
          waiting.findIndex((prompt) => prompt.id === id),
          1
        );
    },
  };
  let profile: { id: string; profileData: string } | null = null;
  const profileStore = {
    async getActiveProfile() {
      return profile as any;
    },
    async createProfile() {
      profile = {
        id: "p",
        profileData: JSON.stringify({ preferences: [], patterns: [], workflows: [] }),
      };
      return "p";
    },
    async updateProfile() {
      return true;
    },
    async getLearnedPromptIds() {
      return [];
    },
    async forgetLearnedPromptIds() {},
  };
  return { waiting, batches, promptStore, profileStore };
}
const reply = JSON.stringify({ preferences: [], patterns: [], workflows: [] });
const user = { userEmail: "me@example.invalid" };

it("drains in batches of 50, oldest first", async () => {
  const { promptStore, profileStore, waiting } = stores(120);
  const seen: string[][] = [];
  const model = {
    provider: "stub",
    modelId: "stub",
    async complete(_system: string, prompt: string) {
      seen.push(prompt.split("\n"));
      return reply;
    },
  };
  const report = await drainProfileBacklog({ user, model, promptStore, profileStore } as any);
  expect(seen.map((batch) => batch.length)).toEqual([50, 50, 20]);
  expect(seen[0]![0]).toContain("Prompt number 0 ");
  expect(report).toMatchObject({ batchesBuilt: 3, remaining: 0 });
  expect(waiting).toHaveLength(0);
});

it("stops on a failed batch with its reason and keeps finished batches", async () => {
  const { promptStore, profileStore, waiting } = stores(120);
  let calls = 0;
  const model = {
    provider: "stub",
    modelId: "stub",
    async complete() {
      calls++;
      if (calls > 1) throw new ProfileModelError("timeout");
      return reply;
    },
  };
  const report = await drainProfileBacklog({ user, model, promptStore, profileStore } as any);
  expect(report).toMatchObject({ batchesBuilt: 1, remaining: 70, reason: "timeout" });
  expect(waiting).toHaveLength(70);
});

it("honours the abort signal between batches", async () => {
  const { promptStore, profileStore } = stores(120);
  const controller = new AbortController();
  const model = {
    provider: "stub",
    modelId: "stub",
    async complete() {
      controller.abort();
      return reply;
    },
  };
  const report = await drainProfileBacklog({
    user,
    model,
    promptStore,
    profileStore,
    signal: controller.signal,
  } as any);
  expect(report).toMatchObject({ batchesBuilt: 1, remaining: 70 });
});

it("asks before each batch and stops when a newer run took over", async () => {
  const { promptStore, profileStore, waiting } = stores(120);
  const events: string[] = [];
  const model = {
    provider: "stub",
    modelId: "stub",
    async complete() {
      events.push("call");
      return reply;
    },
  };
  let batches = 0;
  const report = await drainProfileBacklog({
    user,
    model,
    promptStore,
    profileStore,
    beforeBatch: async () => {
      events.push("begin");
      return ++batches === 2 ? "superseded" : "ok";
    },
    afterBatch: async () => {
      events.push("end");
    },
  } as any);
  expect(events).toEqual(["begin", "call", "end", "begin"]);
  expect(report).toMatchObject({ batchesBuilt: 1, remaining: 70, superseded: true });
  expect(waiting).toHaveLength(70);
});

/**
 * Stores that keep claims, and a profile store that records the saved prompt ids with each
 * save, as the real profile database does. `markFailures` makes that many marks fail.
 */
function ledgerStores(count: number) {
  const waiting = new Set(Array.from({ length: count }, (_, index) => `p${index}`));
  const claimed = new Set<string>();
  const ledger = new Set<string>();
  const state = { markFailures: 0, saves: 0 };
  const promptStore = {
    async countUnanalyzedForUserLearning() {
      return waiting.size;
    },
    async getPromptsForUserLearning(limit: number) {
      const free = [...waiting].filter((id) => !claimed.has(id)).slice(0, limit);
      for (const id of free) claimed.add(id);
      return free.map((id, index) => ({
        id,
        content: `Prompt ${id} about work`,
        createdAt: index,
      }));
    },
    async markMultipleAsUserLearningCaptured(ids: string[]) {
      if (ids.length > 0 && state.markFailures > 0) {
        state.markFailures--;
        throw new Error("database is locked");
      }
      for (const id of ids) {
        waiting.delete(id);
        claimed.delete(id);
      }
    },
    async markForUserLearning(ids: string[]) {
      for (const id of ids) claimed.delete(id);
    },
  };
  let profile: { id: string; version: number; profileData: string } | null = null;
  const profileStore = {
    async getActiveProfile() {
      return profile;
    },
    async getProfileById() {
      return profile;
    },
    async mergeProfileData(existing: unknown) {
      return existing;
    },
    async createProfile(...args: unknown[]) {
      state.saves++;
      profile = { id: "p", version: 1, profileData: JSON.stringify(args[4]) };
      for (const id of (args[6] as string[] | undefined) ?? []) ledger.add(id);
      return "p";
    },
    async updateProfile(...args: unknown[]) {
      state.saves++;
      for (const id of (args[5] as string[] | undefined) ?? []) ledger.add(id);
      return true;
    },
    async getLearnedPromptIds(ids: string[]) {
      return ids.filter((id) => ledger.has(id));
    },
    async forgetLearnedPromptIds(ids: string[]) {
      for (const id of ids) ledger.delete(id);
    },
  };
  /** The 10-minute claim runs out, or the process restarts. */
  const expireClaims = () => claimed.clear();
  return { waiting, ledger, state, promptStore, profileStore, expireClaims };
}

function countingModel() {
  const model = {
    calls: 0,
    provider: "stub",
    modelId: "stub",
    async complete() {
      model.calls++;
      return reply;
    },
  };
  return model;
}

it("saves a batch once when its mark fails once", async () => {
  const { waiting, state, promptStore, profileStore } = ledgerStores(5);
  state.markFailures = 1;
  const model = countingModel();
  await drainProfileBacklog({ user, model, promptStore, profileStore } as any);
  expect(model.calls).toBe(1);
  expect(state.saves).toBe(1);
  expect(waiting.size).toBe(0);
});

it("marks a saved batch on the next run without a model call", async () => {
  const { waiting, ledger, state, promptStore, profileStore, expireClaims } = ledgerStores(5);
  state.markFailures = 99;
  const model = countingModel();
  await drainProfileBacklog({ user, model, promptStore, profileStore } as any);
  expect(state.saves).toBe(1);
  expect(waiting.size).toBe(5);

  expireClaims();
  state.markFailures = 0;
  await drainProfileBacklog({ user, model, promptStore, profileStore } as any);
  expect(model.calls).toBe(1);
  expect(state.saves).toBe(1);
  expect(waiting.size).toBe(0);
  expect(ledger.size).toBe(0);
});
