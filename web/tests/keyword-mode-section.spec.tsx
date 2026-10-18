import { beforeEach, expect, it, mock } from "bun:test";
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
const { Label } = await import("../src/lib/components/ui/label.tsx");
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

beforeEach(() => setLanguage("en"));

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

it("uses the shared Select with a Label and offers both modes", () => {
  const nodes = tree("boost");
  const select = nodes.find((node) => node.type === Select);
  expect(select).toBeDefined();
  expect(nodes.some((node) => node.type === Label && node.props.htmlFor === "keyword-mode")).toBe(
    true
  );
  const options = find(select?.props.children, (node) => node.type === "option");
  expect(options.map((node) => node.props.value)).toEqual(["boost", "rrf"]);
  expect(options[1].props.children).toContain("(experimental)");
});

it("caps the width of the dropdown and its list with a wrapper", () => {
  const nodes = tree("boost");
  const wrapper = nodes.find(
    (node) =>
      typeof node.props.className === "string" &&
      node.props.className.includes("w-72") &&
      find(node.props.children, (child) => child.type === Select).length === 1
  );
  expect(wrapper?.props.className).toContain("max-w-full");
});

it("shows the chosen mode and the key name", () => {
  expect(html("boost")).toContain("Boost (default)");
  expect(html("rrf")).toContain("Rank fusion (experimental)");
  expect(html()).toContain("keywordMode");
});

it("uses the shared Button for Save and Cancel", () => {
  const buttons = tree("rrf").filter((node) => node.type === Button);
  expect(buttons).toHaveLength(2);
  expect(buttons[1].props.variant).toBe("outline");
});

it("explains the chosen mode", () => {
  expect(html("boost")).toContain("small score bonus");
  const rrf = html("rrf");
  expect(rrf).toContain("below the similarity threshold");
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
  expect(html("boost", project)).toContain("A project file can override this setting");
  expect(html("boost")).not.toContain("A project file can override this setting");
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
