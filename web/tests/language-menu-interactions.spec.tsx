import { beforeEach, expect, it, mock } from "bun:test";
import type { ReactElement, ReactNode } from "react";
import * as react from "react";

let state: unknown[] = [];
let cursor = 0;
let refCursor = 0;
let refs: { current: unknown }[] = [];
const listeners = new Map<string, (event: { target: unknown }) => void>();
mock.module("react", () => ({
  ...react,
  useState: (initial: unknown) => {
    const index = cursor++;
    state[index] ??= initial;
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
  useRef: (value: unknown) => {
    const index = refCursor++;
    refs[index] ??= { current: value };
    return refs[index];
  },
}));
mock.module("../src/lib/theme.ts", () => ({
  useTheme: () => "dark",
  toggleTheme: () => {},
}));

const { AppSidebar } = await import("../src/lib/components/explorer/AppSidebar.tsx");

type Node = ReactElement<{ children?: ReactNode; [key: string]: unknown }>;
function find(node: ReactNode, predicate: (node: Node) => boolean): Node[] {
  if (!react.isValidElement(node))
    return Array.isArray(node) ? node.flatMap((child) => find(child, predicate)) : [];
  const element = node as Node;
  return [...(predicate(element) ? [element] : []), ...find(element.props.children, predicate)];
}
const props = {
  currentView: "project" as const,
  brand: "omms",
  projectLabel: "Project",
  profileLabel: "Profile",
  langLabel: "EN",
  languageLabel: "Language",
  themeLabel: "Theme",
  settingsLabel: "Settings",
  closeLabel: "Close",
};
function render(overrides: Record<string, unknown> = {}) {
  cursor = 0;
  refCursor = 0;
  return AppSidebar({ ...props, ...overrides });
}
function trigger(tree: ReactNode) {
  const button = find(
    tree,
    (node) => node.type === "button" && String(node.props["aria-label"]).startsWith("Language: ")
  )[0];
  if (!button) throw new Error("Language trigger is missing");
  return button;
}

beforeEach(() => {
  state = [];
  cursor = 0;
  refCursor = 0;
  refs = [];
  listeners.clear();
  Object.assign(globalThis, {
    document: {
      documentElement: { dir: "ltr", lang: "en" },
      addEventListener: (name: string, handler: (event: { target: unknown }) => void) => {
        listeners.set(name, handler);
      },
      removeEventListener: (name: string) => {
        listeners.delete(name);
      },
    },
  });
});

it("opens language choices without switching the language", () => {
  const chosen = mock(() => {});
  const button = trigger(render({ onLanguageSelect: chosen }));
  button.props.onClick?.();
  const menu = find(render({ onLanguageSelect: chosen }), (node) => node.props.role === "menu");
  expect(menu).toHaveLength(1);
  expect(chosen).not.toHaveBeenCalled();
  expect(button.props["aria-expanded"]).toBe(false);
});
it("shows only the current code and marks the selected menu item", () => {
  for (const code of ["EN", "ZH", "AR"]) {
    state = [];
    const button = trigger(render({ langLabel: code }));
    expect(
      find(button.props.children, (node) => node.type === "span").map((node) => node.props.children)
    ).toEqual([code]);
    button.props.onClick?.();
    const items = find(render({ langLabel: code }), (node) => node.props.role === "menuitemradio");
    expect(items.map((item) => item.props.children)).toEqual([
      "English (EN)",
      "中文 (ZH)",
      "العربية (AR)",
    ]);
    expect(items.map((item) => item.props["aria-checked"])).toEqual(
      ["EN", "ZH", "AR"].map((value) => value === code)
    );
  }
});

it("selects a named language only after a menu choice and closes", () => {
  const chosen = mock(() => {});
  trigger(render({ onLanguageSelect: chosen })).props.onClick?.();
  const item = find(
    render({ onLanguageSelect: chosen }),
    (node) => node.props.role === "menuitemradio" && node.props.children === "中文 (ZH)"
  )[0];
  item.props.onClick?.();
  expect(chosen).toHaveBeenCalledWith("zh");
  expect(find(render(), (node) => node.props.role === "menu")).toHaveLength(0);
});
it("closes with Escape without selecting another language", () => {
  const chosen = mock(() => {});
  trigger(render({ onLanguageSelect: chosen })).props.onClick?.();
  const menu = find(render({ onLanguageSelect: chosen }), (node) => node.props.role === "menu")[0];
  menu.props.onKeyDown?.({ key: "Escape", preventDefault: () => {} });
  expect(find(render(), (node) => node.props.role === "menu")).toHaveLength(0);
  expect(chosen).not.toHaveBeenCalled();
});

it("persists a selected language and updates Arabic document direction", async () => {
  const saved = new Map<string, string>();
  Object.assign(globalThis, {
    localStorage: {
      getItem: (key: string) => saved.get(key) ?? null,
      setItem: (key: string, value: string) => {
        saved.set(key, value);
      },
    },
  });
  const { getLanguage, setLanguage } = await import("../src/lib/i18n/index.ts");
  const button = trigger(render({ onLanguageSelect: setLanguage }));
  button.props.onClick?.();
  expect(getLanguage()).toBe("en");
  const arabic = find(
    render({ onLanguageSelect: setLanguage }),
    (node) => node.props.role === "menuitemradio" && node.props.children === "العربية (AR)"
  )[0];
  arabic.props.onClick?.();
  expect(getLanguage()).toBe("ar");
  expect(saved.get("omms-lang")).toBe("ar");
  expect(document.documentElement.dir).toBe("rtl");
  expect(document.documentElement.lang).toBe("ar");
  setLanguage("en");
});

it("dismisses on an outside pointer press without selecting", () => {
  const chosen = mock(() => {});
  trigger(render({ onLanguageSelect: chosen })).props.onClick?.();
  render({ onLanguageSelect: chosen });
  expect(listeners.has("pointerdown")).toBe(true);
  listeners.get("pointerdown")?.({ target: {} });
  expect(find(render(), (node) => node.props.role === "menu")).toHaveLength(0);
  expect(chosen).not.toHaveBeenCalled();
});

it("keeps the upward menu inside the sidebar and moves through choices by keyboard", () => {
  trigger(render()).props.onClick?.();
  const focused: number[] = [];
  const options = [0, 1, 2].map((index) => ({ focus: () => focused.push(index) }));
  refs[0].current = {
    querySelector: () => options[0],
    querySelectorAll: () => options,
  };
  const tree = render({ langLabel: "AR" });
  const menu = find(tree, (node) => node.props.role === "menu")[0];
  expect(menu.props.className).toContain("bottom-full");
  expect(menu.props.className).toContain("start-0");
  expect(menu.props.className).toContain("max-h-[60vh]");
  Object.assign(document, { activeElement: options[0] });
  menu.props.onKeyDown?.({ key: "ArrowDown", preventDefault: () => {} });
  expect(focused).toContain(1);
});

it("closes when keyboard focus leaves the menu, but not when it moves inside", () => {
  trigger(render()).props.onClick?.();
  const inside = {};
  refs[0].current = {
    contains: (node: unknown) => node === inside,
    querySelector: () => null,
  };
  const container = () =>
    find(render(), (node) => node.type === "div" && typeof node.props.onBlur === "function")[0]!;
  container().props.onBlur?.({ relatedTarget: inside });
  expect(find(render(), (node) => node.props.role === "menu")).toHaveLength(1);
  container().props.onBlur?.({ relatedTarget: {} });
  expect(find(render(), (node) => node.props.role === "menu")).toHaveLength(0);
});
