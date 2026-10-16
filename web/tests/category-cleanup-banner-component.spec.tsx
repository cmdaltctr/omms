import { beforeEach, expect, it, mock } from "bun:test";
import * as react from "react";
import type { ReactElement, ReactNode } from "react";
import type { CleanupJob } from "../src/lib/category-cleanup-status.ts";

mock.module("react", () => ({
  ...react,
  useContext: () => null,
  useMemo: (factory: () => unknown) => factory(),
  useSyncExternalStore: (_subscribe: unknown, snapshot: () => unknown) => snapshot(),
  useRef: (current: unknown) => ({ current }),
  useState: (initial: unknown) => [initial, () => {}],
  useEffect: () => {},
}));
let currentJob: CleanupJob | null = null;
const pausedArgs: boolean[] = [];
mock.module("../src/hooks/useCategoryCleanupStatus.ts", () => ({
  useCategoryCleanupStatus: (paused: boolean) => {
    pausedArgs.push(paused);
    return currentJob;
  },
}));
const { CategoryCleanupBanner } =
  await import("../src/lib/components/explorer/CategoryCleanupBanner.tsx");
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
const job = (status: CleanupJob["status"]): CleanupJob => ({ id: "1", status });
const render = (paused = false, onOpen = () => {}) =>
  nodes(CategoryCleanupBanner({ paused, onOpen }) as ReactNode);
const alertNode = (tree: Node[]) =>
  tree.find((node) => typeof node.type === "function" && node.type.name === "Alert")!;

beforeEach(() => {
  currentJob = null;
  pausedArgs.length = 0;
  setLanguage("en");
});

it("renders nothing without a job and while paused, and passes paused to the hook", () => {
  expect(render()).toEqual([]);
  currentJob = job({ state: "grouping" });
  expect(render(true)).toEqual([]);
  expect(pausedArgs).toEqual([false, true]);
});

it("shows the grouping text for a job that is grouping names", () => {
  currentJob = job({ state: "grouping" });
  const tree = render();
  expect(text(alertNode(tree).props.children)).toContain(t("label-category-cleanup-loading"));
  expect(alertNode(tree).props.role).toBe("status");
});

it("shows batches done and total for a job that is checking groups", () => {
  currentJob = job({ state: "checking", done: 2, total: 9 });
  const tree = render();
  expect(text(alertNode(tree).props.children)).toContain(
    t("label-category-cleanup-progress", { done: 2, total: 9 })
  );
  expect(alertNode(tree).props.role).toBe("status");
});

it("shows the number of groups when the preview is ready", () => {
  currentJob = job({ state: "done", preview: { groups: [{}, {}, {}] } });
  const tree = render();
  expect(text(alertNode(tree).props.children)).toContain(
    t("label-category-cleanup-banner-ready", { groups: 3 })
  );
  expect(alertNode(tree).props.role).toBe("status");
});

it("shows a failure as an alert with the server error inside bdi", () => {
  currentJob = job({ state: "failed", error: "Model timed out" });
  const tree = render();
  expect(alertNode(tree).props.role).toBe("alert");
  expect(text(alertNode(tree).props.children)).toContain(t("label-category-cleanup-banner-failed"));
  const isolated = tree.find((node) => node.type === "bdi")!;
  expect(text(isolated.props.children)).toBe("Model timed out");
});

it("opens the review dialog from the button", () => {
  currentJob = job({ state: "done", preview: { groups: [] } });
  const onOpen = mock(() => {});
  const tree = render(false, onOpen);
  const button = tree.find(
    (node) =>
      typeof node.type === "function" &&
      node.type.name === "Button" &&
      text(node.props.children) === t("btn-category-cleanup-banner-open")
  )!;
  expect(button).toBeDefined();
  (button.props.onClick as () => void)();
  expect(onOpen).toHaveBeenCalledTimes(1);
});

it("translates every banner text into Chinese and Arabic", () => {
  for (const key of [
    "label-category-cleanup-banner-ready",
    "label-category-cleanup-banner-failed",
    "btn-category-cleanup-banner-open",
  ] as const) {
    expect(translations.en[key]).toBeTruthy();
    for (const lang of ["zh", "ar"] as const) {
      expect(translations[lang][key]).toBeTruthy();
      expect(translations[lang][key]).not.toBe(translations.en[key]);
    }
  }
  expect(translations.en["label-category-cleanup-banner-ready"]).toContain("{groups}");
  for (const lang of ["zh", "ar"] as const) {
    expect(translations[lang]["label-category-cleanup-banner-ready"]).toContain("{groups}");
  }
});

it("renders the banner on the Profile page, hidden while the cleanup dialog is open", async () => {
  const { readFileSync } = await import("node:fs");
  const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
  const view = source("lib/components/explorer/ProfileView.tsx");
  expect(view).toMatch(/<CategoryCleanupBanner\s+paused=\{categoryCleanupOpen\}/);
  expect(view).toMatch(/onOpen=\{\(\) => onCategoryCleanup\?\.\(\)\}/);
  expect(source("App.tsx")).toContain("categoryCleanupOpen={profile.categoryCleanupOpen}");
});
