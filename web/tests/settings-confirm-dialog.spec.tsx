import { beforeEach, expect, it } from "bun:test";
import {
  allText,
  installReact,
  render,
  resetRender,
  settle,
  text,
  type Node,
} from "./space-kit.tsx";

installReact();

const { SettingsConfirmDialog } =
  await import("../src/lib/components/settings/SettingsConfirmDialog.tsx");
const { Button } = await import("../src/lib/components/ui/button.tsx");
const { setLanguage } = await import("../src/lib/i18n/index.ts");

const own = [SettingsConfirmDialog];

type Result = { success: boolean; error?: string };
let sent = 0;
let closed = 0;
let reply: Result = { success: true };
let wait: Promise<void> = Promise.resolve();

const dialog = (props: Partial<Parameters<typeof SettingsConfirmDialog>[0]> = {}) => (
  <SettingsConfirmDialog
    title="Turn on automatic deletion?"
    body="12 memories would be deleted now."
    confirmLabel="Turn on"
    onConfirm={async () => {
      sent += 1;
      await wait;
      return reply;
    }}
    onClose={() => {
      closed += 1;
    }}
    {...props}
  />
);
const button = (tree: Node[], label: string) =>
  tree.find((node) => node.type === Button && text(node.props.children).trim() === label)!;

beforeEach(() => {
  resetRender();
  setLanguage("en");
  sent = 0;
  closed = 0;
  reply = { success: true };
  wait = Promise.resolve();
});

it("sends nothing until the user confirms", async () => {
  const tree = await settle(dialog(), own);
  expect(allText(tree)).toContain("12 memories would be deleted now.");
  expect(sent).toBe(0);
  button(tree, "Cancel").props.onClick();
  expect(closed).toBe(1);
  expect(sent).toBe(0);
});

it("sends one request on confirm and closes on success", async () => {
  const tree = await settle(dialog(), own);
  button(tree, "Turn on").props.onClick();
  await settle(dialog(), own);
  expect(sent).toBe(1);
  expect(closed).toBe(1);
});

it("keeps a server error inside the dialog and stays open", async () => {
  reply = { success: false, error: "Config changed. Reload settings and save again." };
  const tree = await settle(dialog(), own);
  button(tree, "Turn on").props.onClick();
  const after = await settle(dialog(), own);
  expect(allText(after)).toContain("Config changed. Reload settings and save again.");
  expect(closed).toBe(0);
  // The same dialog can try again.
  expect(button(after, "Turn on").props.disabled).toBe(false);
});

it("shows progress and blocks a second click while the request runs", async () => {
  let release: () => void = () => {};
  wait = new Promise((resolve) => (release = resolve));
  const tree = await settle(dialog(), own);
  button(tree, "Turn on").props.onClick();
  const running = render(dialog(), own);
  expect(running.some((node) => node.props.role === "status")).toBe(true);
  expect(button(running, "Turn on").props.disabled).toBe(true);
  expect(button(running, "Cancel").props.disabled).toBe(true);
  release();
  await settle(dialog(), own);
  expect(sent).toBe(1);
});

it("refuses to confirm while a reason blocks it", async () => {
  const tree = await settle(dialog({ blocked: "OMMS could not count the memories." }), own);
  expect(allText(tree)).toContain("OMMS could not count the memories.");
  expect(button(tree, "Turn on").props.disabled).toBe(true);
  button(tree, "Turn on").props.onClick?.();
  expect(sent).toBe(0);
});

it("reads the Cancel button in Arabic", async () => {
  setLanguage("ar");
  const tree = await settle(dialog(), own);
  const labels = tree
    .filter((node) => node.type === Button)
    .map((node) => text(node.props.children));
  expect(labels.some((label) => /[\u0600-\u06ff]/.test(label))).toBe(true);
  expect(labels).not.toContain("Cancel");
});
