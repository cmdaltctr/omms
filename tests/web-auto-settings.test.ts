import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  backfillModelEdit,
  importStatusBadge,
  lastRunSummary,
  manualModelFieldVisible,
  showsExchangeProgress,
  shouldPollBackfill,
} from "../web/src/lib/auto-import-settings.js";
import {
  isValidClaudeConfigDir as pageClaudeCheck,
  nextClaudeDraft,
} from "../web/src/lib/claude-folder-settings.js";
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

it("keeps an edited Claude Code folder when another section saves", () => {
  // Not edited: the field follows the saved value.
  expect(nextClaudeDraft("/saved", "/old", false)).toBe("/saved");
  expect(nextClaudeDraft(undefined, "/old", false)).toBe("");
  // Edited and not yet saved: the user's text stays.
  expect(nextClaudeDraft("/saved", "/typed", true)).toBe("/typed");
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

it("identifies running hosts for progress callers", () => {
  expect(shouldPollBackfill({ pi: { state: "running" }, opencode: null })).toBe(true);
  expect(shouldPollBackfill({ pi: { state: "done" }, opencode: { state: "failed" } })).toBe(false);
  expect(
    shouldPollBackfill({ pi: null, opencode: null, "claude-code": { state: "running" } })
  ).toBe(true);
});

it("renders automatic import in Memory and web controls in Settings with unchanged switches", () => {
  const folder = join(import.meta.dir, "../web/src/lib/components/settings");
  const memoryFolder = join(import.meta.dir, "../web/src/lib/components/memory");
  const automatic = readFileSync(join(memoryFolder, "AutoImportSection.tsx"), "utf8");
  const memoryView = readFileSync(join(memoryFolder, "MemoryView.tsx"), "utf8");
  const web = readFileSync(join(folder, "WebAppSection.tsx"), "utf8");
  const view = readFileSync(join(folder, "SettingsView.tsx"), "utf8");
  expect(automatic).toContain("autoBackfill");
  expect(automatic).toContain("setInterval");
  expect(automatic).toContain("3000");
  expect(automatic).toContain("backfillModelEdit");
  expect(web).toContain("webServerAutoStart");
  expect(memoryView).toContain('"memory-section-auto-import": <AutoImportSection />');
  expect(view).not.toContain("AutoImportSection");
  expect(readFileSync(join(folder, "AutoImportSection.tsx"), "utf8")).toContain(
    'from "../memory/AutoImportSection"'
  );
  expect(view).toContain(": WebAppSection,");
  // The Claude Code folder: a field, the folder in use, its source, and a missing folder warning.
  const claude = readFileSync(join(folder, "ClaudeFolderSection.tsx"), "utf8");
  expect(view).toContain(": ClaudeFolderSection,");
  expect(claude).toContain("claudeConfigDir");
  // web/tests/claude-folder-status.spec.tsx renders the folder, its source, and the warning.
  expect(claude).toContain("<ClaudeFolderStatus folder={snapshot?.claudeFolder} />");
  // A slow first load never replaces a newer published snapshot.
  expect(claude).toContain("read.isCurrent()");
  expect(claude).toContain("isValidClaudeConfigDir");
  // Claude Code gets a backfill card without a model select.
  expect(automatic).toContain('"claude-code"');
  expect(automatic).toContain('host === "claude-code" ? (');
});

describe("import status badge", () => {
  const status = (state: string, pending = 0, unresolved = 0, error: string | null = null) => ({
    state,
    counts: { pending, unresolved },
    error,
  });
  const run = (over: Record<string, unknown>) =>
    ({
      surface: "auto",
      state: "done",
      total: 6,
      done: 6,
      percent: 100,
      minutesLeft: null,
      paused: false,
      ...over,
    }) as never;

  it("shows each badge the spec names", () => {
    expect(importStatusBadge(status("done"), run({}))).toEqual({ kind: "imported" });
    expect(importStatusBadge(status("done", 0, 27), run({}))).toEqual({
      kind: "partly",
      unresolved: 27,
    });
    expect(importStatusBadge(status("running"), run({ state: "running" }))).toEqual({
      kind: "running",
    });
    expect(
      importStatusBadge(
        status("running"),
        run({ state: "running", phase: "profile", profileDone: 2, profileTotal: 3 })
      )
    ).toEqual({ kind: "learning-profile", done: 2, total: 3 });
    expect(importStatusBadge(status("stopped", 4), run({ state: "paused", paused: true }))).toEqual(
      { kind: "paused" }
    );
    expect(importStatusBadge(status("failed", 0, 0, "offline"), run({ state: "failed" }))).toEqual({
      kind: "failed",
      error: "offline",
    });
    expect(importStatusBadge(null, null)).toEqual({ kind: "not-started" });
    // A finished run with one failed exchange is partly imported, not failed.
    expect(
      importStatusBadge(
        {
          state: "failed",
          counts: { pending: 0, unresolved: 27, failed: 1 },
          error: "call failed",
        },
        run({ state: "done" })
      )
    ).toEqual({ kind: "partly", unresolved: 27 });
    // A backfill that failed before its run finished stays failed.
    expect(
      importStatusBadge(
        { state: "failed", counts: { pending: 0, unresolved: 0, failed: 0 }, error: "no package" },
        run({ state: "done" })
      )
    ).toEqual({ kind: "failed", error: "no package" });
    expect(importStatusBadge(status("stopped", 5), run({ state: "stopped" }))).toEqual({
      kind: "stopped",
      pending: 5,
    });
  });

  it("shows a latest profile failure instead of an older successful backfill", () => {
    const failedRun = run({
      state: "failed",
      phase: "profile",
      startedAt: 200,
      updatedAt: 300,
      error: "Profile analysis failed: invalid_response [REDACTED]",
      rawReply: "private model reply",
    });
    expect(importStatusBadge({ ...status("done"), updatedAt: 100 }, failedRun)).toEqual({
      kind: "failed",
      error: "Profile analysis failed: invalid_response [REDACTED]",
    });
  });

  it("shows a latest profile failure when no backfill exists", () => {
    expect(
      importStatusBadge(
        null,
        run({ state: "failed", phase: "profile", updatedAt: 300, error: "timeout" })
      )
    ).toEqual({ kind: "failed", error: "timeout" });
  });

  it("keeps a newer successful backfill ahead of an older failed run", () => {
    for (const timestamps of [
      { startedAt: 50, updatedAt: 100 },
      { startedAt: 100, updatedAt: null },
    ]) {
      expect(
        importStatusBadge(
          { ...status("done"), updatedAt: 200 },
          run({ state: "failed", error: "old failure", ...timestamps })
        )
      ).toEqual({ kind: "imported" });
    }
  });

  it("keeps completed runs with failed memory units Imported or Partly imported", () => {
    for (const unresolved of [0, 27]) {
      expect(
        importStatusBadge(
          {
            state: "failed",
            counts: { pending: 0, unresolved, failed: 1 },
            error: "call failed",
          },
          run({ state: "done", failed: 1, error: "call failed" })
        )
      ).toEqual(unresolved ? { kind: "partly", unresolved } : { kind: "imported" });
    }
  });

  it("draws the exchange bar only during the exchange phase of an active run", () => {
    expect(showsExchangeProgress(run({ state: "running" }))).toBe(true);
    expect(showsExchangeProgress(run({ state: "running", phase: "profile" }))).toBe(false);
    expect(showsExchangeProgress(run({ state: "done" }))).toBe(false);
  });

  it("summarises the last finished run and nothing while one runs", () => {
    expect(lastRunSummary(run({ updatedAt: 99, imported: 6, skipped: 0, failed: 0 }))).toEqual({
      finishedAt: 99,
      surface: "auto",
      imported: 6,
      skipped: 0,
      failed: 0,
      state: "done",
    });
    expect(lastRunSummary(run({ state: "running", updatedAt: 99 }))).toBeNull();
  });
});
