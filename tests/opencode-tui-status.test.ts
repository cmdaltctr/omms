import { describe, expect, it } from "bun:test";
import { fileURLToPath } from "node:url";
import { startTuiStatus, tuiStatusText } from "../src/adapters/opencode/tui-status.js";
import type { HostSelfUpdateResult, HostUpdateStatus } from "../src/services/host-self-update.js";
import { availableUpdate, latestNpmVersion } from "../src/services/update-check.js";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const settle = () => new Promise((resolve) => setTimeout(resolve, 10));

describe("OpenCode TUI entry", () => {
  it("imports Solid only through OpenCode's runtime-module ids", async () => {
    // From node_modules, OpenCode maps neither bare Solid imports nor a JSX
    // runtime to its own copies; Bun compiles JSX for React, as Bun.build does.
    const built = await Bun.build({
      entrypoints: [fileURLToPath(new URL("../opencode/tui.tsx", import.meta.url))],
      packages: "external",
      external: ["../dist/*", "opentui:*"],
    });
    const output = await built.outputs[0]!.text();
    const imports = new Bun.Transpiler({ loader: "js" }).scanImports(output).map((i) => i.path);
    expect(imports.sort()).toEqual([
      "../dist/adapters/opencode/tui-recall.js",
      "../dist/adapters/opencode/tui-status.js",
      "opentui:runtime-module:%40opentui%2Fsolid%2Fjsx-runtime",
      "opentui:runtime-module:solid-js",
    ]);
  });
});

describe("OpenCode footer status", () => {
  it("reads like Pi's status, and adds a newer release", () => {
    expect(tuiStatusText({ web: "connected", update: null })).toBe("omms: ✔");
    expect(tuiStatusText({ web: "offline", update: null })).toBe("omms: ✘ web app off");
    expect(tuiStatusText({ web: "connected", update: "4.3.0" })).toBe("omms: ✔ · 4.3.0 available");
  });

  it("reports only a newer stable release", () => {
    expect(availableUpdate("4.2.0", "4.3.0")).toBe("4.3.0");
    expect(availableUpdate("4.2.0", "4.2.0")).toBeNull();
    expect(availableUpdate("4.3.0", "4.2.0")).toBeNull();
    expect(availableUpdate("4.2.0", "4.3.0-next.1")).toBeNull();
    expect(availableUpdate("4.2.0", null)).toBeNull();
  });

  it("returns null when npm cannot be reached", async () => {
    expect(await latestNpmVersion((async () => json({}, 500)) as any)).toBeNull();
    expect(
      await latestNpmVersion((async () => {
        throw new Error("offline");
      }) as any)
    ).toBeNull();
    expect(await latestNpmVersion((async () => json({ version: "4.3.0" })) as any)).toBe("4.3.0");
  });

  it("shows connected, then the update, and notifies once", async () => {
    const texts: string[] = [];
    const notes: string[] = [];
    const fetch = (async (url: string) =>
      url.includes("registry.npmjs.org")
        ? json({ version: "4.3.0" })
        : json({ status: "ok" })) as any;
    const stop = startTuiStatus({
      currentVersion: "4.2.0",
      healthUrl: "http://127.0.0.1:4747/api/health",
      fetch,
      setText: (text) => texts.push(text),
      notify: (message) => notes.push(message),
    });
    await settle();
    stop();
    expect(texts[0]).toBe("omms: ⧖");
    expect(texts.at(-1)).toBe("omms: ✔ · 4.3.0 available");
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("opencode plugin update om-memory-system");
  });

  it("says the web app is off when its health check fails, and skips npm when told to", async () => {
    const texts: string[] = [];
    const calls: string[] = [];
    const fetch = (async (url: string) => {
      calls.push(url);
      throw new Error("refused");
    }) as any;
    const stop = startTuiStatus({
      currentVersion: "4.2.0",
      healthUrl: "http://127.0.0.1:4747/api/health",
      fetch,
      setText: (text) => texts.push(text),
      notify: () => {},
      checkUpdates: false,
    });
    await settle();
    stop();
    expect(texts.at(-1)).toBe("omms: ✘ web app off");
    expect(calls.every((url) => !url.includes("registry"))).toBe(true);
  });
});

const COMMAND = "opencode plugin update om-memory-system";
const AVAILABLE_TEXT = `om-memory-system 4.3.0 is available (running 4.2.0). Run: ${COMMAND}, then restart OpenCode.`;

/** Start the status with a fake self-update and a fake marker; nothing touches npm, a process or ~/.omms. */
function selfUpdateHarness(
  options: {
    result?: HostSelfUpdateResult | (() => Promise<HostSelfUpdateResult>);
    status?: { value: HostUpdateStatus | null; reads: number };
    updateIntervalMs?: number;
  } = {}
) {
  const texts: string[] = [];
  const notes: string[] = [];
  const status = options.status ?? { value: null, reads: 0 };
  const result = options.result ?? { code: "started" as const, update: "4.3.0" };
  const calls = { selfUpdate: 0 };
  const stop = startTuiStatus({
    currentVersion: "4.2.0",
    healthUrl: "http://127.0.0.1:4747/api/health",
    fetch: (async () => json({ status: "ok" })) as any,
    setText: (text) => texts.push(text),
    notify: (message) => notes.push(message),
    selfUpdate: async () => {
      calls.selfUpdate += 1;
      return typeof result === "function" ? result() : result;
    },
    readUpdateStatus: () => {
      status.reads += 1;
      return status.value;
    },
    watchIntervalMs: 5,
    watchLimitMs: 2_000,
    updateIntervalMs: options.updateIntervalMs,
  });
  return { texts, notes, status, calls, stop };
}

describe("OpenCode footer background update", () => {
  it("says the update is installing, then asks for a restart when it installs", async () => {
    const h = selfUpdateHarness({ status: { value: "pending", reads: 0 } });
    await settle();
    expect(h.notes).toEqual(["om-memory-system 4.3.0 is installing in the background."]);
    expect(h.texts.at(-1)).toBe("omms: ✔ · 4.3.0 available");
    h.status.value = "installed";
    await settle();
    h.stop();
    expect(h.texts.at(-1)).toBe("omms: ✔ · 4.3.0 installed, restart");
    expect(h.notes).toHaveLength(2);
    expect(h.notes[1]).toBe("om-memory-system 4.3.0 installed. Restart OpenCode to use it.");
  });

  it("shows installed at once when another session already finished the update", async () => {
    const h = selfUpdateHarness({
      result: { code: "recent", update: "4.3.0" },
      status: { value: "installed", reads: 0 },
    });
    await settle();
    h.stop();
    expect(h.texts.at(-1)).toBe("omms: ✔ · 4.3.0 installed, restart");
    expect(h.notes).toEqual(["om-memory-system 4.3.0 installed. Restart OpenCode to use it."]);
  });

  it("names the command when the update has already failed", async () => {
    const h = selfUpdateHarness({ status: { value: "failed", reads: 0 } });
    await settle();
    h.stop();
    expect(h.texts.at(-1)).toBe("omms: ✔ · 4.3.0 available");
    expect(h.notes).toEqual([AVAILABLE_TEXT]);
  });

  it("names the command when a pending update later fails", async () => {
    const h = selfUpdateHarness({ status: { value: "pending", reads: 0 } });
    await settle();
    h.status.value = "failed";
    await settle();
    h.stop();
    expect(h.texts.at(-1)).toBe("omms: ✔ · 4.3.0 available");
    expect(h.notes).toEqual([
      "om-memory-system 4.3.0 is installing in the background.",
      AVAILABLE_TEXT,
    ]);
  });

  for (const code of ["local", "pinned", "spawn-failed"] as const) {
    it(`keeps today's text when the install source is ${code}`, async () => {
      const h = selfUpdateHarness({ result: { code, update: "4.3.0" } });
      await settle();
      h.stop();
      expect(h.texts.at(-1)).toBe("omms: ✔ · 4.3.0 available");
      expect(h.notes).toEqual([AVAILABLE_TEXT]);
      expect(h.status.reads).toBe(0);
    });
  }

  it("shows no notice when there is nothing newer", async () => {
    const h = selfUpdateHarness({ result: { code: "current", update: null } });
    await settle();
    h.stop();
    expect(h.texts.at(-1)).toBe("omms: ✔");
    expect(h.notes).toEqual([]);
  });

  it("does not repeat a toast on the recheck", async () => {
    const h = selfUpdateHarness({
      result: { code: "pinned", update: "4.3.0" },
      updateIntervalMs: 15,
    });
    await new Promise((resolve) => setTimeout(resolve, 80));
    h.stop();
    expect(h.calls.selfUpdate).toBeGreaterThan(2);
    expect(h.notes).toEqual([AVAILABLE_TEXT]);
  });

  it("stops asking once the release is installed", async () => {
    const h = selfUpdateHarness({
      result: { code: "recent", update: "4.3.0" },
      status: { value: "installed", reads: 0 },
      updateIntervalMs: 15,
    });
    await new Promise((resolve) => setTimeout(resolve, 80));
    h.stop();
    expect(h.calls.selfUpdate).toBe(1);
    expect(h.notes).toHaveLength(1);
  });

  it("stops the marker watcher with the status", async () => {
    const h = selfUpdateHarness({ status: { value: "pending", reads: 0 } });
    await settle();
    h.stop();
    const reads = h.status.reads;
    expect(reads).toBeGreaterThan(0);
    h.status.value = "installed";
    await settle();
    expect(h.status.reads).toBe(reads);
    expect(h.notes).toEqual(["om-memory-system 4.3.0 is installing in the background."]);
  });

  it("keeps the footer working when the update path throws", async () => {
    const h = selfUpdateHarness({
      result: async () => {
        throw new Error("boom");
      },
    });
    await settle();
    h.stop();
    expect(h.texts.at(-1)).toBe("omms: ✔");
    expect(h.notes).toEqual([]);
  });

  it("does not start an update when the check is turned off", async () => {
    const texts: string[] = [];
    let called = false;
    const stop = startTuiStatus({
      currentVersion: "4.2.0",
      healthUrl: "http://127.0.0.1:4747/api/health",
      fetch: (async () => json({ status: "ok" })) as any,
      setText: (text) => texts.push(text),
      notify: () => {},
      checkUpdates: false,
      selfUpdate: async () => {
        called = true;
        return { code: "started", update: "4.3.0" };
      },
    });
    await settle();
    stop();
    expect(called).toBe(false);
    expect(texts.at(-1)).toBe("omms: ✔");
  });
});
