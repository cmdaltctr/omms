import { beforeEach, expect, it } from "bun:test";
import {
  allText,
  byText,
  byType,
  installFetch,
  installReact,
  resetRender,
  settle,
  type Node,
  type Request,
} from "./space-kit.tsx";

installReact();

const { ClaudeFolderSection } =
  await import("../src/lib/components/settings/ClaudeFolderSection.tsx");
const { SettingRow } = await import("../src/lib/components/settings/SettingRow.tsx");
const { Button } = await import("../src/lib/components/ui/button.tsx");
const { Input } = await import("../src/lib/components/ui/input.tsx");
const { SettingsConfirmDialog } =
  await import("../src/lib/components/settings/SettingsConfirmDialog.tsx");
const { setLanguage } = await import("../src/lib/i18n/index.ts");

const own = [ClaudeFolderSection, SettingRow];
const REFUSED = "Config changed. Reload settings and save again.";

/** The folder saved in the file; every read answers with what the last save left. */
let folder: string | undefined;
let refusal: string | undefined;
let requests: Request[];

const reply = (request: Request) => {
  if (request.method === "PATCH") {
    if (refusal) return { status: 409, body: { error: refusal } };
    folder = request.body.edits.claudeConfigDir;
  }
  return {
    body: {
      revision: "r1",
      settings: { claudeConfigDir: { globalValue: folder } },
      claudeFolder: { root: folder ?? "/home/me/.claude", source: "default", exists: true },
    },
  };
};

beforeEach(() => {
  resetRender();
  setLanguage("en");
  folder = undefined;
  refusal = undefined;
  requests = installFetch(reply);
});

const field = (tree: Node[]) => byType(tree, Input)[0]!;
const buttonOf = (tree: Node[], label: string) =>
  byText(tree, Button, label).find((node) => !node.props.disabled)!;
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

it("lists the typed folder and sends nothing until the user confirms", async () => {
  let tree = await settle(<ClaudeFolderSection />, own);
  field(tree).props.onChange({ target: { value: "/data/claude" } });
  tree = await settle(<ClaudeFolderSection />, own);
  buttonOf(tree, "Save folder").props.onClick();
  tree = await settle(<ClaudeFolderSection />, own);

  const dialog = dialogOf(tree)!;
  expect(dialog.props.title).toBe("Save the Claude Code folder?");
  expect(dialog.props.confirmLabel).toBe("Save folder");
  expect(rowsOf(dialog)).toEqual([
    {
      key: "claudeConfigDir",
      label: "Claude Code folder",
      from: "The usual Claude folder",
      to: "/data/claude",
    },
  ]);
  expect(patches()).toHaveLength(0);
});

it("saves with no dialog when the folder did not change, as it did before it asked first", async () => {
  folder = "/data/claude";
  let tree = await settle(<ClaudeFolderSection />, own);
  expect(field(tree).props.value).toBe("/data/claude");
  buttonOf(tree, "Save folder").props.onClick();
  tree = await settle(<ClaudeFolderSection />, own);

  // Save stays on for an unchanged folder, and the dialog has nothing to list for it.
  expect(dialogOf(tree)).toBeUndefined();
  expect(patches()).toHaveLength(1);
  expect(patches()[0]!.body).toEqual({
    edits: { claudeConfigDir: "/data/claude" },
    revision: "r1",
  });
});

it("sends nothing on Cancel and the typed folder stays in the box", async () => {
  let tree = await settle(<ClaudeFolderSection />, own);
  field(tree).props.onChange({ target: { value: "/data/claude" } });
  tree = await settle(<ClaudeFolderSection />, own);
  buttonOf(tree, "Save folder").props.onClick();
  tree = await settle(<ClaudeFolderSection />, own);
  dialogOf(tree)!.props.onClose();
  tree = await settle(<ClaudeFolderSection />, own);

  expect(dialogOf(tree)).toBeUndefined();
  expect(patches()).toHaveLength(0);
  expect(allText(tree)).not.toContain("Saved.");
  // The typed folder stays as a draft, so Save folder can be used again.
  expect(field(tree).props.value).toBe("/data/claude");
  buttonOf(tree, "Save folder").props.onClick();
  tree = await settle(<ClaudeFolderSection />, own);
  await confirm(tree);
  tree = await settle(<ClaudeFolderSection />, own);
  expect(patches()).toHaveLength(1);
  expect(patches()[0]!.body).toEqual({
    revision: "r1",
    edits: { claudeConfigDir: "/data/claude" },
  });
  expect(allText(tree)).toContain("Saved. Capture and import use this folder now.");
});

it("shows the path rule on the page and opens no dialog", async () => {
  let tree = await settle(<ClaudeFolderSection />, own);
  field(tree).props.onChange({ target: { value: "claude" } });
  tree = await settle(<ClaudeFolderSection />, own);
  buttonOf(tree, "Save folder").props.onClick();
  tree = await settle(<ClaudeFolderSection />, own);

  expect(dialogOf(tree)).toBeUndefined();
  expect(patches()).toHaveLength(0);
  expect(allText(tree)).toContain("Enter a full path, or a path that starts with ~/");
});

it("lists the usual folder when the box is emptied", async () => {
  folder = "/data/claude";
  let tree = await settle(<ClaudeFolderSection />, own);
  field(tree).props.onChange({ target: { value: "" } });
  tree = await settle(<ClaudeFolderSection />, own);
  buttonOf(tree, "Save folder").props.onClick();
  tree = await settle(<ClaudeFolderSection />, own);

  expect(rowsOf(dialogOf(tree)!)).toEqual([
    {
      key: "claudeConfigDir",
      label: "Claude Code folder",
      from: "/data/claude",
      to: "The usual Claude folder",
    },
  ]);
});

it("keeps a server refusal inside the dialog, which stays open until the user decides", async () => {
  refusal = REFUSED;
  let tree = await settle(<ClaudeFolderSection />, own);
  field(tree).props.onChange({ target: { value: "/data/claude" } });
  tree = await settle(<ClaudeFolderSection />, own);
  buttonOf(tree, "Save folder").props.onClick();
  tree = await settle(<ClaudeFolderSection />, own);

  expect(await dialogOf(tree)!.props.onConfirm()).toMatchObject({ success: false, error: REFUSED });
  tree = await settle(<ClaudeFolderSection />, own);
  expect(dialogOf(tree)).toBeDefined();
  expect(patches()).toHaveLength(1);
  // The reason sits in the dialog, which stays open, and on the card.
  expect(allText(tree)).toContain(REFUSED);
  expect(allText(tree)).not.toContain("Saved. Capture and import use this folder now.");

  dialogOf(tree)!.props.onClose();
  tree = await settle(<ClaudeFolderSection />, own);
  expect(dialogOf(tree)).toBeUndefined();
});
