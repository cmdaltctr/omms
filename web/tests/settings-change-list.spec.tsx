import { beforeEach, expect, it } from "bun:test";
import { allText, installReact, resetRender, settle, text, type Node } from "./space-kit.tsx";

installReact();

const { SettingsChangeList } =
  await import("../src/lib/components/settings/SettingsChangeList.tsx");
const { useSettingsChanges } = await import("../src/hooks/useSettingsChanges.ts");
const { setLanguage } = await import("../src/lib/i18n/index.ts");
type SettingsChange = import("../src/lib/settings-changes.ts").SettingsChange;

const own = [SettingsChangeList];
const rows = [
  { key: "maxMemories", label: "Maximum memories", from: "10", to: "20" },
  { key: "similarityThreshold", label: "Similarity threshold", from: "0.6", to: "Default (0.6)" },
];
const list = (changes: readonly SettingsChange[] = rows) => (
  <SettingsChangeList changes={changes} />
);
const typed = (tree: Node[], type: string) =>
  tree.filter((node) => node.type === type).map((node) => text(node.props.children));

beforeEach(() => {
  resetRender();
  setLanguage("en");
});

it("lists each change with its name, its saved value, then its new value", async () => {
  const tree = await settle(list(), own);
  expect(typed(tree, "dt")).toEqual(["Maximum memories", "Similarity threshold"]);
  expect(typed(tree, "dd")).toEqual(["10changes to20", "0.6changes toDefault (0.6)"]);
});

it("strikes the saved value through and leaves the new value plain", async () => {
  const tree = await settle(list(), own);
  expect(typed(tree, "s")).toEqual(["10", "0.6"]);
  expect(typed(tree, "s")).toEqual(rows.map((row) => row.from));
});

it("keeps the arrow out of the reading order and mirrors it for Arabic", async () => {
  const tree = await settle(list(), own);
  const arrow = tree.find((node) => node.props["aria-hidden"] === "true");
  expect(arrow?.props.className).toContain("rtl:-scale-x-100");
});

it("reads the link between the values in Arabic", async () => {
  setLanguage("ar");
  const tree = await settle(list(), own);
  expect(allText(tree)).toContain("يتغير إلى");
  expect(allText(tree)).not.toContain("changes to");
});

it("shows nothing when the save changes nothing", async () => {
  const tree = await settle(list([]), own);
  expect(allText(tree).trim()).toBe("");
});

it("gives the helper the words and the setting names of the page", async () => {
  let listed: SettingsChange[] = [];
  let names: string[] = [];
  const fields = [
    { key: "autoCaptureEnabled", label: "Automatic capture" },
    { key: "maxMemories", label: "Maximum memories", default: 10 },
    { key: "claudeFolder", label: "Claude Code folder" },
  ];
  const KEYS = ["autoCaptureEnabled", "maxMemories", "claudeFolder", "not.a.setting"];
  const Probe = () => {
    const { changes, name } = useSettingsChanges();
    listed = changes(
      { autoCaptureEnabled: true, maxMemories: 20 },
      { autoCaptureEnabled: false, maxMemories: null, claudeFolder: "/tmp/claude" },
      fields
    );
    names = KEYS.map(name);
    return null;
  };
  await settle(<Probe />, [Probe]);
  expect(listed).toEqual([
    { key: "autoCaptureEnabled", label: "Automatic capture", from: "On", to: "Off" },
    { key: "maxMemories", label: "Maximum memories", from: "20", to: "Default (10)" },
    { key: "claudeFolder", label: "Claude Code folder", from: "Not set", to: "/tmp/claude" },
  ]);
  // A setting the catalogue does not know keeps its key.
  expect(names).toEqual([
    "Save memories automatically",
    "Memories per search",
    "claudeFolder",
    "not.a.setting",
  ]);

  setLanguage("ar");
  await settle(<Probe />, [Probe]);
  expect(listed).toEqual([
    { key: "autoCaptureEnabled", label: "Automatic capture", from: "قيد التشغيل", to: "متوقف" },
    { key: "maxMemories", label: "Maximum memories", from: "20", to: "افتراضي (10)" },
    { key: "claudeFolder", label: "Claude Code folder", from: "غير محدد", to: "/tmp/claude" },
  ]);
  expect(names[0]).toMatch(/[؀-ۿ]/);
  expect(names[3]).toBe("not.a.setting");
});
