import { afterEach, beforeEach, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import {
  allText,
  byType,
  installFetch,
  installReact,
  resetRender,
  settle,
  text,
  type Node,
} from "./space-kit.tsx";

installReact();

const { MemorySection } = await import("../src/lib/components/memory/MemorySection.tsx");
const { KeywordModeSection } = await import("../src/lib/components/memory/KeywordModeSection.tsx");
const { MemoryInjectionSection } =
  await import("../src/lib/components/memory/MemoryInjectionSection.tsx");
const { AutoCleanupSettings } =
  await import("../src/lib/components/memory/AutoCleanupSettings.tsx");
const { SettingsConfirmDialog } =
  await import("../src/lib/components/settings/SettingsConfirmDialog.tsx");
const { SettingRow } = await import("../src/lib/components/settings/SettingRow.tsx");
const { Select } = await import("../src/lib/components/ui/select.tsx");
const { setLanguage } = await import("../src/lib/i18n/index.ts");
const { translateCatalogue } = await import("../src/lib/i18n/settings-catalogue.ts");
const { PLAIN_TEXT, SETTINGS_CATALOGUE, findCatalogueEntry } =
  await import("../src/lib/settings-catalogue.ts");
const { KEYWORD_MODE_OPTIONS } = await import("../src/lib/keyword-mode-controls.ts");
const { MEMORY_CONTROLS } = await import("../src/lib/memory-controls.ts");
const { revealPageAnchor } = await import("../src/lib/settings-navigation.ts");

const snapshot = (settings: Record<string, unknown> = {}) => ({
  revision: "rev-1",
  settings,
  secrets: {},
});
const own = [
  MemorySection,
  KeywordModeSection,
  MemoryInjectionSection,
  AutoCleanupSettings,
  SettingRow,
];
const cards = { MemorySection, KeywordModeSection, MemoryInjectionSection, AutoCleanupSettings };

async function show(Card: () => unknown, settings: Record<string, unknown> = {}) {
  installFetch(() => ({ body: snapshot(settings) }));
  return settle(<Card />, own);
}
const codeFor = (tree: Node[], key: string) =>
  tree.find((node) => node.type === "code" && text(node.props.children) === key);

beforeEach(() => {
  resetRender();
  setLanguage("en");
});
afterEach(() => setLanguage("en"));

it("leads each Memory limits row with a plain name and a one-line description", async () => {
  const tree = await show(MemorySection);
  const words = allText(tree);
  for (const control of MEMORY_CONTROLS) {
    const entry = findCatalogueEntry(control.key)!;
    expect(words, control.key).toContain(entry.name);
    expect(words, control.key).toContain(entry.description);
    expect(words.indexOf(entry.name), control.key).toBeLessThan(words.indexOf(control.key));
  }
});

it("shows each limit key only as small secondary text, left to right", async () => {
  const tree = await show(MemorySection);
  for (const control of MEMORY_CONTROLS) {
    const code = codeFor(tree, control.key);
    expect(code?.props.dir, control.key).toBe("ltr");
    const input = byType(tree, (await import("../src/lib/components/ui/input.tsx")).Input).find(
      (node) => node.props.id === `${control.id}-input`
    )!;
    // The input is named by the plain name, so the key is not its main label.
    expect(String(input.props["aria-label"] ?? "")).toContain(
      findCatalogueEntry(control.key)!.name
    );
    expect(String(input.props["aria-label"] ?? "").startsWith(control.key)).toBe(false);
  }
});

it("keeps the Default, Unit and Affects columns visible", async () => {
  const words = allText(await show(MemorySection));
  for (const heading of ["Setting", "Value", "Default", "Unit", "Affects"]) {
    expect(words).toContain(heading);
  }
  expect(words).toContain("131,072");
});

it("explains sizes in plain words, with no ceil(UTF-8 bytes / 4) wording", async () => {
  const words = allText(await show(MemorySection));
  expect(words).toContain(PLAIN_TEXT.bytesNote);
  expect(words).toContain(PLAIN_TEXT.tokensNote);
  expect(words).not.toContain("ceil(");
  expect(words).not.toContain("UTF-8");
});

it("words the keyword choices plainly and never shows the old labels", async () => {
  expect(KEYWORD_MODE_OPTIONS.map((option) => option.label)).toEqual([
    PLAIN_TEXT.keywordBoost,
    PLAIN_TEXT.keywordMerge,
  ]);
  const tree = await show(KeywordModeSection);
  const select = byType(tree, Select)[0]!;
  const labels = (select.props.children as Node[]).map((option) => text(option.props.children));
  expect(labels).toEqual([PLAIN_TEXT.keywordBoost, PLAIN_TEXT.keywordMerge]);
  const all = allText(tree);
  expect(all).not.toContain("Rank fusion (experimental)");
  expect(all).not.toContain("Boost (default)");
  expect(all).toContain("How word matches join the results");
  expect(codeFor(tree, "keywordMode")?.props.dir).toBe("ltr");
});

it("explains merging in plain words when it is chosen, and when the reranker is on", async () => {
  const merge = { keywordMode: { value: "rrf", source: "global", globalValue: "rrf" } };
  const plain = allText(await show(KeywordModeSection, merge));
  expect(plain).toContain(PLAIN_TEXT.keywordMergeHelp);
  expect(plain).not.toContain("Rank fusion");
  resetRender();
  const reranker = {
    ...merge,
    rerankerEnabled: { value: true, source: "global" },
    rerankerApiUrl: { value: "http://127.0.0.1:3008/v1", source: "global" },
    rerankerModel: { value: "m", source: "global" },
  };
  expect(allText(await show(KeywordModeSection, reranker))).toContain(
    PLAIN_TEXT.keywordMergeWithReranker
  );
});

it("gives the injection and profile tidy cards catalogue rows with the key as secondary text", async () => {
  const injection = await show(MemoryInjectionSection);
  const tidy = await show(AutoCleanupSettings);
  for (const [tree, keys] of [
    [
      injection,
      [
        "openingContext",
        "openingContextQuery",
        "subagentMemory",
        "compaction.enabled",
        "compaction.memoryLimit",
      ],
    ],
    [tidy, ["userProfileAutoCleanupEnabled", "userProfileAutoCleanupInterval"]],
  ] as const) {
    const words = allText(tree);
    for (const key of keys) {
      const entry = findCatalogueEntry(key)!;
      expect(words, key).toContain(entry.name);
      expect(words.indexOf(entry.name), key).toBeLessThan(words.indexOf(key));
      expect(codeFor(tree, key)?.props.dir, key).toBe("ltr");
    }
  }
});

it("reads the Memory limits notes in Arabic", async () => {
  setLanguage("ar");
  const words = allText(await show(MemorySection));
  expect(words).toContain(translateCatalogue(PLAIN_TEXT.bytesNote, "ar"));
  expect(words).toContain(translateCatalogue(PLAIN_TEXT.tokensNote, "ar"));
  expect(words).not.toContain("Conversation size when saving");
});

// The switches in these cards use the shared Switch, so no raw input is left.
it("uses shared controls in the five cards: no raw button or input, no window.confirm", () => {
  for (const name of Object.keys(cards).concat("RerankerSection")) {
    const source = readFileSync(
      new URL(`../src/lib/components/memory/${name}.tsx`, import.meta.url),
      "utf8"
    );
    expect(source, name).not.toMatch(/<button|window\.confirm/);
    expect(source.match(/<input\b[^>]*/g) ?? [], name).toHaveLength(0);
  }
});

it("keeps the profile tidy switch in the form until one Save", async () => {
  const requests = installFetch((request) =>
    request.method === "GET"
      ? {
          body: snapshot({
            userProfileAutoCleanupEnabled: { value: true, globalValue: true },
            userProfileAutoCleanupInterval: { value: 500, globalValue: 500 },
          }),
        }
      : { body: { ok: true } }
  );
  let tree = await settle(<AutoCleanupSettings />, own);
  const { Button } = await import("../src/lib/components/ui/button.tsx");
  const toggle = (nodes: Node[]) => nodes.find((node) => node.props.id === "auto-cleanup-enabled")!;
  toggle(tree).props.onCheckedChange(false);
  tree = await settle(<AutoCleanupSettings />, own);
  // Changing the switch saves nothing on its own.
  expect(requests.filter((request) => request.method === "PATCH")).toHaveLength(0);
  expect(toggle(tree).props.checked).toBe(false);
  const save = byType(tree, Button).find((node) => text(node.props.children).trim() === "Save")!;
  save.props.onClick();
  tree = await settle(<AutoCleanupSettings />, own);
  const dialog = byType(tree, SettingsConfirmDialog)[0]!;
  await dialog.props.onConfirm();
  dialog.props.onClose();
  await settle(<AutoCleanupSettings />, own);
  const patches = requests.filter((request) => request.method === "PATCH");
  expect(patches).toHaveLength(1);
  expect(patches[0]!.body.edits).toEqual({ userProfileAutoCleanupEnabled: false });
});

it("asks before it saves the profile tidy settings, and sends nothing until the user confirms", async () => {
  const requests = installFetch((request) =>
    request.method === "GET"
      ? {
          body: snapshot({
            userProfileAutoCleanupEnabled: { value: true, globalValue: true },
            userProfileAutoCleanupInterval: { value: 500, globalValue: 500 },
          }),
        }
      : { body: { ok: true } }
  );
  let tree = await settle(<AutoCleanupSettings />, own);
  const { Button } = await import("../src/lib/components/ui/button.tsx");
  const toggle = (nodes: Node[]) => nodes.find((node) => node.props.id === "auto-cleanup-enabled")!;
  const field = (nodes: Node[]) => nodes.find((node) => node.props.id === "auto-cleanup-interval")!;
  toggle(tree).props.onCheckedChange(false);
  field(tree).props.onChange({ target: { value: "300" } });
  tree = await settle(<AutoCleanupSettings />, own);
  byType(tree, Button)
    .find((node) => text(node.props.children).trim() === "Save")!
    .props.onClick();
  tree = await settle(<AutoCleanupSettings />, own);

  const dialog = byType(tree, SettingsConfirmDialog)[0]!;
  expect(dialog.props.title).toBe("Save automatic profile cleanup?");
  expect(dialog.props.confirmLabel).toBe("Save");
  expect(dialog.props.body.props.changes).toEqual([
    {
      key: "userProfileAutoCleanupEnabled",
      label: "Tidy the profile automatically",
      from: "On",
      to: "Off",
    },
    {
      key: "userProfileAutoCleanupInterval",
      label: "Profile tidy interval",
      from: "500 prompts",
      to: "300 prompts",
    },
  ]);
  expect(requests.filter((request) => request.method === "PATCH")).toHaveLength(0);
  // Cancel keeps what the user chose as a draft, and sends nothing.
  dialog.props.onClose();
  tree = await settle(<AutoCleanupSettings />, own);
  expect(byType(tree, SettingsConfirmDialog)).toHaveLength(0);
  expect(requests.filter((request) => request.method === "PATCH")).toHaveLength(0);
  expect(toggle(tree).props.checked).toBe(false);
  expect(field(tree).props.value).toBe("300");
});

it("sends the same tidy request as before the rule once the user confirms", async () => {
  const requests = installFetch((request) =>
    request.method === "GET"
      ? {
          body: snapshot({
            userProfileAutoCleanupEnabled: { value: true, globalValue: true },
            userProfileAutoCleanupInterval: { value: 500, globalValue: 500 },
          }),
        }
      : { body: { ok: true } }
  );
  let tree = await settle(<AutoCleanupSettings />, own);
  const { Button } = await import("../src/lib/components/ui/button.tsx");
  const field = (nodes: Node[]) => nodes.find((node) => node.props.id === "auto-cleanup-interval")!;
  field(tree).props.onChange({ target: { value: "300" } });
  tree = await settle(<AutoCleanupSettings />, own);
  byType(tree, Button)
    .find((node) => text(node.props.children).trim() === "Save")!
    .props.onClick();
  tree = await settle(<AutoCleanupSettings />, own);
  const dialog = byType(tree, SettingsConfirmDialog)[0]!;
  expect(await dialog.props.onConfirm()).toEqual({ success: true });
  dialog.props.onClose();
  await settle(<AutoCleanupSettings />, own);
  const patches = requests.filter((request) => request.method === "PATCH");
  expect(patches).toHaveLength(1);
  expect(patches[0]!.body).toEqual({
    edits: { userProfileAutoCleanupInterval: 300 },
    revision: "rev-1",
  });
});

it("keeps a tidy-save refusal inside the dialog, which stays open", async () => {
  const REFUSED = "Config changed. Reload settings and save again.";
  installFetch((request) =>
    request.method === "GET"
      ? {
          body: snapshot({
            userProfileAutoCleanupEnabled: { value: true, globalValue: true },
            userProfileAutoCleanupInterval: { value: 500, globalValue: 500 },
          }),
        }
      : { status: 409, body: { error: REFUSED } }
  );
  let tree = await settle(<AutoCleanupSettings />, own);
  const { Button } = await import("../src/lib/components/ui/button.tsx");
  const toggle = (nodes: Node[]) => nodes.find((node) => node.props.id === "auto-cleanup-enabled")!;
  toggle(tree).props.onCheckedChange(false);
  tree = await settle(<AutoCleanupSettings />, own);
  byType(tree, Button)
    .find((node) => text(node.props.children).trim() === "Save")!
    .props.onClick();
  tree = await settle(<AutoCleanupSettings />, own);
  const dialog = byType(tree, SettingsConfirmDialog)[0]!;
  expect(await dialog.props.onConfirm()).toEqual({ success: false, error: REFUSED });
  tree = await settle(<AutoCleanupSettings />, own);
  expect(byType(tree, SettingsConfirmDialog)).toHaveLength(1);
  expect(allText(tree)).toContain(REFUSED);
  // The draft stays, so the user can save again.
  expect(toggle(tree).props.checked).toBe(false);
});

it("lets search open every Memory and Memorisation page anchor", () => {
  const asked: string[] = [];
  Object.assign(globalThis, {
    document: {
      getElementById: (id: string) => {
        asked.push(id);
        return null;
      },
    },
    requestAnimationFrame: (callback: () => void) => callback(),
  });
  try {
    const anchors = SETTINGS_CATALOGUE.filter(
      (entry) => entry.page === "memory" || entry.page === "memorisation"
    ).map((entry) => entry.anchor);
    expect(anchors).toContain("memorisation-settings");
    for (const anchor of new Set(anchors)) {
      asked.length = 0;
      revealPageAnchor(`#${anchor}`);
      expect(asked.length > 0, anchor).toBe(true);
    }
  } finally {
    Object.assign(globalThis, { document: undefined, requestAnimationFrame: undefined });
  }
});
