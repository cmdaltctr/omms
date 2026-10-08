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
const { initRouter, navigate } = await import("../src/lib/router.ts");
type Node = ReactElement<{ children?: ReactNode; [key: string]: unknown }>;
function find(node: ReactNode, predicate: (node: Node) => boolean): Node[] {
  if (!react.isValidElement(node))
    return Array.isArray(node) ? node.flatMap((child) => find(child, predicate)) : [];
  const element = node as Node;
  return [...(predicate(element) ? [element] : []), ...find(element.props.children, predicate)];
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
  const mappings = {
    import: "import",
    "auto-import": "auto-import",
    profile: "profile",
    memory: "limits",
    "directory-maps": "project-folders",
  };
  for (const [old, next] of Object.entries(mappings)) {
    location.pathname = "/settings";
    location.hash = `#settings-section-${old}`;
    initRouter();
    expect(location.pathname + location.hash).toBe(`/memory#memory-section-${next}`);
    expect(changes.at(-1)).toBe(`replace:/memory#memory-section-${next}`);
  }
  for (const host of ["pi", "opencode", "claude-code"]) {
    location.pathname = "/settings";
    location.hash = `#directory-maps-${host}`;
    initRouter();
    expect(location.pathname + location.hash).toBe(`/memory#directory-maps-${host}`);
  }
  location.pathname = "/settings";
  location.hash = "#settings-section-health";
  initRouter();
  expect(location.pathname + location.hash).toBe("/settings#settings-section-health");
});
it("navigates section hashes without remounting the page, and popstate preserves the destination", () => {
  initRouter();
  navigate("/memory#memory-section-limits");
  expect(location.pathname + location.hash).toBe("/memory#memory-section-limits");
  location.hash = "#memory-section-import";
  handlers.get("popstate")!();
  expect(location.pathname + location.hash).toBe("/memory#memory-section-import");
});
it("reveals a cross-route host disclosure only after mount and preserves other folder drafts", () => {
  location.pathname = "/project-memories";
  location.hash = "";
  const frames: (() => void)[] = [];
  const focus = mock(() => {}),
    scroll = mock(() => {});
  const disclosure = { open: false };
  const other = { open: true, draft: "/edited/target" };
  let summary: object | null = null;
  Object.assign(globalThis, {
    document: {
      getElementById: (id: string) => (id === "directory-maps-opencode" ? summary : null),
    },
    requestAnimationFrame: (fn: () => void) => {
      frames.push(fn);
    },
  });
  navigate("/memory#directory-maps-opencode");
  expect(location.pathname + location.hash).toBe("/memory#directory-maps-opencode");
  expect(focus).not.toHaveBeenCalled();
  summary = { parentElement: disclosure, focus, scrollIntoView: scroll };
  for (const frame of frames.splice(0)) frame();
  expect(disclosure.open).toBe(true);
  expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  expect(scroll).toHaveBeenCalledTimes(1);
  expect(other).toEqual({ open: true, draft: "/edited/target" });
});
it("shows five Memory children and stores its tree independently of Settings", async () => {
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
    (node) => node.type === "a" && String(node.props.href).startsWith("/memory#")
  );
  expect(links).toHaveLength(5);
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
  expect(location.pathname + location.hash).toBe("/memory#memory-section-limits");
  expect(dismissed.at(-1)).toBe(false);
});
