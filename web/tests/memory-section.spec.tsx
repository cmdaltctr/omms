import { afterEach, beforeEach, expect, it, mock } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import type { ReactElement, ReactNode } from "react";
import * as react from "react";
import { setLanguage } from "../src/lib/i18n/index.ts";
import { translateSettings } from "../src/lib/i18n/settings.ts";
import { SETTINGS_SECTIONS } from "../src/lib/settings-sections.ts";
import { MEMORY_SECTIONS } from "../src/lib/memory-sections.ts";

// The Memory card keeps its snapshot, draft, busy, and status in this order,
// so the tests can inject each state through the shared mock. The status is
// an identity object the card translates at render time, never a string.
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
const { MemorySection } = await import("../src/lib/components/memory/MemorySection.tsx");
const controls = await import("../src/lib/memory-controls.ts");
/** Run the recorded mount effects once, so load failures happen for real. */
const runEffects = () => {
  const pending = effects;
  effects = [];
  for (const effect of pending) effect();
};

type Setting = { value?: unknown; source: string; globalValue?: unknown; default?: unknown };
type Snapshot = { revision: string; settings: Record<string, Setting> };
const KEYS = [
  "maxMemories",
  "chatMessage.maxMemories",
  "autoCaptureMaxContextBytes",
  "userProfileMaxContextBytes",
  "retrievalMaxTokens",
] as const;
const DEFAULTS: Record<(typeof KEYS)[number], number> = {
  maxMemories: 10,
  "chatMessage.maxMemories": 3,
  autoCaptureMaxContextBytes: 131072,
  userProfileMaxContextBytes: 32768,
  retrievalMaxTokens: 2000,
};

function snapshotFixture(settings: Partial<Record<(typeof KEYS)[number], Setting>> = {}): Snapshot {
  return {
    revision: "rev-1",
    settings: Object.fromEntries(
      KEYS.map((key) => [
        key,
        settings[key] ?? {
          value: DEFAULTS[key],
          source: "default",
          globalValue: DEFAULTS[key],
          default: DEFAULTS[key],
        },
      ])
    ),
  };
}

function render(draft: Record<string, string> = {}, busy = false): string {
  states = [snapshotFixture(), draft, busy, undefined];
  cursor = 0;
  return renderToStaticMarkup(<MemorySection />);
}

type Node = ReactElement<{ children?: ReactNode; [key: string]: unknown }>;
function find(node: ReactNode, predicate: (node: Node) => boolean): Node[] {
  if (!react.isValidElement(node))
    return Array.isArray(node) ? node.flatMap((child) => find(child, predicate)) : [];
  const element = node as Node;
  return [...(predicate(element) ? [element] : []), ...find(element.props.children, predicate)];
}
function tree(draft: Record<string, string> = {}, busy = false): Node[] {
  states = [snapshotFixture(), draft, busy, undefined];
  cursor = 0;
  return find(MemorySection(), () => true);
}
const button = (label: string, nodes: Node[]) =>
  nodes.find(
    (node) => node.type === "button" && react.Children.toArray(node.props.children)[0] === label
  )!;
const input = (nodes: Node[], id: string) =>
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

it("defines the five memory controls with exact keys, defaults, and units", () => {
  expect(controls.MEMORY_CONTROLS.map((control) => control.key)).toEqual([...KEYS]);
  for (const control of controls.MEMORY_CONTROLS) {
    expect(control.default).toBe(DEFAULTS[control.key]);
    expect(control.unit.length).toBeGreaterThan(0);
    expect(control.affects.length).toBeGreaterThan(0);
    expect(control.accepted.length).toBeGreaterThan(0);
  }
  const units = controls.MEMORY_CONTROLS.map((control) => control.unit);
  expect(units).toContain("Results");
  expect(units).toContain("Memories");
  expect(units).toContain("Bytes");
  expect(units).toContain("Approximate tokens");
});

it("accepts spec boundaries and rejects invalid values", () => {
  const byKey = (key: string) => controls.MEMORY_CONTROLS.find((control) => control.key === key)!;
  for (const key of ["maxMemories", "chatMessage.maxMemories"]) {
    const control = byKey(key);
    expect(controls.parseMemoryValue(control, "1")).toBe(1);
    expect(controls.parseMemoryValue(control, "9007199254740991")).toBe(9007199254740991);
    for (const bad of ["", "  ", "0", "-1", "2.5", "abc", "1e3.5", null, undefined]) {
      expect(controls.parseMemoryValue(control, bad as string)).toBeUndefined();
    }
  }
  const capture = byKey("autoCaptureMaxContextBytes");
  expect(controls.parseMemoryValue(capture, "16384")).toBe(16384);
  expect(controls.parseMemoryValue(capture, "16777216")).toBe(16777216);
  expect(controls.parseMemoryValue(capture, "16383")).toBeUndefined();
  expect(controls.parseMemoryValue(capture, "16777217")).toBeUndefined();
  const profile = byKey("userProfileMaxContextBytes");
  expect(controls.parseMemoryValue(profile, "1024")).toBe(1024);
  expect(controls.parseMemoryValue(profile, "16777216")).toBe(16777216);
  expect(controls.parseMemoryValue(profile, "1023")).toBeUndefined();
  const tokens = byKey("retrievalMaxTokens");
  expect(controls.parseMemoryValue(tokens, "256")).toBe(256);
  expect(controls.parseMemoryValue(tokens, "65536")).toBe(65536);
  expect(controls.parseMemoryValue(tokens, "255")).toBeUndefined();
  expect(controls.parseMemoryValue(tokens, "65537")).toBeUndefined();
  expect(controls.parseMemoryValue(tokens, "2000.5")).toBeUndefined();
});

it("formats defaults with thousands separators while inputs stay plain integers", () => {
  expect(controls.formatMemoryDefault(131072)).toBe("131,072");
  expect(controls.formatMemoryDefault(32768)).toBe("32,768");
  expect(controls.formatMemoryDefault(2000)).toBe("2,000");
  expect(controls.formatMemoryDefault(10)).toBe("10");
  expect(controls.formatMemoryDefault(3)).toBe("3");
});

it("computes the save plan from drafts against the loaded global values", () => {
  const loaded = { ...DEFAULTS };
  expect(controls.canSaveMemory({}, loaded)).toBe(false);
  expect(controls.canSaveMemory({ retrievalMaxTokens: "2000" }, loaded)).toBe(false);
  expect(controls.canSaveMemory({ retrievalMaxTokens: "3000" }, loaded)).toBe(true);
  // Any invalid field blocks the whole save, even when others changed validly.
  expect(controls.canSaveMemory({ retrievalMaxTokens: "3000", maxMemories: "0" }, loaded)).toBe(
    false
  );
  expect(controls.canSaveMemory({ retrievalMaxTokens: "3000", maxMemories: "2.5" }, loaded)).toBe(
    false
  );
  expect(controls.canSaveMemory({ retrievalMaxTokens: "" }, loaded)).toBe(false);
  expect(controls.memorySaveEdits({ retrievalMaxTokens: "3000" }, loaded)).toEqual({
    retrievalMaxTokens: 3000,
  });
  // Only changed fields are sent, and the nested field keeps its dotted request id.
  expect(
    controls.memorySaveEdits({ "chatMessage.maxMemories": "2", retrievalMaxTokens: "2000" }, loaded)
  ).toEqual({ "chatMessage.maxMemories": 2 });
});

it("renders one Memory card with an H2 section title and five labelled rows", () => {
  const html = render();
  expect(html.match(/<section/g)).toHaveLength(1);
  // One form holds the five rows and the Save/Cancel controls (design 7).
  expect(html.match(/<form/g)).toHaveLength(1);
  expect(html).toMatch(
    /<h2 class="[^"]*text-section-title[^"]*font-semibold[^"]*">Memory limits<\/h2>/
  );
  expect(html).toContain('aria-label="Memory limits"');
  expect(html).not.toMatch(/<h[34]\b/);
  for (const header of ["Setting", "Value", "Default", "Unit", "Affects"]) {
    expect(html).toContain(`>${header}</th>`);
  }
  for (const key of KEYS) {
    // Identifiers stay literal and isolated left-to-right, including in Arabic.
    expect(html).toContain(`<code dir="ltr">${key}</code>`);
  }
  expect(html.match(/type="number"/g)).toHaveLength(5);
  for (const control of controls.MEMORY_CONTROLS) {
    expect(html).toContain(`aria-label="${control.key} Value"`);
  }
  // Save submits the one form; Cancel never submits.
  expect(html).toMatch(/<button type="submit"[^>]*>Save memory limits<\/button>/);
  expect(html).toMatch(/<button type="button"[^>]*>Cancel<\/button>/);
});

it("shows defaults, units, and a visible Affects cell beside each control", () => {
  const html = render();
  for (const value of ["10", "3", "131,072", "32,768", "2,000"]) {
    expect(html).toContain(`>${value}</td>`);
  }
  for (const unit of ["Results", "Memories", "Bytes", "Approximate tokens"]) {
    expect(html).toContain(`>${unit}</td>`);
  }
  for (const control of controls.MEMORY_CONTROLS) {
    expect(html).toContain(`>${control.affects.replace(/'/g, "&#x27;")}</td>`);
  }
  expect(html.match(/title=/g)?.length ?? 0).toBeLessThan(html.match(/<td/g)?.length ?? 0);
});

it("explains UTF-8 bytes, the approximate-token estimate, and the limits' scope", () => {
  const html = render();
  expect(html).toContain("Byte limits count UTF-8 bytes.");
  expect(html).toContain(
    "Approximate tokens are estimated as ceil(UTF-8 bytes / 4). A provider can count more or fewer tokens for the same text."
  );
  expect(html).toContain(
    "These controls do not delete stored data, set a spending limit, limit model replies, or control Graphify output."
  );
  expect(html).toContain('<code dir="ltr">~/.config/omms/omms.jsonc</code>');
  expect(html.replace(/<[^>]+>/g, "")).toContain(
    "Edit ~/.config/omms/omms.jsonc directly to set these limits without the web UI."
  );
});

it("disables Save until a valid draft differs from the loaded global values", () => {
  let nodes = tree();
  expect(button("Save memory limits", nodes).props.disabled).toBe(true);
  // A no-change draft keeps Save disabled.
  nodes = tree({ retrievalMaxTokens: "2000" });
  expect(button("Save memory limits", nodes).props.disabled).toBe(true);
  nodes = tree({ retrievalMaxTokens: "3000", maxMemories: "6" });
  expect(button("Save memory limits", nodes).props.disabled).toBe(false);
  // One invalid field blocks saving the rest.
  nodes = tree({ retrievalMaxTokens: "3000", maxMemories: "0" });
  expect(button("Save memory limits", nodes).props.disabled).toBe(true);
});

it("associates an accepted-values validation message with each invalid input", () => {
  const nodes = tree({ retrievalMaxTokens: "255", autoCaptureMaxContextBytes: "" });
  const tokenInput = input(nodes, "memory-retrievalMaxTokens-input");
  expect(tokenInput.props["aria-invalid"]).toBe(true);
  expect(tokenInput.props["aria-describedby"]).toBe("memory-retrievalMaxTokens-help");
  const captureInput = input(nodes, "memory-autoCaptureMaxContextBytes-input");
  expect(captureInput.props["aria-invalid"]).toBe(true);
  const html = renderToStaticMarkup(<MemorySection />);
  expect(html).toMatch(
    /id="memory-retrievalMaxTokens-help"[^>]*>Enter a whole number from 256 to 65,536\./
  );
  expect(html).toMatch(
    /id="memory-autoCaptureMaxContextBytes-help"[^>]*>Enter a whole number from 16,384 to 16,777,216\./
  );
  // A valid field stays clean and still shows its accepted values as help text.
  const nodes2 = tree({ retrievalMaxTokens: "3000" });
  expect(input(nodes2, "memory-retrievalMaxTokens-input").props["aria-invalid"]).toBeUndefined();
  expect(renderToStaticMarkup(<MemorySection />)).toMatch(
    /id="memory-retrievalMaxTokens-help"[^>]*>Enter a whole number from 256 to 65,536\./
  );
});

it("shows the project override with its effective value while editing the global value", () => {
  states = [
    snapshotFixture({ retrievalMaxTokens: { value: 1000, source: "project", globalValue: 3000 } }),
    {},
    false,
    "",
  ];
  cursor = 0;
  const html = renderToStaticMarkup(<MemorySection />);
  expect(html).toContain("Effective value: 1000 (project)");
  expect(html).toContain(
    "Project override is active. Changes to the global file may not take effect here."
  );
  expect(html).toContain("The project value stays in force. Saving edits the global file only.");
  // The input still edits the global value.
  expect(html).toContain('id="memory-retrievalMaxTokens-input"');
  expect(html).toContain('value="3000"');
  // Rows without an override show no override note.
  expect(html).toContain("Effective value: 1000 (project)");
  const count = (html.match(/Project override is active/g) ?? []).length;
  expect(count).toBe(1);
});

it("saves through the shared settings flow and refreshes the revision", async () => {
  stubFetch((call) =>
    call.url === "/api/settings" && call.init?.method === "PATCH"
      ? Response.json({}, { status: 200 })
      : Response.json(
          snapshotFixture({
            retrievalMaxTokens: { value: 3000, source: "global", globalValue: 3000 },
          })
        )
  );
  const nodes = tree({ "chatMessage.maxMemories": "2", retrievalMaxTokens: "3000" });
  await (button("Save memory limits", nodes).props.onClick as () => void)();
  await flush();
  const patch = calls.find((call) => call.init?.method === "PATCH");
  expect(patch?.url).toBe("/api/settings");
  expect(JSON.parse(String(patch?.init?.body))).toEqual({
    edits: { "chatMessage.maxMemories": 2, retrievalMaxTokens: 3000 },
    revision: "rev-1",
  });
  expect(new Headers(patch?.init?.headers).get("x-omms-token")).toBe("page-token");
  expect(new Headers(patch?.init?.headers).get("Content-Type")).toBe("application/json");
  // The shared snapshot reload publishes the new revision for every card.
  expect(calls.filter((call) => !call.init?.method).map((call) => call.url)).toEqual([
    "/api/settings",
  ]);
  // The status is captured as an identity, translated at render time.
  expect(states[3]).toEqual({ kind: "saved", reloaded: true });
  cursor = 0;
  expect(renderToStaticMarkup(<MemorySection />)).toContain(
    "Saved. New memory operations use these limits."
  );
  // The draft is cleared, so the inputs return to the loaded values.
  expect(states[1]).toEqual({});
});

it("translates stale-revision save failures and retranslates on language switch", async () => {
  stubFetch((call) =>
    call.init?.method === "PATCH"
      ? Response.json({ error: "Config changed. Reload settings and save again." }, { status: 409 })
      : Response.json(snapshotFixture())
  );
  const nodes = tree({ retrievalMaxTokens: "3000" });
  await (button("Save memory limits", nodes).props.onClick as () => void)();
  await flush();
  // The identity is captured, never the raw or translated string.
  expect(states[3]).toEqual({
    kind: "save-failed",
    failure: { kind: "stale" },
    reloaded: true,
  });
  // The draft stays for review.
  expect(states[1]).toEqual({ retrievalMaxTokens: "3000" });
  setLanguage("en");
  cursor = 0;
  expect(renderToStaticMarkup(<MemorySection />)).toContain(
    "Config changed. Reload settings and save again. Current settings were reloaded; check the values and save again."
  );
  // A later language switch retranslates the same captured identity.
  setLanguage("zh");
  cursor = 0;
  const html = renderToStaticMarkup(<MemorySection />);
  expect(html).toContain("设置文件已更改。请重新加载设置后再次保存。");
  expect(html).toContain("已重新加载当前设置；检查数值后再次保存。");
  expect(html).not.toContain("Config changed");
  setLanguage("en");
});

it("restores the loaded values on Cancel without any request", () => {
  stubFetch(() => {
    throw new Error("no request expected");
  });
  const nodes = tree({ maxMemories: "6", retrievalMaxTokens: "3000" });
  expect(input(nodes, "memory-maxMemories-input").props.value).toBe("6");
  (button("Cancel", nodes).props.onClick as () => void)();
  expect(states[1]).toEqual({});
  expect(calls).toEqual([]);
  const after = tree();
  expect(input(after, "memory-maxMemories-input").props.value).toBe("10");
  expect(input(after, "memory-retrievalMaxTokens-input").props.value).toBe("2000");
});

it("prevents duplicate submissions while a save runs", async () => {
  let release: ((response: Response) => void) | undefined;
  stubFetch((call) => {
    if (call.init?.method === "PATCH") {
      return new Promise<Response>((resolve) => {
        release = resolve;
      });
    }
    return Response.json(snapshotFixture());
  });
  const nodes = tree({ retrievalMaxTokens: "3000" });
  const save = button("Save memory limits", nodes).props.onClick as () => Promise<void>;
  const inFlight = save();
  const busyNodes = tree({ retrievalMaxTokens: "3000" }, true);
  expect(button("Save memory limits", busyNodes).props.disabled).toBe(true);
  expect(button("Cancel", busyNodes).props.disabled).toBe(true);
  release?.(Response.json({}, { status: 200 }));
  await inFlight;
  await flush();
  expect(calls.filter((call) => call.init?.method === "PATCH")).toHaveLength(1);
});

it("reports an initial load failure as a translated status identity", async () => {
  stubFetch(() => Response.json({ error: "Internal server error" }, { status: 500 }));
  states = [];
  cursor = 0;
  renderToStaticMarkup(<MemorySection />);
  runEffects();
  await flush();
  // The identity is captured; the raw server text never reaches the state.
  expect(states[3]).toEqual({ kind: "load-failed" });
  for (const [language, text] of [
    ["en", "The memory settings could not be loaded. Reload the page to try again."],
    ["zh", "无法加载记忆设置。请重新加载页面重试。"],
    ["ar", "تعذّر تحميل إعدادات الذاكرة. أعد تحميل الصفحة للمحاولة مجدداً."],
  ] as const) {
    setLanguage(language);
    cursor = 0;
    const html = renderToStaticMarkup(<MemorySection />);
    expect(html).toContain(text);
    expect(html).not.toContain("Internal server error");
  }
  setLanguage("en");
});

it("maps invalid five-setting rejections to translated accepted values", async () => {
  stubFetch((call) =>
    call.init?.method === "PATCH"
      ? Response.json(
          {
            error: "Invalid retrievalMaxTokens setting: accepted integers from 256 to 65536",
          },
          { status: 400 }
        )
      : Response.json(snapshotFixture())
  );
  const nodes = tree({ "chatMessage.maxMemories": "2" });
  await (button("Save memory limits", nodes).props.onClick as () => void)();
  await flush();
  expect(states[3]).toEqual({
    kind: "save-failed",
    failure: { kind: "invalid", key: "retrievalMaxTokens" },
    reloaded: true,
  });
  setLanguage("zh");
  cursor = 0;
  const html = renderToStaticMarkup(<MemorySection />);
  // Literal identifier plus the translated accepted values; no raw server prose.
  expect(html).toContain("无效的设置 retrievalMaxTokens");
  expect(html).toContain("请输入 256 到 65,536 之间的整数。");
  expect(html).not.toContain("accepted integers");
  expect(html).not.toContain("Invalid retrievalMaxTokens setting");
  setLanguage("en");
});

it("shows a translated generic message for unknown server and network failures", async () => {
  stubFetch((call) =>
    call.init?.method === "PATCH"
      ? Response.json({ error: "Unexpected boom" }, { status: 500 })
      : Response.json(snapshotFixture())
  );
  const nodes = tree({ retrievalMaxTokens: "3000" });
  await (button("Save memory limits", nodes).props.onClick as () => void)();
  await flush();
  expect(states[3]).toEqual({
    kind: "save-failed",
    failure: { kind: "unknown" },
    reloaded: true,
  });
  setLanguage("ar");
  cursor = 0;
  const html = renderToStaticMarkup(<MemorySection />);
  expect(html).toContain("تعذّر حفظ إعدادات الذاكرة.");
  expect(html).toContain("أُعيد تحميل الإعدادات الحالية. راجع القيم ثم احفظ مجدداً.");
  expect(html).not.toContain("Unexpected boom");
  // A network-level failure with no server text maps to the same identity.
  stubFetch((call) => {
    if (call.init?.method === "PATCH") throw new TypeError("fetch failed");
    return Response.json(snapshotFixture());
  });
  setLanguage("zh");
  const retry = tree({ retrievalMaxTokens: "3000" });
  const submit = retry.find((node) => node.type === "button" && node.props.type === "submit")!;
  await (submit.props.onClick as () => void)();
  await flush();
  expect(states[3]).toEqual({
    kind: "save-failed",
    failure: { kind: "unknown" },
    reloaded: true,
  });
  cursor = 0;
  const html2 = renderToStaticMarkup(<MemorySection />);
  expect(html2).toContain("无法保存记忆设置。");
  expect(html2).not.toContain("fetch failed");
  setLanguage("en");
});

it("guards a second submission from the same render to one PATCH", async () => {
  stubFetch((call) =>
    call.init?.method === "PATCH"
      ? Response.json({}, { status: 200 })
      : Response.json(snapshotFixture())
  );
  const nodes = tree({ retrievalMaxTokens: "3000" });
  const save = button("Save memory limits", nodes).props.onClick as () => void;
  // Both invocations run from the same render, before any re-render.
  const first = save();
  const second = save();
  await Promise.all([first, second]);
  await flush();
  expect(calls.filter((call) => call.init?.method === "PATCH")).toHaveLength(1);
  expect(states[3]).toEqual({ kind: "saved", reloaded: true });
});

it("keeps narrow-screen overflow inside the card and effect prose readable", () => {
  const nodes = tree();
  const table = nodes.find((node) => node.type === "table")!;
  // A card-only minimum width keeps the five columns readable; the shared
  // wrapper scrolls horizontally instead of stretching the page.
  expect(String(table.props.className)).toMatch(/(^| )min-w-\[/);
  expect(String(table.props.className)).toContain("w-full");
  const wrap = nodes.find(
    (node) => node.type === "div" && String(node.props.className).includes("overflow-x-auto")
  )!;
  expect(String(wrap.props.className)).toContain("rounded-lg border");
  // The shared cell and header styles keep the existing table look.
  const html = render();
  expect(html).toMatch(/<th class="[^"]*text-start font-medium">Setting<\/th>/);
  expect(html).toMatch(/<td class="[^"]*">Automatic memory context/);
});

it("keeps drafts when the page language changes", () => {
  states = [snapshotFixture(), { retrievalMaxTokens: "3000", maxMemories: "6" }, false, ""];
  cursor = 0;
  const before = find(MemorySection(), () => true);
  expect(input(before, "memory-retrievalMaxTokens-input").props.value).toBe("3000");
  setLanguage("zh");
  cursor = 0;
  const after = find(MemorySection(), () => true);
  expect(input(after, "memory-retrievalMaxTokens-input").props.value).toBe("3000");
  expect(input(after, "memory-maxMemories-input").props.value).toBe("6");
  expect(renderToStaticMarkup(<MemorySection />)).toContain("记忆");
  setLanguage("en");
});

it("translates every visible and accessible message into Chinese and Arabic", () => {
  for (const message of controls.MEMORY_SETTINGS_MESSAGES) {
    expect(translateSettings(message, "en")).toBe(message);
    expect(translateSettings(message, "zh")).not.toBe(message);
    expect(translateSettings(message, "ar")).not.toBe(message);
    expect(translateSettings(message, "zh").length).toBeGreaterThan(0);
    expect(translateSettings(message, "ar").length).toBeGreaterThan(0);
  }
  for (const [language, title] of [
    ["zh", "记忆限制"],
    ["ar", "حدود الذاكرة"],
  ] as const) {
    setLanguage(language);
    const html = render({ retrievalMaxTokens: "255" });
    expect(html).toContain(`>${title}</h2>`);
    // Identifiers stay literal, isolated, and readable in every language.
    for (const key of KEYS) expect(html).toContain(`<code dir="ltr">${key}</code>`);
    // Column headers translate.
    expect(html).not.toContain(">Setting</th>");
    expect(html).not.toContain(">Affects</th>");
    // Accessible input labels and validation messages translate without English fallback.
    expect(html).not.toContain('aria-label="retrievalMaxTokens Value"');
    expect(html).not.toContain("Enter a whole number from 256 to 65,536.");
    expect(html).toContain('aria-invalid="true"');
    // Help text translates.
    expect(html).not.toContain("Byte limits count UTF-8 bytes.");
    expect(html).not.toContain(
      "Approximate tokens are estimated as ceil(UTF-8 bytes / 4). A provider can count more or fewer tokens for the same text."
    );
    expect(html).not.toContain(
      "These controls do not delete stored data, set a spending limit, limit model replies, or control Graphify output."
    );
    expect(html).toContain("~/.config/omms/omms.jsonc");
    expect(html).not.toContain(
      "Edit ~/.config/omms/omms.jsonc directly to set these limits without the web UI."
    );
    // The overridden row translates its effective-value and override notes.
    expect(html).not.toContain(
      "Project override is active. Changes to the global file may not take effect here."
    );
  }
  setLanguage("en");
  // The translated override row keeps the numbers readable.
  states = [
    snapshotFixture({ retrievalMaxTokens: { value: 1000, source: "project", globalValue: 3000 } }),
    {},
    false,
    "",
  ];
  cursor = 0;
  setLanguage("zh");
  const html = renderToStaticMarkup(<MemorySection />);
  expect(html).not.toContain("Effective value: 1000 (project)");
  expect(html).toContain("1000");
  setLanguage("en");
});

it("uses the shared snapshot protection and revision flow", () => {
  const source = readFileSync(
    new URL("../src/lib/components/memory/MemorySection.tsx", import.meta.url),
    "utf8"
  );
  expect(source).toContain("beginSettingsRead");
  expect(source).toContain("onSettingsSnapshot");
  expect(source).toContain("reloadSettingsSnapshot");
  expect(source).toContain("revision: snapshot.revision");
  // The card never edits other settings or splits dotted paths client-side.
  expect(source).not.toContain("revealDirectoryMaps");
});

it("belongs once to Memory after Profile learning and is absent from Settings", () => {
  const ids = MEMORY_SECTIONS.map((section) => section.id);
  expect(ids.indexOf("memory-section-limits")).toBe(ids.indexOf("memory-section-profile") + 1);
  expect(ids.filter((id) => id === "memory-section-limits")).toHaveLength(1);
  expect(
    SETTINGS_SECTIONS.some((section) => String(section.id) === "settings-section-memory")
  ).toBe(false);
});
