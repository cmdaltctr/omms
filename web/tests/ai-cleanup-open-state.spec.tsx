import { beforeEach, expect, it, mock } from "bun:test";
import * as react from "react";
import type { ReactElement, ReactNode } from "react";
import type { AiCleanupJob } from "../src/lib/components/explorer/ai-cleanup-job-state.ts";

// Hooks run outside a renderer: effects run at once and every set call is recorded.
let sets: unknown[] = [];
// The dialog's one state that starts as null is its snapshot of the profile; a test can set it.
let snapshotState: unknown = null;
mock.module("react", () => ({
  ...react,
  useContext: () => null,
  useMemo: (factory: () => unknown) => factory(),
  useCallback: (fn: unknown) => fn,
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
  useId: () => "tip-0",
  useRef: (current: unknown) => ({ current }),
  useState: (initial: unknown) => [
    initial === null ? snapshotState : initial,
    (next: unknown) => {
      if (typeof next !== "function") sets.push(next);
    },
  ],
  useEffect: (effect: () => void) => effect(),
}));
const warnings: unknown[] = [];
mock.module("sonner", () => ({
  toast: {
    warning: (message: unknown) => warnings.push(message),
    error: () => {},
    success: () => {},
  },
}));
let currentJob: AiCleanupJob | null = null;
const started: unknown[] = [];
const startedVersions: unknown[] = [];
const checkedArgs: unknown[] = [];
let discarded = 0;
mock.module("../src/hooks/useAiCleanupJob.ts", () => ({
  useAiCleanupJob: () => ({
    job: currentJob,
    checked: true,
    start: async (ids: unknown, version: unknown) => {
      started.push(ids);
      startedVersions.push(version);
    },
    discard: async () => discarded++,
    clear: () => {},
  }),
}));
mock.module("../src/hooks/useAiCheckedIds.ts", () => ({
  useAiCheckedIds: (snapshot: unknown) => {
    checkedArgs.push(snapshot);
    return { ids: new Set<string>(), ready: true, reload: () => {} };
  },
}));
const { AiCleanupDialog } = await import("../src/lib/components/explorer/AiCleanupDialog.tsx");
const { AiCleanupSelect } = await import("../src/lib/components/explorer/AiCleanupSelect.tsx");
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

const mem = (description: string, frequency: number) => ({
  category: "git",
  description,
  frequency,
  confidence: 0.5,
});
const profile = {
  version: 4,
  profileData: {
    preferences: [mem("one", 1), mem("two", 2), mem("three", 3)],
    patterns: [mem("four", 1)],
    workflows: [],
  },
} as never;

beforeEach(() => {
  sets = [];
  warnings.length = 0;
  started.length = 0;
  startedVersions.length = 0;
  checkedArgs.length = 0;
  snapshotState = null;
  discarded = 0;
  currentJob = null;
  setLanguage("en");
});

function render() {
  return nodes(AiCleanupDialog({ open: true, profile }) as ReactNode);
}

function selectView(tree: Node[]) {
  const node = tree.find((n) => n.type === AiCleanupSelect)!;
  return nodes(AiCleanupSelect(node.props as Parameters<typeof AiCleanupSelect>[0]) as ReactNode);
}

it("opens with nothing ticked, also when memories have a frequency of 3 or less", () => {
  const tree = render();
  const selections = sets.filter((value): value is Set<string> => value instanceof Set);
  expect(selections.length).toBeGreaterThan(0);
  for (const selection of selections) expect(selection.size).toBe(0);
  expect(text(selectView(tree))).toContain(t("label-ai-cleanup-selected", { count: 0 }));
});

it("warns and sends no request when Analyze runs with nothing selected", () => {
  const view = selectView(render());
  const analyze = view.find(
    (n) => typeof n.props.onClick === "function" && text(n) === t("label-ai-cleanup-analyze")
  )!;
  (analyze.props.onClick as () => void)();
  expect(warnings).toHaveLength(1);
  expect(started).toEqual([]);
});

it("returns to the selection of the job on Stop", () => {
  currentJob = {
    id: "1",
    selection: ["pref_1", "pat_0"],
    status: { state: "running", done: 1, total: 3, failed: 0 },
  };
  const tree = render();
  sets = [];
  const stop = tree.find(
    (n) => typeof n.props.onClick === "function" && text(n) === t("btn-ai-cleanup-stop")
  )!;
  (stop.props.onClick as () => void)();
  expect(sets).toContainEqual(new Set(["pref_1", "pat_0"]));
  expect(discarded).toBe(1);
});

it("shows a Checked label with its tooltip on checked rows only", async () => {
  const { Tooltip } = await import("../src/lib/components/ui/tooltip.tsx");
  const { CheckedLabel } = await import("../src/lib/components/explorer/AiCleanupSelect.tsx");
  const row = (id: string) => ({ ...mem(id, 1), _id: id, _type: "pref" as const });
  const tree = nodes(
    AiCleanupSelect({
      groups: [{ key: "git", items: [row("pref_0"), row("pref_1")] }],
      selectedIds: new Set(),
      checkedIds: new Set(["pref_1"]),
      listRef: { current: null },
      onToggle: () => {},
      shortcuts: {
        onSelectClean: () => {},
        onSelectLow: () => {},
        onSelectSameCat: () => {},
        onSelectAll: () => {},
        onSelectNone: () => {},
        skipped: 0,
        checkedReady: true,
      },
      onAnalyze: () => {},
    }) as ReactNode
  );
  const rows = tree.filter((n) => n.props.role === "checkbox");
  const labelIn = (r: Node) => nodes(r.props.children).filter((n) => n.type === CheckedLabel);
  expect(labelIn(rows[0]!)).toHaveLength(0);
  expect(labelIn(rows[1]!)).toHaveLength(1);
  const label = nodes(CheckedLabel() as ReactNode);
  const tip = label.find((n) => n.type === Tooltip)!;
  expect(tip.props.content).toBe(t("label-ai-cleanup-checked-tip"));
  expect(text(label)).toContain(t("label-ai-cleanup-checked"));
});

it("takes one snapshot of the profile when it opens, for the rows and the checked read", () => {
  render();
  const snapshot = sets.find(
    (value): value is { version: number; items: Array<{ _id: string }> } =>
      !!value && typeof value === "object" && "items" in value
  )!;
  expect(snapshot.version).toBe(4);
  expect(snapshot.items.map((it) => it._id)).toEqual(["pref_0", "pref_1", "pref_2", "pat_0"]);
});

it("keeps the rows, the checked read and Analyze on the snapshot when the profile reloads", () => {
  const snapshot = {
    version: 4,
    items: [{ ...mem("one", 1), _id: "pref_0", _type: "pref" as const }],
  };
  snapshotState = snapshot;
  // A space switch reloads the profile while the dialog stays open.
  const newer = { version: 9, profileData: { preferences: [], patterns: [], workflows: [] } };
  currentJob = { id: "1", selection: ["pref_0"], status: { state: "failed", error: "x" } };
  const tree = nodes(AiCleanupDialog({ open: true, profile: newer as never }) as ReactNode);
  expect(checkedArgs.at(-1)).toBe(snapshot);
  const retry = tree.find(
    (n) => typeof n.props.onClick === "function" && text(n) === t("btn-ai-cleanup-retry")
  )!;
  (retry.props.onClick as () => void)();
  expect(startedVersions).toEqual([4]);
});

it("names the row count and the memory type in the chosen language", () => {
  setLanguage("zh");
  const row = (id: string, type: "pref" | "pat" | "wf") => ({
    ...mem(id, 1),
    _id: id,
    _type: type,
  });
  const tree = nodes(
    AiCleanupSelect({
      groups: [
        { key: "git", items: [row("pref_0", "pref"), row("pat_0", "pat"), row("wf_0", "wf")] },
      ],
      selectedIds: new Set(),
      checkedIds: new Set(),
      listRef: { current: null },
      onToggle: () => {},
      shortcuts: {
        onSelectClean: () => {},
        onSelectLow: () => {},
        onSelectSameCat: () => {},
        onSelectAll: () => {},
        onSelectNone: () => {},
        skipped: 0,
        checkedReady: true,
      },
      onAnalyze: () => {},
    }) as ReactNode
  );
  const shown = text(tree);
  expect(shown).toContain(t("label-ai-cleanup-group-count", { count: 3 }));
  expect(shown).not.toContain("items");
  for (const key of ["profile-type-pref", "profile-type-pat", "profile-type-wf"] as const) {
    expect(shown).toContain(t(key));
  }
});
