import { afterEach, beforeEach, expect, it, mock } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement, ReactNode } from "react";
import * as react from "react";
import { setLanguage } from "../src/lib/i18n/index.ts";
import { translateSettings } from "../src/lib/i18n/settings.ts";
import { KEYWORD_MODE_MESSAGES } from "../src/lib/keyword-mode-controls.ts";

// The card keeps snapshot, mode, busy, and status in this order, so tests inject each state.
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
    return [
      states[index],
      (value: unknown) => {
        states[index] = typeof value === "function" ? value(states[index]) : value;
      },
    ];
  },
}));
const { KeywordModeSection } = await import("../src/lib/components/memory/KeywordModeSection.tsx");
const { Select } = await import("../src/lib/components/ui/select.tsx");
const { SettingRow } = await import("../src/lib/components/settings/SettingRow.tsx");
const { SettingsConfirmDialog } =
  await import("../src/lib/components/settings/SettingsConfirmDialog.tsx");
const { PLAIN_TEXT } = await import("../src/lib/settings-catalogue.ts");
const { Button } = await import("../src/lib/components/ui/button.tsx");

type Setting = { value?: unknown; source: string; globalValue?: unknown };

function snapshotFixture(overrides: Record<string, Setting> = {}) {
  return {
    revision: "rev-1",
    settings: {
      keywordMode: { value: "boost", source: "default", globalValue: "boost" },
      rerankerEnabled: { value: false, source: "default", globalValue: false },
      rerankerApiUrl: { value: undefined, source: "default" },
      rerankerModel: { value: undefined, source: "default" },
      ...overrides,
    },
  };
}

beforeEach(() => {
  setLanguage("en");
  Object.assign(globalThis, { window: { __OMMS_TOKEN__: "page-token" } });
});

type Call = { url: string; init?: RequestInit };
const realFetch = globalThis.fetch;
let calls: Call[] = [];
function stubFetch(reply: (call: Call) => unknown) {
  calls = [];
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const call = { url: String(url), init };
    calls.push(call);
    return reply(call);
  }) as unknown as typeof fetch;
}
afterEach(() => {
  globalThis.fetch = realFetch;
});
/** The Save button submits the form, so the form's onSubmit is the click. */
const submitForm = (nodes: Node[]) =>
  (
    nodes.find((node) => node.type === "form")!.props.onSubmit as (event: {
      preventDefault: () => void;
    }) => void
  )({ preventDefault: () => {} });
/** A fresh render of the card, with the shared hook cursor reset as `tree` does. */
const shown = (): Node[] => {
  cursor = 0;
  return find(KeywordModeSection(), () => true);
};
const dialogOf = (nodes: Node[]) => nodes.find((node) => node.type === SettingsConfirmDialog)!;
const rowsOf = (dialog: Node) => dialog.props.body.props.changes as unknown[];
const flush = async () => {
  for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

const html = (mode = "boost", overrides: Record<string, Setting> = {}, busy = false) => {
  states = [snapshotFixture(overrides), mode, busy, undefined];
  cursor = 0;
  return renderToStaticMarkup(<KeywordModeSection />);
};

type Node = ReactElement<{ children?: ReactNode; [key: string]: unknown }>;
function find(node: ReactNode, predicate: (node: Node) => boolean): Node[] {
  if (!react.isValidElement(node))
    return Array.isArray(node) ? node.flatMap((child) => find(child, predicate)) : [];
  const element = node as Node;
  return [...(predicate(element) ? [element] : []), ...find(element.props.children, predicate)];
}
const tree = (mode: string, busy = false) => {
  states = [snapshotFixture(), mode, busy, undefined];
  cursor = 0;
  return find(KeywordModeSection(), () => true);
};
const saveButton = (mode: string) =>
  tree(mode).find((node) => node.props.type === "submit" && typeof node.type === "function");

it("puts the shared Select in a catalogue row and offers both modes", () => {
  const nodes = tree("boost");
  const row = nodes.find((node) => node.type === SettingRow);
  expect(row?.props.setting).toBe("keywordMode");
  expect(row?.props.controlId).toBe("keyword-mode");
  const select = find(row?.props.children, (node) => node.type === Select)[0];
  expect(select?.props.id).toBe("keyword-mode");
  const options = find(select?.props.children, (node) => node.type === "option");
  expect(options.map((node) => node.props.value)).toEqual(["boost", "rrf"]);
  expect(options[1].props.children).toContain("(experimental)");
});

it("shows plain labels for the chosen mode and the key name as secondary text", () => {
  expect(html("boost")).toContain(PLAIN_TEXT.keywordBoost);
  expect(html("rrf")).toContain(PLAIN_TEXT.keywordMerge);
  expect(html()).toContain("keywordMode");
  expect(html()).not.toContain("Boost (default)");
  expect(html("rrf")).not.toContain("Rank fusion");
});

it("uses the shared Button for Save and Cancel", () => {
  const buttons = tree("rrf").filter((node) => node.type === Button);
  expect(buttons).toHaveLength(2);
  expect(buttons[1].props.variant).toBe("outline");
});

it("explains the chosen mode", () => {
  expect(html("boost")).toContain("gets a small bonus in the order of the results");
  const rrf = html("rrf");
  expect(rrf).toContain("even when its meaning score is low");
  expect(rrf).toContain("Experimental");
});

it("says the reranker wins only when it is on and rank fusion is chosen", () => {
  const rerankerOn = {
    rerankerEnabled: { value: true, source: "global" },
    rerankerApiUrl: { value: "http://127.0.0.1:3008/v1", source: "global" },
    rerankerModel: { value: "m", source: "global" },
  };
  expect(html("rrf", rerankerOn)).toContain("not used while the reranker is on");
  expect(html("boost", rerankerOn)).not.toContain("not used while the reranker is on");
  expect(html("rrf")).not.toContain("not used while the reranker is on");
});

it("tells the user when a project file sets the mode", () => {
  const project = { keywordMode: { value: "rrf", source: "project", globalValue: "boost" } };
  expect(html("boost", project)).toContain("file decides this setting here");
  expect(html("boost")).not.toContain("file decides this setting here");
});

it("enables Save only when the mode differs from the saved one", () => {
  expect(saveButton("boost")?.props.disabled).toBe(true);
  expect(saveButton("rrf")?.props.disabled).toBe(false);
});

it("disables the control while saving", () => {
  expect(html("rrf", {}, true)).toContain("disabled");
});

it("has a Chinese and an Arabic text for every message the card shows", () => {
  for (const message of KEYWORD_MODE_MESSAGES) {
    expect(translateSettings(message, "zh")).not.toBe(message);
    expect(translateSettings(message, "ar")).not.toBe(message);
  }
});

it("asks before it saves the mode, and sends nothing until the user confirms", () => {
  stubFetch((call) =>
    call.init?.method === "PATCH"
      ? { ok: true, json: async () => ({}) }
      : { ok: true, json: async () => snapshotFixture() }
  );
  submitForm(tree("rrf"));
  const dialog = dialogOf(shown());
  expect(dialog.props.title).toBe("Save keyword matching?");
  expect(dialog.props.confirmLabel).toBe("Save");
  expect(rowsOf(dialog)).toEqual([
    {
      key: "keywordMode",
      label: "How word matches join the results",
      from: PLAIN_TEXT.keywordBoost,
      to: PLAIN_TEXT.keywordMerge,
    },
  ]);
  expect(calls.filter((call) => call.init?.method === "PATCH")).toHaveLength(0);
});

it("lists the mode names in the language of the page", () => {
  stubFetch(() => {
    throw new Error("no request expected");
  });
  setLanguage("ar");
  submitForm(tree("rrf"));
  const [row] = rowsOf(dialogOf(shown())) as { from: string; to: string }[];
  // The dropdown shows these names translated, so the dialog must too.
  expect(row!.from).not.toBe(PLAIN_TEXT.keywordBoost);
  expect(row!.to).not.toBe(PLAIN_TEXT.keywordMerge);
  expect(row!.from).toMatch(/[؀-ۿ]/);
  expect(row!.to).toMatch(/[؀-ۿ]/);
});

it("sends nothing on Cancel, and the chosen mode stays", () => {
  stubFetch(() => {
    throw new Error("no request expected");
  });
  submitForm(tree("rrf"));
  (dialogOf(shown()).props.onClose as () => void)();
  expect(calls).toHaveLength(0);
  expect(states[1]).toBe("rrf");
  expect(shown().filter((node) => node.type === Select)[0]!.props.value).toBe("rrf");
});

it("sends the same request as before the rule once the user confirms", async () => {
  stubFetch((call) =>
    call.init?.method === "PATCH"
      ? { ok: true, json: async () => ({}) }
      : { ok: true, json: async () => snapshotFixture() }
  );
  submitForm(tree("rrf"));
  const dialog = dialogOf(shown());
  const result = await (dialog.props.onConfirm as () => Promise<{ success: boolean }>)();
  expect(result).toEqual({ success: true });
  const patch = calls.find((call) => call.init?.method === "PATCH")!;
  expect(patch.url).toBe("/api/settings");
  expect(JSON.parse(String(patch.init!.body))).toEqual({
    edits: { keywordMode: "rrf" },
    revision: "rev-1",
  });
});

it("keeps a server refusal inside the dialog, which stays open", async () => {
  stubFetch((call) =>
    call.init?.method === "PATCH"
      ? {
          ok: false,
          status: 409,
          json: async () => ({ error: "Config changed. Reload settings and save again." }),
        }
      : { ok: true, json: async () => snapshotFixture() }
  );
  submitForm(tree("rrf"));
  const dialog = dialogOf(shown());
  const result = await (
    dialog.props.onConfirm as () => Promise<{ success: boolean; error?: string }>
  )();
  expect(result).toMatchObject({
    success: false,
    error: "Config changed. Reload settings and save again.",
  });
  expect(dialogOf(shown())).toBeDefined();
  await flush();
  expect(states[1]).toBe("rrf");
});
