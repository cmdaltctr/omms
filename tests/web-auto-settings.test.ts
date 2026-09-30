import { expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  backfillModelEdit,
  manualModelFieldVisible,
  shouldPollBackfill,
} from "../web/src/lib/auto-import-settings.js";
import { isValidClaudeConfigDir as pageClaudeCheck } from "../web/src/lib/claude-folder-settings.js";
import { isValidClaudeConfigDir as serverClaudeCheck } from "../src/services/claude-folder.js";

it("checks the Claude Code folder on the page the way the server does", () => {
  const values = [
    "",
    "  ",
    "/data/claude",
    "~/claude",
    "claude/config",
    "./claude",
    "~",
    "~claude",
  ];
  for (const value of values) {
    expect(pageClaudeCheck(value)).toBe(serverClaudeCheck(value));
  }
  expect(pageClaudeCheck("claude/config")).toBe(false);
});

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
  expect(
    shouldPollBackfill({ pi: null, opencode: null, "claude-code": { state: "running" } })
  ).toBe(true);
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
  // The Claude Code folder: a field, the folder in use, its source, and a missing folder warning.
  const claude = readFileSync(join(folder, "ClaudeFolderSection.tsx"), "utf8");
  expect(view).toContain("<ClaudeFolderSection />");
  expect(claude).toContain("claudeConfigDir");
  // web/tests/claude-folder-status.spec.tsx renders the folder, its source, and the warning.
  expect(claude).toContain("<ClaudeFolderStatus folder={snapshot?.claudeFolder} />");
  expect(claude).toContain("isValidClaudeConfigDir");
  // Claude Code gets a backfill card without a model select.
  expect(automatic).toContain('"claude-code"');
  expect(automatic).toContain('host === "claude-code" ? (');
});
