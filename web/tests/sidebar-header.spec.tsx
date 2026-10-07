import { beforeEach, expect, it, mock } from "bun:test";
import type { ReactElement, ReactNode } from "react";
import * as react from "react";
import { translations } from "../src/lib/i18n/translations.ts";

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
  useEffect: (effect: () => void) => {
    effect();
  },
  useRef: (value: unknown) => ({ current: value }),
  // Subscribe on each render as the effect mock does; the store keeps one timer.
  useSyncExternalStore: (subscribe: (cb: () => void) => () => void, snapshot: () => unknown) => {
    subscribe(() => {});
    return snapshot();
  },
}));

let status: { version: string; canControl: boolean; instance?: string } | null = null;
mock.module("../src/lib/power.ts", () => ({
  STATUS_POLL_MS: 15_000,
  readPowerStatus: async () => status,
  sendPowerAction: async () => true,
  waitForWebApp: async () => "restarted",
  sendUpdate: async () => true,
  waitForUpdate: async () => ({ kind: "restarted" }),
}));
mock.module("../src/lib/theme.ts", () => ({ useTheme: () => "dark", toggleTheme: () => {} }));
const store = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
  },
  setInterval: () => 0,
  clearInterval: () => {},
});

const { SidebarBrand } = await import("../src/lib/components/explorer/SidebarBrand.tsx");
const { AppSidebar } = await import("../src/lib/components/explorer/AppSidebar.tsx");

type Node = ReactElement<{ children?: ReactNode; [key: string]: unknown }>;
function find(node: ReactNode, predicate: (node: Node) => boolean): Node[] {
  if (!react.isValidElement(node))
    return Array.isArray(node) ? node.flatMap((child) => find(child, predicate)) : [];
  const element = node as Node;
  return [...(predicate(element) ? [element] : []), ...find(element.props.children, predicate)];
}
function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (react.isValidElement(node)) return textOf((node as Node).props.children);
  return "";
}
const tick = async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
};
function brand() {
  cursor = 0;
  return SidebarBrand({ brand: "OMMS" });
}
const version = (tree: ReactNode) =>
  find(tree, (node) => node.props["data-testid"] === "sidebar-version")[0];

beforeEach(() => {
  state = [];
  store.clear();
  status = null;
});

it("names the product OMMS in every language", () => {
  for (const language of ["en", "zh", "ar"] as const) {
    expect((translations[language] as Record<string, string>).brand).toBe("OMMS");
  }
});

it("shows the name in the brand colour and no version before a status answers", async () => {
  brand();
  await tick();
  const tree = brand();
  const name = find(tree, (node) => node.props.children === "OMMS")[0];
  expect(String(name?.props.className)).toContain("text-brand-label");
  expect(version(tree)).toBeUndefined();
});

it("shows the running version in a smaller font and the normal text colour", async () => {
  status = { version: "4.9.0", canControl: true, instance: "a" };
  brand();
  await tick();
  const shown = version(brand());
  expect(textOf(shown)).toBe("v4.9.0");
  expect(String(shown?.props.className)).toContain("text-xs");
  expect(String(shown?.props.className)).toContain("text-foreground");
  expect(String(shown?.props.className)).not.toContain("text-muted-foreground");
});

it("shows a new version without a page reload", async () => {
  status = { version: "4.9.0", canControl: true, instance: "a" };
  brand();
  await tick();
  status = { version: "4.10.0", canControl: true, instance: "b" };
  brand();
  await tick();
  expect(textOf(version(brand()))).toBe("v4.10.0");
});

function sidebar() {
  cursor = 0;
  return AppSidebar({
    currentView: "project",
    brand: "OMMS",
    projectLabel: "Project",
    profileLabel: "Profile",
    profileSections: [],
    langLabel: "EN",
    languageLabel: "Language",
    themeLabel: "Theme",
    settingsLabel: "Settings",
    closeLabel: "Close",
    collapseLabel: "Collapse",
    expandLabel: "Expand",
  });
}
const header = (tree: ReactNode) => find(tree, (node) => node.type === SidebarBrand)[0];

it("hides the name and the version when the desktop sidebar is collapsed", () => {
  expect(String(header(sidebar())?.props.className ?? "")).not.toContain("md:hidden");
  store.set("omms-sidebar-collapsed", "1");
  state = [];
  expect(String(header(sidebar())?.props.className)).toContain("md:hidden");
});
