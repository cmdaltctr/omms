import { afterEach, beforeEach, expect, it, mock } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement, ReactNode } from "react";
import * as react from "react";
import { setLanguage } from "../src/lib/i18n/index.ts";
import { translateSettings } from "../src/lib/i18n/settings.ts";
import { MEMORY_SECTIONS } from "../src/lib/memory-sections.ts";

// Same shared mock as memory-section.spec.tsx: the card keeps snapshot,
// draft, busy, and status in this order so tests can inject each state.
let states: unknown[] = [];
let cursor = 0;
let effects: (() => unknown)[] = [];
mock.module("react", () => ({
  ...react,
  useEffect: (effect: () => unknown) => {
    effects.push(effect);
  },
  useRef: (value: unknown) => ({ current: value }),
  useContext: () => null,
  useMemo: (factory: () => unknown) => factory(),
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
  useState: (initial: unknown) => {
    const index = cursor++;
    states[index] ??= typeof initial === "function" ? (initial as () => unknown)() : initial;
    return [
      states[index],
      (value: unknown) => {
        states[index] = typeof value === "function" ? value(states[index]) : value;
      },
    ];
  },
}));
const { RerankerSection } = await import("../src/lib/components/memory/RerankerSection.tsx");
const controls = await import("../src/lib/reranker-controls.ts");

type Setting = { value?: unknown; source: string; globalValue?: unknown };
type Snapshot = {
  revision: string;
  settings: Record<string, Setting>;
  secrets: Record<string, { set: boolean; source: string | null; reference: string | null }>;
};

function snapshotFixture(overrides: Record<string, Setting> = {}): Snapshot {
  return {
    revision: "rev-1",
    settings: {
      rerankerEnabled: { value: false, source: "default", globalValue: false },
      rerankerApiUrl: { value: undefined, source: "default", globalValue: undefined },
      rerankerModel: { value: undefined, source: "default", globalValue: undefined },
      rerankerTimeoutMs: { value: 4000, source: "default", globalValue: 4000 },
      ...overrides,
    },
    secrets: { rerankerApiKey: { set: false, source: null, reference: null } },
  };
}

function defaultDraft() {
  return { enabled: false, url: "", model: "", key: "", timeout: "4000" };
}

type Node = ReactElement<{ children?: ReactNode; [key: string]: unknown }>;
function find(node: ReactNode, predicate: (node: Node) => boolean): Node[] {
  if (!react.isValidElement(node))
    return Array.isArray(node) ? node.flatMap((child) => find(child, predicate)) : [];
  const element = node as Node;
  return [...(predicate(element) ? [element] : []), ...find(element.props.children, predicate)];
}
function tree(draft = defaultDraft(), busy = false, status: unknown = undefined): Node[] {
  states = [snapshotFixture(), draft, busy, status];
  cursor = 0;
  return find(RerankerSection(), () => true);
}
const html = (draft = defaultDraft(), busy = false, status: unknown = undefined): string => {
  states = [snapshotFixture(), draft, busy, status];
  cursor = 0;
  return renderToStaticMarkup(<RerankerSection />);
};
const button = (label: string, nodes: Node[]) =>
  nodes.find(
    (node) => node.type === "button" && react.Children.toArray(node.props.children)[0] === label
  )!;
const field = (nodes: Node[], id: string) =>
  nodes.find((node) => node.type === "input" && node.props.id === id)!;

type Call = { url: string; init?: RequestInit };
const realFetch = globalThis.fetch;
let calls: Call[] = [];
beforeEach(() => {
  calls = [];
  effects = [];
  Object.assign(globalThis, { window: { __OMMS_TOKEN__: "page-token" } });
});
afterEach(() => {
  globalThis.fetch = realFetch;
});
function stubFetch(reply: (call: Call) => unknown) {
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const call = { url: String(url), init };
    calls.push(call);
    return reply(call);
  }) as unknown as typeof fetch;
}
const flush = async () => {
  for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

it("shows the default state: switch off, empty fields, timeout 4000, unchanged search", () => {
  const markup = html();
  expect(markup).toMatch(/<h2[^>]*>Reranker<\/h2>/);
  const nodes = tree();
  expect(field(nodes, "reranker-enabled").props.checked).toBe(false);
  expect(field(nodes, "reranker-url").props.value).toBe("");
  expect(field(nodes, "reranker-model").props.value).toBe("");
  expect(field(nodes, "reranker-key").props.value).toBe("");
  expect(field(nodes, "reranker-timeout").props.value).toBe("4000");
  expect(markup).toContain("Search is unchanged while the switch is off.");
  expect(markup).toContain(
    "The reranker sends the prompt and the text of candidate memories to the server URL. A server on the same machine is recommended."
  );
  expect(markup).toContain("A project file cannot change these settings.");
  expect(markup).not.toContain("leaves this machine");
});

it("refuses to save with the switch on and a blank URL or model", () => {
  const nodes = tree({ ...defaultDraft(), enabled: true });
  expect(button("Save", nodes).props.disabled).toBe(true);
  cursor = 0;
  expect(renderToStaticMarkup(<RerankerSection />)).toContain("Enter the server URL and model");
  const withUrl = tree({ ...defaultDraft(), enabled: true, url: "http://127.0.0.1:3008/v1" });
  expect(button("Save", withUrl).props.disabled).toBe(true);
  const complete = tree({
    ...defaultDraft(),
    enabled: true,
    url: "http://127.0.0.1:3008/v1",
    model: "Qwen3-Reranker-0.6B",
  });
  expect(button("Save", complete).props.disabled).toBe(false);
});

it("refuses a plain-text key and out-of-range timeouts", () => {
  const plainKey = tree({
    ...defaultDraft(),
    enabled: true,
    url: "http://127.0.0.1:3008/v1",
    model: "m",
    key: "sk-literal",
  });
  expect(button("Save", plainKey).props.disabled).toBe(true);
  cursor = 0;
  expect(renderToStaticMarkup(<RerankerSection />)).toContain(
    "The key must be an env:// or file:// reference"
  );
  for (const timeout of ["100", "40000", "2500.5", ""]) {
    const nodes = tree({
      ...defaultDraft(),
      enabled: true,
      url: "http://127.0.0.1:3008/v1",
      model: "m",
      timeout,
    });
    expect(button("Save", nodes).props.disabled, `timeout ${timeout}`).toBe(true);
  }
  const markup = html({
    ...defaultDraft(),
    enabled: true,
    url: "http://127.0.0.1:3008/v1",
    model: "m",
    timeout: "40000",
  });
  expect(markup).toContain("Enter a whole number from 500 to 30,000.");
  // The apostrophe in "V2's" is escaped in static markup.
  expect(markup).toContain(
    "The default of 4000 keeps the search inside OpenCode V2&#x27;s 5-second wait. A value over 5000 can make OpenCode V2 send the request with no memory."
  );
});

it("shows the remote-host notice only for non-loopback URLs", () => {
  const remote = html({
    ...defaultDraft(),
    enabled: true,
    url: "https://rerank.example.com/v1",
    model: "m",
  });
  expect(remote).toContain("This URL is not on this machine: memory text leaves this machine.");
  const local = html({
    ...defaultDraft(),
    enabled: true,
    url: "http://127.0.0.1:3008/v1",
    model: "m",
  });
  expect(local).not.toContain("leaves this machine");
});

it("saves the five keys through the shared safe save and reloads the revision", async () => {
  stubFetch((call) =>
    call.url === "/api/settings" && call.init?.method === "PATCH"
      ? Response.json({}, { status: 200 })
      : Response.json(snapshotFixture())
  );
  const nodes = tree({
    ...defaultDraft(),
    enabled: true,
    url: "http://127.0.0.1:3008/v1",
    model: "Qwen3-Reranker-0.6B",
    timeout: "6000",
  });
  await (button("Save", nodes).props.onClick as () => Promise<void>)();
  await flush();
  const patch = calls.find((call) => call.init?.method === "PATCH");
  expect(patch?.url).toBe("/api/settings");
  expect(JSON.parse(String(patch?.init?.body))).toEqual({
    edits: {
      rerankerEnabled: true,
      rerankerApiUrl: "http://127.0.0.1:3008/v1",
      rerankerModel: "Qwen3-Reranker-0.6B",
      rerankerApiKey: undefined,
      rerankerTimeoutMs: 6000,
    },
    revision: "rev-1",
  });
  expect(states[3]).toEqual({ kind: "save", ok: true, reloaded: true });
});

it("tests with the drafted values and reports success or a failure code", async () => {
  stubFetch((call) =>
    call.url === "/api/settings/reranker/test"
      ? Response.json({ success: true })
      : Response.json({})
  );
  let nodes = tree({
    ...defaultDraft(),
    enabled: true,
    url: "http://127.0.0.1:3008/v1",
    model: "Qwen3-Reranker-0.6B",
    timeout: "6000",
  });
  await (button("Test", nodes).props.onClick as () => Promise<void>)();
  await flush();
  const test = calls.find((call) => call.url === "/api/settings/reranker/test");
  expect(JSON.parse(String(test?.init?.body))).toEqual({
    rerankerApiUrl: "http://127.0.0.1:3008/v1",
    rerankerModel: "Qwen3-Reranker-0.6B",
    rerankerTimeoutMs: 6000,
  });
  expect(states[3]).toEqual({ kind: "test", ok: true });

  stubFetch((call) =>
    call.url === "/api/settings/reranker/test"
      ? Response.json({ success: false, code: "reranker_unreachable" })
      : Response.json({})
  );
  states = [snapshotFixture(), defaultDraft(), false, undefined];
  cursor = 0;
  nodes = find(RerankerSection(), () => true);
  await (button("Test", nodes).props.onClick as () => Promise<void>)();
  await flush();
  expect(states[3]).toEqual({ kind: "test", ok: false, code: "reranker_unreachable" });
  cursor = 0;
  expect(renderToStaticMarkup(<RerankerSection />)).toContain("reranker_unreachable");
});

it("restores the saved values on Cancel without any request", () => {
  stubFetch(() => {
    throw new Error("no request expected");
  });
  const nodes = tree({ ...defaultDraft(), url: "http://x", timeout: "9000" });
  (button("Cancel", nodes).props.onClick as () => void)();
  expect(states[1]).toEqual(defaultDraft());
  expect(calls).toEqual([]);
});

it("sits on the Memory page below Memory limits and is absent from Settings", () => {
  const ids = MEMORY_SECTIONS.map((section) => section.id);
  expect(ids.indexOf("memory-section-reranker")).toBe(ids.indexOf("memory-section-limits") + 1);
});

it("translates every reranker message into Chinese and Arabic", () => {
  for (const message of controls.RERANKER_MESSAGES) {
    expect(translateSettings(message, "en")).toBe(message);
    expect(translateSettings(message, "zh")).not.toBe(message);
    expect(translateSettings(message, "ar")).not.toBe(message);
  }
  setLanguage("zh");
  const markup = html();
  expect(markup).not.toContain("Search is unchanged while the switch is off.");
  expect(markup).not.toContain(">Reranker</h2>");
  setLanguage("en");
});
