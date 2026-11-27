import { beforeEach, expect, it } from "bun:test";
import {
  allText,
  byText,
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

const { DirectoryMapsSection } =
  await import("../src/lib/components/memory/DirectoryMapsSection.tsx");
const { DirectoryMapIgnoredList } =
  await import("../src/lib/components/memory/DirectoryMapIgnoredList.tsx");
const { DirectoryMapHost } = await import("../src/lib/components/settings/DirectoryMapHost.tsx");
const { Button } = await import("../src/lib/components/ui/button.tsx");
const { SettingsConfirmDialog } =
  await import("../src/lib/components/settings/SettingsConfirmDialog.tsx");
const { setLanguage } = await import("../src/lib/i18n/index.ts");

const own = [DirectoryMapsSection, DirectoryMapIgnoredList, DirectoryMapHost];
const REFUSED = "Config changed. Reload settings and save again.";

type PathMap = { from: string; to: string };
const savedMaps: PathMap[] = [
  { from: "/saved-a", to: "/keep" },
  { from: "/saved-b", to: "/keep" },
];

// What the server holds; a real save replaces it, as the refreshed list then shows.
let serverSaved: PathMap[];
let serverIgnored: string[];
let refusal: { status: number; error: string } | undefined;
let requests: Request[];

const serve = () =>
  (requests = installFetch((request) => {
    if (request.method === "PATCH") {
      if (refusal) return { status: refusal.status, body: { error: refusal.error } };
      serverSaved = request.body.edits.importPathMaps ?? serverSaved;
      serverIgnored = request.body.edits.importIgnoredDirectories ?? serverIgnored;
      return { body: { ok: true } };
    }
    if (request.path === "/api/settings") return { body: { revision: "r1", settings: {} } };
    return {
      body: {
        saved: serverSaved,
        ignored: serverIgnored,
        pi: [{ directory: "/pi-missing", sessions: 2, suggestion: null }],
        opencode: [],
        "claude-code": [],
      },
    };
  }));

const shown = () => settle(<DirectoryMapsSection />, own);
const dialogOf = (tree: Node[]) => byType(tree, SettingsConfirmDialog)[0];
/** What the dialog lists: one row per setting the save changes. */
const rowsOf = (dialog: Node) => dialog.props.body.props.changes as unknown[];
const patches = () => requests.filter((request) => request.method === "PATCH");
const button = (tree: Node[], label: string) => byText(tree, Button, label)[0]!;
/** The raw page buttons, such as Remove and Keep, are plain elements in the tree. */
const rawButton = (tree: Node[], label: string) =>
  byType(tree, "button").find((node) => text(node.props.children).trim() === label)!;
/** Confirm the open dialog, then let it close as it does when the request succeeds. */
async function confirm(tree: Node[]) {
  const dialog = dialogOf(tree)!;
  const result = await dialog.props.onConfirm();
  dialog.props.onClose();
  return result;
}

beforeEach(() => {
  resetRender();
  setLanguage("en");
  serverSaved = [...savedMaps];
  serverIgnored = ["/old/ignored"];
  refusal = undefined;
  serve();
});

it("asks before Save removals, with how many maps remain, and sends nothing first", async () => {
  let tree = await shown();
  rawButton(tree, "Remove").props.onClick();
  tree = await shown();
  button(tree, "Save removals").props.onClick();
  tree = await shown();

  const dialog = dialogOf(tree)!;
  expect(dialog.props.title).toBe("Save removals?");
  expect(dialog.props.confirmLabel).toBe("Save removals");
  expect(rowsOf(dialog)).toEqual([
    { key: "importPathMaps", label: "Folder maps", from: "2 maps", to: "1 map" },
  ]);
  expect(patches()).toHaveLength(0);
});

it("sends nothing on a cancelled Save removals, and keeps the removal as a draft", async () => {
  let tree = await shown();
  rawButton(tree, "Remove").props.onClick();
  tree = await shown();
  button(tree, "Save removals").props.onClick();
  tree = await shown();
  dialogOf(tree)!.props.onClose();
  tree = await shown();

  expect(dialogOf(tree)).toBeUndefined();
  expect(patches()).toHaveLength(0);
  // The struck-through removal stays, so Save removals can be used again.
  expect(rawButton(tree, "Keep")).toBeDefined();

  button(tree, "Save removals").props.onClick();
  tree = await shown();
  const result = await confirm(tree);
  expect(result).toEqual({ success: true });
  tree = await shown();
  expect(patches()).toHaveLength(1);
  expect(patches()[0]!.body).toEqual({
    revision: "r1",
    edits: { importPathMaps: [{ from: "/saved-b", to: "/keep" }] },
  });
  expect(allText(tree)).toContain(
    "Saved. Removed maps stop applying at the next import or backfill run."
  );
});

it("keeps a conflicting Save removals in the dialog, with the reason on the card", async () => {
  refusal = { status: 409, error: REFUSED };
  let tree = await shown();
  rawButton(tree, "Remove").props.onClick();
  tree = await shown();
  button(tree, "Save removals").props.onClick();
  tree = await shown();

  const result = await dialogOf(tree)!.props.onConfirm();
  expect(result).toEqual({
    success: false,
    error: "Settings changed elsewhere. Check the list and try again.",
  });
  tree = await shown();
  expect(dialogOf(tree)).toBeDefined();
  expect(patches()).toHaveLength(1);
  expect(allText(tree)).not.toContain("Saved. Removed maps");
});

it("asks before Ignore, naming the folder, and sends the same save on confirm", async () => {
  let tree = await shown();
  button(tree, "Ignore").props.onClick();
  tree = await shown();

  const dialog = dialogOf(tree)!;
  expect(dialog.props.title).toBe("Ignore this folder?");
  expect(dialog.props.confirmLabel).toBe("Ignore");
  expect(text(dialog.props.body)).toContain("/pi-missing");
  expect(text(dialog.props.body)).toContain(
    "The folder stays unimported and leaves the unresolved counts."
  );
  expect(patches()).toHaveLength(0);

  const result = await confirm(tree);
  expect(result).toEqual({ success: true });
  tree = await shown();
  expect(patches()).toHaveLength(1);
  expect(patches()[0]!.body).toEqual({
    revision: "r1",
    edits: { importIgnoredDirectories: ["/old/ignored", "/pi-missing"] },
  });
  expect(allText(tree)).toContain("Ignored. The directory stays unimported.");
});

it("sends nothing when the user cancels an Ignore, and the row stays", async () => {
  let tree = await shown();
  button(tree, "Ignore").props.onClick();
  tree = await shown();
  dialogOf(tree)!.props.onClose();
  tree = await shown();

  expect(dialogOf(tree)).toBeUndefined();
  expect(patches()).toHaveLength(0);
  expect(button(tree, "Ignore")).toBeDefined();
});

it("keeps a failed Ignore in the dialog, with the card's reason", async () => {
  refusal = { status: 400, error: "Target unavailable" };
  let tree = await shown();
  button(tree, "Ignore").props.onClick();
  tree = await shown();

  const result = await dialogOf(tree)!.props.onConfirm();
  expect(result).toEqual({
    success: false,
    error: "The directory could not be ignored. Try again.",
  });
  tree = await shown();
  expect(dialogOf(tree)).toBeDefined();
  expect(patches()).toHaveLength(1);
  // The row stays unignored, so the user can confirm again.
  expect(button(tree, "Ignore")).toBeDefined();
});

it("asks before Restore, naming the folder, which stays ignored until confirmed", async () => {
  let tree = await shown();
  button(tree, "Restore").props.onClick();
  tree = await shown();

  const dialog = dialogOf(tree)!;
  expect(dialog.props.title).toBe("Restore this folder?");
  expect(dialog.props.confirmLabel).toBe("Restore");
  expect(text(dialog.props.body)).toContain("/old/ignored");
  expect(text(dialog.props.body)).toContain(
    "The folder shows again in each host list that reported it."
  );
  expect(patches()).toHaveLength(0);
  // Still ignored: the list keeps the folder while the dialog asks.
  expect(button(tree, "Restore")).toBeDefined();

  const result = await confirm(tree);
  expect(result).toEqual({ success: true });
  tree = await shown();
  expect(patches()).toHaveLength(1);
  expect(patches()[0]!.body).toEqual({ revision: "r1", edits: { importIgnoredDirectories: [] } });
  expect(allText(tree)).toContain(
    "Restored. The directory shows again in each host list that reported it."
  );
});

it("sends nothing when the user cancels a Restore, and the folder stays ignored", async () => {
  let tree = await shown();
  button(tree, "Restore").props.onClick();
  tree = await shown();
  dialogOf(tree)!.props.onClose();
  tree = await shown();

  expect(dialogOf(tree)).toBeUndefined();
  expect(patches()).toHaveLength(0);
  expect(button(tree, "Restore")).toBeDefined();
});

it("keeps a conflicting Restore in the dialog, with the reason on the card", async () => {
  refusal = { status: 409, error: REFUSED };
  let tree = await shown();
  button(tree, "Restore").props.onClick();
  tree = await shown();

  const result = await dialogOf(tree)!.props.onConfirm();
  expect(result).toEqual({
    success: false,
    error: "Settings changed elsewhere. Check the list and try again.",
  });
  tree = await shown();
  expect(dialogOf(tree)).toBeDefined();
  expect(patches()).toHaveLength(1);
  expect(allText(tree)).not.toContain("Restored. The directory shows again");
});
