import { beforeEach, expect, it, mock } from "bun:test";
import type { ReactElement, ReactNode } from "react";
import * as react from "react";
import { SETTINGS_SECTIONS } from "../src/lib/settings-sections.ts";

let state: unknown[] = [];
let cursor = 0;
mock.module("react", () => ({
  ...react,
  useState: (initial: unknown) => {
    const index = cursor++;
    state[index] ??= typeof initial === "function" ? (initial as () => unknown)() : initial;
    return [
      state[index],
      (value: unknown) => {
        state[index] = typeof value === "function" ? value(state[index]) : value;
      },
    ];
  },
  useEffect: () => {},
  useRef: (value: unknown) => ({ current: value }),
}));
mock.module("../src/lib/theme.ts", () => ({ useTheme: () => "dark", toggleTheme: () => {} }));
const store = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  },
});

const { AppSidebar } = await import("../src/lib/components/explorer/AppSidebar.tsx");

type Node = ReactElement<{ children?: ReactNode; [key: string]: unknown }>;
function find(node: ReactNode, predicate: (node: Node) => boolean): Node[] {
  if (!react.isValidElement(node))
    return Array.isArray(node) ? node.flatMap((child) => find(child, predicate)) : [];
  const element = node as Node;
  return [...(predicate(element) ? [element] : []), ...find(element.props.children, predicate)];
}
const sections = SETTINGS_SECTIONS.map((section) => ({ id: section.id, label: section.title }));
function render(currentView: "project" | "settings") {
  cursor = 0;
  return AppSidebar({
    currentView,
    brand: "omms",
    projectLabel: "Project",
    profileLabel: "Profile",
    profileSections: [],
    settingsSections: sections,
    langLabel: "EN",
    languageLabel: "Language",
    themeLabel: "Theme",
    settingsLabel: "Settings",
    closeLabel: "Close",
    collapseLabel: "Collapse",
    expandLabel: "Expand",
  });
}
const links = (tree: ReactNode) =>
  find(tree, (node) => node.type === "a" && String(node.props.href).startsWith("/settings#"));
const toggle = (tree: ReactNode) =>
  find(
    tree,
    (node) => node.type === "button" && node.props["aria-controls"] === "sidebar-settings-tree"
  )[0]!;

beforeEach(() => {
  state = [];
  store.clear();
});

it("names every settings card once, with a unique anchor", () => {
  const ids = SETTINGS_SECTIONS.map((section) => section.id);
  expect(new Set(ids).size).toBe(ids.length);
  expect(SETTINGS_SECTIONS.map((section) => section.title)).toContain("Keys and access");
  expect(SETTINGS_SECTIONS.length).toBe(14);
});

it("shows Settings in the main menu, opened on the settings page", () => {
  const tree = render("settings");
  const main = find(
    tree,
    (node) =>
      node.type === "a" && node.props.href === "/settings" && node.props["aria-current"] === "page"
  );
  expect(main.length).toBeGreaterThan(0);
  expect(toggle(tree).props["aria-expanded"]).toBe(true);
  expect(links(tree).map((link) => link.props.href)).toEqual(
    SETTINGS_SECTIONS.map((section) => `/settings#${section.id}`)
  );
});

it("starts closed on other pages, and the toggle opens it and remembers the choice", () => {
  let tree = render("project");
  expect(toggle(tree).props["aria-expanded"]).toBe(false);
  expect(links(tree)).toHaveLength(0);
  (toggle(tree).props.onClick as () => void)();
  tree = render("project");
  expect(toggle(tree).props["aria-expanded"]).toBe(true);
  expect(links(tree)).toHaveLength(14);
  expect(store.get("omms-sidebar-settings-open")).toBe("1");
});
