import { beforeEach, expect, it, mock } from "bun:test";
import { readFileSync } from "node:fs";
import * as react from "react";
import type { ReactElement, ReactNode } from "react";
import { SETTINGS_SECTIONS } from "../src/lib/settings-sections.ts";
import { MEMORY_SECTIONS, SHARED_ROWS } from "../src/lib/memory-sections.ts";
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
const { MemorySidebarLinks } = await import("../src/lib/components/memory/MemorySidebarLinks.tsx");
const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
type Node = ReactElement<{ children?: ReactNode; [key: string]: unknown }>;
function find(node: ReactNode, predicate: (node: Node) => boolean): Node[] {
  if (!react.isValidElement(node))
    return Array.isArray(node) ? node.flatMap((child) => find(child, predicate)) : [];
  const element = node as Node;
  // The Memory links are their own component; mount it as React would.
  const children =
    element.type === MemorySidebarLinks
      ? (element.type as (props: unknown) => ReactNode)(element.props)
      : element.props.children;
  return [...(predicate(element) ? [element] : []), ...find(children, predicate)];
}
beforeEach(() => {
  state = [];
  store.clear();
});

it("registers the four Memory views once and retains unrelated Settings order with Profiles identity", () => {
  const ids = MEMORY_SECTIONS.map((section) => section.id);
  expect(new Set(ids).size).toBe(4);
  expect(ids).toEqual(["pi", "opencode", "claude-code", "shared"]);
  expect(MEMORY_SECTIONS.map((section) => section.title)).toEqual([
    "Pi",
    "OpenCode",
    "Claude Code",
    "Shared",
  ]);
  expect(SETTINGS_SECTIONS.map((section) => section.id)).toEqual([
    "settings-section-external-api",
    "settings-section-models",
    "settings-section-embedding",
    "settings-section-keys",
    "settings-section-diagnostics",
    "settings-section-health",
    "settings-section-claude-folder",
    "settings-section-capture-language",
    "settings-section-profiles",
    "settings-section-web-app",
    "settings-section-log",
  ]);
});
it("composes the limits once into the Shared view and reveals the URL after mount", () => {
  const view = source("lib/components/memory/MemoryView.tsx");
  const shared = source("lib/components/memory/SharedView.tsx");
  expect(shared).toContain('id="shared-limits"');
  expect(shared.match(/<MemorySection \/>/g)).toHaveLength(1);
  expect(view).not.toContain("MemorySection");
  expect(view).toContain("revealPageAnchor(window.location.hash)");
  expect(shared).toContain("scroll-mt-20");
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
  // The host view's folder link opens that host's own list; the badge keeps the older helper.
  expect(source("lib/components/memory/HostRunDetails.tsx")).toContain("navigate(target)");
  expect(source("lib/components/memory/HostRunDetails.tsx")).toContain("event.preventDefault()");
  expect(source("lib/components/settings/ImportStatusBadge.tsx")).toContain(
    "revealDirectoryMaps(host)"
  );
  expect(source("lib/components/settings/ImportStatusBadge.tsx")).toContain(
    "event.preventDefault()"
  );
  expect(source("lib/directory-map-navigation.ts")).toContain("directory-maps-${host}");
  expect(source("lib/components/memory/MemorySection.tsx")).not.toContain("revealDirectoryMaps");
});
it("lists the Memory views in each language and keeps Settings free of moved operations", () => {
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
      (node) => node.type === "a" && String(node.props.href).startsWith("/memory/")
    );
    expect(links.map((link) => link.props.href)).toEqual(
      MEMORY_SECTIONS.map((section) => `/memory/${section.id}`)
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
  expect(sidebar).toContain("onSectionClick={onSectionClick}");
  expect(source("lib/components/memory/MemorySidebarLinks.tsx")).toContain(
    'onSectionClick(event, section.id, "memory")'
  );
  expect(sidebar).not.toContain("revealDirectoryMaps");
});
it("marks only the Memory view on screen as current", () => {
  state = [];
  cursor = 0;
  const tree = AppSidebar({
    currentView: "memory",
    memoryViewId: "opencode",
    brand: "omms",
    projectLabel: "Project",
    profileLabel: "Profile",
    profileSections: [],
    memoryLabel: "Memory",
    memorySections: MEMORY_SECTIONS.map((section) => ({ id: section.id, label: section.title })),
    langLabel: "EN",
    languageLabel: "Language",
    themeLabel: "Theme",
    settingsLabel: "Settings",
    closeLabel: "Close",
    collapseLabel: "Collapse",
    expandLabel: "Expand",
  });
  const links = find(
    tree,
    (node) => node.type === "a" && String(node.props.href).startsWith("/memory/")
  );
  expect(links.map((link) => [link.props.href, link.props["aria-current"]])).toEqual([
    ["/memory/pi", undefined],
    ["/memory/opencode", "page"],
    ["/memory/claude-code", undefined],
    ["/memory/shared", undefined],
  ]);
});

it("shows each host's avatar and a warning marker beside the Memory views", () => {
  state = [];
  cursor = 0;
  const tree = AppSidebar({
    currentView: "memory",
    brand: "omms",
    projectLabel: "Project",
    profileLabel: "Profile",
    profileSections: [],
    memoryLabel: "Memory",
    memoryWarningLabel: "Memories not saved",
    memorySections: [
      { id: "pi", label: "Pi", avatar: <span data-avatar="pi" />, warning: true },
      { id: "shared", label: "Shared" },
    ],
    langLabel: "EN",
    languageLabel: "Language",
    themeLabel: "Theme",
    settingsLabel: "Settings",
    closeLabel: "Close",
    collapseLabel: "Collapse",
    expandLabel: "Expand",
  });
  expect(find(tree, (node) => node.props["data-avatar"] === "pi")).toHaveLength(1);
  const markers = find(tree, (node) => node.props["aria-label"] === "Memories not saved");
  expect(markers).toHaveLength(1);
  expect(markers[0].props.role).toBe("img");
});

it("lists the Shared rows as a contents tree under Shared, each linking to its row", () => {
  state = [];
  cursor = 0;
  const items = SHARED_ROWS.map((row) => ({ id: row.id, label: row.title }));
  const tree = AppSidebar({
    currentView: "memory",
    brand: "omms",
    projectLabel: "Project",
    profileLabel: "Profile",
    profileSections: [],
    memoryLabel: "Memory",
    memorySections: [
      { id: "pi", label: "Pi" },
      { id: "shared", label: "Shared", items },
    ],
    langLabel: "EN",
    languageLabel: "Language",
    themeLabel: "Theme",
    settingsLabel: "Settings",
    closeLabel: "Close",
    collapseLabel: "Collapse",
    expandLabel: "Expand",
  });
  const rows = find(
    tree,
    (node) => node.type === "a" && String(node.props.href).startsWith("/memory/shared#")
  );
  expect(rows.map((row) => row.props.href)).toEqual(
    SHARED_ROWS.map((row) => `/memory/shared#${row.id}`)
  );
  expect(rows.map((row) => react.Children.toArray(row.props.children)[0])).toEqual(
    SHARED_ROWS.map((row) => row.title)
  );
  // Only Shared has a tree; Pi has none.
  expect(
    find(tree, (node) => node.type === "a" && String(node.props.href).startsWith("/memory/pi#"))
  ).toHaveLength(0);
  // The tree is a nested list inside Shared's list item, not a sibling of the four views.
  const lists = find(tree, (node) => node.type === "ul" && node.props["aria-label"] === "Shared");
  expect(lists).toHaveLength(1);
});

it("opens a row and closes the mobile drawer when a contents link is chosen", () => {
  state = [];
  cursor = 0;
  const dismissed: boolean[] = [];
  const items = [{ id: "shared-reranker", label: "Reranker" }];
  const tree = AppSidebar({
    currentView: "memory",
    brand: "omms",
    projectLabel: "Project",
    profileLabel: "Profile",
    profileSections: [],
    memoryLabel: "Memory",
    memorySections: [{ id: "shared", label: "Shared", items }],
    langLabel: "EN",
    languageLabel: "Language",
    themeLabel: "Theme",
    settingsLabel: "Settings",
    closeLabel: "Close",
    collapseLabel: "Collapse",
    expandLabel: "Expand",
    onOpenChange: (value) => dismissed.push(value),
  } as Parameters<typeof AppSidebar>[0]);
  const link = find(tree, (node) => node.props.href === "/memory/shared#shared-reranker")[0];
  let prevented = false;
  const pushed: string[] = [];
  const originalWindow = globalThis.window;
  Object.assign(globalThis, {
    window: {
      location: { pathname: "/memory/pi", hash: "" },
      history: {
        pushState: (_a: unknown, _b: unknown, path: string) => pushed.push(path),
        replaceState: (_a: unknown, _b: unknown, path: string) => pushed.push(path),
      },
    },
    document: {
      getElementById: () => ({ closest: () => ({ open: false }), scrollIntoView: () => {} }),
    },
    requestAnimationFrame: (fn: () => void) => fn(),
  });
  (link.props.onClick as (event: unknown) => void)({
    button: 0,
    preventDefault: () => (prevented = true),
  });
  Object.assign(globalThis, { window: originalWindow });
  expect(prevented).toBe(true);
  expect(pushed).toEqual(["/memory/shared#shared-reranker"]);
  expect(dismissed.at(-1)).toBe(false);
});

it("leaves a modified click on a contents link to the browser", () => {
  state = [];
  cursor = 0;
  const tree = AppSidebar({
    currentView: "memory",
    brand: "omms",
    projectLabel: "Project",
    profileLabel: "Profile",
    profileSections: [],
    memoryLabel: "Memory",
    memorySections: [
      { id: "shared", label: "Shared", items: [{ id: "shared-limits", label: "Memory limits" }] },
    ],
    langLabel: "EN",
    languageLabel: "Language",
    themeLabel: "Theme",
    settingsLabel: "Settings",
    closeLabel: "Close",
    collapseLabel: "Collapse",
    expandLabel: "Expand",
  });
  const link = find(tree, (node) => node.props.href === "/memory/shared#shared-limits")[0];
  let prevented = false;
  (link.props.onClick as (event: unknown) => void)({
    button: 0,
    metaKey: true,
    preventDefault: () => (prevented = true),
  });
  expect(prevented).toBe(false);
});
