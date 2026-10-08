import { beforeEach, expect, it, mock } from "bun:test";
import * as react from "react";
import type { ReactElement, ReactNode } from "react";
import { setLanguage } from "../src/lib/i18n/index.ts";

let states: unknown[] = [],
  cursor = 0;
let effects: (() => unknown)[] = [];
mock.module("react", () => ({
  ...react,
  useContext: () => null,
  useMemo: (factory: () => unknown) => factory(),
  useSyncExternalStore: (_s: unknown, snapshot: () => unknown) => snapshot(),
  useEffect: (effect: () => unknown) => effects.push(effect),
  useState: (initial: unknown) => {
    const index = cursor++;
    if (!(index in states)) states[index] = initial;
    return [
      states[index],
      (value: unknown) => {
        states[index] = typeof value === "function" ? value(states[index]) : value;
      },
    ];
  },
}));
let confirmed = false,
  confirmation = "",
  presetCalls = 0;
const requests: { path: string; method: string }[] = [];
Object.assign(globalThis, {
  window: {
    confirm: (message: string) => {
      confirmation = message;
      return confirmed;
    },
  },
  fetch: async (path: string, options: RequestInit = {}) => {
    requests.push({ path, method: options.method ?? "GET" });
    const value =
      path === "/api/web/status"
        ? { isLocal: true }
        : path === "/api/settings/profile/catch-up"
          ? {
              preview: { waiting: 2600, calls: 52 },
              job: { state: "idle", batchesBuilt: 0, remaining: 2600 },
            }
          : { state: "running", batchesBuilt: 0, remaining: 2600 };
    return new Response(JSON.stringify(value));
  },
});
const { ProfileCatchUpSection, CatchUpStatus } =
  await import("../src/lib/components/memory/ProfileCatchUpSection.tsx");
type Node = ReactElement<{ children?: ReactNode; [key: string]: any }>;
function nodes(node: ReactNode): Node[] {
  if (!react.isValidElement(node)) return Array.isArray(node) ? node.flatMap(nodes) : [];
  const element = node as Node;
  if (element.type === CatchUpStatus)
    return nodes(CatchUpStatus(element.props as Parameters<typeof CatchUpStatus>[0]));
  return [element, ...nodes(element.props.children)];
}
const text = (node: ReactNode): string =>
  react.isValidElement(node)
    ? text((node as Node).props.children)
    : Array.isArray(node)
      ? node.map(text).join("")
      : String(node ?? "");
function render() {
  cursor = 0;
  return nodes(ProfileCatchUpSection({ onReanalyse: () => presetCalls++ }));
}
async function settle() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}
async function mount() {
  render();
  for (const effect of effects.splice(0)) effect();
  await settle();
}
const button = (name: string) =>
  render().find((node) => node.type === "button" && text(node) === name)!;
beforeEach(() => {
  states = [];
  effects = [];
  requests.length = 0;
  confirmed = false;
  confirmation = "";
  presetCalls = 0;
  setLanguage("en");
});
it("requires confirmation of waiting analysis calls and never lists host history", async () => {
  await mount();
  button("Analyse waiting prompts").props.onClick();
  await settle();
  expect(confirmation).toContain("52");
  expect(requests.filter((request) => request.method === "POST")).toHaveLength(0);
  confirmed = true;
  button("Analyse waiting prompts").props.onClick();
  await settle();
  expect(
    requests.filter((request) => request.method === "POST").map((request) => request.path)
  ).toEqual(["/api/settings/profile/catch-up/start"]);
  expect(requests.some((request) => request.path.includes("/imports"))).toBe(false);
});
it("opens history re-analysis through a preset callback without a model request", async () => {
  await mount();
  button("Re-analyse chat history").props.onClick();
  expect(presetCalls).toBe(1);
  expect(requests.filter((request) => request.method === "POST")).toHaveLength(0);
  expect(render().map(text).join(" ")).toContain("preserves your profile and project memories");
});
it("translates both actions and keeps the waiting prompt state on language changes", async () => {
  await mount();
  for (const [language, analyse, replay] of [
    ["zh", "分析等待处理的提示", "重新分析聊天记录"],
    ["ar", "تحليل المطالبات المنتظرة", "إعادة تحليل سجل المحادثات"],
  ] as const) {
    setLanguage(language);
    expect(button(analyse)).toBeDefined();
    expect(button(replay)).toBeDefined();
    expect(render().map(text).join(" ")).toContain("2600");
  }
});
