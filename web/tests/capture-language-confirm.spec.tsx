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

const { CaptureLanguageField, CaptureLanguageSection } =
  await import("../src/lib/components/settings/CaptureLanguageSection.tsx");
const { Button } = await import("../src/lib/components/ui/button.tsx");
const { Dialog } = await import("../src/lib/components/ui/dialog.tsx");
const { Select } = await import("../src/lib/components/ui/select.tsx");
const { SettingsConfirmDialog } =
  await import("../src/lib/components/settings/SettingsConfirmDialog.tsx");
const { SettingsChangeList } =
  await import("../src/lib/components/settings/SettingsChangeList.tsx");
const { setLanguage } = await import("../src/lib/i18n/index.ts");
const { publishSettingsSnapshot } = await import("../src/lib/settings-api.ts");

/** The card on its own: the dialog stays an element to drive through its props. */
const card = [CaptureLanguageSection, CaptureLanguageField];
/** The card with its dialog opened up, so its real buttons can be clicked. */
const shown = [...card, SettingsConfirmDialog, SettingsChangeList];
const REFUSED = "Config changed. Reload settings and save again.";
let saved: string;
let refusal: string | undefined;
let requests: Request[];

// The file answers every read with what the last save left, as the real one does.
const reply = (request: Request) => {
  if (request.method === "PATCH") {
    if (refusal) return { status: 409, body: { error: refusal } };
    saved = request.body.edits.autoCaptureLanguage;
  }
  return { body: { revision: "rev-1", settings: { autoCaptureLanguage: { value: saved } } } };
};
beforeEach(() => {
  resetRender();
  setLanguage("en");
  saved = "auto";
  refusal = undefined;
  requests = installFetch(reply);
});

const picker = (tree: Node[]) => byType(tree, Select)[0]!;
const choose = (tree: Node[], code: string) =>
  (picker(tree).props.onChange as (event: unknown) => void)({ target: { value: code } });
const dialogOf = (tree: Node[]) => byType(tree, SettingsConfirmDialog)[0];
/** What the dialog lists: one row per setting the save changes. */
const rowsOf = (dialog: Node) => dialog.props.body.props.changes as unknown[];
const saves = () => requests.filter((request) => request.method === "PATCH");
const shownCard = (own: readonly unknown[]) => settle(<CaptureLanguageSection />, own);

it("asks before it saves a new language, and sends nothing until the user confirms", async () => {
  let tree = await shownCard(card);
  expect(picker(tree).props.value).toBe("auto");
  choose(tree, "fr");
  tree = await shownCard(card);

  const dialog = dialogOf(tree)!;
  expect(dialog.props.title).toBe("Change the summary language?");
  expect(dialog.props.confirmLabel).toBe("Save");
  expect(rowsOf(dialog)).toEqual([
    { key: "autoCaptureLanguage", label: "Summary language", from: "Automatic", to: "Français" },
  ]);
  expect(saves()).toHaveLength(0);
  // The picker shows the picked language while the dialog asks.
  expect(picker(tree).props.value).toBe("fr");
});

it("sends nothing on Cancel, and the picker shows the saved language again", async () => {
  let tree = await shownCard(card);
  choose(tree, "fr");
  tree = await shownCard(card);
  dialogOf(tree)!.props.onClose();
  tree = await shownCard(card);

  expect(dialogOf(tree)).toBeUndefined();
  expect(saves()).toHaveLength(0);
  expect(picker(tree).props.value).toBe("auto");
  expect(allText(tree)).not.toContain("Saved.");
});

it("puts the saved language back from the Cancel button, from Escape and from the close button", async () => {
  let tree = await shownCard(shown);
  choose(tree, "de");
  tree = await shownCard(shown);
  expect(allText(tree)).toContain("Change the summary language?");
  expect(allText(tree)).toContain("changes to");
  byText(tree, Button, "Cancel")[0]!.props.onClick();
  tree = await shownCard(shown);
  expect(byType(tree, Dialog)).toHaveLength(0);
  expect(picker(tree).props.value).toBe("auto");

  // Escape and the close button both reach the dialog as a request to close it.
  choose(tree, "de");
  tree = await shownCard(shown);
  byType(tree, Dialog)[0]!.props.onOpenChange(false);
  tree = await shownCard(shown);
  expect(byType(tree, Dialog)).toHaveLength(0);
  expect(picker(tree).props.value).toBe("auto");
  expect(saves()).toHaveLength(0);
});

it("sends the same request as before the rule once the user confirms", async () => {
  let tree = await shownCard(card);
  choose(tree, "fr");
  tree = await shownCard(card);

  expect(await dialogOf(tree)!.props.onConfirm()).toEqual({ success: true });
  expect(saves()).toHaveLength(1);
  expect(saves()[0]!.body).toEqual({
    edits: { autoCaptureLanguage: "fr" },
    revision: "rev-1",
  });
  // The dialog itself closes once the request succeeds.
  dialogOf(tree)!.props.onClose();
  tree = await shownCard(card);
  expect(dialogOf(tree)).toBeUndefined();
  expect(picker(tree).props.value).toBe("fr");
  expect(allText(tree)).toContain("Saved. New memories use this language.");
});

it("shows the saved language again when the file changes after a save", async () => {
  let tree = await shownCard(card);
  choose(tree, "fr");
  tree = await shownCard(card);
  await dialogOf(tree)!.props.onConfirm();
  dialogOf(tree)!.props.onClose();
  await shownCard(card);

  // Another window, or a hand edit, changes the file.
  publishSettingsSnapshot({
    revision: "rev-2",
    settings: { autoCaptureLanguage: { value: "de" } },
  });
  tree = await shownCard(card);
  expect(picker(tree).props.value).toBe("de");
});

it("keeps a server refusal inside the dialog, which stays open until the user decides", async () => {
  refusal = REFUSED;
  let tree = await shownCard(card);
  choose(tree, "fr");
  tree = await shownCard(card);
  const dialog = dialogOf(tree)!;

  expect(await dialog.props.onConfirm()).toEqual({ success: false, error: REFUSED });
  tree = await shownCard(card);
  expect(dialogOf(tree)).toBeDefined();
  expect(saves()).toHaveLength(1);
  // The reason sits in the dialog, which stays open, and on the card.
  expect(allText(tree)).toContain(REFUSED);
  expect(allText(tree)).not.toContain("Saved.");

  dialogOf(tree)!.props.onClose();
  tree = await shownCard(card);
  expect(picker(tree).props.value).toBe("auto");
});
