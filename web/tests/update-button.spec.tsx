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
}));
mock.module("../src/lib/i18n/index.ts", () => ({
  useI18n: () => ({
    language: "en",
    t: (key: string, params: Record<string, string | number> = {}) =>
      ((translations.en as Record<string, string>)[key] ?? key).replace(/\{(\w+)\}/g, (_, name) =>
        String(params[name] ?? `{${name}}`)
      ),
  }),
}));

type Update = {
  available: string | null;
  state: "idle" | "installing" | "restarting" | "failed";
  code: string | null;
  canInstall: boolean;
};
let status: {
  version: string;
  canControl: boolean;
  instance?: string;
  update?: Update;
} | null = null;
let sendResult = true;
let sends = 0;
let waitResult: { kind: "restarted" } | { kind: "failed"; code: string } | { kind: "timeout" } = {
  kind: "restarted",
};
const waitedFor: (string | null)[] = [];
mock.module("../src/lib/power.ts", () => ({
  STATUS_POLL_MS: 15_000,
  readPowerStatus: async () => status,
  sendPowerAction: async () => true,
  waitForWebApp: async () => "restarted",
  sendUpdate: async () => {
    sends++;
    return sendResult;
  },
  waitForUpdate: async (previous: string | null) => {
    waitedFor.push(previous);
    return waitResult;
  },
}));

const { UpdateButton, UPDATE_COMMANDS } =
  await import("../src/lib/components/explorer/UpdateButton.tsx");

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
  return UpdateButton();
}
async function loaded() {
  render();
  await tick();
  return render();
}
const button = (tree: ReactNode) =>
  find(tree, (node) => node.type === "button" && node.props["data-update"] !== undefined)[0];
const dialog = (tree: ReactNode) =>
  find(tree, (node) => typeof node.props.onOpenChange === "function")[0];
const choice = (tree: ReactNode, label: string) =>
  find(tree, (node) => node.type !== "span" && textOf(node.props.children) === label)[0];
const en = translations.en as Record<string, string>;

let reloads = 0;
let clipboard: string[] = [];
beforeEach(() => {
  state = [];
  cursor = 0;
  sends = 0;
  sendResult = true;
  waitResult = { kind: "restarted" };
  waitedFor.length = 0;
  reloads = 0;
  clipboard = [];
  status = {
    version: "4.9.0",
    canControl: true,
    instance: "first",
    update: { available: "4.10.0", state: "idle", code: null, canInstall: true },
  };
  Object.assign(globalThis, {
    window: { location: { reload: () => reloads++ } },
    navigator: { clipboard: { writeText: async (text: string) => void clipboard.push(text) } },
    setInterval: () => 0,
    clearInterval: () => {},
  });
});

it("shows the button with the new version for a local caller", async () => {
  const tree = await loaded();
  expect(button(tree)?.props["aria-label"]).toBe("Update available: 4.10.0");
  // The footer shows the word, not an icon.
  expect(textOf(button(tree))).toBe("Update");
});

it("shows no button when there is no update", async () => {
  status = { ...status!, update: { available: null, state: "idle", code: null, canInstall: true } };
  expect(await loaded()).toBeNull();
});

it("shows no button to a caller that may not control the web app", async () => {
  status = { ...status!, canControl: false };
  expect(await loaded()).toBeNull();
});

it("shows no button when an older web app reports no update field", async () => {
  status = { version: "4.9.0", canControl: true, instance: "first" };
  expect(await loaded()).toBeNull();
});

it("lists both versions and every host command with a copy action", async () => {
  const tree = await loaded();
  button(tree)?.props.onClick?.();
  const open = render();
  expect(dialog(open)?.props.open).toBe(true);
  const text = textOf(open);
  expect(text).toContain("Running: 4.9.0. Newer release: 4.10.0.");
  for (const { command } of UPDATE_COMMANDS) expect(text).toContain(command);
  expect(text).toContain(en["update-hosts-note"]);
  const copyOpenCode = find(
    open,
    (node) => node.props["aria-label"] === "Copy: opencode plugin update om-memory-system"
  )[0];
  (copyOpenCode?.props.onClick as () => void)();
  expect(clipboard).toEqual(["opencode plugin update om-memory-system"]);
});

it("installs, waits for a new instance, and reloads", async () => {
  const tree = await loaded();
  button(tree)?.props.onClick?.();
  (choice(render(), en["update-install"]!)?.props.onClick as () => void)();
  await tick();
  expect(sends).toBe(1);
  expect(waitedFor).toEqual(["first"]);
  expect(reloads).toBe(1);
});

it("shows progress while the web app installs", async () => {
  status = { ...status!, update: { ...status!.update!, state: "installing" } };
  const tree = await loaded();
  button(tree)?.props.onClick?.();
  const open = render();
  expect(textOf(open)).toContain(en["update-installing"]);
  expect(choice(open, en["update-install"]!)?.props.disabled).toBe(true);
});

it("shows the failure code and stays usable when the install fails", async () => {
  waitResult = { kind: "failed", code: "permission" };
  const tree = await loaded();
  button(tree)?.props.onClick?.();
  (choice(render(), en["update-install"]!)?.props.onClick as () => void)();
  await tick();
  const after = render();
  expect(reloads).toBe(0);
  expect(textOf(after)).toContain("The update failed (permission). The web app still runs.");
  expect(choice(after, en["update-install"]!)?.props.disabled).toBe(false);
});

it("shows a failure the status poll reports", async () => {
  status = { ...status!, update: { ...status!.update!, state: "failed", code: "timeout" } };
  const tree = await loaded();
  button(tree)?.props.onClick?.();
  expect(textOf(render())).toContain("The update failed (timeout).");
});

it("says the request failed when the web app refuses it", async () => {
  sendResult = false;
  const tree = await loaded();
  button(tree)?.props.onClick?.();
  (choice(render(), en["update-install"]!)?.props.onClick as () => void)();
  await tick();
  expect(textOf(render())).toContain(en["update-request-failed"]);
});

it("disables Update web app and says why when no npm sits beside Node.js", async () => {
  status = { ...status!, update: { ...status!.update!, canInstall: false } };
  const tree = await loaded();
  button(tree)?.props.onClick?.();
  const open = render();
  expect(choice(open, en["update-install"]!)?.props.disabled).toBe(true);
  expect(textOf(open)).toContain(en["update-cannot-install"]);
});

it("has every update string in English, Chinese, and Arabic", () => {
  const keys = (lang: "en" | "zh" | "ar") =>
    Object.keys(translations[lang])
      .filter((key) => key.startsWith("update-"))
      .sort();
  expect(keys("en").length).toBe(20);
  expect(keys("zh")).toEqual(keys("en"));
  expect(keys("ar")).toEqual(keys("en"));
});

it("shows the word in the row and inline variants, and an icon when the sidebar is collapsed", async () => {
  await loaded();
  for (const variant of ["row", "inline"] as const) {
    cursor = 0;
    expect(textOf(button(UpdateButton({ variant })))).toBe("Update");
  }
  cursor = 0;
  const icon = button(UpdateButton({ variant: "icon" }));
  expect(textOf(icon)).toBe("");
  // The icon keeps the version in its accessible name.
  expect(icon?.props["aria-label"]).toBe("Update available: 4.10.0");
});
