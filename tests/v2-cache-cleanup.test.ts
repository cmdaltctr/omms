import { afterEach, beforeEach, expect, it, mock } from "bun:test";

// Everything the V2 plugin pulls in is replaced, so setup runs without OpenCode,
// a database or the real ~/.omms. Only the wiring of the cache clean-up is tested.

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

mock.module("../src/index.js", () => ({ OmmsPlugin: async () => ({}) }));
mock.module("../src/adapters/opencode/opencode-provider-loader.js", () => ({
  loadOpencodeProvider: async () => ({ setV2Client: () => {} }),
}));
mock.module("../src/v2/adapter.js", () => ({ registerV2Adapter: async () => "adapter" }));
mock.module("../src/v2/memory-bridge.js", () => ({ createV2MemoryBridge: () => ({}) }));
mock.module("../src/v2/legacy-client.js", () => ({ createLegacyClient: () => ({}) }));
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
mock.module("../src/services/runtime-handoff.js", () => ({ ommsDir: () => "/fake/.omms" }));
mock.module("../src/services/package-version.js", () => ({ packageVersion: () => "4.3.0" }));
mock.module("../src/services/logger.js", () => ({
  log: (message: string, data: unknown) => state.logs.push({ message, data }),
}));

const { default: plugin } = await import("../src/v2/plugin.js");

const ctx = {
  location: { directory: "/work", project: { directory: "/work" } },
} as any;

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

afterEach(() => {
  delete process.env.OMMS_DISABLE_UPDATE_CHECK;
});

it("starts the clean-up with the running copy, its version and the recorded copy", async () => {
  expect(await plugin.setup(ctx)).toBe("adapter");
  await until(() => state.calls.length > 0);
  expect(state.calls).toHaveLength(1);
  const options = state.calls[0];
  expect(options.modulePath.replaceAll("\\", "/")).toEndWith("/src/v2/plugin.ts");
  expect(options.runningVersion).toBe("4.3.0");
  expect(options.keepRoots).toEqual([state.record!.root]);
  expect(typeof options.now).toBe("number");
  // The record goes to the OMMS log.
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
  const adapter = await plugin.setup(ctx);
  expect(adapter).toBe("adapter");
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
  expect(await plugin.setup(ctx)).toBe("adapter");
  await until(() => state.calls.length > 0);
  expect(state.calls).toHaveLength(1);

  state.calls = [];
  state.prune = () => Promise.reject(new Error("EBUSY"));
  expect(await plugin.setup(ctx)).toBe("adapter");
  await until(() => state.calls.length > 0);
  expect(state.calls).toHaveLength(1);
  // Let a rejection settle; an unhandled one would fail the run.
  await new Promise((resolve) => setTimeout(resolve, 20));
});

it("does not run the clean-up when the plugin is not an npm install", async () => {
  state.npm = false;
  expect(await plugin.setup(ctx)).toBe("adapter");
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(state.calls).toEqual([]);
});

it("keeps nothing extra when runtime.json has no record", async () => {
  state.record = null;
  await plugin.setup(ctx);
  await until(() => state.calls.length > 0);
  expect(state.calls[0].keepRoots).toEqual([]);
});

it("still runs the clean-up when the update check is turned off", async () => {
  process.env.OMMS_DISABLE_UPDATE_CHECK = "1";
  await plugin.setup(ctx);
  await until(() => state.calls.length > 0);
  expect(state.calls).toHaveLength(1);
});

it("starts the background update check once per service, even after several setups", async () => {
  await plugin.setup(ctx);
  await plugin.setup(ctx);
  await until(() => state.serviceUpdates.length > 0);
  expect(state.serviceUpdates).toHaveLength(1);
  expect(state.serviceUpdates[0]!.replaceAll("\\", "/")).toEndWith("/src/v2/plugin.ts");
});
