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

const { WebAppSection } = await import("../src/lib/components/settings/WebAppSection.tsx");
const { Button } = await import("../src/lib/components/ui/button.tsx");
const { Checkbox } = await import("../src/lib/components/ui/checkbox.tsx");
const { SettingsConfirmDialog } =
  await import("../src/lib/components/settings/SettingsConfirmDialog.tsx");
const { setLanguage } = await import("../src/lib/i18n/index.ts");

const own = [WebAppSection];
const REFUSED = "Config changed. Reload settings and save again.";

/** The file answers every read with what the last save left, as the real one does. */
let autostart: boolean;
let refusal: string | undefined;
let requests: Request[];

const reply = (request: Request) => {
  if (request.method === "PATCH") {
    if (refusal) return { status: 409, body: { error: refusal } };
    autostart = request.body.edits.webServerAutoStart;
  }
  if (request.path === "/api/settings/web-autostart") return { body: { state: "installed" } };
  if (request.path === "/api/settings/version")
    return { body: { running: "4.3.2", global: null, relation: "missing" } };
  return { body: { revision: "r1", settings: { webServerAutoStart: { globalValue: autostart } } } };
};

beforeEach(() => {
  resetRender();
  setLanguage("en");
  autostart = true;
  refusal = undefined;
  requests = installFetch(reply);
});

const box = (tree: Node[]) => byType(tree, Checkbox)[0]!;
const buttonOf = (tree: Node[], label: string) =>
  byType(tree, Button).find((node) => text(node.props.children).trim() === label)!;
const dialogOf = (tree: Node[]) => byType(tree, SettingsConfirmDialog)[0];
/** What the dialog lists: one row per setting the save changes. */
const rowsOf = (dialog: Node) => dialog.props.body.props.changes as unknown[];
const patches = () => requests.filter((request) => request.method === "PATCH");
/** Confirm the open dialog, then let it close as it does when the request succeeds. */
async function confirm(tree: Node[]) {
  const dialog = dialogOf(tree)!;
  const result = await dialog.props.onConfirm();
  dialog.props.onClose();
  return result;
}

it("opens the dialog when Save is selected and sends nothing until the user confirms", async () => {
  let tree = await settle(<WebAppSection />, own);
  box(tree).props.onCheckedChange(false);
  tree = await settle(<WebAppSection />, own);
  buttonOf(tree, "Save").props.onClick();
  tree = await settle(<WebAppSection />, own);

  const dialog = dialogOf(tree)!;
  expect(dialog.props.title).toBe("Save web app settings?");
  expect(dialog.props.confirmLabel).toBe("Save");
  expect(rowsOf(dialog)).toEqual([
    { key: "webServerAutoStart", label: "Start the web app at login", from: "On", to: "Off" },
  ]);
  expect(patches()).toHaveLength(0);
  // The box shows the picked value while the dialog asks.
  expect(box(tree).props.checked).toBe(false);
});

it("sends nothing on Cancel and keeps the change as a draft", async () => {
  let tree = await settle(<WebAppSection />, own);
  box(tree).props.onCheckedChange(false);
  tree = await settle(<WebAppSection />, own);
  buttonOf(tree, "Save").props.onClick();
  tree = await settle(<WebAppSection />, own);
  dialogOf(tree)!.props.onClose();
  tree = await settle(<WebAppSection />, own);

  expect(dialogOf(tree)).toBeUndefined();
  expect(patches()).toHaveLength(0);
  expect(allText(tree)).not.toContain("Saved.");
  // The picked value stays, so Save can be used again.
  expect(box(tree).props.checked).toBe(false);
  buttonOf(tree, "Save").props.onClick();
  tree = await settle(<WebAppSection />, own);
  await confirm(tree);
  tree = await settle(<WebAppSection />, own);
  expect(patches()).toHaveLength(1);
  expect(patches()[0]!.body).toEqual({ revision: "r1", edits: { webServerAutoStart: false } });
  expect(allText(tree)).toContain("Saved.");
});

it("keeps a server refusal inside the dialog, which stays open until the user decides", async () => {
  refusal = REFUSED;
  let tree = await settle(<WebAppSection />, own);
  box(tree).props.onCheckedChange(false);
  tree = await settle(<WebAppSection />, own);
  buttonOf(tree, "Save").props.onClick();
  tree = await settle(<WebAppSection />, own);

  expect(await dialogOf(tree)!.props.onConfirm()).toMatchObject({ success: false, error: REFUSED });
  tree = await settle(<WebAppSection />, own);
  expect(dialogOf(tree)).toBeDefined();
  expect(patches()).toHaveLength(1);
  // The reason sits in the dialog, which stays open, and on the card.
  expect(allText(tree)).toContain(REFUSED);
  expect(allText(tree)).not.toContain("Saved.");

  dialogOf(tree)!.props.onClose();
  tree = await settle(<WebAppSection />, own);
  expect(dialogOf(tree)).toBeUndefined();
});
