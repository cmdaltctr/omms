import { beforeEach, expect, it, mock } from "bun:test";
import { readFileSync } from "node:fs";
import * as react from "react";
import type { ReactElement, ReactNode } from "react";
import { SETTINGS_SECTIONS } from "../src/lib/settings-sections.ts";
import { MEMORY_SECTIONS } from "../src/lib/memory-sections.ts";
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

it("registers five Memory operations once and retains unrelated Settings order with Profiles identity", () => {
  const ids = MEMORY_SECTIONS.map((section) => section.id);
  expect(new Set(ids).size).toBe(5);
  expect(ids).toEqual([
    "memory-section-import",
    "memory-section-auto-import",
    "memory-section-profile",
    "memory-section-limits",
    "memory-section-project-folders",
  ]);
  expect(SETTINGS_SECTIONS.map((section) => section.id)).toEqual([
    "settings-section-external-api",
    "settings-section-models",
    "settings-section-embedding",
    "settings-section-keys",
    "settings-section-diagnostics",
    "settings-section-health",
    "settings-section-claude-folder",
    "settings-section-profiles",
    "settings-section-web-app",
    "settings-section-log",
  ]);
});
it("composes the limits once into Memory and reveals the URL after mount", () => {
  const view = source("lib/components/memory/MemoryView.tsx");
  expect(view).toContain('"memory-section-limits": <MemorySection />');
  expect(view).toContain("revealPageAnchor(window.location.hash)");
  expect(view).toContain('className="scroll-mt-20 md:scroll-mt-4"');
  const settings = source("lib/components/settings/SettingsView.tsx");
  for (const card of [
    "ImportSection",
    "AutoImportSection",
    "ProfileCatchUpSection",
    "MemorySection",
    "DirectoryMapsSection",
  ])
    expect(settings).not.toContain(card);
  expect(settings).toContain('"settings-section-profiles": ProfilesSection');
  expect(source("lib/components/settings/ProfilesSection.tsx")).toContain(
    "if (profiles.length < 2) return null;"
  );
});
it("reveals the Memory or Settings card named by the hash and ignores unknown hashes", async () => {
  const { revealSettingsAnchor } = await import("../src/lib/settings-navigation.ts");
  const scrolled: string[] = [];
  const element = { scrollIntoView: (options: unknown) => scrolled.push(JSON.stringify(options)) };
  const getElementById = mock((id: string) =>
    ["memory-section-limits", "settings-section-health"].includes(id) ? element : null
  );
  const doc = { getElementById } as unknown as Document;
  expect(revealSettingsAnchor("#memory-section-limits", doc)).toBe(true);
  expect(revealSettingsAnchor("#settings-section-health", doc)).toBe(true);
  for (const hash of [
    "#directory-maps-pi",
    "",
    "#",
    "#not-a-section",
    "memory-section-limits",
    "#settings-section-log",
  ])
    expect(revealSettingsAnchor(hash, doc)).toBe(false);
  expect(scrolled).toEqual([
    '{"behavior":"smooth","block":"start"}',
    '{"behavior":"smooth","block":"start"}',
  ]);
});
it("keeps host folder navigation and excludes it from the limit card", () => {
  for (const file of [
    "lib/components/memory/AutoImportSection.tsx",
    "lib/components/settings/ImportStatusBadge.tsx",
  ]) {
    expect(source(file)).toContain("revealDirectoryMaps(host)");
    expect(source(file)).toContain("event.preventDefault()");
  }
  expect(source("lib/directory-map-navigation.ts")).toContain("directory-maps-${host}");
  expect(source("lib/components/memory/MemorySection.tsx")).not.toContain("revealDirectoryMaps");
});
it("lists translated Memory children in each language and keeps Settings free of moved operations", () => {
  for (const language of ["en", "zh", "ar"] as const) {
    state = [];
    cursor = 0;
    const tree = AppSidebar({
      currentView: "memory",
      brand: "omms",
      projectLabel: "Project",
      profileLabel: "Profile",
      profileSections: [],
      memoryLabel: translateSettings("Memory", language),
      memorySections: MEMORY_SECTIONS.map((section) => ({
        id: section.id,
        label: translateSettings(section.title, language),
      })),
      settingsSections: SETTINGS_SECTIONS.map((section) => ({
        id: section.id,
        label: translateSettings(section.title, language),
      })),
      langLabel: language.toUpperCase(),
      languageLabel: "Language",
      themeLabel: "Theme",
      settingsLabel: "Settings",
      closeLabel: "Close",
      collapseLabel: "Collapse",
      expandLabel: "Expand",
    });
    const links = find(
      tree,
      (node) => node.type === "a" && String(node.props.href).startsWith("/memory#")
    );
    expect(links.map((link) => link.props.href)).toEqual(
      MEMORY_SECTIONS.map((section) => `/memory#${section.id}`)
    );
    links.forEach((link, index) =>
      expect(react.Children.toArray(link.props.children)[0]).toBe(
        translateSettings(MEMORY_SECTIONS[index].title, language)
      )
    );
    expect(
      find(tree, (node) => node.props.href === "/settings#settings-section-memory")
    ).toHaveLength(0);
  }
});
it("uses shared navigation for Memory and Settings children", () => {
  const sidebar = source("lib/components/explorer/AppSidebar.tsx");
  expect(sidebar).toContain('onSectionClick(e, section.id, "settings")');
  expect(sidebar).toContain('onSectionClick(e, section.id, "memory")');
  expect(sidebar).not.toContain("revealDirectoryMaps");
});
