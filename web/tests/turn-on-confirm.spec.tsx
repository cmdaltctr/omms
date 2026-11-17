import { beforeEach, expect, it } from "bun:test";
import { Button } from "../src/lib/components/ui/button";
import { setLanguage } from "../src/lib/i18n/index";
import { allText, installReact, resetRender, settle, text, type Node } from "./space-kit.tsx";

installReact();
const { TurnOnAction, TurnOnDialog } = await import("../src/lib/components/memory/TurnOnAction");
const own = [TurnOnAction, TurnOnDialog];

const buttons = (tree: Node[], label: string) =>
  tree.filter(
    (node) =>
      (node.type === Button || node.type === "button") && text(node.props.children) === label
  );

beforeEach(() => {
  resetRender();
  setLanguage("en");
});

it("asks before it turns automatic import on, and sends nothing until the user confirms", async () => {
  let saves = 0;
  const element = <TurnOnAction disabled={false} onConfirm={async () => void saves++} />;
  let tree = await settle(element, own);
  expect(buttons(tree, "Turn on")).toHaveLength(1);
  buttons(tree, "Turn on")[0]!.props.onClick();
  tree = await settle(element, own);
  expect(saves).toBe(0);
  const words = allText(tree);
  expect(words).toContain("Turn on automatic import?");
  expect(words).toContain("Automatic import will run for every host, not just this one.");
  expect(words).toContain("It makes model calls, which can cost money.");
  // Cancel sends nothing and closes the question.
  buttons(tree, "Cancel")[0]!.props.onClick();
  tree = await settle(element, own);
  expect(saves).toBe(0);
  expect(allText(tree)).not.toContain("Turn on automatic import?");
  // Confirm sends the save once and closes.
  buttons(tree, "Turn on")[0]!.props.onClick();
  tree = await settle(element, own);
  buttons(tree, "Turn on").at(-1)!.props.onClick();
  tree = await settle(element, own);
  expect(saves).toBe(1);
  expect(allText(tree)).not.toContain("Turn on automatic import?");
});

it("reads the question in Chinese and Arabic", async () => {
  for (const [language, title] of [
    ["zh", "开启自动导入？"],
    ["ar", "تشغيل الاستيراد التلقائي؟"],
  ] as const) {
    resetRender();
    setLanguage(language);
    const element = <TurnOnAction disabled={false} onConfirm={async () => {}} />;
    const tree = await settle(element, own);
    tree.find((node) => node.type === Button)!.props.onClick();
    expect(allText(await settle(element, own))).toContain(title);
  }
});

const { HostSettings } = await import("../src/lib/components/memory/HostSettings");

function fakeBackfill(on: boolean, saves: Record<string, unknown>[]) {
  return {
    snapshot: { settings: { autoBackfill: { globalValue: on } }, secrets: {} },
    lists: {},
    busy: false,
    save: async (edits: Record<string, unknown>) => void saves.push(edits),
    saveModel: () => {},
  } as never;
}
const autoImportBox = (tree: Node[]) =>
  tree.find((node) => node.props.id === "memory-section-auto-import")!;
const checkbox = (tree: Node[]) =>
  tree.find((node) => node.type === "input" && node.props.type === "checkbox")!;

it("asks with the Turn on dialog before the settings checkbox turns automatic import on", async () => {
  const saves: Record<string, unknown>[] = [];
  const element = <HostSettings host="pi" backfill={fakeBackfill(false, saves)} />;
  const views = [HostSettings, TurnOnDialog];
  let tree = await settle(element, views);
  expect(autoImportBox(tree)).toBeDefined();
  checkbox(tree).props.onChange({ target: { checked: true } });
  tree = await settle(element, views);
  expect(saves).toHaveLength(0);
  expect(allText(tree)).toContain("Turn on automatic import?");
  // Cancel saves nothing.
  buttons(tree, "Cancel")[0]!.props.onClick();
  tree = await settle(element, views);
  expect(saves).toHaveLength(0);
  expect(allText(tree)).not.toContain("Turn on automatic import?");
  // Confirm saves once.
  checkbox(tree).props.onChange({ target: { checked: true } });
  tree = await settle(element, views);
  buttons(tree, "Turn on").at(-1)!.props.onClick();
  expect(allText(await settle(element, views))).not.toContain("Turn on automatic import?");
  expect(saves).toEqual([{ autoBackfill: true }]);
});

it("turns automatic import off from the settings checkbox at once, with no dialog", async () => {
  const saves: Record<string, unknown>[] = [];
  const element = <HostSettings host="pi" backfill={fakeBackfill(true, saves)} />;
  const views = [HostSettings, TurnOnDialog];
  let tree = await settle(element, views);
  checkbox(tree).props.onChange({ target: { checked: false } });
  tree = await settle(element, views);
  expect(saves).toEqual([{ autoBackfill: false }]);
  expect(allText(tree)).not.toContain("Turn on automatic import?");
});
