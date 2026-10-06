import { expect, it, mock } from "bun:test";
import * as react from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";

let states: unknown[] = [];
let cursor = 0;
let effects: (() => unknown)[] = [];
let refs: { current: unknown }[] = [];
let refCursor = 0;
const sets: [number, unknown][] = [];
mock.module("react", () => ({
  ...react,
  useEffect: (effect: () => unknown) => effects.push(effect),
  useRef: (value: unknown) => (refs[refCursor++] ??= { current: value }),
  useState: (initial: unknown) => {
    const index = cursor++;
    return [
      states[index] ?? (typeof initial === "function" ? initial() : initial),
      (value: unknown) => sets.push([index, value]),
    ];
  },
}));
const { AutoImportSection } = await import("../src/lib/components/settings/AutoImportSection.tsx");
const hosts = ["pi", "opencode", "claude-code"] as const;
function render(phase: "exchanges" | "profile" | "done" = "done") {
  const rows = Object.fromEntries(
    hosts.map((host, i) => [
      host,
      {
        state: "done",
        model: "synthetic/model",
        cutoff: 1,
        counts: { imported: 10, skipped: 3, failed: 1, pending: 0, unresolved: i + 2 },
        error: "Synthetic error",
      },
    ])
  );
  const runs = Object.fromEntries(
    hosts.map((host) => [
      host,
      {
        runNowUnavailable: null,
        run: {
          state: phase === "done" ? "done" : "running",
          phase,
          surface: "web",
          updatedAt: 1,
          imported: 10,
          skipped: 3,
          failed: 1,
          pending: 5,
          unresolved: 2,
          done: 14,
          total: 19,
          elapsedMs: 1000,
          startedAt: 1,
          profileDone: 1,
          profileTotal: 2,
        },
      },
    ])
  );
  states = [{ revision: "fixture", settings: {} }, rows, runs, {}, {}, {}, "", false, open];
  cursor = 0;
  refCursor = 0;
  effects = [];
  return renderToStaticMarkup(<AutoImportSection />);
}
// The host cards' open state, index 8 of the section's useState calls.
const OPEN_STATE = 8;
let open: Record<string, boolean> = {};

it("keeps operational information and host links without duplicate overall pills", () => {
  const html = render();
  expect(html).not.toContain("Partly imported");
  for (const host of hosts) expect(html).toContain(`href="#directory-maps-${host}"`);
  for (const text of [
    "Pi",
    "OpenCode",
    "Claude Code",
    "State",
    "done",
    "Last run",
    "Imported",
    "Skipped",
    "Failed",
    "Pending",
    "Unresolved sessions",
    "synthetic/model",
    "Cutoff",
    "Synthetic error",
    "Save model",
    "Run now",
    "Pause",
    "Resume",
  ]) {
    expect(html).toContain(text);
  }
  expect(html).toContain('aria-label="Pi: Directory maps"');
});

it("keeps exchange progress, profile progress, and polling", () => {
  expect(render("exchanges")).toContain('role="progressbar"');
  expect(render("exchanges")).toContain("Minutes left");
  expect(render("profile")).toContain("Learning the profile from the imported prompts");
  expect(render("profile")).toContain("1 / 2 batches");
  const source = readFileSync(
    new URL("../src/lib/components/settings/AutoImportSection.tsx", import.meta.url),
    "utf8"
  );
  expect(source).toContain("shouldPollBackfill(rows)");
  expect(source).toContain("setInterval(");
  expect(source).toContain("3000");
  expect(source).toContain("onClick={() => revealDirectoryMaps(host)}");
  // Polls and control-action refreshes overlap: only the newest reply sets state.
  expect(source).toContain("latestReply<Rows>(");
  expect(source).toContain("latestReply<Runs>(");
  expect(source).not.toMatch(/\.then\(setRuns\)/);
});

it("puts each host card in a collapsed disclosure with a one-line status", () => {
  open = {};
  const html = render();
  expect(html.match(/<details/g)?.length).toBe(3);
  expect(html).not.toMatch(/<details[^>]*\bopen[= >]/);
  expect(html).toContain("State: done · Pending: 0 · Unresolved sessions: 2");
  for (const summary of html.matchAll(/<summary[^>]*>([\s\S]*?)<\/summary>/g)) {
    expect(summary[1]).not.toMatch(/<a |<button|<input/);
  }
  // The switch stays above the cards.
  expect(html.indexOf("Import past chats automatically")).toBeLessThan(html.indexOf("<details"));
  open = { pi: true };
  expect(render().match(/<details[^>]*\bopen[= >]/g)?.length).toBe(1);
  open = {};
});

it("opens running or paused hosts once, then leaves the cards to the user", async () => {
  const { initialCardsOpen } = await import("../src/lib/auto-import-settings.ts");
  const run = (state: string, paused = false) => ({ run: { state, paused } as never });
  expect(
    initialCardsOpen({
      pi: run("running"),
      opencode: run("done", true),
      "claude-code": run("done"),
    })
  ).toEqual({ pi: true, opencode: true, "claude-code": false });
  refs = [];
  sets.length = 0;
  render("exchanges");
  for (const effect of effects) effect();
  render("exchanges");
  for (const effect of effects) effect();
  const opened = sets.filter(([index]) => index === OPEN_STATE);
  expect(opened).toEqual([[OPEN_STATE, { pi: true, opencode: true, "claude-code": true }]]);
});
