import { beforeEach, expect, it, mock } from "bun:test";

const selected: unknown[] = [];
const drained: unknown[] = [];
const lease: string[] = [];
let superseded = false;
let drainThrows = false;
mock.module("../src/config.js", () => ({
  CONFIG: { memoryApiKey: "saved-key" },
  initConfig: () => {},
  initConfigWithLegacyMigration: () => {},
}));
mock.module("../src/importer/profile-catch-up.js", () => ({
  CATCH_UP_BATCH_SIZE: 50,
  previewCatchUp: async () => ({ waiting: 2600, calls: 52 }),
  catchUpLeaseHooks: async () => {
    lease.push("take");
    return {
      beforeBatch: async () => "ok",
      afterBatch: async () => {},
      release: async () => void lease.push("release"),
    };
  },
}));
mock.module("../src/importer/model-selection.js", () => ({
  selectImportModel: (flags: unknown) => {
    selected.push(flags);
    return {
      provider: "openai-chat",
      modelId: "other-model",
      profile: { complete: async () => "" },
    };
  },
}));
mock.module("../src/importer/profile-backlog.js", () => ({
  drainProfileBacklog: async (options: unknown) => {
    drained.push(options);
    if (drainThrows) throw new Error("store unavailable");
    return superseded
      ? { batchesBuilt: 3, remaining: 2450, superseded: true }
      : { batchesBuilt: 52, remaining: 0 };
  },
}));
mock.module("../src/services/tags.js", () => ({
  getTags: () => ({ user: { userEmail: "me@example.invalid" } }),
}));

const { runProfileCatchUpCommand } = await import("../src/cli/profile-catch-up-command.js");
let output: string[] = [];
const print = (line: string) => output.push(line);
beforeEach(() => {
  selected.length = 0;
  drained.length = 0;
  lease.length = 0;
  superseded = false;
  drainThrows = false;
  output = [];
});

it("prints the counts and makes no call without --yes", async () => {
  expect(await runProfileCatchUpCommand([], print)).toBe(0);
  expect(output.join("\n")).toContain("2600");
  expect(output.join("\n")).toContain("52");
  expect(output.join("\n")).toContain("--yes");
  expect(selected).toHaveLength(0);
  expect(drained).toHaveLength(0);
});

it("makes no call on a dry run, even with --yes", async () => {
  expect(await runProfileCatchUpCommand(["--dry-run", "--yes"], print)).toBe(0);
  expect(selected).toHaveLength(0);
  expect(drained).toHaveLength(0);
});

it("runs with another model from the flags without saving it", async () => {
  const code = await runProfileCatchUpCommand(
    [
      "--provider",
      "openai-chat",
      "--model",
      "other-model",
      "--api-url",
      "https://api.invalid/v1",
      "--api-key-env=KEY",
      "--yes",
    ],
    print
  );
  expect(code).toBe(0);
  expect(selected).toEqual([
    {
      provider: "openai-chat",
      model: "other-model",
      apiUrl: "https://api.invalid/v1",
      apiKeyEnv: "KEY",
    },
  ]);
  expect(drained).toHaveLength(1);
  expect(output.join("\n")).toContain("openai-chat/other-model");
});

it("refuses an unknown option", async () => {
  expect(await runProfileCatchUpCommand(["--nope"], print)).toBe(1);
});

it("takes the run record, releases it, and reports a takeover", async () => {
  superseded = true;
  expect(await runProfileCatchUpCommand(["--yes"], print)).toBe(0);
  expect(lease).toEqual(["take", "release"]);
  expect((drained[0] as { beforeBatch?: unknown }).beforeBatch).toBeFunction();
  expect(output.join("\n")).toContain("a newer catch-up run took over");
});

it("releases the run record when the run throws", async () => {
  drainThrows = true;
  expect(await runProfileCatchUpCommand(["--yes"], print)).toBe(1);
  expect(lease).toEqual(["take", "release"]);
});
