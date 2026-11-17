import { beforeEach, expect, it } from "bun:test";
import {
  allText,
  byType,
  installFetch,
  installReact,
  resetRender,
  settle,
  text,
  type Node,
  type Request,
} from "./space-kit.tsx";

installReact();

const { MemoryCleanupSection } =
  await import("../src/lib/components/settings/MemoryCleanupSection.tsx");
const { SettingRow } = await import("../src/lib/components/settings/SettingRow.tsx");
const { SettingsConfirmDialog } =
  await import("../src/lib/components/settings/SettingsConfirmDialog.tsx");
const { Button } = await import("../src/lib/components/ui/button.tsx");
const { Checkbox } = await import("../src/lib/components/ui/checkbox.tsx");
const { Input } = await import("../src/lib/components/ui/input.tsx");
const { setLanguage } = await import("../src/lib/i18n/index.ts");

const own = [MemoryCleanupSection, SettingRow];

function snapshot(on: boolean, days = 30, extra: Record<string, unknown> = {}) {
  return {
    revision: "r1",
    readOnly: false,
    settings: {
      autoDeleteOldMemories: { value: on, source: "global", globalValue: on, default: false },
      autoCleanupRetentionDays: { value: days, source: "global", globalValue: days, default: 30 },
    },
    ...extra,
  };
}

let current = snapshot(false);
// The server replies `{ days, count }` (src/services/settings-routes.ts).
let preview: { status?: number; body: unknown } | "network" = { body: { days: 30, count: 12 } };
let requests: Request[] = [];
function serve() {
  requests = installFetch((request) => {
    if (request.path.startsWith("/api/settings/auto-cleanup/preview")) {
      if (preview === "network") throw new TypeError("Failed to fetch");
      return preview;
    }
    if (request.method === "GET") return { body: current };
    return { body: { ok: true } };
  });
}
const buttonOf = (tree: Node[], label: string) =>
  byType(tree, Button).find((node) => text(node.props.children).trim() === label)!;
const patches = () => requests.filter((request) => request.method === "PATCH");
const dialog = (tree: Node[]) => byType(tree, SettingsConfirmDialog)[0];

async function turnOn(days?: string) {
  let tree = await settle(<MemoryCleanupSection />, own);
  byType(tree, Checkbox)[0]!.props.onCheckedChange(true);
  if (days) byType(tree, Input)[0]!.props.onChange({ target: { value: days } });
  tree = await settle(<MemoryCleanupSection />, own);
  buttonOf(tree, "Save").props.onClick();
  return settle(<MemoryCleanupSection />, own);
}

beforeEach(() => {
  resetRender();
  setLanguage("en");
  current = snapshot(false);
  preview = { body: { days: 30, count: 12 } };
  serve();
});

it("shows the warning and an off switch when the file does not set the key", async () => {
  const tree = await settle(<MemoryCleanupSection />, own);
  const words = allText(tree);
  expect(words).toContain("cannot be restored");
  expect(words).toContain("A project file cannot change these settings.");
  expect(byType(tree, Checkbox)[0]!.props.checked).toBe(false);
});

it("opens the dialog with the live count before it saves deletion on", async () => {
  const tree = await turnOn();
  const request = requests.find((item) => item.path.includes("auto-cleanup/preview"))!;
  expect(request.path).toBe("/api/settings/auto-cleanup/preview?days=30");
  expect(dialog(tree)).toBeDefined();
  expect(text(dialog(tree)!.props.body)).toContain("12");
  // Deletion happens at the next daily check, not when the user presses the button.
  expect(text(dialog(tree)!.props.body)).toContain("next daily check");
  expect(text(dialog(tree)!.props.body)).not.toContain("deleted now");
  // Nothing is saved until the user confirms.
  expect(patches()).toHaveLength(0);
  const result = await dialog(tree)!.props.onConfirm();
  expect(result.success).toBe(true);
  expect(patches()[0]!.body).toEqual({
    revision: "r1",
    edits: { autoDeleteOldMemories: true },
  });
});

it("writes autoDeleteOldMemories and never autoCleanupEnabled", async () => {
  const tree = await turnOn("14");
  await dialog(tree)!.props.onConfirm();
  const edits = patches()[0]!.body.edits as Record<string, unknown>;
  expect(Object.keys(edits).sort()).toEqual(["autoCleanupRetentionDays", "autoDeleteOldMemories"]);
  expect(edits.autoCleanupRetentionDays).toBe(14);
  expect(JSON.stringify(patches())).not.toContain("autoCleanupEnabled");
  expect(requests.find((item) => item.path.includes("preview"))!.path).toContain("days=14");
});

it("saves nothing when the dialog is cancelled", async () => {
  let tree = await turnOn();
  dialog(tree)!.props.onClose();
  tree = await settle(<MemoryCleanupSection />, own);
  expect(dialog(tree)).toBeUndefined();
  expect(patches()).toHaveLength(0);
  // The switch goes back to its saved state, so nobody thinks deletion is on.
  expect(byType(tree, Checkbox)[0]!.props.checked).toBe(false);
  expect(buttonOf(tree, "Save").props.disabled).toBe(true);
});

it("shows the switch off, with the reason, while a rejected days value keeps deletion off", async () => {
  current = snapshot(true, 30, {
    problems: [
      {
        kind: "value",
        file: "/home/u/.config/omms/omms.jsonc",
        line: 7,
        key: "autoCleanupRetentionDays",
        accepted: "whole numbers of 1 or more",
        off: "autoDeleteOldMemories",
        message: "x",
      },
    ],
  });
  const tree = await settle(<MemoryCleanupSection />, own);
  expect(byType(tree, Checkbox)[0]!.props.checked).toBe(false);
  expect(allText(tree)).toContain(
    "Deletion is off for now, because a value in your config file cannot be used. The message at the top of the page says which one."
  );
});

it("refuses to save on when the count cannot be read: 500, 400 or no connection", async () => {
  const failures = [
    { status: 500, body: { error: "The number of memories could not be counted" } },
    { status: 400, body: { error: "Invalid days: accepted whole numbers of 1 or more" } },
    "network" as const,
  ];
  for (const failure of failures) {
    resetRender();
    preview = failure;
    serve();
    const tree = await turnOn();
    expect(dialog(tree)!.props.blocked).toContain("could not count");
    expect(patches()).toHaveLength(0);
  }
});

it("refuses to save on when the count is not a number", async () => {
  preview = { body: { count: "many" } };
  const tree = await turnOn();
  expect(dialog(tree)!.props.blocked).toBeTruthy();
});

it("turning it off needs no dialog", async () => {
  current = snapshot(true);
  let tree = await settle(<MemoryCleanupSection />, own);
  byType(tree, Checkbox)[0]!.props.onCheckedChange(false);
  tree = await settle(<MemoryCleanupSection />, own);
  buttonOf(tree, "Save").props.onClick();
  tree = await settle(<MemoryCleanupSection />, own);
  expect(dialog(tree)).toBeUndefined();
  expect(requests.some((item) => item.path.includes("preview"))).toBe(false);
  expect(patches()[0]!.body.edits).toEqual({ autoDeleteOldMemories: false });
});

it("asks again when the days go down while deletion is on", async () => {
  current = snapshot(true, 30);
  let tree = await settle(<MemoryCleanupSection />, own);
  byType(tree, Input)[0]!.props.onChange({ target: { value: "7" } });
  tree = await settle(<MemoryCleanupSection />, own);
  buttonOf(tree, "Save").props.onClick();
  tree = await settle(<MemoryCleanupSection />, own);
  expect(dialog(tree)).toBeDefined();
  expect(requests.find((item) => item.path.includes("preview"))!.path).toContain("days=7");
  // More days is safe: it saves with no dialog.
  resetRender();
  requests.length = 0;
  tree = await settle(<MemoryCleanupSection />, own);
  byType(tree, Input)[0]!.props.onChange({ target: { value: "60" } });
  tree = await settle(<MemoryCleanupSection />, own);
  buttonOf(tree, "Save").props.onClick();
  tree = await settle(<MemoryCleanupSection />, own);
  expect(dialog(tree)).toBeUndefined();
  expect(patches()[0]!.body.edits).toEqual({ autoCleanupRetentionDays: 60 });
});

it("shows a message next to the days field for an invalid number", async () => {
  let tree = await settle(<MemoryCleanupSection />, own);
  byType(tree, Input)[0]!.props.onChange({ target: { value: "0" } });
  tree = await settle(<MemoryCleanupSection />, own);
  expect(allText(tree)).toContain("whole number of 1 or more");
  expect(buttonOf(tree, "Save").props.disabled).toBe(true);
});

it("turns Save off and says why while the config file cannot be read", async () => {
  current = { ...snapshot(false), readOnly: true };
  let tree = await settle(<MemoryCleanupSection />, own);
  byType(tree, Checkbox)[0]!.props.onCheckedChange(true);
  tree = await settle(<MemoryCleanupSection />, own);
  expect(buttonOf(tree, "Save").props.disabled).toBe(true);
  expect(allText(tree)).toContain("Saving is turned off until the file is fixed.");
});
