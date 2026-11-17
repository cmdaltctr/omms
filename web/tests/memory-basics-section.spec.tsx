import { beforeEach, expect, it } from "bun:test";
import {
  allText,
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

const { MemoryBasicsSection } =
  await import("../src/lib/components/settings/MemoryBasicsSection.tsx");
const { SettingRow } = await import("../src/lib/components/settings/SettingRow.tsx");
const { Button } = await import("../src/lib/components/ui/button.tsx");
const { Checkbox } = await import("../src/lib/components/ui/checkbox.tsx");
const { Select } = await import("../src/lib/components/ui/select.tsx");
const { setLanguage } = await import("../src/lib/i18n/index.ts");

const own = [MemoryBasicsSection, SettingRow];

const entry = (value: unknown, source = "global") => ({
  value,
  source,
  globalValue: value,
  default: value,
});
function snapshot(over: Record<string, unknown> = {}, readOnly = false) {
  return {
    revision: "r1",
    readOnly,
    settings: {
      autoCaptureEnabled: entry(true),
      "chatMessage.enabled": entry(true),
      visibleRecall: entry(true),
      injectProfile: entry(true),
      "memory.defaultScope": entry("project"),
      ...over,
    },
  };
}

let current = snapshot();
let requests: Request[] = [];
function serve() {
  requests = installFetch((request) => {
    if (request.method === "GET") return { body: current };
    return { body: { ok: true } };
  });
}
const buttonOf = (tree: Node[], label: string) =>
  byType(tree, Button).find((node) => text(node.props.children).trim() === label)!;
const checkbox = (tree: Node[], key: string) =>
  byType(tree, Checkbox).find((node) => node.props.id === `basics-${key}`)!;

beforeEach(() => {
  resetRender();
  setLanguage("en");
  current = snapshot();
  serve();
});

it("saves chatMessage.enabled false and nothing else", async () => {
  let tree = await settle(<MemoryBasicsSection />, own);
  checkbox(tree, "chatMessage.enabled").props.onCheckedChange(false);
  tree = await settle(<MemoryBasicsSection />, own);
  buttonOf(tree, "Save").props.onClick();
  tree = await settle(<MemoryBasicsSection />, own);
  const patch = requests.find((request) => request.method === "PATCH")!;
  expect(patch.body).toEqual({ revision: "r1", edits: { "chatMessage.enabled": false } });
  expect(allText(tree)).toContain("Saved.");
});

it("saves the default memory scope as all-projects", async () => {
  let tree = await settle(<MemoryBasicsSection />, own);
  byType(tree, Select)[0]!.props.onChange({ target: { value: "all-projects" } });
  tree = await settle(<MemoryBasicsSection />, own);
  buttonOf(tree, "Save").props.onClick();
  await settle(<MemoryBasicsSection />, own);
  const patch = requests.find((request) => request.method === "PATCH")!;
  expect(patch.body.edits).toEqual({ "memory.defaultScope": "all-projects" });
});

it("says when this project's file decides a switch", async () => {
  current = snapshot({ autoCaptureEnabled: { ...entry(false, "project"), globalValue: true } });
  const tree = await settle(<MemoryBasicsSection />, own);
  expect(allText(tree)).toContain("This project's file decides this setting here.");
  // The switch still shows the global value the page writes.
  expect(checkbox(tree, "autoCaptureEnabled").props.checked).toBe(true);
});

it("keeps Save off with no change and while the snapshot is read-only", async () => {
  let tree = await settle(<MemoryBasicsSection />, own);
  expect(buttonOf(tree, "Save").props.disabled).toBe(true);
  resetRender();
  current = snapshot({}, true);
  tree = await settle(<MemoryBasicsSection />, own);
  checkbox(tree, "visibleRecall").props.onCheckedChange(false);
  tree = await settle(<MemoryBasicsSection />, own);
  expect(buttonOf(tree, "Save").props.disabled).toBe(true);
});

it("shows the server's reason when a save fails", async () => {
  requests = installFetch((request) =>
    request.method === "GET"
      ? { body: current }
      : { status: 409, body: { error: "Config changed. Reload settings and save again." } }
  );
  let tree = await settle(<MemoryBasicsSection />, own);
  checkbox(tree, "injectProfile").props.onCheckedChange(false);
  tree = await settle(<MemoryBasicsSection />, own);
  buttonOf(tree, "Save").props.onClick();
  tree = await settle(<MemoryBasicsSection />, own);
  expect(allText(tree)).toContain("Config changed. Reload settings and save again.");
});
