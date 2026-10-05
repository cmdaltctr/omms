import { beforeEach, expect, it, mock } from "bun:test";
import { readFileSync } from "node:fs";
import * as react from "react";
import type { ReactElement, ReactNode } from "react";
import { SETTINGS_SECTIONS } from "../src/lib/settings-sections.ts";
import { translateSettings } from "../src/lib/i18n/settings.ts";

let state: unknown[] = [];
let cursor = 0;
mock.module("react", () => ({
  ...react,
  useEffect: () => {},
  useRef: (value: unknown) => ({ current: value }),
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

const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

type Node = ReactElement<{ children?: ReactNode; [key: string]: unknown }>;
function find(node: ReactNode, predicate: (node: Node) => boolean): Node[] {
  if (!react.isValidElement(node))
    return Array.isArray(node) ? node.flatMap((child) => find(child, predicate)) : [];
  const element = node as Node;
  return [...(predicate(element) ? [element] : []), ...find(element.props.children, predicate)];
}

beforeEach(() => {
  state = [];
  store.clear();
});

it("registers Memory once, immediately after Models, with a unique anchor", () => {
  const ids = SETTINGS_SECTIONS.map((section) => section.id);
  expect(new Set(ids).size).toBe(ids.length);
  const memory = SETTINGS_SECTIONS.filter((section) => section.title === "Memory");
  expect(memory).toHaveLength(1);
  expect(memory[0].id).toBe("settings-section-memory");
  expect(ids.indexOf("settings-section-memory")).toBe(ids.indexOf("settings-section-models") + 1);
  // Every other card keeps its existing anchor and order apart from Memory's insertion.
  const withoutMemory = ids.filter((id) => id !== "settings-section-memory");
  const expected = [
    "settings-section-external-api",
    "settings-section-models",
    "settings-section-embedding",
    "settings-section-keys",
    "settings-section-diagnostics",
    "settings-section-health",
    "settings-section-claude-folder",
    "settings-section-import",
    "settings-section-auto-import",
    "settings-section-profile",
    "settings-section-directory-maps",
    "settings-section-web-app",
    "settings-section-log",
  ];
  expect(withoutMemory).toEqual(expected);
});

it("composes MemorySection into the page and scrolls the URL anchor after mount", () => {
  const view = source("lib/components/settings/SettingsView.tsx");
  expect(view).toContain('"settings-section-memory": MemorySection');
  expect(view).toContain("revealSettingsAnchor(window.location.hash, document)");
  // The sticky mobile header overlaps scrolled cards, so the anchor margin is
  // larger on mobile and returns to the desktop value at md and above.
  expect(view).toContain('className="scroll-mt-20 md:scroll-mt-4"');
  // The page itself never calls the host-specific disclosure helper.
  expect(view).not.toContain("revealDirectoryMaps");
});

it("reveals the card named by the hash and ignores every other hash", async () => {
  const { revealSettingsAnchor } = await import("../src/lib/settings-navigation.ts");
  const scrolled: string[] = [];
  const element = { scrollIntoView: (options: unknown) => scrolled.push(JSON.stringify(options)) };
  const getElementById = mock((id: string) => (id === "settings-section-memory" ? element : null));
  const doc = { getElementById };
  expect(revealSettingsAnchor("#settings-section-memory", doc as unknown as Document)).toBe(true);
  expect(scrolled).toEqual(['{"behavior":"smooth","block":"start"}']);
  // Host disclosures and non-settings hashes are not this helper's job.
  expect(revealSettingsAnchor("#directory-maps-pi", doc as unknown as Document)).toBe(false);
  expect(revealSettingsAnchor("", doc as unknown as Document)).toBe(false);
  expect(revealSettingsAnchor("#", doc as unknown as Document)).toBe(false);
  expect(revealSettingsAnchor("#not-a-settings-section", doc as unknown as Document)).toBe(false);
  expect(revealSettingsAnchor("settings-section-memory", doc as unknown as Document)).toBe(false);
  expect(scrolled).toHaveLength(1);
  // A missing element does nothing rather than throwing.
  expect(revealSettingsAnchor("#settings-section-log", doc as unknown as Document)).toBe(false);
  expect(scrolled).toHaveLength(1);
});

it("keeps the host directory-map helper and anchors untouched by Memory", () => {
  // The host disclosure helper keeps its job and its call sites.
  for (const file of ["AutoImportSection", "ImportStatusBadge"]) {
    expect(source(`lib/components/settings/${file}.tsx`)).toContain(
      "onClick={() => revealDirectoryMaps(host)}"
    );
  }
  expect(source("lib/directory-map-navigation.ts")).toContain("directory-maps-${host}");
  expect(source("lib/settings-sections.ts")).toContain('id: "settings-section-directory-maps"');
  // The Memory card and the settings anchor handling never call or import it.
  for (const file of ["lib/components/settings/MemorySection.tsx", "lib/settings-navigation.ts"]) {
    const text = source(file);
    expect(text).not.toMatch(/revealDirectoryMaps\s*\(/);
    expect(text).not.toMatch(/from "[^"]*directory-map-navigation"/);
    expect(text).not.toContain("directory-maps-");
  }
});

it("lists Memory once among the sidebar's Settings children in every language", () => {
  let language: "en" | "zh" | "ar" = "en";
  const renderSidebar = (currentView: "project" | "settings", reset = true) => {
    if (reset) state = [];
    cursor = 0;
    return AppSidebar({
      currentView,
      brand: "omms",
      projectLabel: "Project",
      profileLabel: "Profile",
      profileSections: [],
      // The page passes translated titles, as App.tsx does.
      settingsSections: SETTINGS_SECTIONS.map((section) => ({
        id: section.id,
        label: translateSettings(section.title, language),
      })),
      langLabel: "EN",
      languageLabel: "Language",
      themeLabel: "Theme",
      settingsLabel: "Settings",
      closeLabel: "Close",
      collapseLabel: "Collapse",
      expandLabel: "Expand",
    });
  };
  for (language of ["en", "zh", "ar"] as const) {
    // On the settings page the tree starts open and lists every card in order.
    const open = find(
      renderSidebar("settings"),
      (node) => node.type === "a" && String(node.props.href).startsWith("/settings#")
    );
    expect(open.map((link) => link.props.href)).toEqual(
      SETTINGS_SECTIONS.map((section) => `/settings#${section.id}`)
    );
    const memory = open.filter((link) => link.props.href === "/settings#settings-section-memory");
    expect(memory).toHaveLength(1);
    // The accessible label follows the page language.
    expect(react.Children.toArray(memory[0].props.children)[0]).toBe(
      translateSettings("Memory", language)
    );
    // From the project view the tree starts closed; opening it reveals Memory.
    store.clear();
    state = [];
    const closed = find(
      renderSidebar("project"),
      (node) => node.type === "a" && String(node.props.href).startsWith("/settings#")
    );
    expect(closed).toHaveLength(0);
    const toggle = find(
      renderSidebar("project", false),
      (node) => node.type === "button" && node.props["aria-controls"] === "sidebar-settings-tree"
    )[0]!;
    (toggle.props.onClick as () => void)();
    const reopened = find(
      renderSidebar("project", false),
      (node) => node.type === "a" && node.props.href === "/settings#settings-section-memory"
    );
    expect(reopened).toHaveLength(1);
  }
});

it("sends every settings child through the shared section click handler", () => {
  const sidebar = source("lib/components/explorer/AppSidebar.tsx");
  expect(sidebar).toContain('onClick={(e) => onSectionClick(e, section.id, "settings")}');
  expect(sidebar).not.toContain("revealDirectoryMaps");
});
