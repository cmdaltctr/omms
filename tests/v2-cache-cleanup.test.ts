import { afterEach, beforeEach, expect, it, mock } from "bun:test";
import { createFakeV2Context } from "./fake-v2-context.js";

// Setup runs for real against a fake V2 context. The services behind it (config,
// memory client, runtime record, logger, update check) are replaced, so it needs
// no OpenCode, database or real ~/.omms. Only the wiring of the cache clean-up
// and the service self-update is tested.

const state = {
  npm: true,
  record: { root: "/cache/om-memory-system@latest/1/node_modules/om-memory-system" } as {
    root: string;
  } | null,
  prune: (async () => ({ removed: 0, kept: 0 })) as (options: any) => Promise<unknown>,
  calls: [] as any[],
  serviceUpdates: [] as string[],
  logs: [] as { message: string; data: unknown }[],
};

mock.module("../src/config.js", () => ({
  CONFIG: {
    autoBackfill: false,
    autoCaptureEnabled: false,
    webServerEnabled: false,
    chatMessage: { enabled: false },
  },
  initConfigWithLegacyMigration: () => {},
  refreshConfigIfChanged: () => {},
  getExplicitContainerTagPrefix: () => undefined,
  isConfigured: () => false,
}));
mock.module("../src/services/client.js", () => ({
  memoryClient: { warmup: async () => {}, close: async () => {} },
}));
mock.module("../src/services/tags.js", () => ({
  getTags: () => ({ project: { tag: "test" }, user: { userEmail: "test@example.invalid" } }),
}));
mock.module("../src/services/user-prompt/user-prompt-manager.js", () => ({
  userPromptManager: { savePrompt: async () => {} },
}));
mock.module("../src/services/host-copies.js", () => ({
  pruneOldCacheCopies: (options: any) => {
    state.calls.push(options);
    return state.prune(options);
  },
}));
mock.module("../src/adapters/opencode/self-update.js", () => ({
  opencodeSelfUpdateDeps: (options: any) => options,
  startOpencodeServiceSelfUpdate: (options: any) => {
    options.run();
    return () => {};
  },
}));
mock.module("../src/services/host-self-update.js", () => ({
  installedFromNpm: () => state.npm,
  startHostSelfUpdate: async (deps: any) => {
    state.serviceUpdates.push(deps.modulePath);
    return { code: "current", update: null };
  },
}));
mock.module("../src/services/runtime-record.js", () => ({
  readRuntimeRecord: () => state.record,
}));
mock.module("../src/services/runtime-handoff.js", () => ({
  ommsDir: () => "/fake/.omms",
  registerOwnCopy: () => "skipped",
  hostReplaceOlder: async () => undefined,
}));
mock.module("../src/services/package-version.js", () => ({ packageVersion: () => "4.3.0" }));
mock.module("../src/services/logger.js", () => ({
  log: (message: string, data: unknown) => state.logs.push({ message, data }),
}));

const { default: plugin } = await import("../src/v2/plugin.js");

// Every setup returns the function that stops its event subscription.
const stops: Array<() => Promise<void>> = [];
const start = async () => {
  const stop = await plugin.setup(createFakeV2Context({ directory: "/work" }).ctx);
  expect(typeof stop).toBe("function");
  stops.push(stop as () => Promise<void>);
};

const until = async (done: () => boolean) => {
  for (let i = 0; i < 100 && !done(); i++) await new Promise((resolve) => setTimeout(resolve, 5));
};

beforeEach(() => {
  state.npm = true;
  state.record = { root: "/cache/om-memory-system@latest/1/node_modules/om-memory-system" };
  state.prune = async () => ({ removed: 0, kept: 0 });
  state.calls = [];
  state.logs = [];
});

afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
  delete process.env.OMMS_DISABLE_UPDATE_CHECK;
});

it("starts the clean-up with the running copy, its version and the recorded copy", async () => {
  await start();
  await until(() => state.calls.length > 0);
  expect(state.calls).toHaveLength(1);
  const options = state.calls[0];
  expect(options.modulePath.replaceAll("\\", "/")).toEndWith("/src/v2/plugin.ts");
  expect(options.runningVersion).toBe("4.3.0");
  expect(options.keepRoots).toEqual([state.record!.root]);
  expect(typeof options.now).toBe("number");
  // The record goes to the OMMS log.
  state.logs = [];
  options.log("OpenCode cache clean-up", { removed: 1, kept: 0 });
  expect(state.logs).toEqual([
    { message: "OpenCode cache clean-up", data: { removed: 1, kept: 0 } },
  ]);
});

it("does not wait for the clean-up before setup returns", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  let finished = false;
  state.prune = async () => {
    await gate;
    finished = true;
    return { removed: 1, kept: 0 };
  };
  await start();
  await until(() => state.calls.length > 0);
  // Setup returned while the clean-up is still running.
  expect(state.calls).toHaveLength(1);
  expect(finished).toBe(false);
  release();
  await until(() => finished);
  expect(finished).toBe(true);
});

it("keeps setup working when the clean-up throws or rejects", async () => {
  state.prune = () => {
    throw new Error("EBUSY");
  };
  await start();
  await until(() => state.calls.length > 0);
  expect(state.calls).toHaveLength(1);

  state.calls = [];
  state.prune = () => Promise.reject(new Error("EBUSY"));
  await start();
  await until(() => state.calls.length > 0);
  expect(state.calls).toHaveLength(1);
  // Let a rejection settle; an unhandled one would fail the run.
  await new Promise((resolve) => setTimeout(resolve, 20));
});

it("does not run the clean-up when the plugin is not an npm install", async () => {
  state.npm = false;
  await start();
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(state.calls).toEqual([]);
});

it("keeps nothing extra when runtime.json has no record", async () => {
  state.record = null;
  await start();
  await until(() => state.calls.length > 0);
  expect(state.calls[0].keepRoots).toEqual([]);
});

it("still runs the clean-up when the update check is turned off", async () => {
  process.env.OMMS_DISABLE_UPDATE_CHECK = "1";
  await start();
  await until(() => state.calls.length > 0);
  expect(state.calls).toHaveLength(1);
});

it("starts the background update check once per service, even after several setups", async () => {
  await start();
  await start();
  await until(() => state.serviceUpdates.length > 0);
  expect(state.serviceUpdates).toHaveLength(1);
  expect(state.serviceUpdates[0]!.replaceAll("\\", "/")).toEndWith("/src/v2/plugin.ts");
});
