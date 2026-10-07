import { beforeEach, expect, it, mock } from "bun:test";
import type { ReactElement, ReactNode } from "react";
import * as react from "react";
import { translations } from "../src/lib/i18n/translations.ts";

let state: unknown[] = [];
let cursor = 0;
mock.module("react", () => ({
  ...react,
  useState: (initial: unknown) => {
    const index = cursor++;
    state[index] ??= typeof initial === "function" ? (initial as () => unknown)() : initial;
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
  useRef: (value: unknown) => ({ current: value }),
  // Subscribe on each render as the effect mock does; the store keeps one timer.
  useSyncExternalStore: (subscribe: (cb: () => void) => () => void, snapshot: () => unknown) => {
    subscribe(() => {});
    return snapshot();
  },
}));
mock.module("../src/lib/i18n/index.ts", () => ({
  useI18n: () => ({
    language: "en",
    t: (key: string) => (translations.en as Record<string, string>)[key] ?? key,
  }),
}));

const requests: string[] = [];
let status: { version: string; canControl: boolean; instance?: string } | null = {
  version: "1.0.0",
  canControl: true,
  instance: "first",
};
let sendResult = true;
let waitResult: "restarted" | "unchanged" | "down" = "restarted";
const waitedFor: (string | null)[] = [];
mock.module("../src/lib/power.ts", () => ({
  STATUS_POLL_MS: 15_000,
  readPowerStatus: async () => status,
  sendPowerAction: async (action: string) => {
    requests.push(action);
    return sendResult;
  },
  waitForWebApp: async (previous: string | null) => {
    waitedFor.push(previous);
    return waitResult;
  },
}));

const { PowerButton } = await import("../src/lib/components/explorer/PowerButton.tsx");

type Node = ReactElement<{ children?: ReactNode; [key: string]: unknown }>;
function find(node: ReactNode, predicate: (node: Node) => boolean): Node[] {
  if (!react.isValidElement(node))
    return Array.isArray(node) ? node.flatMap((child) => find(child, predicate)) : [];
  const element = node as Node;
  return [...(predicate(element) ? [element] : []), ...find(element.props.children, predicate)];
}
function textOf(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(textOf).join("");
  if (react.isValidElement(node)) return textOf((node as Node).props.children);
  return "";
}
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const tick = async () => {
  await flush();
  await flush();
};
function render() {
  cursor = 0;
  return PowerButton();
}
const powerButton = (tree: ReactNode) =>
  find(tree, (node) => node.type === "button" && node.props["aria-label"] === "Web app power")[0];
const dialog = (tree: ReactNode) =>
  find(tree, (node) => typeof node.props.onOpenChange === "function")[0];
const choice = (tree: ReactNode, label: string) =>
  find(tree, (node) => node.type !== "span" && textOf(node.props.children) === label)[0];

let reloads = 0;
beforeEach(() => {
  state = [];
  cursor = 0;
  requests.length = 0;
  status = { version: "1.0.0", canControl: true, instance: "first" };
  sendResult = true;
  waitResult = "restarted";
  waitedFor.length = 0;
  reloads = 0;
  Object.assign(globalThis, {
    window: { location: { reload: () => reloads++ } },
    setInterval: () => 0,
    clearInterval: () => {},
  });
});

/** Render once to start the status read, wait for it, and render again. */
async function loaded() {
  render();
  await tick();
  return render();
}

it("shows no button when the caller may not control the web app", async () => {
  status = { version: "1.0.0", canControl: false };
  expect(await loaded()).toBeNull();
});

it("is green when the last status call succeeded and grey when it failed", async () => {
  const on = await loaded();
  expect(powerButton(on)?.props["data-power"]).toBe("on");
  status = null;
  render();
  await tick();
  expect(powerButton(render())?.props["data-power"]).toBe("off");
});

it("opens a dialog that focuses Restart and shows the note", async () => {
  const tree = await loaded();
  expect(dialog(tree)?.props.open).toBe(false);
  powerButton(tree)?.props.onClick?.();
  const open = render();
  expect(dialog(open)?.props.open).toBe(true);
  expect(choice(open, "Restart")?.props.autoFocus).toBe(true);
  expect(textOf(open)).toContain(translations.en["power-note"]);
});

it("sends no request when the dialog is closed", async () => {
  const tree = await loaded();
  powerButton(tree)?.props.onClick?.();
  (dialog(render())?.props.onOpenChange as (open: boolean) => void)(false);
  expect(dialog(render())?.props.open).toBe(false);
  powerButton(render())?.props.onClick?.();
  (choice(render(), "Cancel")?.props.onClick as () => void)();
  await tick();
  expect(requests).toEqual([]);
});

it("sends the chosen action and reloads after a restart", async () => {
  const tree = await loaded();
  powerButton(tree)?.props.onClick?.();
  (choice(render(), "Restart")?.props.onClick as () => void)();
  await tick();
  expect(requests).toEqual(["restart"]);
  expect(reloads).toBe(1);
  // The page waits for a process other than the one it read the status from.
  expect(waitedFor).toEqual(["first"]);
});

it("shows the stopped screen with the command and the note after Stop", async () => {
  const tree = await loaded();
  powerButton(tree)?.props.onClick?.();
  (choice(render(), "Stop")?.props.onClick as () => void)();
  await tick();
  expect(requests).toEqual(["stop"]);
  // The full-page screen, not the dialog, carries the title, command, and note.
  const screen = find(
    render(),
    (node) =>
      node.props.role === "alert" &&
      textOf(node.props.children).includes(translations.en["power-stopped-title"])
  )[0];
  const text = textOf(screen);
  expect(text).toContain("om-memory-system web");
  expect(text).toContain(translations.en["power-note"]);
  expect(reloads).toBe(0);
});

it("shows the stopped screen when the web app does not come back after a restart", async () => {
  waitResult = "down";
  const tree = await loaded();
  powerButton(tree)?.props.onClick?.();
  (choice(render(), "Restart")?.props.onClick as () => void)();
  await tick();
  expect(reloads).toBe(0);
  expect(textOf(render())).toContain(translations.en["power-stopped-title"]);
});

it("keeps the dialog open and says so when the request fails", async () => {
  sendResult = false;
  const tree = await loaded();
  powerButton(tree)?.props.onClick?.();
  (choice(render(), "Stop")?.props.onClick as () => void)();
  await tick();
  const after = render();
  expect(dialog(after)?.props.open).toBe(true);
  expect(textOf(after)).toContain(translations.en["power-request-failed"]);
  expect(textOf(after)).not.toContain(translations.en["power-stopped-title"]);
});

it("says the restart failed and stays usable when the old web app still answers", async () => {
  waitResult = "unchanged";
  const tree = await loaded();
  powerButton(tree)?.props.onClick?.();
  (choice(render(), "Restart")?.props.onClick as () => void)();
  await tick();
  const after = render();
  expect(reloads).toBe(0);
  expect(textOf(after)).not.toContain(translations.en["power-stopped-title"]);
  expect(textOf(after)).not.toContain(translations.en["power-restarting"]);
  expect(dialog(after)?.props.open).toBe(true);
  expect(textOf(after)).toContain(translations.en["power-restart-failed"]);
  expect(choice(after, "Restart")?.props.disabled).toBe(false);
});
