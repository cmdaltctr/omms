import { beforeEach, expect, it, mock } from "bun:test";
import * as react from "react";
import type { ReactElement, ReactNode } from "react";
import { isAppPath, pathForView, resolveAppPath, viewFromPath } from "../src/lib/routes.ts";

let state: unknown[] = [];
let cursor = 0;
mock.module("react", () => ({
  ...react,
  useEffect: () => {},
  useRef: (value: unknown) => ({ current: value }),
  useState: (initial: unknown) => {
    const index = cursor++;
    state[index] ??= typeof initial === "function" ? initial() : initial;
    return [
      state[index],
      (value: unknown) => {
        state[index] = value;
      },
    ];
  },
}));
mock.module("../src/lib/theme.ts", () => ({ useTheme: () => "dark", toggleTheme: () => {} }));
const store = new Map<string, string>();
const handlers = new Map<string, () => void>();
const location = { pathname: "/memory", hash: "" };
const changes: string[] = [];
Object.assign(globalThis, {
  localStorage: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => store.set(key, value),
  },
  window: {
    location,
    history: {
      replaceState: (_a: unknown, _b: unknown, path: string) => {
        changes.push(`replace:${path}`);
        [location.pathname, location.hash = ""] = path.split(/(?=#)/);
      },
      pushState: (_a: unknown, _b: unknown, path: string) => {
        changes.push(`push:${path}`);
        [location.pathname, location.hash = ""] = path.split(/(?=#)/);
      },
    },
    addEventListener: (name: string, handler: () => void) => handlers.set(name, handler),
    removeEventListener: () => {},
  },
});
const { AppSidebar } = await import("../src/lib/components/explorer/AppSidebar.tsx");
const { MemorySidebarLinks } = await import("../src/lib/components/memory/MemorySidebarLinks.tsx");
const { initRouter, navigate } = await import("../src/lib/router.ts");
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
  cursor = 0;
  changes.length = 0;
  store.clear();
  location.pathname = "/memory";
  location.hash = "";
});
it("recognises Memory for direct load, reload and application routing", () => {
  expect(isAppPath("/memory/")).toBe(true);
  expect(viewFromPath("/memory")).toBe("memory");
  expect(pathForView("memory" as never)).toBe("/memory");
  expect(resolveAppPath("/memory")).toBe("/memory");
  initRouter();
  expect(location.pathname).toBe("/memory");
});
it("replaces every legacy link before mounting and retains unrelated Settings links", () => {
  // Import and automatic import name no host, so they open the overview; the rest are Shared rows.
  const mappings = {
    import: "/memory",
    "auto-import": "/memory",
    profile: "/memory/shared#shared-profile",
    memory: "/memory/shared#shared-limits",
    "directory-maps": "/memory/shared#shared-directory-maps",
  };
  for (const [old, next] of Object.entries(mappings)) {
    location.pathname = "/settings";
    location.hash = `#settings-section-${old}`;
    initRouter();
    expect(location.pathname + location.hash).toBe(next);
    expect(changes.at(-1)).toBe(`replace:${next}`);
  }
  for (const host of ["pi", "opencode", "claude-code"]) {
    location.pathname = "/settings";
    location.hash = `#directory-maps-${host}`;
    initRouter();
    expect(location.pathname + location.hash).toBe(`/memory/${host}#host-unresolved`);
  }
  location.pathname = "/settings";
  location.hash = "#settings-section-health";
  initRouter();
  expect(location.pathname + location.hash).toBe("/settings#settings-section-health");
});
it("navigates section hashes without remounting the page, and popstate preserves the destination", () => {
  initRouter();
  navigate("/memory/shared#shared-limits");
  expect(location.pathname + location.hash).toBe("/memory/shared#shared-limits");
  location.hash = "#shared-profile";
  handlers.get("popstate")!();
  expect(location.pathname + location.hash).toBe("/memory/shared#shared-profile");
});
it("sends an old host folder link to that host's view and reveals its list only after mount", () => {
  location.pathname = "/project-memories";
  location.hash = "";
  const frames: (() => void)[] = [];
  const scroll = mock(() => {});
  const other = { open: true, draft: "/edited/target" };
  let list: object | null = null;
  Object.assign(globalThis, {
    document: { getElementById: (id: string) => (id === "host-unresolved" ? list : null) },
    requestAnimationFrame: (fn: () => void) => {
      frames.push(fn);
    },
  });
  navigate("/memory#directory-maps-opencode");
  expect(location.pathname + location.hash).toBe("/memory/opencode#host-unresolved");
  expect(scroll).not.toHaveBeenCalled();
  list = { scrollIntoView: scroll };
  for (const frame of frames.splice(0)) frame();
  expect(scroll).toHaveBeenCalledTimes(1);
  expect(other).toEqual({ open: true, draft: "/edited/target" });
});
it("opens a collapsed Shared row when a link names it", () => {
  const frames: (() => void)[] = [];
  const details = { open: false };
  const scroll = mock(() => {});
  Object.assign(globalThis, {
    document: {
      getElementById: (id: string) =>
        id === "shared-reranker" ? { closest: () => details, scrollIntoView: scroll } : null,
    },
    requestAnimationFrame: (fn: () => void) => {
      frames.push(fn);
    },
  });
  navigate("/memory#memory-section-reranker");
  expect(location.pathname + location.hash).toBe("/memory/shared#shared-reranker");
  for (const frame of frames.splice(0)) frame();
  expect(details.open).toBe(true);
  expect(scroll).toHaveBeenCalledTimes(1);
});
it("shows four Memory views and stores its tree independently of Settings", async () => {
  const { MEMORY_SECTIONS } = await import("../src/lib/memory-sections.ts");
  const dismissed: boolean[] = [];
  const render = () => {
    cursor = 0;
    return AppSidebar({
      currentView: "memory" as never,
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
      onOpenChange: (value) => dismissed.push(value),
    } as Parameters<typeof AppSidebar>[0]);
  };
  let tree = render();
  expect(
    find(tree, (node) => node.props.href === "/memory" && node.props["aria-current"] === "page")
  ).toHaveLength(1);
  const links = find(
    tree,
    (node) => node.type === "a" && String(node.props.href).startsWith("/memory/")
  );
  // Pi, OpenCode, Claude Code and Shared.
  expect(links).toHaveLength(4);
  const toggle = find(tree, (node) => node.props["aria-controls"] === "sidebar-memory-tree")[0];
  (toggle.props.onClick as () => void)();
  tree = render();
  expect(store.get("omms-sidebar-memory-open")).toBe("0");
  expect(store.has("omms-sidebar-settings-open")).toBe(false);
  (
    find(tree, (node) => node.props["aria-controls"] === "sidebar-memory-tree")[0].props
      .onClick as () => void
  )();
  Object.assign(globalThis, {
    document: { getElementById: () => ({ scrollIntoView: () => {} }) },
    requestAnimationFrame: (fn: () => void) => fn(),
  });
  (links[3].props.onClick as (event: unknown) => void)({ button: 0, preventDefault: () => {} });
  expect(location.pathname + location.hash).toBe("/memory/shared");
  expect(dismissed.at(-1)).toBe(false);
});
