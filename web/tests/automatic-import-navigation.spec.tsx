import { expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { HostRunDetails } from "../src/lib/components/memory/HostRunDetails";
import { HostSettings } from "../src/lib/components/memory/HostSettings";
import type { Backfill } from "../src/lib/components/memory/use-backfill";
import type { ImportRunView } from "../src/lib/auto-import-settings";

const hosts = ["pi", "opencode", "claude-code"] as const;
const row = (unresolved: number) => ({
  state: "done",
  model: "synthetic/model",
  cutoff: 1,
  counts: { imported: 10, skipped: 3, failed: 1, pending: 0, unresolved },
  error: "Synthetic error",
});
const run = (phase: "exchanges" | "profile" | "done"): NonNullable<ImportRunView> => ({
  state: phase === "done" ? "done" : "running",
  phase: phase === "done" ? "exchanges" : phase,
  surface: "web",
  updatedAt: 1,
  imported: 10,
  skipped: 3,
  failed: 1,
  done: 14,
  total: 19,
  percent: 73,
  minutesLeft: null,
  paused: false,
  startedAt: 1,
  profileDone: 1,
  profileTotal: 2,
});
const render = (host: (typeof hosts)[number], phase: "exchanges" | "profile" | "done" = "done") =>
  renderToStaticMarkup(
    <HostRunDetails host={host} run={run(phase)} row={row(hosts.indexOf(host) + 2)} />
  );

it("keeps operational information and a link to the host's folders without duplicate pills", () => {
  for (const host of hosts) {
    const html = render(host);
    expect(html).not.toContain("Partly imported");
    // The link opens that host's own view at its list of sessions that need a folder.
    expect(html).toContain(`href="/memory/${host}#host-unresolved"`);
    for (const text of [
      "Last run",
      "Imported",
      "Skipped",
      "Failed",
      "Pending",
      "Unresolved sessions",
      "synthetic/model",
      "Cutoff",
      "Synthetic error",
    ]) {
      expect(html).toContain(text);
    }
  }
  expect(render("pi")).toContain('aria-label="Pi: Resolve missing project folders"');
});

it("keeps exchange progress, profile progress, and polling", () => {
  expect(render("pi", "exchanges")).toContain('role="progressbar"');
  expect(render("pi", "exchanges")).toContain("Minutes left");
  expect(render("pi", "profile")).toContain("Learning the profile from the imported prompts");
  expect(render("pi", "profile")).toContain("1 / 2 batches");
  expect(render("pi", "profile")).not.toContain('role="progressbar"');
  const source = readFileSync(
    new URL("../src/lib/components/memory/use-backfill.ts", import.meta.url),
    "utf8"
  );
  expect(source).toContain("setInterval(");
  expect(source).toContain("POLL_MS = 3000");
  // Polls and control-action refreshes overlap: only the newest reply sets state.
  expect(source).toContain("latestReply<Rows>(");
  expect(source).toContain("latestReply<Runs>(");
  expect(source).not.toMatch(/\.then\(setRuns\)/);
});

const backfill = (settings: Record<string, { globalValue?: unknown }> = {}): Backfill =>
  ({
    snapshot: { revision: "fixture", settings },
    rows: { pi: null, opencode: null, "claude-code": null },
    runs: undefined,
    lists: { opencode: { available: true, models: [] } },
    message: "",
    busy: false,
    save: async () => {},
    control: async () => {},
    saveModel: () => {},
    setMessage: () => {},
  }) as unknown as Backfill;

it("keeps the backfill model and the automatic-import switch in each host's own settings", () => {
  const opencode = renderToStaticMarkup(
    <HostSettings host="opencode" backfill={backfill({ autoBackfill: { globalValue: true } })} />
  );
  expect(opencode).toContain('aria-label="OpenCode Backfill model"');
  expect(opencode).toContain("Save model");
  expect(opencode).toContain("Import past chats automatically");
  expect(opencode).toMatch(/type="checkbox"[^>]*checked/);
  expect(opencode).toContain("applies to every host");
});

it("tells Claude Code users it has no backfill model", () => {
  const html = renderToStaticMarkup(<HostSettings host="claude-code" backfill={backfill()} />);
  expect(html).toContain("always uses the external API");
  expect(html).not.toContain('Backfill model"');
  expect(html).not.toContain("Save model");
  expect(html).toContain("Import past chats automatically");
});
