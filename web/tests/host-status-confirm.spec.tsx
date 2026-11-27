import { beforeEach, expect, it } from "bun:test";
import type { ImportRunView } from "../src/lib/auto-import-settings";
import { hostStatus, type HostStatusInput } from "../src/lib/components/memory/host-status";
import {
  allText,
  byText,
  byType,
  installReact,
  resetRender,
  settle,
  text,
  type Node,
} from "./space-kit.tsx";

installReact();
const { HostStatusHeader } = await import("../src/lib/components/memory/HostStatusHeader.tsx");
const { Button } = await import("../src/lib/components/ui/button.tsx");
const { SettingsConfirmDialog } =
  await import("../src/lib/components/settings/SettingsConfirmDialog.tsx");
const { setLanguage } = await import("../src/lib/i18n/index.ts");

const own = [HostStatusHeader];
const REFUSED = "Another import is already running.";

/** The runs that give the header its Pause, Resume and Retry actions. A running run that is
 * paused is still pausing; a paused run that has stopped offers Resume. */
const pausedRun = { state: "stopped", paused: true, total: 0, done: 0 } as ImportRunView;
const failedRun = { state: "failed", error: "model refused", total: 0, done: 0 } as ImportRunView;

type Call = { host: string; action: string };
let controls: Call[];
let models: Call[];
let refusal: string | undefined;

function statuses(run: ImportRunView, blocked: string | null = null) {
  const input = (host: "pi"): HostStatusInput => ({
    host,
    run,
    pending: 5,
    cutoff: null,
    runNowUnavailable: blocked,
    setUp: true,
    autoImport: true,
    formatDate: String,
    lastSaved: null,
    formatSaved: String,
  });
  return {
    backfill: {
      snapshot: undefined,
      rows: { pi: null, opencode: null, "claude-code": null },
      runs: undefined,
      lists: {},
      message: "",
      busy: false,
      save: async () => ({ success: true }),
      control: async (host: string, action: string) => {
        controls.push({ host, action });
        return refusal ? { success: false, error: refusal } : { success: true };
      },
      saveModel: async (host: string, choice: string) => {
        models.push({ host, action: choice });
        return refusal ? { success: false, error: refusal } : { success: true };
      },
      setMessage: () => {},
    },
    readiness: null,
    input,
    status: () => hostStatus(input("pi")),
    line: () => ({ text: "" }),
  } as never;
}

beforeEach(() => {
  resetRender();
  setLanguage("en");
  controls = [];
  models = [];
  refusal = undefined;
});

const el = (run: ImportRunView, blocked: string | null = null) => (
  <HostStatusHeader host="pi" statuses={statuses(run, blocked)} />
);
const action = (tree: Node[], label: string) => byText(tree, Button, label).at(-1)!;
const dialogOf = (tree: Node[]) => byType(tree, SettingsConfirmDialog)[0];

it("asks before it pauses, and Pause controls nothing until the user confirms", async () => {
  let tree = await settle(el(null), own);
  action(tree, "Pause").props.onClick();
  tree = await settle(el(null), own);

  const dialog = dialogOf(tree)!;
  expect(dialog.props.title).toBe("Pause automatic import?");
  expect(dialog.props.confirmLabel).toBe("Pause");
  expect(text(dialog.props.body)).toContain("stops after the current exchange");
  expect(controls).toHaveLength(0);

  dialog.props.onClose();
  tree = await settle(el(null), own);
  expect(dialogOf(tree)).toBeUndefined();
  expect(controls).toHaveLength(0);
});

it("pauses through the confirmed request once the user confirms", async () => {
  let tree = await settle(el(null), own);
  action(tree, "Pause").props.onClick();
  tree = await settle(el(null), own);
  expect(await dialogOf(tree)!.props.onConfirm()).toEqual({ success: true });
  expect(controls).toEqual([{ host: "pi", action: "pause" }]);
  dialogOf(tree)!.props.onClose();
  tree = await settle(el(null), own);
  expect(dialogOf(tree)).toBeUndefined();
});

it("asks before it resumes a paused import, and says it makes model calls", async () => {
  let tree = await settle(el(pausedRun), own);
  action(tree, "Resume").props.onClick();
  tree = await settle(el(pausedRun), own);

  const dialog = dialogOf(tree)!;
  expect(dialog.props.title).toBe("Resume automatic import?");
  expect(dialog.props.confirmLabel).toBe("Resume");
  expect(text(dialog.props.body)).toContain("makes model calls");
  expect(controls).toHaveLength(0);

  expect(await dialog.props.onConfirm()).toEqual({ success: true });
  expect(controls).toEqual([{ host: "pi", action: "resume" }]);
});

it("asks before it retries a failed import, and says the retry calls the model again", async () => {
  let tree = await settle(el(failedRun), own);
  action(tree, "Retry").props.onClick();
  tree = await settle(el(failedRun), own);

  const dialog = dialogOf(tree)!;
  expect(dialog.props.title).toBe("Retry the import?");
  expect(dialog.props.confirmLabel).toBe("Retry");
  expect(text(dialog.props.body)).toContain("calls the model again");
  expect(controls).toHaveLength(0);

  expect(await dialog.props.onConfirm()).toEqual({ success: true });
  expect(controls).toEqual([{ host: "pi", action: "run" }]);
});

it("asks before it switches a blocked host to the external API model", async () => {
  const blocked = "Pi needs an open host or an external backfill model.";
  let tree = await settle(el(pausedRun, blocked), own);
  action(tree, "Use external API").props.onClick();
  tree = await settle(el(pausedRun, blocked), own);

  const dialog = dialogOf(tree)!;
  expect(dialog.props.title).toBe("Use the external API?");
  expect(dialog.props.confirmLabel).toBe("Use external API");
  expect(text(dialog.props.body)).toContain("Pi will use the external API model");
  expect(models).toHaveLength(0);

  expect(await dialog.props.onConfirm()).toEqual({ success: true });
  expect(models).toEqual([{ host: "pi", action: "external" }]);
});

it("keeps a refused action inside the dialog, which stays open until the user decides", async () => {
  refusal = REFUSED;
  let tree = await settle(el(failedRun), own);
  action(tree, "Retry").props.onClick();
  tree = await settle(el(failedRun), own);

  expect(await dialogOf(tree)!.props.onConfirm()).toEqual({ success: false, error: REFUSED });
  tree = await settle(el(failedRun), own);
  expect(dialogOf(tree)).toBeDefined();
  expect(controls).toEqual([{ host: "pi", action: "run" }]);
  expect(allText(tree)).not.toContain("Backfill started.");
});
