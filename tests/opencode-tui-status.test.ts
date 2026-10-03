import { describe, expect, it } from "bun:test";
import { fileURLToPath } from "node:url";
import { startTuiStatus, tuiStatusText } from "../src/adapters/opencode/tui-status.js";
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
      "../dist/adapters/opencode/tui-status.js",
      "opentui:runtime-module:%40opentui%2Fsolid%2Fjsx-runtime",
      "opentui:runtime-module:solid-js",
    ]);
  });
});

describe("OpenCode footer status", () => {
  it("reads like Pi's status, and adds a newer release", () => {
    expect(tuiStatusText({ web: "connected", update: null })).toBe("omms:connected");
    expect(tuiStatusText({ web: "offline", update: null })).toBe("omms:web app off");
    expect(tuiStatusText({ web: "connected", update: "4.3.0" })).toBe(
      "omms:connected · 4.3.0 available"
    );
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
    expect(texts[0]).toBe("omms:warming");
    expect(texts.at(-1)).toBe("omms:connected · 4.3.0 available");
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
    expect(texts.at(-1)).toBe("omms:web app off");
    expect(calls.every((url) => !url.includes("registry"))).toBe(true);
  });
});
