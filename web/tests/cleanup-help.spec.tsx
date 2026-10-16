import { beforeEach, expect, it, mock } from "bun:test";
import { readFileSync } from "node:fs";
import * as react from "react";
import type { ReactElement, ReactNode } from "react";

// Hooks run outside a renderer here, so useState hands back queued values and records its setters.
let queuedState: unknown[] = [];
let setters: Array<ReturnType<typeof mock>> = [];
mock.module("react", () => ({
  ...react,
  useContext: () => null,
  useMemo: (factory: () => unknown) => factory(),
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
  useId: () => "info-0",
  useRef: (current: unknown) => ({ current }),
  useEffect: () => {},
  useLayoutEffect: () => {},
  useState: (initial: unknown) => {
    const set = mock(() => {});
    setters.push(set);
    return [queuedState.length ? queuedState.shift() : initial, set];
  },
}));
const { InfoPopover } = await import("../src/lib/components/ui/info-popover.tsx");
const { CleanupSelectShortcuts } =
  await import("../src/lib/components/explorer/CleanupSelectShortcuts.tsx");
const { setLanguage, t } = await import("../src/lib/i18n/index.ts");
const { translations } = await import("../src/lib/i18n/translations.ts");

type Node = ReactElement<{ children?: ReactNode; [key: string]: unknown }>;
function nodes(value: ReactNode): Node[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!react.isValidElement(value)) return [];
  const node = value as Node;
  return [node, ...nodes(node.props.children)];
}
function text(value: ReactNode): string {
  if (Array.isArray(value)) return value.map(text).join("");
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (!react.isValidElement(value)) return "";
  return text((value as Node).props.children);
}
const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

beforeEach(() => {
  queuedState = [];
  setters = [];
  setLanguage("en");
});

it("keeps the info popover closed until its button is pressed, then toggles it", () => {
  const closed = nodes(InfoPopover({ label: "What does this do?", children: "Body text" }));
  const button = closed.find((node) => node.type === "button")!;
  expect(button.props["aria-label"]).toBe("What does this do?");
  expect(button.props["aria-expanded"]).toBe(false);
  expect(closed.some((node) => node.props.id === "info-0")).toBe(false);

  (button.props.onClick as () => void)();
  const toggle = setters[0]!.mock.calls[0]![0] as (open: boolean) => boolean;
  expect(toggle(false)).toBe(true);
  expect(toggle(true)).toBe(false);

  queuedState = [true, 0];
  const open = nodes(InfoPopover({ label: "What does this do?", children: "Body text" }));
  expect(open.find((node) => node.type === "button")!.props["aria-expanded"]).toBe(true);
  const panel = open.find((node) => node.props.id === "info-0")!;
  expect(text(panel.props.children)).toBe("Body text");
  expect(button.props["aria-controls"]).toBe("info-0");
});

it("explains Low Freq and Same Category under the shortcuts and still selects", () => {
  const handlers = {
    onSelectAll: mock(() => {}),
    onSelectNone: mock(() => {}),
    onSelectLow: mock(() => {}),
    onSelectSameCat: mock(() => {}),
  };
  const buttonFor = (tree: Node[], label: string) =>
    tree.find((node) => node.props.onClick && text(node.props.children) === label)!;

  const idle = nodes(CleanupSelectShortcuts(handlers));
  expect(idle.some((node) => node.props.role === "status")).toBe(false);

  (buttonFor(idle, t("label-ai-cleanup-select-low")).props.onClick as () => void)();
  expect(handlers.onSelectLow).toHaveBeenCalledTimes(1);
  expect(setters[0]).toHaveBeenCalledWith("low");

  (buttonFor(idle, t("label-ai-cleanup-select-same-cat")).props.onClick as () => void)();
  expect(handlers.onSelectSameCat).toHaveBeenCalledTimes(1);
  expect(setters[0]).toHaveBeenCalledWith("same-cat");

  (buttonFor(idle, t("label-ai-cleanup-select-all")).props.onClick as () => void)();
  expect(handlers.onSelectAll).toHaveBeenCalledTimes(1);
  expect(setters[0]).toHaveBeenCalledWith(null);

  for (const [hint, key] of [
    ["low", "label-ai-cleanup-hint-low"],
    ["same-cat", "label-ai-cleanup-hint-same-cat"],
  ] as const) {
    queuedState = [hint];
    const shown = nodes(CleanupSelectShortcuts(handlers));
    const note = shown.find((node) => node.props.role === "status")!;
    expect(text(note.props.children)).toBe(t(key));
  }
});

it("names the 3+ shortcut and translates every new help text", () => {
  expect(translations.en["label-ai-cleanup-select-same-cat"]).toBe("Same Category (3+)");
  const keys = [
    "label-ai-cleanup-hint-low",
    "label-ai-cleanup-hint-same-cat",
    "label-more-info",
    "help-ai-cleanup",
    "help-category-cleanup",
  ] as const;
  for (const key of keys) {
    expect(translations.en[key]).toBeTruthy();
    for (const lang of ["zh", "ar"] as const) {
      expect(translations[lang][key]).toBeTruthy();
      expect(translations[lang][key]).not.toBe(translations.en[key]);
    }
  }
});

it("shows the selected count in a green box and puts an info popover beside each cleanup button", () => {
  const dialog = source("lib/components/explorer/AiCleanupDialog.tsx");
  expect(dialog).toMatch(
    /bg-status-success\/10[^>]*text-status-success[^>]*>\s*\{t\("label-ai-cleanup-selected"/
  );
  const profile = source("lib/components/explorer/ProfileView.tsx");
  expect(profile).toContain('{t("help-ai-cleanup")}');
  expect(profile).toContain('{t("help-category-cleanup")}');
});
