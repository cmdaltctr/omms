import { afterEach, beforeEach, expect, it, mock } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import * as react from "react";
import { setLanguage } from "../src/lib/i18n/index.ts";
import { allSetUp, fakeStatuses } from "./fake-statuses";

// The section keeps its snapshot, draft, busy and status in this order, so the
// tests can inject each state through the shared mock (as reranker-section.spec).
let states: unknown[] = [];
let cursor = 0;
mock.module("react", () => ({
  ...react,
  useEffect: () => {},
  useRef: (value: unknown) => ({ current: value }),
  useContext: () => null,
  useMemo: (factory: () => unknown) => factory(),
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
  useState: (initial: unknown) => {
    const index = cursor++;
    states[index] ??= typeof initial === "function" ? (initial as () => unknown)() : initial;
    return [states[index], () => {}];
  },
}));
const { MemoryInjectionSection } =
  await import("../src/lib/components/memory/MemoryInjectionSection.tsx");
const { MemoryOverview } = await import("../src/lib/components/memory/MemoryOverview.tsx");
const { SharedView } = await import("../src/lib/components/memory/SharedView.tsx");

const DEFAULT_QUERY = "project architecture, setup, conventions and key decisions";
const draft = (over: Record<string, unknown> = {}) => ({
  opening: false,
  query: DEFAULT_QUERY,
  subagent: true,
  restore: true,
  limit: "10",
  ...over,
});
const section = (d = draft(), busy = false, status: unknown = undefined) => {
  states = [undefined, d, busy, status];
  cursor = 0;
  return renderToStaticMarkup(<MemoryInjectionSection />);
};
const overview = () => {
  states = [];
  cursor = 0;
  return renderToStaticMarkup(
    <MemoryOverview statuses={fakeStatuses(allSetUp)} profilePreset={0} />
  );
};

beforeEach(() => setLanguage("en"));
afterEach(() => setLanguage("en"));

it("sits after the host cards and the Import all hosts row, with the memory-injection anchor", () => {
  const html = overview();
  const cards = html.indexOf(">Shared<");
  const importRow = html.indexOf('id="memory-import-all"');
  const injection = html.indexOf('id="memory-injection"');
  expect(cards).toBeGreaterThan(0);
  expect(importRow).toBeGreaterThan(cards);
  expect(injection).toBeGreaterThan(importRow);
  expect(html.match(/id="memory-injection"/g)).toHaveLength(1);
});

it("shows the defaults: opening off, the default query, subagent on, restore on with limit 10", () => {
  const html = section();
  const box = (id: string) => html.match(new RegExp(`<input[^>]*id="${id}"[^>]*>`))![0];
  expect(box("injection-opening")).not.toContain("checked");
  expect(box("injection-subagent")).toContain("checked");
  expect(box("injection-restore")).toContain("checked");
  expect(box("injection-opening")).toContain('role="switch"');
  expect(html).toContain(">Inject memories at session start<");
  expect(html).toContain(">Subagent memory<");
  expect(html).toContain(">Restore memories after compaction or resume<");
  expect(html).toContain(DEFAULT_QUERY);
  expect(html).toMatch(/<input[^>]*id="injection-limit"[^>]*value="10"/);
  expect(html).toContain("Most memories to restore");
});

it("shows saved values: opening on with a custom query, restore off", () => {
  const html = section(draft({ opening: true, query: "release notes", restore: false }));
  expect(html.match(/<input[^>]*id="injection-opening"[^>]*>/)![0]).toContain("checked");
  expect(html.match(/<input[^>]*id="injection-restore"[^>]*>/)![0]).not.toContain("checked");
  expect(html).toContain("release notes");
});

it("limits the query to 500 characters and counts them", () => {
  const html = section(draft({ query: "a".repeat(120) }));
  expect(html).toMatch(/<textarea[^>]*maxLength="500"/);
  expect(html).toContain("120 / 500");
  expect(section()).toContain(`${DEFAULT_QUERY.length} / 500`);
});

it("has the help texts, the host note and the project note", () => {
  const html = section();
  expect(html).toContain(
    "Added to the first message of a new session. OMMS searches the query below and adds only matching memories."
  );
  expect(html).toContain(
    "Subagents get memories that match their task. No rows are shown for them."
  );
  expect(html).toContain(
    "Applies to OpenCode V2, Pi and Claude Code. OpenCode V1 is not covered. On Pi, subagent memory needs om-pi-subagents to load OMMS."
  );
  expect(html).toContain(
    "A project config can turn the session-start and subagent options off. It can turn restore on or off."
  );
});

it("has Save and Reset to default, and disables Save while busy or when the limit is invalid", () => {
  const button = (html: string, label: string) =>
    html.match(new RegExp(`<button[^>]*>${label}</button>`))![0];
  expect(button(section(), "Save")).toBeTruthy();
  expect(button(section(), "Reset to default")).toBeTruthy();
  expect(button(section(draft(), true), "Save")).toContain("disabled");
  const invalid = section(draft({ limit: "0", opening: true }));
  expect(button(invalid, "Save")).toContain("disabled");
  expect(invalid).toContain("Enter a positive whole number.");
});

it("shows the writer's message when a save is rejected, and the saved line after a save", () => {
  const rejected = section(draft(), false, {
    kind: "save-failed",
    message: "Invalid compaction.memoryLimit setting: accepted positive safe integers",
    reloaded: true,
  });
  expect(rejected).toContain(
    "Invalid compaction.memoryLimit setting: accepted positive safe integers"
  );
  expect(rejected).toContain("Current settings were reloaded; check the values and save again.");
  const saved = section(draft(), false, { kind: "saved", reloaded: true });
  expect(saved).toContain("Saved. The next session uses these options.");
});

it("shows every label in Chinese and Arabic", () => {
  setLanguage("zh");
  expect(section()).not.toContain(">Inject memories at session start<");
  setLanguage("ar");
  const html = section();
  expect(html).not.toContain("Inject memories at session start");
  expect(html).not.toContain("Reset to default");
  expect(html).not.toContain("Most memories to restore");
});

it("gives the Shared view one link row with the switch states and no controls", () => {
  states = [];
  cursor = 0;
  const html = renderToStaticMarkup(
    <SharedView statuses={fakeStatuses(allSetUp)} onReanalyse={() => {}} />
  );
  const start = html.indexOf('id="shared-memory-injection"');
  expect(start).toBeGreaterThan(0);
  const row = html.slice(html.lastIndexOf("<a ", start), html.indexOf("</a>", start) + 4);
  expect(row).toContain('href="/memory#memory-injection"');
  expect(row).toContain("Memory injection");
  expect(row).toMatch(/Session start Off · Subagents On · Restore On/);
  expect(row).not.toMatch(/<(input|textarea|select|button)/);
  expect(html).not.toContain('id="memory-injection"');
});
