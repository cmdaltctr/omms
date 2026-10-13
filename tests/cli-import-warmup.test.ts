import { beforeEach, describe, expect, it, mock } from "bun:test";

// A profile-only terminal import never embeds through the memory store, so nothing warms the
// embedding service. mergeItems then sees isWarmedUp === false and buffers findings in a cold
// buffer capped at 50 per type. The CLI must warm the service before the import starts.

const events: string[] = [];
let warmupError: Error | null = null;

mock.module("../src/services/runtime-handoff.js", () => ({
  handOffOrRegister: async () => null,
}));
mock.module("../src/config.js", () => ({
  CONFIG: { memoryApiKey: undefined },
  initConfig: () => {},
  initConfigWithLegacyMigration: () => {},
}));
mock.module("../src/importer/model-selection.js", () => ({
  selectImportModel: () => ({
    provider: "openai-chat",
    modelId: "small",
    capture: {},
    profile: {},
  }),
}));
mock.module("../src/services/client.js", () => ({
  memoryClient: {
    warmup: async () => {
      events.push("warmup");
      if (warmupError) throw warmupError;
    },
  },
}));
mock.module("../src/importer/run-import.js", () => ({
  runHistoryImport: async () => {
    events.push("import");
    return {};
  },
  formatHistoryImportReport: () => "report",
  historyImportFailed: () => false,
}));

const { runCli } = await import("../src/cli/index.js");

describe("terminal history import warms the embedding service", () => {
  beforeEach(() => {
    events.length = 0;
    warmupError = null;
  });

  it("warms up before a profile-only import starts", async () => {
    const code = await runCli(["import-pi-history", "--skip-memories"]);
    expect(code).toBe(0);
    expect(events).toEqual(["warmup", "import"]);
  });

  it("does not warm up for a dry run", async () => {
    await runCli(["import-pi-history", "--dry-run"]);
    expect(events).toEqual(["import"]);
  });

  it("does not warm up when the profile step is skipped", async () => {
    await runCli(["import-pi-history", "--skip-profile"]);
    expect(events).toEqual(["import"]);
  });

  it("still runs the import when the warm-up fails, and says why", async () => {
    warmupError = new Error("embedding server unreachable");
    const warnings: string[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args.join(" "));
    try {
      const code = await runCli(["import-pi-history", "--skip-memories"]);
      expect(code).toBe(0);
    } finally {
      console.warn = original;
    }
    expect(events).toEqual(["warmup", "import"]);
    expect(warnings.join("\n")).toContain("embedding server unreachable");
  });
});
