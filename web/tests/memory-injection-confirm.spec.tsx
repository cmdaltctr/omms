import { beforeEach, expect, it, mock } from "bun:test";
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
// A failed settings reload shows a toast; the real one needs a page.
mock.module("sonner", () => ({ toast: { warning: () => {}, success: () => {}, error: () => {} } }));

const { MemoryInjectionSection } =
  await import("../src/lib/components/memory/MemoryInjectionSection.tsx");
const { Button } = await import("../src/lib/components/ui/button.tsx");
const { SettingsConfirmDialog } =
  await import("../src/lib/components/settings/SettingsConfirmDialog.tsx");
const { setLanguage } = await import("../src/lib/i18n/index.ts");

/** The card on its own: the dialog stays an element to drive through its props. */
const own = [MemoryInjectionSection];
const DEFAULT_QUERY = "project architecture, setup, conventions and key decisions";
const REFUSED = "Config changed. Reload settings and save again.";

// The file answers every read with what the last save left, as the real one does.
let saved: Record<string, unknown>;
let refusal: string | undefined;
let requests: Request[];
const reply = (request: Request) => {
  if (request.method === "PATCH") {
    if (refusal) return { status: 409, body: { error: refusal } };
    for (const [key, value] of Object.entries(request.body.edits as Record<string, unknown>)) {
      if (value === null) delete saved[key];
      else saved[key] = value;
    }
  }
  return {
    body: {
      revision: "rev-1",
      settings: Object.fromEntries(
        Object.entries(saved).map(([key, value]) => [key, { globalValue: value }])
      ),
    },
  };
};
beforeEach(() => {
  resetRender();
  setLanguage("en");
  // A custom file, so both a save and a reset to default have keys to change.
  saved = {
    openingContext: true,
    openingContextQuery: "release notes",
    subagentMemory: false,
    "compaction.enabled": false,
    "compaction.memoryLimit": 25,
  };
  refusal = undefined;
  requests = installFetch(reply);
});

const el = () => <MemoryInjectionSection />;
const opening = (tree: Node[]) => tree.find((node) => node.props.id === "injection-opening")!;
const query = (tree: Node[]) => tree.find((node) => node.props.id === "injection-query")!;
const limit = (tree: Node[]) => tree.find((node) => node.props.id === "injection-limit")!;
const save = (tree: Node[]) => byText(tree, Button, "Save")[0]!;
/** Save is the form's submit button: submit the form, as the browser does on a click. */
const submit = (tree: Node[]) =>
  tree.find((node) => node.type === "form")!.props.onSubmit({ preventDefault: () => {} });
const reset = (tree: Node[]) => byText(tree, Button, "Reset to default")[0]!;
const dialogOf = (tree: Node[]) => byType(tree, SettingsConfirmDialog)[0];
/** What the dialog lists: one row per setting the save changes. */
const rowsOf = (dialog: Node) => dialog.props.body.props.changes as unknown[];
const patches = () => requests.filter((request) => request.method === "PATCH");

it("asks before it saves, listing each setting with its old and new value", async () => {
  let tree = await settle(el(), own);
  opening(tree).props.onCheckedChange(false);
  query(tree).props.onChange({ target: { value: "setup guide" } });
  limit(tree).props.onChange({ target: { value: "20" } });
  tree = await settle(el(), own);
  submit(tree);
  tree = await settle(el(), own);

  const dialog = dialogOf(tree)!;
  expect(dialog.props.title).toBe("Save memory injection?");
  expect(dialog.props.confirmLabel).toBe("Save");
  expect(rowsOf(dialog)).toEqual([
    // Off is the default, so the save removes the key and the row says so.
    {
      key: "openingContext",
      label: "Add memories to the first message",
      from: "On",
      to: "Default (Off)",
    },
    {
      key: "openingContextQuery",
      label: "Opening search text",
      from: "release notes",
      to: "setup guide",
    },
    {
      key: "compaction.memoryLimit",
      label: "Memories added back after a summary",
      from: "25",
      to: "20",
    },
  ]);
  expect(patches()).toHaveLength(0);
});

it("keeps what the user typed as a draft when the save is cancelled", async () => {
  let tree = await settle(el(), own);
  opening(tree).props.onCheckedChange(false);
  query(tree).props.onChange({ target: { value: "setup guide" } });
  tree = await settle(el(), own);
  submit(tree);
  tree = await settle(el(), own);
  dialogOf(tree)!.props.onClose();
  tree = await settle(el(), own);

  expect(dialogOf(tree)).toBeUndefined();
  expect(patches()).toHaveLength(0);
  expect(opening(tree).props.checked).toBe(false);
  expect(query(tree).props.value).toBe("setup guide");
});

it("sends the same request as before the rule once the user confirms", async () => {
  let tree = await settle(el(), own);
  opening(tree).props.onCheckedChange(false);
  query(tree).props.onChange({ target: { value: "setup guide" } });
  limit(tree).props.onChange({ target: { value: "20" } });
  tree = await settle(el(), own);
  submit(tree);
  tree = await settle(el(), own);

  expect(await dialogOf(tree)!.props.onConfirm()).toEqual({ success: true });
  expect(patches()).toHaveLength(1);
  expect(patches()[0]!.body).toEqual({
    // Returning to a default removes the key, exactly as before the rule.
    edits: {
      openingContext: null,
      openingContextQuery: "setup guide",
      "compaction.memoryLimit": 20,
    },
    revision: "rev-1",
  });
  dialogOf(tree)!.props.onClose();
  tree = await settle(el(), own);
  expect(dialogOf(tree)).toBeUndefined();
  expect(allText(tree)).toContain("Saved. The next session uses these options.");
});

it("opens no dialog for Reset to default, and the Save after it lists the removed keys", async () => {
  let tree = await settle(el(), own);
  reset(tree).props.onClick();
  tree = await settle(el(), own);
  expect(dialogOf(tree)).toBeUndefined();
  expect(patches()).toHaveLength(0);

  submit(tree);
  tree = await settle(el(), own);
  const dialog = dialogOf(tree)!;
  expect(rowsOf(dialog)).toEqual([
    {
      key: "openingContext",
      label: "Add memories to the first message",
      from: "On",
      to: "Default (Off)",
    },
    {
      key: "openingContextQuery",
      label: "Opening search text",
      from: "release notes",
      to: `Default (${DEFAULT_QUERY})`,
    },
    { key: "subagentMemory", label: "Give subagents memories", from: "Off", to: "Default (On)" },
    {
      key: "compaction.enabled",
      label: "Add memories back after a summary",
      from: "Off",
      to: "Default (On)",
    },
    {
      key: "compaction.memoryLimit",
      label: "Memories added back after a summary",
      from: "25",
      to: "Default (10)",
    },
  ]);

  expect(await dialog.props.onConfirm()).toEqual({ success: true });
  expect(patches()[0]!.body.edits).toEqual({
    openingContext: null,
    openingContextQuery: null,
    subagentMemory: null,
    "compaction.enabled": null,
    "compaction.memoryLimit": null,
  });
});

it("keeps a server refusal inside the dialog, which stays open", async () => {
  refusal = REFUSED;
  let tree = await settle(el(), own);
  query(tree).props.onChange({ target: { value: "setup guide" } });
  tree = await settle(el(), own);
  submit(tree);
  tree = await settle(el(), own);

  expect(await dialogOf(tree)!.props.onConfirm()).toEqual({ success: false, error: REFUSED });
  tree = await settle(el(), own);
  expect(dialogOf(tree)).toBeDefined();
  expect(patches()).toHaveLength(1);
  // The draft stays, so the user can save again.
  expect(query(tree).props.value).toBe("setup guide");
});

it("shows the page's own message for an invalid limit, and opens no dialog", async () => {
  let tree = await settle(el(), own);
  limit(tree).props.onChange({ target: { value: "0" } });
  tree = await settle(el(), own);

  expect(save(tree).props.disabled).toBe(true);
  expect(allText(tree)).toContain("Enter a positive whole number.");
  expect(dialogOf(tree)).toBeUndefined();
  expect(patches()).toHaveLength(0);
});
