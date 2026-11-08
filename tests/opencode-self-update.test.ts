import { expect, it } from "bun:test";
import {
  OPENCODE_SERVICE_CHECK_MS,
  opencodeSelfUpdateDeps,
  startOpencodeServiceSelfUpdate,
} from "../src/adapters/opencode/self-update.js";

const NPM_PATH =
  "/home/u/.cache/opencode/npm/om-memory-system@latest/1794091868583/node_modules/om-memory-system/dist/v2/plugin.js";

it("builds the OpenCode update inputs from the module path and home folder", () => {
  const deps = opencodeSelfUpdateDeps({
    modulePath: NPM_PATH,
    currentVersion: "4.2.0",
    home: "/home/u",
    log: () => {},
    env: {},
  });
  expect(deps.logLabel).toBe("OpenCode plugin self-update");
  expect(deps.command).toBe("opencode");
  expect(deps.args).toEqual(["plugin", "update", "om-memory-system"]);
  expect(deps.markerPath.replaceAll("\\", "/")).toBe("/home/u/.omms/opencode-plugin-update.json");
  expect(deps.currentVersion).toBe("4.2.0");
  expect(deps.enabled).toBe(true);
  expect(deps.installSource()).toBe("npm");
});

it("treats a local checkout and a pinned cache folder as not updatable", () => {
  const source = (modulePath: string) =>
    opencodeSelfUpdateDeps({ modulePath, currentVersion: "4.2.0", log: () => {} }).installSource();
  expect(source("/home/u/dev/omms/dist/v2/plugin.js")).toBe("local");
  expect(source(NPM_PATH.replace("@latest", "@4.2.0"))).toBe("pinned");
});

it("turns the update off with OMMS_DISABLE_UPDATE_CHECK", () => {
  const deps = opencodeSelfUpdateDeps({
    modulePath: NPM_PATH,
    currentVersion: "4.2.0",
    log: () => {},
    env: { OMMS_DISABLE_UPDATE_CHECK: "1" },
  });
  expect(deps.enabled).toBe(false);
});

it("checks at once and again at each interval in the background service", async () => {
  let runs = 0;
  const stop = startOpencodeServiceSelfUpdate({
    run: async () => {
      runs++;
    },
    intervalMs: 5,
  });
  expect(runs).toBe(1);
  await Bun.sleep(30);
  stop();
  const afterStop = runs;
  expect(afterStop).toBeGreaterThan(1);
  await Bun.sleep(20);
  expect(runs).toBe(afterStop);
});

it("keeps running when a check throws or rejects", async () => {
  let runs = 0;
  const stop = startOpencodeServiceSelfUpdate({
    run: () => {
      runs++;
      if (runs === 1) throw new Error("boom");
      return Promise.reject(new Error("offline"));
    },
    intervalMs: 5,
  });
  await Bun.sleep(30);
  stop();
  expect(runs).toBeGreaterThan(1);
});

it("rechecks every 6 hours by default, like the OpenCode footer", () => {
  expect(OPENCODE_SERVICE_CHECK_MS).toBe(6 * 3_600_000);
});
