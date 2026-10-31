import { beforeEach, expect, it, mock } from "bun:test";
import * as react from "react";
import type { ReactElement, ReactNode } from "react";

// The same hook harness as the other sidebar specs.
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
let blocked = false;
Object.assign(globalThis, {
  localStorage: {
    getItem: (key: string) => {
      if (blocked) throw new Error("blocked");
      return store.get(key) ?? null;
    },
    setItem: (key: string, value: string) => {
      if (blocked) throw new Error("blocked");
      store.set(key, value);
    },
  },
});
const { AppSidebar } = await import("../src/lib/components/explorer/AppSidebar.tsx");
const { MemorySidebarLinks } = await import("../src/lib/components/memory/MemorySidebarLinks.tsx");
const { ProfileTree } = await import("../src/lib/components/explorer/ProfileTree.tsx");
const { SidebarNavLink } = await import("../src/lib/components/explorer/SidebarNavLink.tsx");

type Node = ReactElement<{ children?: ReactNode; [key: string]: any }>;
function find(node: ReactNode, predicate: (node: Node) => boolean): Node[] {
  if (!react.isValidElement(node))
    return Array.isArray(node) ? node.flatMap((child) => find(child, predicate)) : [];
  const element = node as Node;
  const mounted =
    element.type === MemorySidebarLinks ||
    element.type === ProfileTree ||
    element.type === SidebarNavLink;
  const children = mounted
    ? (element.type as (props: unknown) => ReactNode)(element.props)
    : element.props.children;
  return [...(predicate(element) ? [element] : []), ...find(children, predicate)];
}

const sections = [
  { id: "profile-preferences", label: "Preferences" },
  { id: "profile-patterns", label: "Patterns" },
  { id: "profile-workflows", label: "Workflows" },
];
function render(currentView: string, extra: Record<string, unknown> = {}) {
  cursor = 0;
  return AppSidebar({
    currentView: currentView as never,
    brand: "omms",
    projectLabel: "Project memories",
    profileLabel: "User profile",
    chatLabel: "Chat",
    profileSections: sections,
    memoryLabel: "Memory",
    memorySections: [{ id: "pi", label: "Pi" }],
    langLabel: "EN",
    languageLabel: "Language",
    themeLabel: "Theme",
    settingsLabel: "Settings",
    closeLabel: "Close",
    collapseLabel: "Collapse",
    expandLabel: "Expand",
    ...extra,
  });
}
const toggle = (tree: ReactNode) =>
  find(tree, (node) => node.props["aria-controls"] === "sidebar-profile-tree")[0];
const links = (tree: ReactNode) =>
  find(
    tree,
    (node) => node.type === "a" && String(node.props.href).startsWith("/user-profile#")
  ).map((link) => link.props.children);

beforeEach(() => {
  state = [];
  cursor = 0;
  store.clear();
  blocked = false;
});

it("opens the profile tree by default on the User profile page, with a toggle that says so", () => {
  const tree = render("profile");
  expect(toggle(tree).props["aria-expanded"]).toBe(true);
  expect(links(tree)).toEqual(["Preferences", "Patterns", "Workflows"]);
});

it("starts the profile tree closed on other pages, so only the entry shows", () => {
  const tree = render("project");
  expect(toggle(tree).props["aria-expanded"]).toBe(false);
  expect(links(tree)).toEqual([]);
  expect(
    find(tree, (node) => node.type === "a" && node.props.href === "/user-profile")
  ).toHaveLength(1);
});

it("opens and closes on the toggle and remembers the choice under its own key", () => {
  let tree = render("project");
  (toggle(tree).props.onClick as () => void)();
  expect(store.get("omms-sidebar-profile-open")).toBe("1");
  tree = render("project");
  expect(toggle(tree).props["aria-expanded"]).toBe(true);
  expect(links(tree)).toHaveLength(3);
  (toggle(tree).props.onClick as () => void)();
  expect(store.get("omms-sidebar-profile-open")).toBe("0");
  expect(links(render("project"))).toEqual([]);
  // Memory and Settings keep their own saved state.
  expect(store.has("omms-sidebar-memory-open")).toBe(false);
  expect(store.has("omms-sidebar-settings-open")).toBe(false);
});

it("keeps a saved choice over the page default", () => {
  store.set("omms-sidebar-profile-open", "0");
  expect(toggle(render("profile")).props["aria-expanded"]).toBe(false);
  state = [];
  store.set("omms-sidebar-profile-open", "1");
  expect(toggle(render("project")).props["aria-expanded"]).toBe(true);
});

it("names the toggle for assistive technology and keeps the entry itself a link", () => {
  const tree = render("profile");
  const button = toggle(tree);
  expect(button.type).toBe("button");
  expect(button.props["aria-label"]).toBe("User profile");
  expect(button.props.type).toBe("button");
  const entry = find(tree, (node) => node.type === "a" && node.props.href === "/user-profile")[0];
  expect(entry.props["aria-current"]).toBe("page");
});

it("still works when the browser blocks storage", () => {
  blocked = true;
  const tree = render("profile");
  expect(toggle(tree).props["aria-expanded"]).toBe(true);
  expect(() => (toggle(tree).props.onClick as () => void)()).not.toThrow();
  expect(links(render("profile"))).toEqual([]);
});

const skillsSections = [
  { id: "skills-section-activity", label: "Activity" },
  { id: "skills-section-ranked", label: "Ranked skills" },
];
const skillsToggle = (tree: ReactNode) =>
  find(tree, (node) => node.props["aria-controls"] === "sidebar-skills-tree")[0];
const skillsLinks = (tree: ReactNode) =>
  find(tree, (node) => node.type === "a" && String(node.props.href).startsWith("/skills#")).map(
    (link) => link.props.children
  );

it("shows the Skills tree open on the Skills page, linking to its sections", () => {
  const tree = render("skills", { skillsSections });
  expect(skillsToggle(tree).props["aria-expanded"]).toBe(true);
  expect(skillsLinks(tree)).toEqual(["Activity", "Ranked skills"]);
  const hrefs = find(
    tree,
    (node) => node.type === "a" && String(node.props.href).startsWith("/skills#")
  ).map((link) => link.props.href);
  expect(hrefs).toEqual(["/skills#skills-section-activity", "/skills#skills-section-ranked"]);
});

it("keeps the Skills tree closed elsewhere and remembers a toggle under its own key", () => {
  let tree = render("project", { skillsSections });
  expect(skillsToggle(tree).props["aria-expanded"]).toBe(false);
  expect(skillsLinks(tree)).toEqual([]);
  (skillsToggle(tree).props.onClick as () => void)();
  expect(store.get("omms-sidebar-skills-open")).toBe("1");
  expect(store.has("omms-sidebar-profile-open")).toBe(false);
  tree = render("project", { skillsSections });
  expect(skillsLinks(tree)).toHaveLength(2);
});

it("shows no Skills toggle when the page has no sections", () => {
  expect(skillsToggle(render("skills"))).toBeUndefined();
});
