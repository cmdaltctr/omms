import { describe, expect, it, mock, setDefaultTimeout } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

// The OpenCode V2 server plugin has no toast, and its console output reaches neither the screen
// nor OpenCode's log. Its notices must reach the TUI entry over plugin RPC (`registerTuiNotices`),
// the route the profile notice takes. The test runs the real V2 `setup` twice with a fake V2
// context and a fake plugin RPC, and records each notice the server sends: a config problem,
// a failed store migration, the web app address, an automatic import and a captured memory. The
// first-run notice stays on the console: the TUI shows it itself. The capture, import and store
// steps are replaced by recorders. The idle scenario waits out the real 10 s delay. The isolated
// test runner gives this process an empty home folder.
setDefaultTimeout(60_000);

process.env.OMMS_DISABLE_WEB_AUTOSTART = "0";
delete process.env.OMMS_DISABLE_AUTO_BACKFILL;
process.env.OMMS_DISABLE_UPDATE_CHECK = "1";
mkdirSync(join(homedir(), ".config", "omms"), { recursive: true });
writeFileSync(
  join(homedir(), ".config", "omms", "omms.jsonc"),
  JSON.stringify({
    webServerEnabled: true,
    webServerAutoStart: false,
    webServerPort: 48793,
    autoBackfill: true,
    chatMessage: { enabled: false },
    opencodeProvider: "opencode-go",
    opencodeModel: "test-model",
    userProfileAnalysisInterval: 0,
    // A rejected value: OMMS uses the default and tells the user once, at start.
    userProfilePromptDetail: "everything",
  })
);

const store = { fail: true };
const shards = await import("../src/services/storage/memory/shards.js");
mock.module("../src/services/storage/memory/shards.js", () => ({
  ...shards,
  ensureMemoryStoreReady: async () => {
    if (store.fail) throw new Error("migration failed");
  },
}));
mock.module("../src/services/client.js", () => ({
  memoryClient: { warmup: async () => {}, close: async () => {} },
}));
mock.module("../src/services/web-ensure.js", () => ({ ensureWebApp: async () => "running" }));
mock.module("../src/services/web-autostart.js", () => ({ reconcileWebAutostart: async () => {} }));
const handoff = await import("../src/services/runtime-handoff.js");
mock.module("../src/services/runtime-handoff.js", () => ({
  ...handoff,
  registerOwnCopy: () => "skipped",
  hostReplaceOlder: async () => undefined,
}));
const backfill = await import("../src/adapters/opencode/backfill-startup.js");
mock.module("../src/adapters/opencode/backfill-startup.js", () => ({
  ...backfill,
  registerOpencodeCaptureRetryDrain: () => {},
  startOpencodeBackfill: async (input: { notify: (message: string) => void }) => {
    input.notify("Imported 3 sessions");
  },
}));
const autoCapture = await import("../src/services/auto-capture.js");
mock.module("../src/services/auto-capture.js", () => ({
  ...autoCapture,
  // The capture step sends its notice through the host, as the real one does.
  performAutoCapture: async (host: { notify: (notice: unknown) => Promise<void> }) => {
    await host.notify({ title: "Memory Captured", message: "Saved", variant: "success" });
  },
}));
const cleanup = await import("../src/services/cleanup-service.js");
mock.module("../src/services/cleanup-service.js", () => ({
  ...cleanup,
  cleanupService: { shouldRunCleanup: async () => false, runDailyMaintenance: async () => {} },
}));
const prompts = await import("../src/services/user-prompt/user-prompt-manager.js");
mock.module("../src/services/user-prompt/user-prompt-manager.js", () => ({
  ...prompts,
  userPromptManager: {
    reset: () => {},
    savePrompt: async () => {},
    setPromptModel: async () => {},
  },
}));

const consoleLines: string[] = [];
for (const method of ["info", "warn", "error"] as const) {
  const original = console[method].bind(console);
  console[method] = (...args: unknown[]) => {
    if (typeof args[0] === "string" && args[0].startsWith("[omms] ")) consoleLines.push(args[0]);
    else original(...args);
  };
}

(globalThis as Record<symbol, unknown>)[Symbol.for("omms.plugin.warmedup")] = true;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const waitFor = async (condition: () => boolean, ms: number) => {
  const end = Date.now() + ms;
  while (!condition() && Date.now() < end) await sleep(20);
};
const { createFakeV2Context, checkRpcEventData } = await import("./fake-v2-context.js");
const plugin = (await import("../src/v2/plugin.js")).default;

/** Plugin RPC as OpenCode wires it: the server emits; a client of the same id receives. */
function createRpcBridge() {
  const emitted: Array<{ id: string; name: string; data: any }> = [];
  return {
    emitted,
    server: {
      register: async (definition: { id: string; events: Record<string, { schema: any }> }) => ({
        dispose: async () => {},
        events: {
          emit: async (name: string, data: any) => {
            checkRpcEventData(definition, name, data);
            emitted.push({ id: definition.id, name, data });
          },
        },
      }),
    },
  };
}

const notices = (bridge: ReturnType<typeof createRpcBridge>) =>
  bridge.emitted
    .filter((event) => event.id === "omms-notice" && event.name === "notice")
    .map((event) => event.data);

async function start(bridge: ReturnType<typeof createRpcBridge>) {
  const directory = mkdtempSync(join(tmpdir(), "omms-v2-notices-"));
  const fake = createFakeV2Context({ directory });
  fake.ctx.rpc = bridge.server;
  const stop = (await plugin.setup(fake.ctx)) as unknown as () => Promise<void>;
  return { fake, directory, stop };
}

describe("OpenCode server notices", () => {
  it("reach the TUI entry over plugin RPC with today's words", async () => {
    // First start: the store migration fails, so the web app does not start.
    const first = createRpcBridge();
    const one = await start(first);
    await waitFor(() => notices(first).length >= 3, 5_000);
    await one.stop();

    // Second start: the web app runs, and one idle session captures a memory.
    store.fail = false;
    const second = createRpcBridge();
    const two = await start(second);
    try {
      two.fake.emit({
        type: "session.execution.succeeded",
        location: { directory: two.directory },
        data: { sessionID: "ses-user" },
      });
      await waitFor(
        () => notices(second).some((notice) => notice.title === "Memory Captured"),
        20_000
      );
    } finally {
      await two.stop();
    }

    const firstNotices = notices(first);
    expect(firstNotices).toContainEqual(
      expect.objectContaining({ title: "OMMS settings", variant: "warning" })
    );
    expect(firstNotices.find((notice) => notice.title === "OMMS settings")?.message).toContain(
      "userProfilePromptDetail"
    );
    expect(firstNotices).toContainEqual({
      title: "Memory Explorer",
      message: "Database migration failed; web UI not started",
      variant: "error",
    });
    expect(firstNotices).toContainEqual({
      title: "Automatic import",
      message: "Imported 3 sessions",
      variant: "info",
    });

    const secondNotices = notices(second);
    expect(secondNotices).toContainEqual({
      title: "Memory Explorer",
      message: "Web UI available at http://127.0.0.1:48793",
      variant: "info",
    });
    expect(secondNotices).toContainEqual({
      title: "Memory Captured",
      message: "Saved",
      variant: "success",
    });

    // Routed notices no longer go to the console. The first-run notice still does.
    expect(consoleLines.filter((line) => !line.includes("OMMS does these things"))).toEqual([]);
    expect(
      [...firstNotices, ...secondNotices].some((notice) =>
        String(notice.message).includes("OMMS does these things")
      )
    ).toBe(false);
  });
});
