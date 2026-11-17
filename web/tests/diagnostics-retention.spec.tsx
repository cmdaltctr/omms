import { beforeEach, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
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

const { CaptureControls } = await import("../src/lib/components/settings/CaptureControls.tsx");
const { SettingsConfirmDialog } =
  await import("../src/lib/components/settings/SettingsConfirmDialog.tsx");
const { Button } = await import("../src/lib/components/ui/button.tsx");
const { Checkbox } = await import("../src/lib/components/ui/checkbox.tsx");
const { Input } = await import("../src/lib/components/ui/input.tsx");
const { setLanguage } = await import("../src/lib/i18n/index.ts");

const own = [CaptureControls];

const entry = (value: unknown) => ({ value, source: "global", globalValue: value });
const snapshot = (readOnly = false) => ({
  revision: "r1",
  readOnly,
  settings: {
    captureTrace: entry(false),
    captureTraceRetentionDays: entry(30),
    captureAttemptRetentionDays: entry(30),
    captureRetryRetentionHours: entry(72),
  },
});

let requests: Request[] = [];
let reloaded = 0;
let removed: string[] = [];
const props = (over: Record<string, unknown> = {}) => ({
  snapshot: snapshot(),
  queue: { pi: 2, opencode: 1, "claude-code": 0 },
  readQueue: async () => ({ pi: 2, opencode: 1, "claude-code": 0 }),
  traces: [{ file: "2026-01-01.jsonl", size: 120 }],
  note: "",
  onRetry: () => {},
  onChanged: async () => {
    reloaded += 1;
  },
  ...over,
});
const view = (over: Record<string, unknown> = {}) => <CaptureControls {...(props(over) as any)} />;
const buttonOf = (tree: Node[], label: string) =>
  byType(tree, Button).find((node) => text(node.props.children).trim() === label)!;
const field = (tree: Node[], label: string) =>
  byType(tree, Input).find((node) => node.props["aria-label"] === label)!;
const dialog = (tree: Node[]) => byType(tree, SettingsConfirmDialog)[0];
const patches = () => requests.filter((request) => request.method === "PATCH");

beforeEach(() => {
  resetRender();
  setLanguage("en");
  reloaded = 0;
  removed = [];
  requests = installFetch((request) => {
    if (request.method === "DELETE") {
      removed.push(request.path);
      return { body: { ok: true } };
    }
    return { body: snapshot() };
  });
});

it("saves a changed retention with the Save button, not on leaving the field", async () => {
  let tree = await settle(view(), own);
  field(tree, "Trace retention (days)").props.onChange({ target: { value: "14" } });
  field(tree, "Trace retention (days)").props.onBlur?.();
  tree = await settle(view(), own);
  expect(patches()).toHaveLength(0);
  buttonOf(tree, "Save retention").props.onClick();
  tree = await settle(view(), own);
  expect(patches()[0]!.body).toEqual({ revision: "r1", edits: { captureTraceRetentionDays: 14 } });
  expect(allText(tree)).toContain("Saved.");
  expect(reloaded).toBe(1);
});

it("shows a message next to an invalid field and keeps Save off", async () => {
  let tree = await settle(view(), own);
  field(tree, "Trace retention (days)").props.onChange({ target: { value: "0" } });
  tree = await settle(view(), own);
  expect(allText(tree)).toContain("Use a whole number of days, 1 or more.");
  expect(buttonOf(tree, "Save retention").props.disabled).toBe(true);
  field(tree, "Retry retention (hours)").props.onChange({ target: { value: "900" } });
  tree = await settle(view(), own);
  expect(allText(tree)).toContain("Use a whole number of hours from 0 to 720.");
});

it("asks before retry retention 0 and states the waiting count", async () => {
  let tree = await settle(view(), own);
  field(tree, "Retry retention (hours)").props.onChange({ target: { value: "0" } });
  tree = await settle(view(), own);
  buttonOf(tree, "Save retention").props.onClick();
  tree = await settle(view(), own);
  expect(dialog(tree)).toBeDefined();
  expect(text(dialog(tree)!.props.body)).toContain("3 waiting turns will be deleted");
  // Nothing is saved until the user confirms.
  expect(patches()).toHaveLength(0);
  await dialog(tree)!.props.onConfirm();
  expect(patches()[0]!.body.edits).toEqual({ captureRetryRetentionHours: 0 });
});

it("saves nothing when the retry retention dialog is cancelled", async () => {
  let tree = await settle(view(), own);
  field(tree, "Retry retention (hours)").props.onChange({ target: { value: "0" } });
  tree = await settle(view(), own);
  buttonOf(tree, "Save retention").props.onClick();
  tree = await settle(view(), own);
  dialog(tree)!.props.onClose();
  tree = await settle(view(), own);
  expect(dialog(tree)).toBeUndefined();
  expect(patches()).toHaveLength(0);
});

it("blocks the save when the waiting count cannot be read", async () => {
  const over = { readQueue: async () => undefined };
  let tree = await settle(view(over), own);
  field(tree, "Retry retention (hours)").props.onChange({ target: { value: "0" } });
  tree = await settle(view(over), own);
  buttonOf(tree, "Save retention").props.onClick();
  tree = await settle(view(over), own);
  expect(dialog(tree)!.props.blocked).toContain("could not count");
});

it("reads the waiting count again when Save is pressed, not the count from page load", async () => {
  // The page loaded with 3 waiting turns; 7 wait by the time the user saves.
  const over = { readQueue: async () => ({ pi: 4, opencode: 3, "claude-code": 0 }) };
  let tree = await settle(view(over), own);
  field(tree, "Retry retention (hours)").props.onChange({ target: { value: "0" } });
  tree = await settle(view(over), own);
  buttonOf(tree, "Save retention").props.onClick();
  tree = await settle(view(over), own);
  expect(text(dialog(tree)!.props.body)).toContain("7 waiting turns will be deleted");
});

it("asks before it turns trace saving on, and saves it only after confirm", async () => {
  let tree = await settle(view(), own);
  byType(tree, Checkbox)[0]!.props.onCheckedChange(true);
  tree = await settle(view(), own);
  buttonOf(tree, "Save retention").props.onClick();
  tree = await settle(view(), own);
  expect(text(dialog(tree)!.props.body)).toContain("parts of your conversations");
  expect(patches()).toHaveLength(0);
  await dialog(tree)!.props.onConfirm();
  expect(patches()[0]!.body.edits).toEqual({ captureTrace: true });
});

it("keeps Save off while the snapshot is read-only", async () => {
  let tree = await settle(view({ snapshot: snapshot(true) }), own);
  field(tree, "Trace retention (days)").props.onChange({ target: { value: "14" } });
  tree = await settle(view({ snapshot: snapshot(true) }), own);
  expect(buttonOf(tree, "Save retention").props.disabled).toBe(true);
});

it("deletes a trace file only after a dialog confirm", async () => {
  let tree = await settle(view(), own);
  buttonOf(tree, "Delete").props.onClick();
  tree = await settle(view(), own);
  expect(dialog(tree)).toBeDefined();
  expect(removed).toHaveLength(0);
  await dialog(tree)!.props.onConfirm();
  expect(removed).toEqual(["/api/settings/traces/2026-01-01.jsonl"]);
});

it("uses no raw button and no window.confirm in either diagnostics file", () => {
  for (const file of ["DiagnosticsSection.tsx", "CaptureControls.tsx"]) {
    const source = readFileSync(
      new URL(`../src/lib/components/settings/${file}`, import.meta.url),
      "utf8"
    );
    expect({ file, raw: /<button|<input|window\.confirm/.test(source) }).toEqual({
      file,
      raw: false,
    });
  }
});
