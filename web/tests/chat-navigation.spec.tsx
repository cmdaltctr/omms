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
const saved = new Map<string, string>();
Object.assign(globalThis, {
  localStorage: {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => void saved.set(key, value),
  },
});

const { AppSidebar } = await import("../src/lib/components/explorer/AppSidebar.tsx");
const { SidebarNavLink } = await import("../src/lib/components/explorer/SidebarNavLink.tsx");
const { ROUTES, isAppPath, pathForView, viewFromPath } = await import("../src/lib/routes.ts");

type Node = ReactElement<{ children?: ReactNode; [key: string]: unknown }>;
function find(node: ReactNode, predicate: (node: Node) => boolean): Node[] {
  if (!react.isValidElement(node))
    return Array.isArray(node) ? node.flatMap((child) => find(child, predicate)) : [];
  const element = node as Node;
  return [...(predicate(element) ? [element] : []), ...find(element.props.children, predicate)];
}
// SidebarNavLink has no hooks, so render it here to reach the link it returns.
function expand(node: ReactNode): ReactNode {
  if (Array.isArray(node)) return node.map(expand);
  if (!react.isValidElement(node)) return node;
  const element = node as Node;
  if (element.type === SidebarNavLink) {
    return expand((element.type as (props: unknown) => ReactNode)(element.props));
  }
  return react.cloneElement(element, undefined, expand(element.props.children));
}

function sidebar(currentView: "chat" | "project", collapsed = false) {
  state = [];
  cursor = 0;
  saved.clear();
  if (collapsed) saved.set("omms-sidebar-collapsed", "1");
  return expand(
    AppSidebar({
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
    } as never)
  );
}

beforeEach(() => {
  state = [];
});

it("resolves /chat to the chat view and back", () => {
  expect(ROUTES.chat).toBe("/chat");
  expect(viewFromPath("/chat")).toBe("chat");
  expect(viewFromPath("/chat/")).toBe("chat");
  expect(pathForView("chat")).toBe("/chat");
  expect(isAppPath("/chat")).toBe(true);
});

it("shows a Chat link marked as the current page on /chat", () => {
  const links = find(sidebar("chat"), (node) => node.props.href === "/chat");
  expect(links).toHaveLength(1);
  expect(links[0]!.props["aria-current"]).toBe("page");

  const other = find(sidebar("project"), (node) => node.props.href === "/chat");
  expect(other[0]!.props["aria-current"]).toBeUndefined();
});

it("labels the Chat link when the sidebar is collapsed", () => {
  const link = find(sidebar("project", true), (node) => node.props.href === "/chat")[0]!;
  expect(link.props.title).toBe("Chat");
});
