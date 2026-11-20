import { beforeEach, expect, it, mock } from "bun:test";
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

// A failed settings reload shows a toast; the real one needs a page.
mock.module("sonner", () => ({ toast: { warning: () => {}, success: () => {}, error: () => {} } }));

const { ReasoningLevel } = await import("../src/lib/components/settings/ReasoningLevel.tsx");
const { Button } = await import("../src/lib/components/ui/button.tsx");
const { Select } = await import("../src/lib/components/ui/select.tsx");
const { SettingsConfirmDialog } =
  await import("../src/lib/components/settings/SettingsConfirmDialog.tsx");
const { setLanguage } = await import("../src/lib/i18n/index.ts");
const { translateSettings } = await import("../src/lib/i18n/settings.ts");

const own = [ReasoningLevel];
const SAVE = "/api/settings/external-api/reasoning";
const OPENROUTER = "https://openrouter.ai/api/v1";
const FLASH = "deepseek/deepseek-v4.1-flash-1017";

type Props = Parameters<typeof ReasoningLevel>[0];
let requests: Request[] = [];
beforeEach(() => {
  resetRender();
  setLanguage("en");
  requests = installFetch(() => ({ body: { revision: "rev-10", settings: {} } }));
});

const models = [
  {
    id: FLASH,
    name: "Flash",
    supported_efforts: ["max", "high", "low", "none"],
    default_effort: "high",
    mandatory: false,
  },
  { id: "x/must", name: "Must", supported_efforts: ["high", "medium", "low"], mandatory: true },
  { id: "x/toggle", name: "Toggle", mandatory: false },
  { id: "x/plain", name: "Plain" },
];

const card = (props: Partial<Props> = {}) => (
  <ReasoningLevel
    revision="rev-9"
    saved={{}}
    savedUrl={OPENROUTER}
    savedProvider="openai-chat"
    savedModel={FLASH}
    unsaved={false}
    models={models}
    {...props}
  />
);
const options = (tree: Node[]) =>
  tree.filter((node) => node.type === "option").map((node) => String(node.props.value));
const optionLabels = (tree: Node[]) =>
  tree.filter((node) => node.type === "option").map((node) => text(node.props.children));
const select = (tree: Node[]) => byType(tree, Select)[0]!;
const pick = (tree: Node[], value: string) =>
  (select(tree).props.onChange as (event: unknown) => void)({ target: { value } });
const saveButton = (tree: Node[]) =>
  byType(tree, Button).find((node) => text(node.props.children).includes("Save reasoning level"))!;

it("offers the levels of the model and names its default effort", async () => {
  const tree = await settle(card(), own);
  expect(options(tree)).toEqual(["default", "off", "low", "high", "max"]);
  expect(optionLabels(tree)[0]).toBe("Default (High)");
  expect(allText(tree)).not.toContain("nearest level");
});

it("does not offer Off when reasoning is mandatory", async () => {
  const tree = await settle(card({ savedModel: "x/must" }), own);
  expect(options(tree)).toEqual(["default", "low", "medium", "high"]);
});

it("offers the general choices and a nearest-level note for an unlisted model and a listed one without facts", async () => {
  for (const props of [
    { savedModel: "other/unlisted" },
    { savedModel: "x/plain" },
    { models: [] },
  ]) {
    resetRender();
    const tree = await settle(card(props), own);
    expect(options(tree)).toEqual(["default", "off", "low", "medium", "high"]);
    expect(allText(tree)).toContain("OpenRouter uses the nearest level the model supports.");
  }
});

it("offers on and off for a model with reasoning but no effort list, and posts toggle", async () => {
  let tree = await settle(card({ savedModel: "x/toggle" }), own);
  expect(options(tree)).toEqual(["default", "off", "on"]);
  pick(tree, "on");
  tree = await settle(card({ savedModel: "x/toggle" }), own);
  (saveButton(tree).props.onClick as () => void)();
  await settle(card({ savedModel: "x/toggle" }), own);
  expect(requests.find((r) => r.path === SAVE)!.body).toEqual({
    revision: "rev-9",
    level: "on",
    toggle: true,
  });
});

it("offers four levels for DeepSeek and the effort levels for the Responses provider", async () => {
  const deepseek = await settle(card({ savedUrl: "https://api.deepseek.com" }), own);
  expect(options(deepseek)).toEqual(["default", "off", "on"]);
  resetRender();
  const responses = await settle(
    card({ savedUrl: "https://api.openai.com/v1", savedProvider: "openai-responses" }),
    own
  );
  expect(options(responses)).toEqual(["default", "low", "medium", "high"]);
});

it("says another OpenAI Chat endpoint may ignore or refuse the field", async () => {
  const tree = await settle(card({ savedUrl: "https://api.example.com/v1" }), own);
  expect(options(tree)).toEqual(["default", "low", "medium", "high"]);
  expect(allText(tree)).toContain("This endpoint may ignore or refuse this field.");
});

it("shows no control and points to the config file for the Anthropic provider", async () => {
  const tree = await settle(card({ savedProvider: "anthropic" }), own);
  expect(byType(tree, Select)).toEqual([]);
  expect(allText(tree)).toContain(
    "Reasoning for this provider is set in memoryExtraParams in the config file."
  );
});

it("turns Save off with the reason while the URL, provider or model is unsaved", async () => {
  const tree = await settle(card({ unsaved: true }), own);
  expect(saveButton(tree).props.disabled).toBe(true);
  expect(allText(tree)).toContain("Save the endpoint first.");
  const ready = await settle(card({ unsaved: false }), own);
  expect(saveButton(ready).props.disabled).toBeFalsy();
});

it("shows the saved level and Set in the config file for a hand-written value", async () => {
  const high = await settle(card({ saved: { reasoning: { effort: "high" } } }), own);
  expect(select(high).props.value).toBe("high");
  resetRender();
  const custom = await settle(card({ saved: { reasoning: { max_tokens: 2000 } } }), own);
  expect(select(custom).props.value).toBe("custom");
  expect(optionLabels(custom)).toContain("Set in the config file");
  expect(saveButton(custom).props.disabled).toBe(true);
  resetRender();
  const none = await settle(card(), own);
  expect(select(none).props.value).toBe("default");
});

it("warns about a DeepSeek thinking field sent to OpenRouter", async () => {
  const tree = await settle(card({ saved: { thinking: { type: "disabled" } } }), own);
  const words = allText(tree);
  expect(words).toContain("OpenRouter ignores the saved thinking field.");
  expect(words).toContain("Saving a level replaces it.");
  resetRender();
  const fits = await settle(card({ saved: { reasoning: { effort: "low" } } }), own);
  expect(allText(fits)).not.toContain("ignores the saved");
});

it("posts the revision and the level, then reloads the settings", async () => {
  let tree = await settle(card(), own);
  pick(tree, "low");
  tree = await settle(card(), own);
  (saveButton(tree).props.onClick as () => void)();
  tree = await settle(card(), own);
  const post = requests.find((request) => request.path === SAVE)!;
  expect(post.method).toBe("POST");
  expect(post.body).toEqual({ revision: "rev-9", level: "low" });
  expect(requests.some((request) => request.path === "/api/settings")).toBe(true);
  expect(allText(tree)).toContain("Reasoning level saved.");
});

it("shows the level names, notes and warning in Arabic", async () => {
  setLanguage("ar");
  const tree = await settle(card({ saved: { thinking: { type: "disabled" } } }), own);
  expect(optionLabels(tree)[1]).toBe(translateSettings("Off", "ar"));
  expect(translateSettings("Off", "ar")).not.toBe("Off");
  expect(allText(tree)).toContain(
    translateSettings("OpenRouter ignores the saved thinking field.", "ar")
  );
  expect(allText(tree)).not.toContain("OpenRouter ignores the saved thinking field.");
});

it("drops a pending pick that the new saved endpoint does not offer", async () => {
  const deepseek = { savedUrl: "https://api.deepseek.com" };
  let tree = await settle(card(deepseek), own);
  pick(tree, "off");
  tree = await settle(card(deepseek), own);
  expect(select(tree).props.value).toBe("off");

  const other = { savedUrl: "https://api.example.com/v1" };
  tree = await settle(card(other), own);
  expect(options(tree)).not.toContain("off");
  expect(select(tree).props.value).toBe("default");
  (saveButton(tree).props.onClick as () => void)();
  await settle(card(other), own);
  expect(requests.find((request) => request.path === SAVE)!.body).toEqual({
    revision: "rev-9",
    level: "default",
  });
});

it("resets a pending pick when the saved endpoint changes, even to one that offers it", async () => {
  const first = { savedUrl: "https://api.example.com/v1" };
  let tree = await settle(card(first), own);
  pick(tree, "low");
  tree = await settle(card(first), own);
  expect(select(tree).props.value).toBe("low");

  tree = await settle(card({ savedUrl: "https://api.example.org/v1" }), own);
  expect(select(tree).props.value).toBe("default");
});

it("keeps the submitted level on screen when the settings reload fails after a save", async () => {
  requests = installFetch((request) =>
    request.path === "/api/settings"
      ? { status: 500, body: { error: "down" } }
      : { body: { revision: "rev-10" } }
  );
  let tree = await settle(card(), own);
  pick(tree, "low");
  tree = await settle(card(), own);
  (saveButton(tree).props.onClick as () => void)();
  tree = await settle(card(), own);
  expect(requests.some((request) => request.path === "/api/settings")).toBe(true);
  expect(allText(tree)).toContain("Reasoning level saved.");
  expect(select(tree).props.value).toBe("low");
});

it("turns the Select off while a save runs, so a later pick cannot be lost", async () => {
  let release!: (reply: { body: unknown }) => void;
  const pending = new Promise<{ body: unknown }>((done) => (release = done));
  requests = installFetch((request) =>
    request.path === SAVE ? pending : { body: { revision: "rev-10", settings: {} } }
  );
  let tree = await settle(card(), own);
  expect(select(tree).props.disabled).toBeFalsy();
  pick(tree, "low");
  tree = await settle(card(), own);
  (saveButton(tree).props.onClick as () => void)();
  tree = await settle(card(), own);
  expect(allText(tree)).toContain("Saving reasoning level");
  expect(select(tree).props.disabled).toBe(true);

  release({ body: { revision: "rev-10" } });
  tree = await settle(card(), own);
  expect(select(tree).props.disabled).toBeFalsy();
});

const HAND_WRITTEN = { reasoning: { max_tokens: 2000 } };
const dialogOf = (tree: Node[]) => byType(tree, SettingsConfirmDialog)[0];
const posts = () => requests.filter((request) => request.path === SAVE);

it("asks before it replaces a hand-written value, and sends nothing until confirmed", async () => {
  const props = { saved: HAND_WRITTEN };
  let tree = await settle(card(props), own);
  pick(tree, "low");
  tree = await settle(card(props), own);
  (saveButton(tree).props.onClick as () => void)();
  tree = await settle(card(props), own);

  const dialog = dialogOf(tree)!;
  expect(dialog.props.confirmLabel).toBe("Replace");
  expect(text(dialog.props.title)).toBe("Replace the value in the config file?");
  expect(posts()).toHaveLength(0);

  const result = await dialog.props.onConfirm();
  expect(result).toEqual({ success: true });
  expect(posts()).toHaveLength(1);
  expect(posts()[0]!.body).toEqual({ revision: "rev-9", level: "low" });
  tree = await settle(card(props), own);
  expect(allText(tree)).toContain("Reasoning level saved.");
});

it("sends nothing when the hand-written value dialog is cancelled", async () => {
  const props = { saved: HAND_WRITTEN };
  let tree = await settle(card(props), own);
  pick(tree, "low");
  tree = await settle(card(props), own);
  (saveButton(tree).props.onClick as () => void)();
  tree = await settle(card(props), own);
  dialogOf(tree)!.props.onClose();
  tree = await settle(card(props), own);
  expect(dialogOf(tree)).toBeUndefined();
  expect(posts()).toHaveLength(0);
});

it("shows a server error inside the dialog and leaves the card without a saved notice", async () => {
  requests = installFetch((request) =>
    request.path === SAVE
      ? { status: 409, body: { error: "The settings changed. Reload and try again." } }
      : { body: { revision: "rev-10", settings: {} } }
  );
  const props = { saved: HAND_WRITTEN };
  let tree = await settle(card(props), own);
  pick(tree, "low");
  tree = await settle(card(props), own);
  (saveButton(tree).props.onClick as () => void)();
  tree = await settle(card(props), own);
  const result = await dialogOf(tree)!.props.onConfirm();
  expect(result.success).toBe(false);
  expect(result.error).toContain("The settings changed.");
  tree = await settle(card(props), own);
  expect(allText(tree)).not.toContain("Reasoning level saved.");
});

it("saves straight away, with no dialog, when no hand-written value is saved", async () => {
  for (const saved of [{}, { reasoning: { effort: "high" } }]) {
    resetRender();
    requests = installFetch(() => ({ body: { revision: "rev-10", settings: {} } }));
    let tree = await settle(card({ saved }), own);
    pick(tree, "low");
    tree = await settle(card({ saved }), own);
    (saveButton(tree).props.onClick as () => void)();
    tree = await settle(card({ saved }), own);
    expect(dialogOf(tree)).toBeUndefined();
    expect(posts()).toHaveLength(1);
  }
});

it("shows the replace dialog in Arabic", async () => {
  setLanguage("ar");
  const props = { saved: HAND_WRITTEN };
  let tree = await settle(card(props), own);
  pick(tree, "low");
  tree = await settle(card(props), own);
  (byType(tree, Button)[0]!.props.onClick as () => void)();
  tree = await settle(card(props), own);
  const title = text(dialogOf(tree)!.props.title);
  expect(title).toBe(translateSettings("Replace the value in the config file?", "ar"));
  expect(title).not.toBe("Replace the value in the config file?");
});
