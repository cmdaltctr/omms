import { afterAll, afterEach, beforeEach, expect, it, mock } from "bun:test";
import * as react from "react";
import type { ReactElement, ReactNode } from "react";
import type { ImportRunView } from "../src/lib/auto-import-settings.ts";

// Use the same hook harness as the existing Memory interaction specs.
let state: unknown[] = [];
let refs: { current: unknown }[] = [];
let deps: unknown[][] = [];
let cursor = 0;
let refCursor = 0;
let effectCursor = 0;
let effects: (() => unknown)[] = [];
let cleanups: (() => void)[] = [];
mock.module("react", () => ({
  ...react,
  useContext: () => null,
  useMemo: (factory: () => unknown) => factory(),
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
  useRef: (value: unknown) => (refs[refCursor++] ??= { current: value }),
  useEffect: (effect: () => unknown, dependencies: unknown[] = []) => {
    const index = effectCursor++;
    if (!deps[index] || dependencies.some((value, i) => value !== deps[index][i]))
      effects.push(effect);
    deps[index] = dependencies;
  },
  useState: (initial: unknown) => {
    const index = cursor++;
    if (!(index in state)) state[index] = typeof initial === "function" ? initial() : initial;
    return [
      state[index],
      (value: unknown) => {
        state[index] = typeof value === "function" ? value(state[index]) : value;
      },
    ];
  },
}));

const originalFetch = globalThis.fetch;
const originalInterval = globalThis.setInterval;
const originalClear = globalThis.clearInterval;
const originalWindow = globalThis.window;
const timers = new Map<number, () => void>();
const requests: { path: string; method: string }[] = [];
let run: ImportRunView = null;
let nextTimer = 0;
Object.assign(globalThis, {
  window: { location: { pathname: "/memory", hash: "" } },
  setInterval: (callback: () => void) => {
    timers.set(++nextTimer, callback);
    return nextTimer;
  },
  clearInterval: (id: number) => timers.delete(id),
  fetch: async (path: string, options: RequestInit = {}) => {
    requests.push({ path, method: options.method ?? "GET" });
    const hosts = ["pi", "opencode", "claude-code"];
    let value: unknown = {};
    if (path === "/api/settings")
      value = { revision: "fixture", settings: { autoBackfill: { globalValue: false } } };
    if (path.startsWith("/api/settings/models")) value = { available: true, models: [] };
    if (path === "/api/settings/backfill")
      value = Object.fromEntries(
        hosts.map((host) => [
          host,
          {
            state: host === "pi" ? (run?.state ?? "not-started") : "not-started",
            model: "synthetic/model",
            cutoff: 1,
            counts: {
              imported: host === "pi" ? (run?.imported ?? 0) : 0,
              skipped: 0,
              failed: 0,
              pending: host === "pi" && run?.state === "running" ? run.total - run.done : 0,
              unresolved: 0,
            },
            error: null,
          },
        ])
      );
    if (path === "/api/settings/backfill/runs")
      value = Object.fromEntries(
        hosts.map((host) => [host, { run: host === "pi" ? run : null, runNowUnavailable: null }])
      );
    return new Response(JSON.stringify(value));
  },
});
const { AutoImportSection } = await import("../src/lib/components/memory/AutoImportSection.tsx");
const { HostImportBadges } = await import("../src/lib/components/settings/HostImportBadges.tsx");
const { ImportStatusBadge } = await import("../src/lib/components/settings/ImportStatusBadge.tsx");

type Node = ReactElement<{ children?: ReactNode; [key: string]: any }>;
function nodes(node: ReactNode): Node[] {
  if (!react.isValidElement(node)) return Array.isArray(node) ? node.flatMap(nodes) : [];
  const element = node as Node;
  if (element.type === ImportStatusBadge) return nodes(ImportStatusBadge(element.props as never));
  return [element, ...nodes(element.props.children)];
}
function render(component = AutoImportSection) {
  cursor = refCursor = effectCursor = 0;
  const tree = nodes(component());
  for (const effect of effects.splice(0)) {
    const cleanup = effect();
    if (typeof cleanup === "function") cleanups.push(cleanup as () => void);
  }
  return tree;
}
function text(node: ReactNode): string {
  if (react.isValidElement(node)) return text((node as Node).props.children);
  return Array.isArray(node) ? node.map(text).join("") : String(node ?? "");
}
async function settle() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}
async function poll() {
  for (const callback of timers.values()) callback();
  await settle();
}
function progress(surface: "cli" | "web", overrides: Partial<NonNullable<ImportRunView>> = {}) {
  run = {
    surface,
    state: "running",
    phase: "exchanges",
    total: 1000,
    done: 0,
    percent: 0,
    minutesLeft: null,
    paused: false,
    updatedAt: 1000,
    imported: 0,
    skipped: 0,
    failed: 0,
    ...overrides,
  };
}
beforeEach(() => {
  state = [];
  refs = [];
  deps = [];
  effects = [];
  cleanups = [];
  timers.clear();
  requests.length = 0;
  run = null;
});
afterEach(() => {
  for (const cleanup of cleanups) cleanup();
  expect(timers.size).toBe(0);
});

for (const surface of ["cli", "web"] as const) {
  it(`refreshes an idle Memory card through ${surface === "web" ? "group child" : "CLI"} start, exchanges, profile and completion without losing drafts`, async () => {
    render();
    await settle();
    let tree = render();
    const cards = () => tree.filter((node) => node.type === "details");
    expect(cards().every((node) => !node.props.open)).toBe(true);
    cards()[1].props.onToggle({ currentTarget: { open: true } });
    tree
      .find((node) => node.props["aria-label"] === "OpenCode Backfill model")!
      .props.onChange({ target: { value: "typed" } });
    tree = render();
    tree
      .find((node) => node.props["aria-label"] === "opencode Manual provider/model")!
      .props.onChange({ target: { value: "draft/model" } });
    progress(surface);
    await poll();
    tree = render();
    expect(tree.filter((node) => node.props.role === "progressbar")).toHaveLength(1);
    expect(tree.map(text).join(" ")).toContain("Minutes left: unknown");
    progress(surface, { done: 400, percent: 40, minutesLeft: 120, imported: 400 });
    await poll();
    tree = render();
    expect(tree.find((node) => node.props.role === "progressbar")!.props["aria-valuenow"]).toBe(40);
    expect(tree.map(text).join(" ")).toContain("40% · 400 / 1,000 · Minutes left: about 120");
    progress(surface, {
      phase: "profile",
      done: 1000,
      percent: 100,
      profileDone: 2,
      profileTotal: 3,
    });
    await poll();
    tree = render();
    expect(tree.some((node) => node.props.role === "progressbar")).toBe(false);
    expect(tree.map(text).join(" ")).toContain(
      "Learning the profile from the imported prompts: 2 / 3 batches"
    );
    progress(surface, { state: "done", done: 1000, percent: 100, imported: 1000, skipped: 3 });
    await poll();
    tree = render();
    expect(tree.map(text).join(" ")).toContain("Last run:");
    expect(tree.map(text).join(" ")).toContain("Imported: 1000 · Skipped: 3 · Failed: 0");
    expect(tree.some((node) => node.props.role === "progressbar")).toBe(false);
    expect(cards().map((node) => node.props.open)).toEqual([false, true, false]);
    expect(
      tree.find((node) => node.props["aria-label"] === "opencode Manual provider/model")!.props
        .value
    ).toBe("draft/model");
    expect(requests.every((request) => request.method === "GET")).toBe(true);
    expect(requests.some((request) => request.path.startsWith("/api/settings/imports"))).toBe(
      false
    );
  });
}

it("refreshes idle historical badges when a group child starts and finishes its profile phase", async () => {
  render(HostImportBadges);
  await settle();
  expect(render(HostImportBadges).map(text).join(" ")).toContain("Not started");
  progress("web");
  await poll();
  expect(render(HostImportBadges).map(text).join(" ")).toContain("Running");
  progress("web", { phase: "profile", profileDone: 2, profileTotal: 3 });
  await poll();
  expect(render(HostImportBadges).map(text).join(" ")).toContain("Learning profile 2 / 3");
  progress("web", { state: "done", done: 1000 });
  await poll();
  expect(render(HostImportBadges).map(text).join(" ")).toContain("Imported ✅");
  expect(requests.every((request) => request.method === "GET")).toBe(true);
});

afterAll(() => {
  Object.assign(globalThis, {
    fetch: originalFetch,
    setInterval: originalInterval,
    clearInterval: originalClear,
    window: originalWindow,
  });
});
