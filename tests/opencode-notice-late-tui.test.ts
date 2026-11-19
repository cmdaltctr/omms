import { describe, expect, it, mock, setDefaultTimeout } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

// OpenCode plugin RPC events are live only: a client that subscribes later never gets the events
// sent before it. The OpenCode background service starts the server plugin before any terminal
// interface (TUI) runs, so the notices sent at start, such as "OMMS settings", were lost. The
// test runs the real V2 `setup` with a fake V2 context and a fake plugin RPC that drops events
// nobody listens to, as OpenCode does. It then attaches the TUI module (`startTuiNotices`) and
// checks that each notice shows once, in order. The isolated test runner gives this process an
// empty home folder.
setDefaultTimeout(30_000);

process.env.OMMS_DISABLE_WEB_AUTOSTART = "0";
process.env.OMMS_DISABLE_AUTO_BACKFILL = "1";
process.env.OMMS_DISABLE_UPDATE_CHECK = "1";
mkdirSync(join(homedir(), ".config", "omms"), { recursive: true });
writeFileSync(
  join(homedir(), ".config", "omms", "omms.jsonc"),
  JSON.stringify({
    webServerEnabled: true,
    webServerAutoStart: false,
    webServerPort: 48794,
    autoBackfill: false,
    chatMessage: { enabled: false },
    opencodeProvider: "opencode-go",
    opencodeModel: "test-model",
    userProfileAnalysisInterval: 0,
    // Two rejected values: OMMS uses the defaults and sends two "OMMS settings" notices at start.
    userProfilePromptDetail: "everything",
    userProfileAutoCleanupInterval: 0,
  })
);

const shards = await import("../src/services/storage/memory/shards.js");
mock.module("../src/services/storage/memory/shards.js", () => ({
  ...shards,
  ensureMemoryStoreReady: async () => {},
}));
mock.module("../src/services/client.js", () => ({
  memoryClient: { warmup: async () => {}, close: async () => {} },
}));
// The web app answers when the test says so, which sends a notice after the start.
const web = { release: () => {} };
mock.module("../src/services/web-ensure.js", () => ({
  ensureWebApp: () =>
    new Promise<string>((resolve) => {
      web.release = () => resolve("running");
    }),
}));
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
}));
const cleanup = await import("../src/services/cleanup-service.js");
mock.module("../src/services/cleanup-service.js", () => ({
  ...cleanup,
  cleanupService: { shouldRunCleanup: async () => false, runDailyMaintenance: async () => {} },
}));

(globalThis as Record<symbol, unknown>)[Symbol.for("omms.plugin.warmedup")] = true;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const waitFor = async (condition: () => boolean, ms: number) => {
  const end = Date.now() + ms;
  while (!condition() && Date.now() < end) await sleep(20);
};
const { createFakeV2Context, checkRpcEventData } = await import("./fake-v2-context.js");
const plugin = (await import("../src/v2/plugin.js")).default;
const { startTuiNotices } = await import("../src/adapters/opencode/tui-notices.js");
const { noticeRpc } = await import("../src/v2/notice-rpc.js");

/**
 * Plugin RPC as OpenCode wires it. An event reaches only the client handlers attached when it is
 * sent. A client method call runs the server handler, and fails while no server has registered.
 * `hold` keeps method calls waiting until `release`, to let a notice arrive during a call.
 */
function createRpcBridge() {
  const registered = new Map<string, Record<string, any>>();
  const listeners = new Map<string, Set<(event: unknown) => void>>();
  const gate = { hold: false, waiting: [] as Array<() => void> };
  return {
    hold() {
      gate.hold = true;
    },
    release() {
      gate.hold = false;
      for (const resume of gate.waiting.splice(0)) resume();
    },
    server: {
      register: async (definition: any, handlers: Record<string, any>) => {
        registered.set(definition.id, handlers);
        return {
          dispose: async () => {
            registered.delete(definition.id);
          },
          events: {
            emit: async (name: string, data: any) => {
              checkRpcEventData(definition, name, data);
              for (const handler of [...(listeners.get(`${definition.id}/${name}`) ?? [])]) {
                handler({ type: `rpc.${definition.id}.${name}`, data });
              }
            },
          },
        };
      },
    },
    client: {
      rpc: (definition: any) => {
        const methods = Object.fromEntries(
          Object.keys(definition.methods).map((method) => [
            method,
            async (input: unknown) => {
              if (gate.hold) await new Promise<void>((resume) => gate.waiting.push(resume));
              const handler = registered.get(definition.id);
              if (!handler?.[method]) {
                throw Object.assign(new Error("unavailable"), { type: "rpc.unavailable" });
              }
              return handler[method](input, { signal: new AbortController().signal });
            },
          ])
        );
        return {
          ...methods,
          events: {
            on: (name: string, handler: (event: unknown) => void) => {
              const key = `${definition.id}/${name}`;
              const set = listeners.get(key) ?? new Set();
              set.add(handler);
              listeners.set(key, set);
              return () => set.delete(handler);
            },
          },
        };
      },
    },
  };
}

type Toast = { title?: string; message: string; variant?: string; duration: number };

async function start(bridge: ReturnType<typeof createRpcBridge>) {
  const directory = mkdtempSync(join(tmpdir(), "omms-v2-late-tui-"));
  const fake = createFakeV2Context({ directory });
  fake.ctx.rpc = bridge.server;
  return (await plugin.setup(fake.ctx)) as unknown as () => Promise<void>;
}

function attachTui(bridge: ReturnType<typeof createRpcBridge>, toasts: Toast[]) {
  return startTuiNotices({
    client: bridge.client as never,
    toast: (options) => {
      // A claimed notice carries only set fields, as OpenCode's schema requires.
      const { duration: _duration, ...data } = options;
      checkRpcEventData(noticeRpc, "notice", data);
      toasts.push(options);
    },
  });
}

const settings = (toasts: Toast[]) => toasts.filter((toast) => toast.title === "OMMS settings");
const webNotices = (toasts: Toast[]) =>
  toasts.filter((toast) => toast.message === "Web UI available at http://127.0.0.1:48794");
const keys = (toasts: Toast[]) => toasts.map((toast) => `${toast.title}|${toast.message}`);

describe("OpenCode notices sent before the TUI listens", () => {
  it("a notice sent at start shows once when the TUI attaches later", async () => {
    const bridge = createRpcBridge();
    const stop = await start(bridge);
    const toasts: Toast[] = [];
    let stopTui: (() => void) | undefined;
    try {
      // The start notices went out before any TUI ran.
      await sleep(100);
      stopTui = attachTui(bridge, toasts);
      await waitFor(() => settings(toasts).length >= 2, 5_000);
      await sleep(200);
    } finally {
      stopTui?.();
      web.release();
      await stop();
    }
    const shown = settings(toasts);
    expect(shown).toHaveLength(2);
    // In the order the server sent them: the config check reads the keys in this order.
    expect(shown[0]?.message).toContain("userProfileAutoCleanupInterval");
    expect(shown[1]?.message).toContain("userProfilePromptDetail");
    expect(shown[0]).toMatchObject({ variant: "warning", duration: 10_000 });
  });

  it("a notice sent after the TUI attaches shows once", async () => {
    const bridge = createRpcBridge();
    const stop = await start(bridge);
    const toasts: Toast[] = [];
    let stopTui: (() => void) | undefined;
    try {
      stopTui = attachTui(bridge, toasts);
      await waitFor(() => settings(toasts).length >= 2, 5_000);
      web.release();
      await waitFor(() => webNotices(toasts).length >= 1, 5_000);
      await sleep(200);
    } finally {
      stopTui?.();
      await stop();
    }
    expect(webNotices(toasts)).toEqual([
      {
        title: "Memory Explorer",
        message: "Web UI available at http://127.0.0.1:48794",
        variant: "info",
        duration: 10_000,
      },
    ]);
    expect(new Set(keys(toasts)).size).toBe(toasts.length);
  });

  it("shows each notice once, in order, when one arrives while the TUI collects the earlier ones", async () => {
    const bridge = createRpcBridge();
    const stop = await start(bridge);
    const toasts: Toast[] = [];
    let stopTui: (() => void) | undefined;
    try {
      await sleep(100);
      // The TUI attaches and asks for the waiting notices; the web notice arrives before the answer.
      bridge.hold();
      stopTui = attachTui(bridge, toasts);
      await sleep(50);
      web.release();
      await sleep(100);
      bridge.release();
      await waitFor(() => webNotices(toasts).length >= 1 && settings(toasts).length >= 2, 5_000);
      await sleep(300);
    } finally {
      stopTui?.();
      await stop();
    }
    expect(settings(toasts)).toHaveLength(2);
    expect(webNotices(toasts)).toHaveLength(1);
    expect(new Set(keys(toasts)).size).toBe(toasts.length);
    const order = keys(toasts);
    const lastSetting = Math.max(
      ...settings(toasts).map((toast) => order.indexOf(`${toast.title}|${toast.message}`))
    );
    expect(order.indexOf(keys(webNotices(toasts))[0]!)).toBeGreaterThan(lastSetting);
  });

  it("a TUI that loads before the server plugin shows the server's notices once", async () => {
    const bridge = createRpcBridge();
    const toasts: Toast[] = [];
    // The TUI asks before the server has registered, so its first request fails.
    const stopTui = attachTui(bridge, toasts);
    const stop = await start(bridge);
    try {
      web.release();
      await waitFor(() => webNotices(toasts).length >= 1 && settings(toasts).length >= 2, 5_000);
      await sleep(300);
    } finally {
      stopTui();
      await stop();
    }
    expect(settings(toasts)).toHaveLength(2);
    expect(webNotices(toasts)).toHaveLength(1);
    expect(new Set(keys(toasts)).size).toBe(toasts.length);
  });
});
