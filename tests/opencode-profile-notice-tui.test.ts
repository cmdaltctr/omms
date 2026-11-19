import { describe, expect, it, mock, setDefaultTimeout } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

// The OpenCode V2 server plugin has no toast. Its console output reaches neither the screen nor
// OpenCode's log, so a finished profile pass must send its notice to the TUI entry over plugin
// RPC, the route the recall rows use (TDR-060). The TUI entry shows it with `ui.toast.show`.
// The notice words must match Pi's (change unify-profile-learning). The test runs the real V2
// `setup` with a fake V2 context and the real shared pass on fake stores, waits out the real
// 10 s idle delay, then runs Pi's pass on the same stores. The isolated test runner gives this
// process an empty home folder.
setDefaultTimeout(60_000);

process.env.OMMS_DISABLE_WEB_AUTOSTART = "1";
process.env.OMMS_DISABLE_AUTO_BACKFILL = "1";
process.env.OMMS_DISABLE_UPDATE_CHECK = "1";
mkdirSync(join(homedir(), ".config", "omms"), { recursive: true });
writeFileSync(
  join(homedir(), ".config", "omms", "omms.jsonc"),
  JSON.stringify({
    webServerEnabled: false,
    chatMessage: { enabled: false },
    opencodeProvider: "opencode-go",
    opencodeModel: "test-model",
    userProfileAnalysisInterval: 2,
    showUserProfileToasts: true,
    showErrorToasts: false,
    userProfileAutoCleanupEnabled: false,
  })
);

const empty = { preferences: [], patterns: [], workflows: [] };
const world = { learned: new Set<string>() };
const prompts = [
  { id: "p1", content: "Please refactor the settings page into smaller parts", createdAt: 1 },
  { id: "p2", content: "Add a regression test for the profile notice route", createdAt: 2 },
];
const waiting = () => prompts.filter((prompt) => !world.learned.has(prompt.id));

const autoCapture = await import("../src/services/auto-capture.js");
mock.module("../src/services/auto-capture.js", () => ({
  ...autoCapture,
  performAutoCapture: async () => {},
}));
const cleanup = await import("../src/services/cleanup-service.js");
mock.module("../src/services/cleanup-service.js", () => ({
  ...cleanup,
  cleanupService: { runDailyMaintenance: async () => {} },
}));
const promptStore = await import("../src/services/user-prompt/user-prompt-manager.js");
mock.module("../src/services/user-prompt/user-prompt-manager.js", () => ({
  ...promptStore,
  userPromptManager: {
    reset: () => {},
    savePrompt: async () => {},
    setPromptModel: async () => {},
    skipTrivialPromptsForLearning: async () => 0,
    countUnanalyzedForUserLearning: async () => waiting().length,
    getPromptsForUserLearning: async () => waiting(),
    markMultipleAsUserLearningCaptured: async (ids: string[]) => {
      for (const id of ids) world.learned.add(id);
    },
    markForUserLearning: async () => {},
  },
}));
const profileStore = await import("../src/services/user-profile/user-profile-manager.js");
mock.module("../src/services/user-profile/user-profile-manager.js", () => ({
  ...profileStore,
  userProfileManager: {
    reset: () => {},
    getActiveProfile: async () => null,
    createProfile: async () => "profile-1",
  },
}));
const loader = await import("../src/adapters/opencode/opencode-provider-loader.js");
const loadRealProvider = loader.loadOpencodeProvider;
mock.module("../src/adapters/opencode/opencode-provider-loader.js", () => ({
  ...loader,
  loadOpencodeProvider: async () => ({
    ...(await loadRealProvider()),
    generateStructuredOutput: async () => empty,
  }),
}));
mock.module("../src/adapters/opencode/profile-llm-client.js", () => ({
  getOpencodeProfileHost: async () => ({}),
}));

// The store warm-up is not under test.
(globalThis as Record<symbol, unknown>)[Symbol.for("omms.plugin.warmedup")] = true;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const { createFakeV2Context, checkRpcEventData } = await import("./fake-v2-context.js");
const plugin = (await import("../src/v2/plugin.js")).default;
const { learnPiProfile } = await import("../src/adapters/pi/profile.js");

/**
 * Plugin RPC as OpenCode wires it: the server registers a contract and emits its events; a TUI
 * client of a contract with the same id receives them, and its method calls run the server's
 * handlers (they fail while the server has not registered).
 */
function createRpcBridge() {
  const handlers = new Map<string, Array<(event: unknown) => void>>();
  const emitted: Array<{ id: string; name: string; data: any }> = [];
  const methods = new Map<string, Record<string, (input: unknown) => Promise<unknown>>>();
  return {
    emitted,
    server: {
      register: async (
        definition: { id: string; events: Record<string, { schema: any }> },
        serverMethods: Record<string, (input: unknown) => Promise<unknown>>
      ) => {
        methods.set(definition.id, serverMethods);
        return {
          dispose: async () => {},
          events: {
            emit: async (name: string, data: any) => {
              checkRpcEventData(definition, name, data);
              emitted.push({ id: definition.id, name, data });
              for (const handler of handlers.get(`${definition.id}/${name}`) ?? []) {
                handler({ type: `rpc.${definition.id}.${name}`, data });
              }
            },
          },
        };
      },
    },
    client: {
      rpc: (definition: { id: string; methods: Record<string, unknown> }) => ({
        ...Object.fromEntries(
          Object.keys(definition.methods).map((name) => [
            name,
            async (input: unknown) => {
              const method = methods.get(definition.id)?.[name];
              if (!method) throw new Error("rpc.unavailable");
              return method(input);
            },
          ])
        ),
        events: {
          on: (name: string, handler: (event: unknown) => void) => {
            const key = `${definition.id}/${name}`;
            handlers.set(key, [...(handlers.get(key) ?? []), handler]);
            return () =>
              handlers.set(
                key,
                (handlers.get(key) ?? []).filter((h) => h !== handler)
              );
          },
        },
      }),
    },
  };
}

/** What Pi shows for a finished pass on the same stores. */
async function piNotice() {
  world.learned.clear();
  const notices: unknown[] = [];
  await learnPiProfile({
    directory: "/workspace",
    model: () =>
      ({ provider: "stub", modelId: "stub", complete: async () => JSON.stringify(empty) }) as never,
    notify: (notice) => {
      notices.push(notice);
    },
  });
  return notices;
}

describe("OpenCode profile notice", () => {
  it("a finished pass reaches the TUI entry as a toast with Pi's words", async () => {
    world.learned.clear();
    const bridge = createRpcBridge();
    const toasts: unknown[] = [];
    // The TUI side: the module `opencode/tui.tsx` loads. Absent today, so no toast is shown.
    const tui = await import("../src/adapters/opencode/tui-notices.js").catch(() => null);
    const stopTui = tui?.startTuiNotices({
      client: bridge.client,
      toast: (options: unknown) => toasts.push(options),
    });

    const directory = mkdtempSync(join(tmpdir(), "omms-v2-profile-notice-"));
    const fake = createFakeV2Context({ directory });
    fake.ctx.rpc = bridge.server;
    const stop = await plugin.setup(fake.ctx);
    try {
      fake.emit({
        type: "session.execution.succeeded",
        location: { directory },
        data: { sessionID: "ses-user" },
      });
      const end = Date.now() + 20_000;
      while (world.learned.size < prompts.length && Date.now() < end) await sleep(50);
      await sleep(200);
    } finally {
      await (stop as unknown as () => Promise<void>)();
      stopTui?.();
    }

    const pi = await piNotice();
    expect(pi).toEqual([
      {
        title: "User profile updated",
        message: "Analysed 2 prompts and updated your profile",
        variant: "success",
      },
    ]);
    // The server sent the notice over plugin RPC, with Pi's words.
    const sent = bridge.emitted.filter((event) => typeof event.data?.message === "string");
    expect(sent.map((event) => event.data)).toEqual(pi);
    // The TUI entry showed it as a toast, with Pi's words.
    expect(toasts).toEqual([{ ...(pi[0] as object), duration: 10_000 }]);
  });
});
