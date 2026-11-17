import { beforeEach, expect, it } from "bun:test";
import type { ReactNode } from "react";
import {
  allText,
  byType,
  installReact,
  render,
  resetRender,
  text,
  type Node,
} from "./space-kit.tsx";

installReact();

const { KeySourceField } = await import("../src/lib/components/settings/KeySourceField.tsx");
const { Select } = await import("../src/lib/components/ui/select.tsx");
const { Input } = await import("../src/lib/components/ui/input.tsx");
const { setLanguage } = await import("../src/lib/i18n/index.ts");

const own = [KeySourceField];
const noInput = { name: "", path: "", value: "" };

type Choice = "env" | "file" | "paste" | "none";
function field(props: Partial<Parameters<typeof KeySourceField>[0]> = {}) {
  return render(
    <KeySourceField
      id="memory-key"
      choice="file"
      onChoice={() => {}}
      input={noInput}
      onInput={() => {}}
      {...props}
    />,
    own
  );
}

/** The options of the source dropdown: value and label. */
function options(tree: Node[]): [string, string][] {
  const select = byType(tree, Select)[0]!;
  const out: [string, string][] = [];
  const walk = (node: ReactNode) => {
    if (Array.isArray(node)) return node.forEach(walk);
    const element = node as Node | null;
    if (!element || typeof element !== "object") return;
    if (element.type === "option") out.push([element.props.value, text(element.props.children)]);
    else walk(element.props.children);
  };
  walk(select.props.children);
  return out;
}

beforeEach(() => {
  resetRender();
  setLanguage("en");
});

it("offers the three key sources", () => {
  expect(options(field())).toEqual([
    ["env", "Environment variable"],
    ["file", "Key file"],
    ["paste", "Save key to a private file"],
  ]);
});

it("offers No key only where a key is optional", () => {
  expect(options(field({ optional: true })).map(([value]) => value)).toEqual([
    "env",
    "file",
    "paste",
    "none",
  ]);
});

it("warns that a login web app does not see shell profile variables", () => {
  const env = allText(field({ choice: "env" }));
  expect(env).toContain("variables set only in a shell profile");
  expect(allText(field({ choice: "file" }))).not.toContain("shell profile");
});

it("names the saved key source without showing a value", () => {
  const tree = field({
    saved: { source: "env", reference: "ZAI_API_KEY", resolvesInWebApp: false },
  });
  const words = allText(tree);
  expect(words).toContain("Saved key");
  expect(words).toContain("ZAI_API_KEY");
  expect(words).toContain("The web app cannot read it");
  expect(allText(field({ saved: null }))).toContain("No key is saved");
});

it("shows a password field for a pasted key and reports each edit", () => {
  const edits: unknown[] = [];
  const tree = field({ choice: "paste", onInput: (value) => edits.push(value) });
  const inputs = byType(tree, Input);
  const secret = inputs.find((node) => node.props.type === "password")!;
  expect(secret.props.autoComplete).toBe("off");
  secret.props.onChange({ target: { value: "sk-test" } });
  expect(edits).toEqual([{ name: "", path: "", value: "sk-test" }]);
  expect(allText(tree)).toContain("only you can read");
});

it("shows no field when no key is chosen", () => {
  const tree = field({ choice: "none", optional: true });
  expect(byType(tree, Input)).toHaveLength(0);
  expect(allText(tree)).toContain("No key is sent");
});

it("reports a new source from the dropdown", () => {
  const seen: Choice[] = [];
  const tree = field({ onChoice: (choice) => seen.push(choice) });
  byType(tree, Select)[0]!.props.onChange({ target: { value: "paste" } });
  expect(seen).toEqual(["paste"]);
});

it("reads in Arabic", () => {
  setLanguage("ar");
  const words = allText(field({ choice: "env" }));
  expect(words).toMatch(/[؀-ۿ]/);
  expect(words).not.toContain("Environment variable");
});
