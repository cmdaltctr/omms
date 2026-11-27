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

const { ModelsSection, ModelCard } =
  await import("../src/lib/components/settings/ModelsSection.tsx");
const { SettingRow } = await import("../src/lib/components/settings/SettingRow.tsx");
const { Button } = await import("../src/lib/components/ui/button.tsx");
const { Input } = await import("../src/lib/components/ui/input.tsx");
const { Select } = await import("../src/lib/components/ui/select.tsx");
const { SettingsConfirmDialog } =
  await import("../src/lib/components/settings/SettingsConfirmDialog.tsx");
const { setLanguage } = await import("../src/lib/i18n/index.ts");

const own = [ModelsSection, ModelCard, SettingRow];
const REFUSED = "Config changed. Reload settings and save again.";

/** What the file holds for OpenCode's model choice; reads answer with what the last save left. */
let opencodeModel: string | undefined;
let refusal: string | undefined;
let requests: Request[];

const reply = (request: Request) => {
  if (request.method === "PATCH") {
    if (refusal) return { status: 409, body: { error: refusal } };
    const edits = request.body.edits as Record<string, string>;
    if ("opencodeModel" in edits) opencodeModel = edits.opencodeModel;
  }
  if (request.path.startsWith("/api/settings/models")) return { body: { available: false } };
  return {
    body: {
      revision: "r1",
      settings: {
        opencodeModel: { value: opencodeModel, globalValue: opencodeModel, source: "global" },
        piModel: { value: "inherit", globalValue: "inherit", source: "global" },
      },
      fallback: { model: null, configured: false },
      effective: { opencode: { mode: "session", ready: true }, pi: { kind: "session" } },
      secrets: {},
    },
  };
};

beforeEach(() => {
  resetRender();
  setLanguage("en");
  opencodeModel = "inherit";
  refusal = undefined;
  requests = installFetch(reply);
});

/** OpenCode's choice select: the first Select in the card. */
const choice = (tree: Node[]) => byType(tree, Select)[0]!;
const manualInput = (tree: Node[]) => byType(tree, Input)[0]!;
const saveModel = (tree: Node[]) => byText(tree, Button, "Save model")[0]!;
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

it("names the host, lists the model change and sends nothing until the user confirms", async () => {
  let tree = await settle(<ModelsSection />, own);
  choice(tree).props.onChange({ target: { value: "external" } });
  tree = await settle(<ModelsSection />, own);
  saveModel(tree).props.onClick();
  tree = await settle(<ModelsSection />, own);

  const dialog = dialogOf(tree)!;
  expect(dialog.props.title).toBe("Save the OpenCode model?");
  expect(dialog.props.confirmLabel).toBe("Save model");
  expect(rowsOf(dialog)).toEqual([
    { key: "opencodeModel", label: "OpenCode model", from: "Session model", to: "External API" },
  ]);
  expect(patches()).toHaveLength(0);
});

it("opens the dialog with an empty change list when the choice did not change, and saves only on confirm", async () => {
  let tree = await settle(<ModelsSection />, own);
  expect(choice(tree).props.value).toBe("inherit");
  saveModel(tree).props.onClick();
  tree = await settle(<ModelsSection />, own);

  // Save stays on for an unchanged choice. The dialog opens with nothing to list.
  expect(dialogOf(tree)).toBeDefined();
  expect(rowsOf(dialogOf(tree)!)).toEqual([]);
  expect(patches()).toHaveLength(0);

  await confirm(tree);
  expect(patches()).toHaveLength(1);
  expect(patches()[0]!.body).toEqual({ edits: { opencodeModel: "inherit" }, revision: "r1" });
});

it("lists both settings of a manual model and sends the same body after Cancel kept the draft", async () => {
  let tree = await settle(<ModelsSection />, own);
  choice(tree).props.onChange({ target: { value: "manual" } });
  tree = await settle(<ModelsSection />, own);
  manualInput(tree).props.onChange({ target: { value: "zai/glm-4.7" } });
  tree = await settle(<ModelsSection />, own);
  saveModel(tree).props.onClick();
  tree = await settle(<ModelsSection />, own);

  expect(rowsOf(dialogOf(tree)!)).toEqual([
    { key: "opencodeProvider", label: "OpenCode model service", from: "Not set", to: "zai" },
    { key: "opencodeModel", label: "OpenCode model", from: "Session model", to: "glm-4.7" },
  ]);
  dialogOf(tree)!.props.onClose();
  tree = await settle(<ModelsSection />, own);

  // Cancel sends nothing; the typed model stays, so Save model can be used again.
  expect(patches()).toHaveLength(0);
  expect(manualInput(tree).props.value).toBe("zai/glm-4.7");
  saveModel(tree).props.onClick();
  tree = await settle(<ModelsSection />, own);
  await confirm(tree);
  tree = await settle(<ModelsSection />, own);
  expect(patches()).toHaveLength(1);
  expect(patches()[0]!.body).toEqual({
    revision: "r1",
    edits: { opencodeProvider: "zai", opencodeModel: "glm-4.7" },
  });
  expect(allText(tree)).toContain("Saved. New capture and profile work uses these settings.");
});

it("shows the provider/model rule on the page and opens no dialog", async () => {
  let tree = await settle(<ModelsSection />, own);
  choice(tree).props.onChange({ target: { value: "manual" } });
  tree = await settle(<ModelsSection />, own);
  manualInput(tree).props.onChange({ target: { value: "glm-4.7" } });
  tree = await settle(<ModelsSection />, own);
  saveModel(tree).props.onClick();
  tree = await settle(<ModelsSection />, own);

  expect(dialogOf(tree)).toBeUndefined();
  expect(patches()).toHaveLength(0);
  expect(allText(tree)).toContain("Enter a model as provider/model.");
});

it("keeps a server refusal inside the dialog, which stays open until the user decides", async () => {
  refusal = REFUSED;
  let tree = await settle(<ModelsSection />, own);
  choice(tree).props.onChange({ target: { value: "external" } });
  tree = await settle(<ModelsSection />, own);
  saveModel(tree).props.onClick();
  tree = await settle(<ModelsSection />, own);

  expect(await dialogOf(tree)!.props.onConfirm()).toMatchObject({ success: false, error: REFUSED });
  tree = await settle(<ModelsSection />, own);
  expect(dialogOf(tree)).toBeDefined();
  expect(patches()).toHaveLength(1);
  // The reason sits in the dialog, which stays open, and on the card.
  expect(allText(tree)).toContain(REFUSED);
  expect(allText(tree)).not.toContain("Saved.");

  dialogOf(tree)!.props.onClose();
  tree = await settle(<ModelsSection />, own);
  expect(dialogOf(tree)).toBeUndefined();
});
