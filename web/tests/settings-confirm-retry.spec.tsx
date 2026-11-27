import { beforeEach, expect, it } from "bun:test";
import { byType, installReact, resetRender, settle, type Node } from "./space-kit.tsx";

installReact();

const { useSettingsConfirm } = await import("../src/hooks/useSettingsConfirm.tsx");
const { SettingsConfirmDialog } =
  await import("../src/lib/components/settings/SettingsConfirmDialog.tsx");
const { setLanguage } = await import("../src/lib/i18n/index.ts");

const STALE = "Close this dialog and save again, so it shows the current settings.";
type Result = { success: boolean; error?: string };

let ask: ReturnType<typeof useSettingsConfirm>["ask"];
/** A card with nothing but the shared confirm: the spec asks through `ask`. */
function Card() {
  const confirm = useSettingsConfirm();
  ask = confirm.ask;
  return <div>{confirm.dialog}</div>;
}
const own = [Card];
const el = () => <Card />;
const dialogOf = (tree: Node[]) => byType(tree, SettingsConfirmDialog)[0];

beforeEach(() => {
  resetRender();
  setLanguage("en");
});

function request(run: () => Promise<Result>) {
  return { title: "Save?", body: "Body", confirmLabel: "Save", run };
}

it("turns confirm off after a failed run, so a retry cannot resend the values from the click", async () => {
  let runs = 0;
  await settle(el(), own);
  ask(request(async () => (runs++, { success: false, error: "Config changed." })));
  let tree = await settle(el(), own);
  expect(dialogOf(tree)!.props.blocked).toBeUndefined();

  expect(await dialogOf(tree)!.props.onConfirm()).toEqual({
    success: false,
    error: "Config changed.",
  });
  tree = await settle(el(), own);
  expect(dialogOf(tree)!.props.blocked).toBe(STALE);
  expect(runs).toBe(1);
});

it("starts the next question with confirm on again", async () => {
  await settle(el(), own);
  ask(request(async () => ({ success: false, error: "No." })));
  let tree = await settle(el(), own);
  await dialogOf(tree)!.props.onConfirm();
  tree = await settle(el(), own);
  dialogOf(tree)!.props.onClose();
  tree = await settle(el(), own);
  expect(dialogOf(tree)).toBeUndefined();

  ask(request(async () => ({ success: true })));
  tree = await settle(el(), own);
  expect(dialogOf(tree)!.props.blocked).toBeUndefined();
});

it("does not block a follow-up question that the run asked", async () => {
  await settle(el(), own);
  ask(
    request(async () => {
      // As the External API card does when the key-file dialog takes over the click.
      ask({ ...request(async () => ({ success: true })), title: "Replace the key file?" });
      return { success: false, error: "" };
    })
  );
  let tree = await settle(el(), own);
  await dialogOf(tree)!.props.onConfirm();
  tree = await settle(el(), own);
  expect(dialogOf(tree)!.props.title).toBe("Replace the key file?");
  expect(dialogOf(tree)!.props.blocked).toBeUndefined();
});

it("keeps the card's own blocked reason when nothing has failed", async () => {
  await settle(el(), own);
  ask({ ...request(async () => ({ success: true })), blocked: "The count could not be read." });
  const tree = await settle(el(), own);
  expect(dialogOf(tree)!.props.blocked).toBe("The count could not be read.");
});
