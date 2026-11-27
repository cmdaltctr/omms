import { beforeEach, expect, it } from "bun:test";
import { isValidElement } from "react";
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

const { SkillLearningSection, SkillLearningCard, Switch } =
  await import("../src/lib/components/settings/SkillLearningSection.tsx");
const { RecordPast, RecordPastView } = await import("../src/lib/components/skills/RecordPast.tsx");
const { Button } = await import("../src/lib/components/ui/button.tsx");
const { Switch: SwitchControl } = await import("../src/lib/components/ui/switch.tsx");
const { SettingsConfirmDialog } =
  await import("../src/lib/components/settings/SettingsConfirmDialog.tsx");
const { SettingsChangeList } =
  await import("../src/lib/components/settings/SettingsChangeList.tsx");
const { setLanguage } = await import("../src/lib/i18n/index.ts");

const own = [SkillLearningSection, SkillLearningCard, Switch, RecordPast, RecordPastView];
const REFUSED = "Config changed. Reload settings and save again.";

/** The file answers every read with what the last save left, as the real one does. */
let recording: boolean | undefined;
let redact: boolean | undefined;
let refusal: string | undefined;
let startRefusal: string | undefined;
let requests: Request[];

const reply = (request: Request) => {
  if (request.method === "PATCH") {
    if (refusal) return { status: 409, body: { error: refusal } };
    const edits = request.body.edits as Record<string, boolean>;
    if ("skillLearning" in edits) recording = edits.skillLearning;
    if ("skillLearningRedact" in edits) redact = edits.skillLearningRedact;
  }
  if (request.path === "/api/skills/record-past")
    return startRefusal
      ? { status: 500, body: { success: false, error: startRefusal } }
      : {
          body: {
            success: true,
            data: {
              job: { id: "j1", dryRun: false, state: "done", summary: { skillTurnsRecorded: 7 } },
            },
          },
        };
  if (request.path === "/api/skills/stats")
    return {
      body: {
        success: true,
        data: { turns: 340, fileSize: 2048, recording, redact: redact !== false },
      },
    };
  return {
    body: {
      revision: "r1",
      settings: {
        skillLearning: { value: recording, globalValue: recording, source: "global" },
        skillLearningRedact: { value: redact, globalValue: redact, source: "global" },
      },
    },
  };
};

beforeEach(() => {
  resetRender();
  setLanguage("en");
  recording = false;
  redact = true;
  refusal = undefined;
  startRefusal = undefined;
  requests = installFetch(reply);
});

/** The card's switches are the shared Switch: recording first, redaction second. */
const switches = (tree: Node[]) => byType(tree, SwitchControl);
const dialogOf = (tree: Node[]) => byType(tree, SettingsConfirmDialog)[0];
/** The change list inside a dialog body, which may hold more than the list. */
function findList(node: unknown): Node | undefined {
  if (Array.isArray(node)) return node.map(findList).find(Boolean);
  if (!isValidElement(node)) return undefined;
  if (node.type === SettingsChangeList) return node as Node;
  return findList(node.props.children);
}
/** What the dialog lists: one row per setting the save changes. */
const rowsOf = (dialog: Node) => findList(dialog.props.body)!.props.changes as unknown[];
const patches = () => requests.filter((request) => request.method === "PATCH");
const recordStarts = () => requests.filter((request) => request.path === "/api/skills/record-past");
/** Confirm the open dialog, then let it close as it does when the request succeeds. */
async function confirm(tree: Node[]) {
  const dialog = dialogOf(tree)!;
  const result = await dialog.props.onConfirm();
  dialog.props.onClose();
  return result;
}

it("asks before the recording switch saves, and the switch shows its saved value after Cancel", async () => {
  let tree = await settle(<SkillLearningSection />, own);
  switches(tree)[0]!.props.onCheckedChange(true);
  tree = await settle(<SkillLearningSection />, own);

  const dialog = dialogOf(tree)!;
  expect(dialog.props.title).toBe("Turn on skill learning?");
  expect(dialog.props.confirmLabel).toBe("Turn on");
  expect(rowsOf(dialog)).toEqual([
    { key: "skillLearning", label: "Learn from skill use", from: "Off", to: "On" },
  ]);
  expect(patches()).toHaveLength(0);
  // The switch shows the picked value while the dialog asks.
  expect(switches(tree)[0]!.props.checked).toBe(true);

  dialog.props.onClose();
  tree = await settle(<SkillLearningSection />, own);
  expect(dialogOf(tree)).toBeUndefined();
  expect(patches()).toHaveLength(0);
  expect(switches(tree)[0]!.props.checked).toBe(false);
});

it("sends the same body as before once the recording switch is confirmed", async () => {
  let tree = await settle(<SkillLearningSection />, own);
  switches(tree)[0]!.props.onCheckedChange(true);
  tree = await settle(<SkillLearningSection />, own);
  await confirm(tree);
  tree = await settle(<SkillLearningSection />, own);

  expect(patches()).toHaveLength(1);
  expect(patches()[0]!.body).toEqual({ revision: "r1", edits: { skillLearning: true } });
  // The reloaded snapshot now holds the saved value, so the switch stays on without a pending one.
  expect(switches(tree)[0]!.props.checked).toBe(true);
  expect(allText(tree)).toContain("Saved.");
});

it("asks before the recording switch turns off", async () => {
  recording = true;
  let tree = await settle(<SkillLearningSection />, own);
  switches(tree)[0]!.props.onCheckedChange(false);
  tree = await settle(<SkillLearningSection />, own);

  expect(dialogOf(tree)!.props.title).toBe("Turn off skill learning?");
  expect(dialogOf(tree)!.props.confirmLabel).toBe("Turn off");
  expect(rowsOf(dialogOf(tree)!)).toEqual([
    { key: "skillLearning", label: "Learn from skill use", from: "On", to: "Off" },
  ]);
  expect(patches()).toHaveLength(0);
});

it("replaces the inline warning: turning redaction off asks in the dialog with the same warning", async () => {
  let tree = await settle(<SkillLearningSection />, own);
  // No inline question sits on the card before or after the click.
  expect(allText(tree)).not.toContain("Stop removing private text and secrets?");
  switches(tree)[1]!.props.onCheckedChange(false);
  tree = await settle(<SkillLearningSection />, own);

  const dialog = dialogOf(tree)!;
  expect(dialog.props.title).toBe("Stop removing private text and secrets?");
  expect(dialog.props.confirmLabel).toBe("Turn off");
  expect(dialog.props.destructive).toBe(true);
  expect(rowsOf(dialog)).toEqual([
    {
      key: "skillLearningRedact",
      label: "Hide private text in skill records",
      from: "On",
      to: "Off",
    },
  ]);
  // The dialog carries the warning the inline callout used to carry.
  expect(text(dialog.props.body)).toContain("New turns will be stored as written.");
  expect(patches()).toHaveLength(0);

  // Cancel leaves redaction on and the switch shows it.
  dialog.props.onClose();
  tree = await settle(<SkillLearningSection />, own);
  expect(patches()).toHaveLength(0);
  expect(switches(tree)[1]!.props.checked).toBe(true);
});

it("turning redaction back on also asks, and confirm sends the same body", async () => {
  redact = false;
  let tree = await settle(<SkillLearningSection />, own);
  switches(tree)[1]!.props.onCheckedChange(true);
  tree = await settle(<SkillLearningSection />, own);

  const dialog = dialogOf(tree)!;
  expect(dialog.props.title).toBe("Remove private text and secrets?");
  expect(dialog.props.confirmLabel).toBe("Turn on");
  expect(dialog.props.destructive).toBeFalsy();
  expect(rowsOf(dialog)).toEqual([
    {
      key: "skillLearningRedact",
      label: "Hide private text in skill records",
      from: "Off",
      to: "On",
    },
  ]);
  await confirm(tree);
  tree = await settle(<SkillLearningSection />, own);
  expect(patches()).toHaveLength(1);
  expect(patches()[0]!.body).toEqual({ revision: "r1", edits: { skillLearningRedact: true } });
  expect(switches(tree)[1]!.props.checked).toBe(true);
});

it("keeps a server refusal inside the dialog, which stays open until the user decides", async () => {
  refusal = REFUSED;
  let tree = await settle(<SkillLearningSection />, own);
  switches(tree)[0]!.props.onCheckedChange(true);
  tree = await settle(<SkillLearningSection />, own);

  expect(await dialogOf(tree)!.props.onConfirm()).toMatchObject({ success: false, error: REFUSED });
  tree = await settle(<SkillLearningSection />, own);
  expect(dialogOf(tree)).toBeDefined();
  expect(patches()).toHaveLength(1);
  expect(allText(tree)).toContain(REFUSED);
  expect(allText(tree)).not.toContain("Saved.");

  dialogOf(tree)!.props.onClose();
  tree = await settle(<SkillLearningSection />, own);
  expect(dialogOf(tree)).toBeUndefined();
  // Cancel after the refusal puts the saved value back on the switch.
  expect(switches(tree)[0]!.props.checked).toBe(false);
});

it("asks before Record past turns starts, with one sentence, and starts nothing on Cancel", async () => {
  recording = true;
  let tree = await settle(<SkillLearningSection />, own);
  byText(tree, Button, "Record past turns")[0]!.props.onClick();
  tree = await settle(<SkillLearningSection />, own);

  const dialog = dialogOf(tree)!;
  expect(dialog.props.title).toBe("Record past turns?");
  expect(dialog.props.confirmLabel).toBe("Record past turns");
  expect(text(dialog.props.body)).toContain(
    "OMMS records skill turns from the past sessions of every set-up host, with no model call."
  );
  expect(recordStarts()).toHaveLength(0);

  dialog.props.onClose();
  tree = await settle(<SkillLearningSection />, own);
  expect(dialogOf(tree)).toBeUndefined();
  expect(recordStarts()).toHaveLength(0);

  byText(tree, Button, "Record past turns")[0]!.props.onClick();
  tree = await settle(<SkillLearningSection />, own);
  await confirm(tree);
  tree = await settle(<SkillLearningSection />, own);
  expect(recordStarts()).toHaveLength(1);
  expect(allText(tree)).toContain("Recorded 7 past turns.");
});

it("keeps a refused Record past turns start inside the dialog, which stays open", async () => {
  const reason = "The history could not be read. Try again.";
  startRefusal = reason;
  recording = true;
  let tree = await settle(<SkillLearningSection />, own);
  byText(tree, Button, "Record past turns")[0]!.props.onClick();
  tree = await settle(<SkillLearningSection />, own);
  const dialog = dialogOf(tree)!;

  expect(await dialog.props.onConfirm()).toEqual({ success: false, error: reason });
  tree = await settle(<SkillLearningSection />, own);
  // The reason sits in the dialog, which stays open, and on the card.
  expect(dialogOf(tree)).toBeDefined();
  expect(allText(tree)).toContain(reason);
  expect(allText(tree)).not.toContain("Recorded 7 past turns.");

  // The same dialog can try again.
  startRefusal = undefined;
  await dialogOf(tree)!.props.onConfirm();
  dialogOf(tree)!.props.onClose();
  await settle(<SkillLearningSection />, own);
  expect(recordStarts()).toHaveLength(2);
});
