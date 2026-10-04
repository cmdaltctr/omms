import { expect, it, mock } from "bun:test";
import * as react from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";

let states: unknown[] = [];
let cursor = 0;
mock.module("react", () => ({
  ...react,
  useEffect: () => {},
  useState: (initial: unknown) => [
    states[cursor++] ?? (typeof initial === "function" ? initial() : initial),
    () => {},
  ],
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
  states = [{ revision: "fixture", settings: {} }, rows, runs, {}, {}, {}, "", false];
  cursor = 0;
  return renderToStaticMarkup(<AutoImportSection />);
}

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
});
