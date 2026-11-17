import { beforeEach, expect, it } from "bun:test";
import {
  allText,
  byType,
  installReact,
  render,
  resetRender,
  text,
  type Node,
} from "./space-kit.tsx";

installReact();

const { ImportConfirmDialog } =
  await import("../src/lib/components/memory/ImportConfirmDialog.tsx");
const { Button } = await import("../src/lib/components/ui/button.tsx");
const { Callout } = await import("../src/lib/components/skills/Callout.tsx");
const { setLanguage } = await import("../src/lib/i18n/index.ts");

const own = [ImportConfirmDialog];
const SKIPPED = "Chats already imported are skipped, so running an import again is safe.";

let confirmed = 0;
let closed = 0;
let reply: string | null = null;

const dialog = (estimate = { sessions: 12, calls: 46, minutes: 23 as number | null }) => (
  <ImportConfirmDialog
    estimate={estimate}
    hosts={["pi", "claude-code"]}
    onConfirm={async () => {
      confirmed++;
      return reply;
    }}
    onClose={() => {
      closed++;
    }}
  />
);
const button = (tree: Node[], label: string) =>
  byType(tree, Button).find((node) => text(node.props.children) === label)!;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  resetRender();
  setLanguage("en");
  confirmed = 0;
  closed = 0;
  reply = null;
});

it("states the sessions, hosts, calls, time and the skipped-chats line", () => {
  const words = allText(render(dialog(), own));
  expect(words).toContain("Import chats?");
  expect(words).toContain("Sessions to import: 12");
  expect(words).toContain("From: Pi, Claude Code");
  expect(words).toContain("Model calls: about 46");
  expect(words).toContain("Time: about 23 min");
  expect(words).toContain(SKIPPED);
});

it("says the time is known once the import starts when no rate is measured", () => {
  const words = allText(render(dialog({ sessions: 3, calls: 9, minutes: null }), own));
  expect(words).toContain("The time is known once the import starts.");
  expect(words).not.toContain("Time: about");
});

it("makes Cancel the default focus and calls nothing when it is chosen", () => {
  const tree = render(dialog(), own);
  expect(button(tree, "Cancel").props.autoFocus).toBe(true);
  expect(button(tree, "Import").props.autoFocus).toBeUndefined();
  button(tree, "Cancel").props.onClick();
  expect(confirmed).toBe(0);
  expect(closed).toBe(1);
});

it("calls onConfirm once and closes when the import starts", async () => {
  const tree = render(dialog(), own);
  button(tree, "Import").props.onClick();
  await settle();
  expect(confirmed).toBe(1);
  expect(closed).toBe(1);
});

it("shows a server error inside and stays open", async () => {
  reply = "Model is not reachable.";
  button(render(dialog(), own), "Import").props.onClick();
  await settle();
  const tree = render(dialog(), own);
  expect(confirmed).toBe(1);
  expect(closed).toBe(0);
  const alert = byType(tree, Callout)[0]!;
  expect(alert.props.tone).toBe("danger");
  expect(allText(tree)).toContain("The import did not start:");
  expect(button(tree, "Import").props.disabled).toBe(false);
});

it("disables both buttons while the request runs", () => {
  const tree = render(dialog(), own);
  button(tree, "Import").props.onClick();
  const busy = render(dialog(), own);
  expect(button(busy, "Import").props.disabled).toBe(true);
  expect(button(busy, "Cancel").props.disabled).toBe(true);
  expect(allText(busy)).toContain("Starting the import…");
});

it("reads in Chinese and Arabic", () => {
  setLanguage("zh");
  expect(allText(render(dialog(), own))).toContain("待导入的会话：12");
  setLanguage("ar");
  expect(allText(render(dialog(), own))).toContain("الجلسات المراد استيرادها: 12");
});

it("says a re-analyse analyses imported chats again, and drops the skipped-chats line", () => {
  const element = (
    <ImportConfirmDialog
      estimate={{ sessions: 2, calls: 3, minutes: null }}
      hosts={["pi"]}
      force
      onConfirm={async () => null}
      onClose={() => {}}
    />
  );
  const words = allText(render(element, own));
  expect(words).toContain(
    "Chats already imported are analysed again. This can cost more model calls."
  );
  expect(words).not.toContain(SKIPPED);
});
