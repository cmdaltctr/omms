import { beforeEach, expect, it, mock } from "bun:test";
import * as react from "react";
import type { ReactElement, ReactNode } from "react";

let state: unknown[] = [];
let cursor = 0;
mock.module("react", () => ({
  ...react,
  useEffect: () => {},
  useRef: (value: unknown) => ({ current: value }),
  useState: (initial: unknown) => {
    const index = cursor++;
    state[index] ??= typeof initial === "function" ? (initial as () => unknown)() : initial;
    return [state[index], () => {}];
  },
}));
mock.module("../src/lib/theme.ts", () => ({ useTheme: () => "dark", toggleTheme: () => {} }));
Object.assign(globalThis, {
  localStorage: { getItem: () => null, setItem: () => {} },
});

const { AppSidebar } = await import("../src/lib/components/explorer/AppSidebar.tsx");
const { SpaceNav } = await import("../src/lib/components/spaces/SpaceNav.tsx");
const { SidebarNavLink } = await import("../src/lib/components/explorer/SidebarNavLink.tsx");
const { ROUTES, isAppPath, pathForView, resolveAppPath, viewFromPath } =
  await import("../src/lib/routes.ts");

type Node = ReactElement<{ children?: ReactNode; [key: string]: unknown }>;
function find(node: ReactNode, predicate: (node: Node) => boolean): Node[] {
  if (!react.isValidElement(node))
    return Array.isArray(node) ? node.flatMap((child) => find(child, predicate)) : [];
  const element = node as Node;
  return [...(predicate(element) ? [element] : []), ...find(element.props.children, predicate)];
}

function sidebar(currentView: "project" | "spaces", collapsed = false) {
  state = [];
  cursor = 0;
  (globalThis.localStorage as unknown as { getItem: () => string | null }).getItem = () =>
    collapsed ? "1" : null;
  return AppSidebar({
    currentView,
    brand: "omms",
    projectLabel: "Project",
    profileLabel: "Profile",
    chatLabel: "Chat",
    profileSections: [],
    langLabel: "EN",
    languageLabel: "Language",
    themeLabel: "Theme",
    settingsLabel: "Settings",
    closeLabel: "Close",
    collapseLabel: "Collapse",
    expandLabel: "Expand",
  } as never);
}
/** The elements of the main navigation, in order. */
const navItems = (tree: ReactNode) => {
  const nav = find(tree, (node) => node.type === "nav")[0]!;
  return react.Children.toArray(nav.props.children) as Node[];
};

beforeEach(() => {
  state = [];
});

it("resolves /spaces to the Spaces page", () => {
  expect(ROUTES.spaces).toBe("/spaces");
  expect(viewFromPath("/spaces")).toBe("spaces");
  expect(viewFromPath("/spaces/")).toBe("spaces");
  expect(pathForView("spaces")).toBe("/spaces");
  expect(isAppPath("/spaces")).toBe(true);
  expect(resolveAppPath("/spaces")).toBe("/spaces");
});

it("puts the space item first, above Chat", () => {
  for (const collapsed of [false, true]) {
    const items = navItems(sidebar("project", collapsed));
    expect(items[0]!.type).toBe(SpaceNav);
    expect(items[1]!.type).toBe(SidebarNavLink);
    expect(items[1]!.props.href).toBe(ROUTES.chat);
    expect(items[0]!.props.collapsed).toBe(collapsed);
    expect(items[0]!.props.hideWhenCollapsed).toBe(collapsed ? "md:hidden" : "");
  }
});

it("styles the space item like the other rows and marks it on the Spaces page", () => {
  const away = navItems(sidebar("project"))[0]!;
  const onSpaces = navItems(sidebar("spaces"));
  // An idle project row and an idle space row share one class string.
  expect(away.props.className).toBe(onSpaces[1]!.props.className);
  expect(onSpaces[0]!.props.className).toContain(
    "bg-sidebar-accent text-sidebar-accent-foreground"
  );
  expect(away.props.className).not.toContain("bg-sidebar-accent text-sidebar-accent-foreground");
});

it("scrolls to a space card and outlines it when the address names one", async () => {
  const { revealPageAnchor } = await import("../src/lib/settings-navigation.ts");
  const scrolled: string[] = [];
  const card = {
    classList: { add() {}, remove() {} },
    offsetWidth: 1,
    scrollIntoView: () => void scrolled.push("card"),
  };
  const seen = { document: globalThis.document, frame: globalThis.requestAnimationFrame };
  Object.assign(globalThis, {
    document: { getElementById: (id: string) => (id === "space-card-experiments" ? card : null) },
    requestAnimationFrame: (callback: () => void) => callback(),
  });
  try {
    revealPageAnchor("#space-card-experiments");
    revealPageAnchor("#space-card-experiments/../x");
    expect(scrolled).toEqual(["card"]);
  } finally {
    Object.assign(globalThis, { document: seen.document, requestAnimationFrame: seen.frame });
  }
});

it("resolves /spaces/archive to the Archive page and keeps /spaces for the Spaces page", () => {
  expect(ROUTES.spacesArchive).toBe("/spaces/archive");
  expect(viewFromPath("/spaces/archive")).toBe("spaces-archive");
  expect(viewFromPath("/spaces/archive/")).toBe("spaces-archive");
  expect(viewFromPath("/spaces")).toBe("spaces");
  expect(pathForView("spaces-archive")).toBe("/spaces/archive");
  expect(isAppPath("/spaces/archive")).toBe(true);
  expect(resolveAppPath("/spaces/archive")).toBe("/spaces/archive");
  expect(resolveAppPath("/spaces/other")).toBe("/project-memories");
});
