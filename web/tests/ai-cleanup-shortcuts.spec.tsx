import { beforeEach, expect, it, mock } from "bun:test";
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
  useId: () => "tip-0",
  useRef: (current: unknown) => ({ current }),
  useEffect: () => {},
  useLayoutEffect: () => {},
  useState: (initial: unknown) => {
    const set = mock(() => {});
    setters.push(set);
    return [queuedState.length ? queuedState.shift() : initial, set];
  },
}));
const { Tooltip } = await import("../src/lib/components/ui/tooltip.tsx");
const { CleanupSelectShortcuts } =
  await import("../src/lib/components/explorer/CleanupSelectShortcuts.tsx");
const { setLanguage, t } = await import("../src/lib/i18n/index.ts");

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

const handlers = () => ({
  onSelectClean: mock(() => {}),
  onSelectLow: mock(() => {}),
  onSelectSameCat: mock(() => {}),
  onSelectAll: mock(() => {}),
  onSelectNone: mock(() => {}),
});

const BUTTONS = [
  ["label-ai-cleanup-select-clean", "label-ai-cleanup-tip-clean", "onSelectClean"],
  ["label-ai-cleanup-select-low", "label-ai-cleanup-tip-low", "onSelectLow"],
  ["label-ai-cleanup-select-same-cat", "label-ai-cleanup-tip-same-cat", "onSelectSameCat"],
  ["label-ai-cleanup-select-all", "label-ai-cleanup-tip-all", "onSelectAll"],
  ["label-ai-cleanup-deselect-all", "label-ai-cleanup-tip-none", "onSelectNone"],
] as const;

beforeEach(() => {
  queuedState = [];
  setters = [];
  setLanguage("en");
});

const buttons = (tree: Node[]) => tree.filter((node) => typeof node.props.onClick === "function");

it("renders the five buttons in order, and each one calls its handler", () => {
  const h = handlers();
  const tree = nodes(CleanupSelectShortcuts({ ...h, skipped: 0, checkedReady: true }));
  expect(buttons(tree).map((node) => text(node.props.children))).toEqual(
    BUTTONS.map(([label]) => t(label))
  );
  buttons(tree).forEach((node, i) => {
    (node.props.onClick as () => void)();
    expect(h[BUTTONS[i]![2]]).toHaveBeenCalledTimes(1);
  });
});

it("puts each button in a tooltip that describes it and links to it", () => {
  const tree = nodes(CleanupSelectShortcuts({ ...handlers(), skipped: 0, checkedReady: true }));
  const tips = tree.filter((node) => node.type === Tooltip);
  expect(tips.map((tip) => text(nodes(tip.props.children)[0]!.props.children))).toEqual(
    BUTTONS.map(([label]) => t(label))
  );
  expect(tips.map((tip) => tip.props.content)).toEqual(BUTTONS.map(([, tip]) => t(tip)));
  for (const tip of tips) {
    const rendered = nodes(Tooltip(tip.props as Parameters<typeof Tooltip>[0]));
    const bubble = rendered.find((node) => node.props.role === "tooltip")!;
    const button = rendered.find((node) => typeof node.props.onClick === "function")!;
    expect(button.props["aria-describedby"]).toBe(bubble.props.id);
    expect(text(bubble.props.children)).toBe(String(tip.props.content));
  }
});

it("shows the skipped count after a shortcut that skipped checked memories", () => {
  for (const hint of ["clean", "low", "same-cat"]) {
    queuedState = [hint];
    const tree = nodes(
      CleanupSelectShortcuts({ ...handlers(), skipped: 1250, checkedReady: true })
    );
    const status = tree.find((node) => node.props.role === "status")!;
    expect(text(status.props.children)).toContain(t("label-ai-cleanup-skipped", { count: 1250 }));
  }
});

it("keeps the hint of the last shortcut", () => {
  queuedState = ["clean"];
  const tree = nodes(CleanupSelectShortcuts({ ...handlers(), skipped: 0, checkedReady: true }));
  const status = tree.find((node) => node.props.role === "status")!;
  expect(text(status.props.children)).toBe(t("label-ai-cleanup-hint-clean"));
});

it("hides the skipped line when nothing was skipped, and after Select All or Deselect All", () => {
  const skippedText = t("label-ai-cleanup-skipped", { count: 0 }).split("0")[0]!;
  queuedState = ["low"];
  const none = nodes(CleanupSelectShortcuts({ ...handlers(), skipped: 0, checkedReady: true }));
  expect(text(none)).not.toContain(skippedText);
  // Select All and Deselect All clear the hint; a stale count must not show.
  const cleared = nodes(CleanupSelectShortcuts({ ...handlers(), skipped: 40, checkedReady: true }));
  expect(cleared.some((node) => node.props.role === "status")).toBe(false);
  const h = handlers();
  const tree = nodes(CleanupSelectShortcuts({ ...h, skipped: 0, checkedReady: true }));
  (buttons(tree)[3]!.props.onClick as () => void)();
  (buttons(tree)[4]!.props.onClick as () => void)();
  expect(setters.at(-1)!.mock.calls).toEqual([[null], [null]]);
});

it("blocks the checked-aware shortcuts with a reason until the checked read is ready", () => {
  const h = handlers();
  const tree = nodes(CleanupSelectShortcuts({ ...h, skipped: 0, checkedReady: false }));
  const reason = t("label-ai-cleanup-checked-waiting");
  const tips = tree.filter((node) => node.type === Tooltip);
  expect(tips.map((tip) => tip.props.content)).toEqual([
    reason,
    reason,
    reason,
    t("label-ai-cleanup-tip-all"),
    t("label-ai-cleanup-tip-none"),
  ]);
  const shortcutButtons = buttons(tree);
  expect(shortcutButtons.map((node) => node.props.disabled === true)).toEqual([
    true,
    true,
    true,
    false,
    false,
  ]);
  for (const tip of tips.slice(0, 3)) {
    // A disabled button gets no hover or focus, so a focusable span holds the tooltip.
    const holder = nodes(tip.props.children)[0]!;
    expect(holder.props.tabIndex).toBe(0);
    const button = nodes(holder.props.children).find((n) => n.props.disabled === true)!;
    const line = nodes(holder.props.children).find(
      (n) => n.props.id === button.props["aria-describedby"]
    )!;
    expect(line.props.className).toContain("sr-only");
    expect(text(line)).toBe(reason);
  }
});

it("has the blocked reason in every language", () => {
  for (const lang of ["en", "zh", "ar"] as const) {
    setLanguage(lang);
    expect(t("label-ai-cleanup-checked-waiting")).not.toBe("label-ai-cleanup-checked-waiting");
  }
});
