import { beforeEach, expect, it, mock } from "bun:test";
import {
  allText,
  byText,
  byType,
  installReact,
  resetRender,
  settle,
  type Node,
} from "./space-kit.tsx";

installReact();
// A failed settings reload shows a toast; the real one needs a page.
mock.module("sonner", () => ({ toast: { warning: () => {}, success: () => {}, error: () => {} } }));

const { HostSettings } = await import("../src/lib/components/memory/HostSettings.tsx");
const { Button } = await import("../src/lib/components/ui/button.tsx");
const { Switch } = await import("../src/lib/components/ui/switch.tsx");
const { SettingsConfirmDialog } =
  await import("../src/lib/components/settings/SettingsConfirmDialog.tsx");
const { setLanguage } = await import("../src/lib/i18n/index.ts");

/** The card on its own: the dialog stays an element to drive through its props. */
const own = [HostSettings];
const REFUSED = "Config changed. Reload settings and save again.";

// The file the fake hook saves to, as the real one does through the snapshot.
let file: Record<string, { globalValue?: unknown }>;
let saves: Record<string, unknown>[];
let messages: string[];
let refusal: string | undefined;

const backfill = () =>
  ({
    snapshot: { revision: "rev-1", settings: file, secrets: { memoryApiKey: { set: true } } },
    lists: {
      pi: { available: true, models: [{ provider: "zai", model: "glm-5-turbo", name: "GLM" }] },
    },
    message: "",
    busy: false,
    save: async (edits: Record<string, unknown>) => {
      saves.push(edits);
      if (refusal) return { success: false, error: refusal };
      for (const [key, value] of Object.entries(edits)) {
        if (value === null) delete file[key];
        else file[key] = { globalValue: value };
      }
      return { success: true };
    },
    saveModel: () => {},
    setMessage: (message: string) => void messages.push(message),
  }) as never;

beforeEach(() => {
  resetRender();
  setLanguage("en");
  // A complete external API, so the External API model choice is available.
  file = {
    autoBackfill: { globalValue: true },
    memoryProvider: { globalValue: "openai" },
    memoryModel: { globalValue: "deepseek/deepseek-chat" },
    memoryApiUrl: { globalValue: "https://api.example.com/v1" },
  };
  saves = [];
  messages = [];
  refusal = undefined;
});

const el = () => <HostSettings host="pi" backfill={backfill()} />;
const checkbox = (tree: Node[]) => byType(tree, Switch)[0]!;
const modelSelect = (tree: Node[]) =>
  tree.find((node) => node.props["aria-label"] === "Pi Backfill model")!;
const saveModel = (tree: Node[]) => byText(tree, Button, "Save model")[0]!;
const dialogOf = (tree: Node[]) => byType(tree, SettingsConfirmDialog)[0];
/** What the dialog lists: one row per setting the save changes. */
const rowsOf = (dialog: Node) => dialog.props.body.props.changes as unknown[];

it("asks before it saves a backfill model, and sends nothing until the user confirms", async () => {
  let tree = await settle(el(), own);
  modelSelect(tree).props.onChange({ target: { value: "zai/glm-5-turbo" } });
  tree = await settle(el(), own);
  saveModel(tree).props.onClick();
  tree = await settle(el(), own);

  const dialog = dialogOf(tree)!;
  expect(dialog.props.title).toBe("Save the backfill model?");
  expect(dialog.props.confirmLabel).toBe("Save model");
  expect(rowsOf(dialog)).toEqual([
    {
      key: "piBackfillModel",
      label: "Backfill model",
      from: "Same as live capture",
      to: "zai/glm-5-turbo",
    },
  ]);
  expect(saves).toHaveLength(0);
});

it("keeps the picked model as a draft when the model save is cancelled", async () => {
  let tree = await settle(el(), own);
  modelSelect(tree).props.onChange({ target: { value: "zai/glm-5-turbo" } });
  tree = await settle(el(), own);
  saveModel(tree).props.onClick();
  tree = await settle(el(), own);
  dialogOf(tree)!.props.onClose();
  tree = await settle(el(), own);

  expect(dialogOf(tree)).toBeUndefined();
  expect(saves).toHaveLength(0);
  expect(modelSelect(tree).props.value).toBe("zai/glm-5-turbo");
});

it("sends the same model save as before the rule once the user confirms", async () => {
  let tree = await settle(el(), own);
  modelSelect(tree).props.onChange({ target: { value: "external" } });
  tree = await settle(el(), own);
  saveModel(tree).props.onClick();
  tree = await settle(el(), own);

  expect(await dialogOf(tree)!.props.onConfirm()).toEqual({ success: true });
  expect(saves).toEqual([{ piBackfillModel: "external" }]);
  dialogOf(tree)!.props.onClose();
  tree = await settle(el(), own);
  expect(dialogOf(tree)).toBeUndefined();
  expect(modelSelect(tree).props.value).toBe("external");
});

it("keeps a refused model save inside the dialog, which stays open", async () => {
  refusal = REFUSED;
  let tree = await settle(el(), own);
  modelSelect(tree).props.onChange({ target: { value: "zai/glm-5-turbo" } });
  tree = await settle(el(), own);
  saveModel(tree).props.onClick();
  tree = await settle(el(), own);

  expect(await dialogOf(tree)!.props.onConfirm()).toEqual({ success: false, error: REFUSED });
  tree = await settle(el(), own);
  expect(dialogOf(tree)).toBeDefined();
  expect(saves).toHaveLength(1);
});

it("refuses an empty manual model on the page, and opens no dialog", async () => {
  let tree = await settle(el(), own);
  modelSelect(tree).props.onChange({ target: { value: "typed" } });
  tree = await settle(el(), own);
  saveModel(tree).props.onClick();
  tree = await settle(el(), own);

  expect(dialogOf(tree)).toBeUndefined();
  expect(saves).toHaveLength(0);
  expect(messages).toContain("Enter a model as provider/model.");
});

it("asks before it turns automatic import off, and Cancel leaves the box ticked", async () => {
  let tree = await settle(el(), own);
  expect(checkbox(tree).props.checked).toBe(true);
  checkbox(tree).props.onCheckedChange(false);
  tree = await settle(el(), own);

  const dialog = dialogOf(tree)!;
  expect(dialog.props.title).toBe("Turn automatic import off?");
  expect(dialog.props.confirmLabel).toBe("Turn off");
  expect(rowsOf(dialog)).toEqual([
    { key: "autoBackfill", label: "Import past chats automatically", from: "On", to: "Off" },
  ]);
  // The box shows the cleared state while the dialog asks, and nothing is saved yet.
  expect(checkbox(tree).props.checked).toBe(false);
  expect(saves).toHaveLength(0);

  dialog.props.onClose();
  tree = await settle(el(), own);
  expect(dialogOf(tree)).toBeUndefined();
  expect(saves).toHaveLength(0);
  expect(checkbox(tree).props.checked).toBe(true);
});

it("sends the same autoBackfill false as before the rule once the user confirms", async () => {
  let tree = await settle(el(), own);
  checkbox(tree).props.onCheckedChange(false);
  tree = await settle(el(), own);

  expect(await dialogOf(tree)!.props.onConfirm()).toEqual({ success: true });
  expect(saves).toEqual([{ autoBackfill: false }]);
  dialogOf(tree)!.props.onClose();
  tree = await settle(el(), own);
  expect(checkbox(tree).props.checked).toBe(false);
});

it("shows the file's value again after a save when the file changes", async () => {
  let tree = await settle(el(), own);
  checkbox(tree).props.onCheckedChange(false);
  tree = await settle(el(), own);
  await dialogOf(tree)!.props.onConfirm();
  dialogOf(tree)!.props.onClose();
  tree = await settle(el(), own);
  expect(checkbox(tree).props.checked).toBe(false);

  // Another window, or a hand edit, turns automatic import back on.
  file.autoBackfill = { globalValue: true };
  tree = await settle(el(), own);
  expect(checkbox(tree).props.checked).toBe(true);
});

it("keeps a refused turn-off inside the dialog, and Cancel then re-ticks the box", async () => {
  refusal = REFUSED;
  let tree = await settle(el(), own);
  checkbox(tree).props.onCheckedChange(false);
  tree = await settle(el(), own);

  expect(await dialogOf(tree)!.props.onConfirm()).toEqual({ success: false, error: REFUSED });
  tree = await settle(el(), own);
  expect(dialogOf(tree)).toBeDefined();
  expect(saves).toHaveLength(1);

  dialogOf(tree)!.props.onClose();
  tree = await settle(el(), own);
  expect(checkbox(tree).props.checked).toBe(true);
  expect(allText(tree)).not.toContain("Saved.");
});
