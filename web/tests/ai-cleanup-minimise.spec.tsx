import { beforeEach, expect, it, mock } from "bun:test";
import * as react from "react";
import type { ReactElement, ReactNode } from "react";
import type { AiCleanupJob } from "../src/lib/components/explorer/ai-cleanup-job-state.ts";

mock.module("react", () => ({
  ...react,
  useContext: () => null,
  useMemo: (factory: () => unknown) => factory(),
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
  useRef: (current: unknown) => ({ current }),
  useState: (initial: unknown) => [initial, () => {}],
  // Effects run at once, so the pill's "no job" effect can be checked.
  useEffect: (effect: () => void) => effect(),
}));
let currentJob: AiCleanupJob | null = null;
let checked = true;
mock.module("../src/hooks/useAiCleanupJob.ts", () => ({
  useAiCleanupJob: () => ({ job: currentJob, checked, start: () => {}, discard: () => {} }),
}));
const { AiCleanupPill } = await import("../src/lib/components/explorer/AiCleanupPill.tsx");
const { AiCleanupDialog } = await import("../src/lib/components/explorer/AiCleanupDialog.tsx");
const { DialogContent } = await import("../src/lib/components/ui/dialog.tsx");
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
const job = (status: AiCleanupJob["status"]): AiCleanupJob => ({ id: "1", selection: [], status });
const running = job({ state: "running", done: 12, total: 24, failed: 0 });
const minimiseButton = (tree: Node[]) =>
  tree.find((node) => text(node.props.children) === t("dialog-minimise") && node.props.onClick);

beforeEach(() => {
  currentJob = null;
  checked = true;
  setLanguage("en");
});

function pill(onOpen = () => {}, onGone = () => {}) {
  return nodes(AiCleanupPill({ onOpen, onGone }) as ReactNode);
}

it("shows batch progress in the pill while the job runs", () => {
  currentJob = running;
  const tree = pill();
  expect(text(tree[0])).toContain(t("label-ai-cleanup-pill-progress", { done: 12, total: 24 }));
  expect(tree[0].props.role).toBe("status");
});

it("says the review is ready, or that the cleanup failed", () => {
  currentJob = job({
    state: "done",
    result: {
      old: { preferences: [], patterns: [], workflows: [] },
      changes: { kept: [], merged: [], removed: [] },
      failedBatches: 0,
      failedItems: 0,
    },
  });
  expect(text(pill()[0])).toContain(t("label-ai-cleanup-pill-ready"));
  currentJob = job({ state: "failed", error: "timeout" });
  const failed = pill();
  expect(text(failed[0])).toContain(t("label-ai-cleanup-pill-failed"));
  const button = failed.find((node) => node.props.onClick)!;
  expect(String(button.props.className)).toContain("text-destructive");
});

it("opens the dialog when the pill is selected", () => {
  currentJob = running;
  let opened = 0;
  const button = pill(() => opened++).find((node) => node.props.onClick)!;
  (button.props.onClick as () => void)();
  expect(opened).toBe(1);
});

it("goes away when a read finds no job, but not before the first read", () => {
  let gone = 0;
  checked = false;
  expect(pill(undefined, () => gone++).length).toBeGreaterThan(0);
  expect(gone).toBe(0);
  checked = true;
  expect(pill(undefined, () => gone++)).toEqual([]);
  expect(gone).toBe(1);
});

it("shows a Minimise button beside the close button only when asked", () => {
  const onMinimise = () => {};
  const withButton = nodes(DialogContent({ onMinimise, children: null }) as ReactNode);
  expect(minimiseButton(withButton)?.props.onClick).toBe(onMinimise);
  const without = nodes(DialogContent({ children: null }) as ReactNode);
  expect(minimiseButton(without)).toBeUndefined();
});

it("offers Minimise in the AI Cleanup dialog only while a job runs", () => {
  const onMinimise = () => {};
  const content = () =>
    nodes(AiCleanupDialog({ open: true, onMinimise }) as ReactNode).find(
      (node) => node.type === DialogContent
    )!;
  currentJob = running;
  expect(content().props.onMinimise).toBe(onMinimise);
  currentJob = null;
  expect(content().props.onMinimise).toBeUndefined();
});

it("waits for the first read after opening before it shows a retained job", () => {
  const onMinimise = () => {};
  const tree = () => nodes(AiCleanupDialog({ open: true, onMinimise }) as ReactNode);
  currentJob = running;
  checked = false;
  const waiting = tree();
  expect(waiting.find((node) => node.type === DialogContent)!.props.onMinimise).toBeUndefined();
  expect(waiting.some((node) => text(node.props.children) === t("btn-ai-cleanup-stop"))).toBe(
    false
  );
  expect(text(waiting)).not.toContain(t("label-ai-cleanup-progress", { done: 12, total: 24 }));
});
