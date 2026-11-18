import { beforeEach, expect, it } from "bun:test";
import { allText, installReact, render, resetRender, text, type Node } from "./space-kit.tsx";

installReact();

const { SettingRow } = await import("../src/lib/components/settings/SettingRow.tsx");
const { setLanguage } = await import("../src/lib/i18n/index.ts");

const own = [SettingRow];
const row = (props: Partial<Parameters<typeof SettingRow>[0]> = {}) =>
  render(
    <SettingRow setting="autoCaptureMaxContextBytes" controlId="limit-capture" {...props}>
      <input id="limit-capture" />
    </SettingRow>,
    own
  );

beforeEach(() => {
  resetRender();
  setLanguage("en");
});

it("leads with a plain name and puts the config key last as secondary text", () => {
  const tree = row();
  const words = allText(tree);
  expect(words).toContain("Conversation size when saving");
  expect(words.indexOf("Conversation size when saving")).toBeLessThan(
    words.indexOf("autoCaptureMaxContextBytes")
  );
  const key = tree.find((node: Node) => node.type === "code")!;
  expect(text(key.props.children)).toBe("autoCaptureMaxContextBytes");
  expect(key.props.dir).toBe("ltr");
});

it("keeps the key left to right inside a wrapper that follows the page direction", () => {
  const tree = row();
  const key = tree.find((node: Node) => node.type === "code")!;
  const wrapper = tree.find((node: Node) =>
    [node.props.children].flat().some((child) => child === key)
  )!;
  expect(wrapper).toBeTruthy();
  // No dir on the wrapper: in Arabic it starts on the right, under the row name.
  expect(wrapper.props.dir).toBeUndefined();
  expect(String(wrapper.props.className)).toContain("block");
  expect(String(wrapper.props.className)).toContain("text-start");
  expect(String(wrapper.props.className)).toContain("text-muted-foreground");
  // The code stays left to right and inline, so the key text reads correctly.
  expect(key.props.dir).toBe("ltr");
  expect(String(key.props.className ?? "")).not.toContain("block");
});

it("shows the description, the default and what the setting affects", () => {
  const words = allText(row());
  expect(words).toContain("How much of a conversation OMMS reads when it writes a memory.");
  expect(words).toContain("Default");
  expect(words).toContain("128 KB of text");
  expect(words).toContain("Affects");
  expect(words).toContain("Saving memories from your sessions");
});

it("ties the name to the control", () => {
  const label = row().find((node) => String(node.props.htmlFor) === "limit-capture");
  expect(label).toBeTruthy();
});

it("says when the project file decides the setting", () => {
  expect(allText(row())).not.toContain("file decides");
  expect(allText(row({ projectNote: true }))).toContain("file decides this setting");
});

it("reads in Arabic with the key kept left to right", () => {
  setLanguage("ar");
  const tree = row();
  expect(allText(tree)).toMatch(/[؀-ۿ]/);
  expect(allText(tree)).not.toContain("Conversation size when saving");
  expect(tree.find((node) => node.type === "code")!.props.dir).toBe("ltr");
});

it("still shows the control for a setting with no catalogue entry", () => {
  const tree = row({ setting: "noSuchKey" });
  expect(tree.some((node) => node.type === "input")).toBe(true);
  expect(allText(tree)).not.toContain("Default");
});
