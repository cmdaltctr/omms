import { expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  backfillModelEdit,
  manualModelFieldVisible,
  shouldPollBackfill,
} from "../web/src/lib/auto-import-settings.js";

it("saves the backfill model without editing the live-capture model", () => {
  expect(backfillModelEdit("pi", "inherit")).toEqual({ piBackfillModel: "inherit" });
  expect(backfillModelEdit("pi", "zai/glm-5-turbo")).toEqual({
    piBackfillModel: "zai/glm-5-turbo",
  });
  expect(backfillModelEdit("opencode", "a/b/c")).toEqual({ opencodeBackfillModel: "a/b/c" });
  expect(() => backfillModelEdit("pi", "provider/")).toThrow();
});

it("keeps the manual field visible when typed text matches a listed model", () => {
  expect(manualModelFieldVisible(true, true)).toBe(true);
  expect(manualModelFieldVisible(false, true)).toBe(false);
  expect(manualModelFieldVisible(undefined, false)).toBe(true);
  expect(manualModelFieldVisible(undefined, true)).toBe(false);
});

it("polls only while a host is running", () => {
  expect(shouldPollBackfill({ pi: { state: "running" }, opencode: null })).toBe(true);
  expect(shouldPollBackfill({ pi: { state: "done" }, opencode: { state: "failed" } })).toBe(false);
});

it("renders both Settings sections with the global switches and the running poll", () => {
  const folder = join(import.meta.dir, "../web/src/lib/components/settings");
  const automatic = readFileSync(join(folder, "AutoImportSection.tsx"), "utf8");
  const web = readFileSync(join(folder, "WebAppSection.tsx"), "utf8");
  const view = readFileSync(join(folder, "SettingsView.tsx"), "utf8");
  expect(automatic).toContain("autoBackfill");
  expect(automatic).toContain("setInterval");
  expect(automatic).toContain("3000");
  expect(automatic).toContain("backfillModelEdit");
  expect(web).toContain("webServerAutoStart");
  expect(view).toContain("<AutoImportSection />");
  expect(view).toContain("<WebAppSection />");
});
