import { beforeEach, expect, it } from "bun:test";
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
  type Request,
} from "./space-kit.tsx";

installReact();

const { ExternalApiSection } =
  await import("../src/lib/components/settings/ExternalApiSection.tsx");
const { OpenRouterRouting, ProviderRows } =
  await import("../src/lib/components/settings/OpenRouterRouting.tsx");
const { SettingRow } = await import("../src/lib/components/settings/SettingRow.tsx");
const { ReasoningLevel } = await import("../src/lib/components/settings/ReasoningLevel.tsx");
const { KeySourceField } = await import("../src/lib/components/settings/KeySourceField.tsx");
const { SettingsConfirmDialog } =
  await import("../src/lib/components/settings/SettingsConfirmDialog.tsx");
const { SettingsChangeList } =
  await import("../src/lib/components/settings/SettingsChangeList.tsx");
const { Button } = await import("../src/lib/components/ui/button.tsx");
const { Select } = await import("../src/lib/components/ui/select.tsx");
const { setLanguage } = await import("../src/lib/i18n/index.ts");

const own = [ExternalApiSection, OpenRouterRouting, ProviderRows, SettingRow];

const snapshot = (url = "https://api.example.com/v1", model = "glm-5-turbo") => ({
  revision: "rev-1",
  settings: {
    memoryApiUrl: { globalValue: url },
    memoryModel: { globalValue: model },
    memoryProvider: { globalValue: "openai-chat" },
  },
  externalKey: { source: null, reference: null, resolvesInWebApp: false, warning: null },
  openrouterProvider: null,
});

let requests: Request[] = [];
let testReply: { status?: number; body: unknown } = { body: { ok: true, model: "x/y" } };
let keyReply: { status?: number; body: unknown } = { body: { revision: "rev-3" } };
function serve() {
  requests = installFetch((request) => {
    if (request.path === "/api/settings/external-api/test") return testReply;
    if (request.path === "/api/settings/external-api/key") return keyReply;
    if (request.path.startsWith("/api/settings/external-api/openrouter")) {
      return { body: { ok: true, providers: [], models: [] } };
    }
    return { body: snapshot() };
  });
}
const buttonOf = (tree: Node[], label: string) =>
  byType(tree, Button).find((node) => text(node.props.children).trim() === label)!;
const inputByHolder = (tree: Node[], holder: string) =>
  tree.find((node) => node.props.placeholder === holder)!;
const type = (node: Node, value: string) => node.props.onChange({ target: { value } });
const keyField = (tree: Node[]) => byType(tree, KeySourceField)[0]!;
const post = (path: string) => requests.find((request) => request.path === path);
const dialogOf = (tree: Node[]) => byType(tree, SettingsConfirmDialog)[0];
const bodyChildren = (dialog: Node) =>
  ([dialog.props.body.props.children].flat() as Node[]).filter(Boolean);
/** What the dialog lists: one row per setting the save changes. */
const rowsOf = (dialog: Node) =>
  (
    bodyChildren(dialog).find((node) => node.type === SettingsChangeList)!.props as {
      changes: unknown[];
    }
  ).changes;
const leadOf = (dialog: Node) => text(bodyChildren(dialog).find((node) => node.type === "p"));
/** Confirm the open dialog, then let it close as it does when the request succeeds. */
async function confirm(tree: Node[]) {
  const dialog = dialogOf(tree)!;
  const result = await dialog.props.onConfirm();
  dialog.props.onClose();
  return result;
}

beforeEach(() => {
  resetRender();
  setLanguage("en");
  testReply = { body: { ok: true, model: "x/y" } };
  keyReply = { body: { revision: "rev-3" } };
  serve();
});

it("tests the values typed in the form, not the saved ones", async () => {
  let tree = await settle(<ExternalApiSection />, own);
  type(inputByHolder(tree, "glm-5-turbo"), "glm-6");
  tree = await settle(<ExternalApiSection />, own);
  buttonOf(tree, "Test").props.onClick();
  tree = await settle(<ExternalApiSection />, own);
  expect(post("/api/settings/external-api/test")!.body).toEqual({
    provider: "openai-chat",
    url: "https://api.example.com/v1",
    model: "glm-6",
  });
  // The provider's display name and the model, not the "openai-chat/glm-6" id pair.
  expect(allText(tree)).toContain("The test call worked: OpenAI Chat Completions, model glm-6.");
  expect(allText(tree)).not.toContain("openai-chat/");
  // A test saves nothing.
  expect(requests.some((request) => request.method === "PATCH")).toBe(false);
});

it("sends a pasted key to the test in memory only and never shows it", async () => {
  let tree = await settle(<ExternalApiSection />, own);
  keyField(tree).props.onChoice("paste");
  tree = await settle(<ExternalApiSection />, own);
  keyField(tree).props.onInput({ name: "memory-api", path: "", value: "sk-secret-123" });
  tree = await settle(<ExternalApiSection />, own);
  buttonOf(tree, "Test").props.onClick();
  tree = await settle(<ExternalApiSection />, own);
  expect(post("/api/settings/external-api/test")!.body.key).toBe("sk-secret-123");
  expect(requests.some((request) => request.method === "PATCH")).toBe(false);
  expect(post("/api/settings/external-api/key")).toBeUndefined();
  expect(allText(tree)).not.toContain("sk-secret-123");
});

it("sends an environment variable to the test as a reference", async () => {
  let tree = await settle(<ExternalApiSection />, own);
  keyField(tree).props.onChoice("env");
  tree = await settle(<ExternalApiSection />, own);
  keyField(tree).props.onInput({ name: "ZAI_API_KEY", path: "", value: "" });
  tree = await settle(<ExternalApiSection />, own);
  buttonOf(tree, "Test").props.onClick();
  await settle(<ExternalApiSection />, own);
  expect(post("/api/settings/external-api/test")!.body.key).toBe("env://ZAI_API_KEY");
});

const RAW_401 = 'API error: 401 - {"error":{"message":"Incorrect API key provided"}}';
const refused = { ok: false, error: RAW_401, reason: "refused", status: 401 };
const unreachable = { ok: false, error: "TypeError: fetch failed", reason: "unreachable" };

it("says why a test failed in plain translated words, with the status as small text", async () => {
  testReply = { body: refused };
  setLanguage("ar");
  let tree = await settle(<ExternalApiSection />, own);
  buttonOf(tree, "اختبار").props.onClick();
  tree = await settle(<ExternalApiSection />, own);
  const page = allText(tree);
  expect(page).toContain("رفض المزوّد المفتاح");
  expect(page).toContain("401");
  // Never the provider's raw reply, and no English left in the sentence.
  for (const raw of ["API error", "Incorrect API key", "{", "Test call failed", "refused"]) {
    expect(page).not.toContain(raw);
  }
});

it("words each failure reason as its own sentence", async () => {
  const sentences: Array<[Record<string, unknown>, string]> = [
    [{ reason: "not-found", status: 404 }, "The address or the model was not found."],
    [{ reason: "rate-limited", status: 429 }, "The provider got too many requests."],
    [{ reason: "provider", status: 503 }, "The provider had a problem on its side."],
    [{ reason: "unreachable" }, "OMMS could not reach the address."],
  ];
  for (const [reply, sentence] of sentences) {
    resetRender();
    testReply = { body: { ok: false, error: "raw body", ...reply } };
    let tree = await settle(<ExternalApiSection />, own);
    buttonOf(tree, "Test").props.onClick();
    tree = await settle(<ExternalApiSection />, own);
    expect(allText(tree)).toContain(sentence);
    expect(allText(tree)).not.toContain("raw body");
  }
});

const tests = () =>
  requests.filter((request) => request.path === "/api/settings/external-api/test");
const patched = () => requests.some((request) => request.method === "PATCH");

it("Save tests the form values first, then confirms, and saves only after the user confirms", async () => {
  let tree = await settle(<ExternalApiSection />, own);
  type(inputByHolder(tree, "glm-5-turbo"), "glm-6");
  tree = await settle(<ExternalApiSection />, own);
  buttonOf(tree, "Save settings").props.onClick();
  tree = await settle(<ExternalApiSection />, own);
  expect(tests()).toHaveLength(1);
  expect(tests()[0]!.body.model).toBe("glm-6");

  const dialog = dialogOf(tree)!;
  expect(dialog.props.title).toBe("Save external API settings?");
  expect(dialog.props.confirmLabel).toBe("Save settings");
  expect(rowsOf(dialog)).toEqual([
    { key: "memoryModel", label: "Model name", from: "glm-5-turbo", to: "glm-6" },
  ]);
  expect(patched()).toBe(false);

  await confirm(tree);
  tree = await settle(<ExternalApiSection />, own);
  expect(patched()).toBe(true);
  const patch = requests.find((request) => request.method === "PATCH")!;
  expect(requests.indexOf(tests()[0]!)).toBeLessThan(requests.indexOf(patch));
  expect(patch.body).toEqual({ revision: "rev-1", edits: { memoryModel: "glm-6" } });
  expect(allText(tree)).toContain("Saved. New capture and profile work uses these settings.");
});

it("sends nothing on Cancel, and the typed model stays as a draft", async () => {
  let tree = await settle(<ExternalApiSection />, own);
  type(inputByHolder(tree, "glm-5-turbo"), "glm-6");
  tree = await settle(<ExternalApiSection />, own);
  buttonOf(tree, "Save settings").props.onClick();
  tree = await settle(<ExternalApiSection />, own);
  dialogOf(tree)!.props.onClose();
  tree = await settle(<ExternalApiSection />, own);

  expect(dialogOf(tree)).toBeUndefined();
  expect(patched()).toBe(false);
  expect(allText(tree)).not.toContain("Saved. New capture and profile work uses these settings.");
  // The typed model stays, so Save can be used again.
  expect(inputByHolder(tree, "glm-5-turbo").props.value).toBe("glm-6");
  buttonOf(tree, "Save settings").props.onClick();
  tree = await settle(<ExternalApiSection />, own);
  await confirm(tree);
  await settle(<ExternalApiSection />, own);
  expect(patched()).toBe(true);
});

it("Save never saves a key the provider refuses (401 or 403)", async () => {
  for (const status of [401, 403]) {
    resetRender();
    serve();
    testReply = { body: { ...refused, status } };
    let tree = await settle(<ExternalApiSection />, own);
    type(inputByHolder(tree, "glm-5-turbo"), "glm-6");
    keyField(tree).props.onChoice("paste");
    tree = await settle(<ExternalApiSection />, own);
    keyField(tree).props.onInput({ name: "zai", path: "", value: "sk-secret-123" });
    tree = await settle(<ExternalApiSection />, own);
    buttonOf(tree, "Save settings").props.onClick();
    tree = await settle(<ExternalApiSection />, own);
    expect(tests()).toHaveLength(1);
    expect(patched()).toBe(false);
    expect(post("/api/settings/external-api/key")).toBeUndefined();
    expect(byType(tree, SettingsConfirmDialog)).toHaveLength(0);
    expect(allText(tree)).toContain("The provider refused the key.");
    expect(allText(tree)).toContain("Nothing was saved.");
    expect(allText(tree)).not.toContain("sk-secret-123");
  }
});

it("Save asks before it saves when the provider cannot be reached, and Cancel saves nothing", async () => {
  testReply = { body: unreachable };
  let tree = await settle(<ExternalApiSection />, own);
  type(inputByHolder(tree, "glm-5-turbo"), "glm-6");
  tree = await settle(<ExternalApiSection />, own);
  buttonOf(tree, "Save settings").props.onClick();
  tree = await settle(<ExternalApiSection />, own);
  const dialog = byType(tree, SettingsConfirmDialog)[0]!;
  expect(dialog.props.confirmLabel).toBe("Save anyway");
  // The Save-anyway dialog is the confirmation for this click, so it also lists the changes.
  expect(rowsOf(dialog)).toEqual([
    { key: "memoryModel", label: "Model name", from: "glm-5-turbo", to: "glm-6" },
  ]);
  expect(patched()).toBe(false);
  dialog.props.onClose();
  tree = await settle(<ExternalApiSection />, own);
  expect(byType(tree, SettingsConfirmDialog)).toHaveLength(0);
  expect(patched()).toBe(false);
});

it("Save anyway saves without a second test call", async () => {
  testReply = { body: unreachable };
  let tree = await settle(<ExternalApiSection />, own);
  type(inputByHolder(tree, "glm-5-turbo"), "glm-6");
  tree = await settle(<ExternalApiSection />, own);
  buttonOf(tree, "Save settings").props.onClick();
  tree = await settle(<ExternalApiSection />, own);
  const result = await byType(tree, SettingsConfirmDialog)[0]!.props.onConfirm();
  expect(result.success).toBe(true);
  await settle(<ExternalApiSection />, own);
  expect(patched()).toBe(true);
  expect(tests()).toHaveLength(1);
});

it("clears the URL: a confirm dialog says the external API turns off, then saves null", async () => {
  let tree = await settle(<ExternalApiSection />, own);
  type(inputByHolder(tree, "https://api.example.com/v1"), "");
  tree = await settle(<ExternalApiSection />, own);
  buttonOf(tree, "Save settings").props.onClick();
  tree = await settle(<ExternalApiSection />, own);

  const dialog = dialogOf(tree)!;
  expect(dialog.props.title).toBe("Save external API settings?");
  expect(leadOf(dialog)).toBe("The external API will be turned off.");
  expect(rowsOf(dialog)).toEqual([
    {
      key: "memoryApiUrl",
      label: "Model service address",
      from: "https://api.example.com/v1",
      to: "Default (Not set)",
    },
  ]);
  // An emptied address turns the external API off: there is nothing to test, and nothing is sent.
  expect(post("/api/settings/external-api/test")).toBeUndefined();
  expect(patched()).toBe(false);

  await confirm(tree);
  await settle(<ExternalApiSection />, own);
  const patch = requests.find((request) => request.method === "PATCH")!;
  expect(patch.body).toEqual({ revision: "rev-1", edits: { memoryApiUrl: null } });
});

it("clears the model: the same turn-off confirm, and nothing is sent before the user confirms", async () => {
  let tree = await settle(<ExternalApiSection />, own);
  type(inputByHolder(tree, "glm-5-turbo"), "");
  tree = await settle(<ExternalApiSection />, own);
  buttonOf(tree, "Save settings").props.onClick();
  tree = await settle(<ExternalApiSection />, own);
  const dialog = dialogOf(tree)!;
  expect(leadOf(dialog)).toBe("The external API will be turned off.");
  expect(rowsOf(dialog)).toEqual([
    { key: "memoryModel", label: "Model name", from: "glm-5-turbo", to: "Default (Not set)" },
  ]);
  expect(post("/api/settings/external-api/test")).toBeUndefined();
  expect(patched()).toBe(false);

  await confirm(tree);
  await settle(<ExternalApiSection />, own);
  expect(requests.find((request) => request.method === "PATCH")!.body).toEqual({
    revision: "rev-1",
    edits: { memoryModel: null },
  });
});

it("refuses a URL without http:// or https:// and says why next to the field", async () => {
  let tree = await settle(<ExternalApiSection />, own);
  type(inputByHolder(tree, "https://api.example.com/v1"), "api.example.com/v1");
  tree = await settle(<ExternalApiSection />, own);
  expect(allText(tree)).toContain("The URL must start with http:// or https://.");
  expect(buttonOf(tree, "Save settings").props.disabled).toBe(true);
});

it("shows provider display names, not ids", async () => {
  const tree = await settle(<ExternalApiSection />, own);
  const select = byType(tree, Select).find((node) => node.props["aria-label"] === "Provider")!;
  const labels = [select.props.children].flat(2).map((node: Node) => text(node.props.children));
  expect(labels).toContain("OpenAI Chat Completions");
  expect(labels).toContain("Google Gemini");
  expect(labels).not.toContain("openai-chat");
});

it("saves a pasted key as a private file with the setting name and the fresh revision", async () => {
  let tree = await settle(<ExternalApiSection />, own);
  type(inputByHolder(tree, "glm-5-turbo"), "glm-6");
  keyField(tree).props.onChoice("paste");
  tree = await settle(<ExternalApiSection />, own);
  keyField(tree).props.onInput({ name: "zai", path: "", value: "sk-secret-123" });
  tree = await settle(<ExternalApiSection />, own);
  buttonOf(tree, "Save settings").props.onClick();
  tree = await settle(<ExternalApiSection />, own);
  // The dialog names the key source, never the key itself.
  const dialog = dialogOf(tree)!;
  expect(rowsOf(dialog)).toEqual([
    { key: "memoryModel", label: "Model name", from: "glm-5-turbo", to: "glm-6" },
    { key: "memoryApiKey", label: "Model service key", from: "Not set", to: "key file zai" },
  ]);
  expect(JSON.stringify(rowsOf(dialog))).not.toContain("sk-secret-123");
  expect(patched()).toBe(false);
  await confirm(tree);
  tree = await settle(<ExternalApiSection />, own);
  expect(post("/api/settings/external-api/key")!.body).toMatchObject({
    setting: "memoryApiKey",
    source: "paste",
    name: "zai",
    value: "sk-secret-123",
  });
  // The key saves first, so a refused key saves nothing; the PATCH carries the key's revision.
  const patch = requests.find((request) => request.method === "PATCH")!;
  expect(patch.body).toEqual({ revision: "rev-3", edits: { memoryModel: "glm-6" } });
  expect(post("/api/settings/external-api/key")!.body.revision).toBe("rev-1");
  expect(requests.indexOf(post("/api/settings/external-api/key")!)).toBeLessThan(
    requests.indexOf(patch)
  );
  const page = allText(tree);
  expect(page).not.toContain("sk-secret-123");
  expect(keyField(tree).props.input.value).toBe("");
});

it("checks the key before any request: a bad variable name saves nothing", async () => {
  let tree = await settle(<ExternalApiSection />, own);
  type(inputByHolder(tree, "glm-5-turbo"), "glm-6");
  keyField(tree).props.onChoice("env");
  tree = await settle(<ExternalApiSection />, own);
  keyField(tree).props.onInput({ name: "BAD NAME", path: "", value: "" });
  tree = await settle(<ExternalApiSection />, own);
  buttonOf(tree, "Save settings").props.onClick();
  tree = await settle(<ExternalApiSection />, own);
  expect(requests.some((request) => request.method === "PATCH")).toBe(false);
  expect(post("/api/settings/external-api/key")).toBeUndefined();
  expect(post("/api/settings/external-api/test")).toBeUndefined();
  expect(allText(tree)).toContain("Enter a variable name such as ZAI_API_KEY");
});

it("saves nothing when the server refuses the key, and the dialog stays open with the reason", async () => {
  keyReply = { status: 400, body: { error: "Enter the path of a key file" } };
  setLanguage("zh");
  let tree = await settle(<ExternalApiSection />, own);
  type(inputByHolder(tree, "glm-5-turbo"), "glm-6");
  keyField(tree).props.onChoice("file");
  tree = await settle(<ExternalApiSection />, own);
  keyField(tree).props.onInput({ name: "", path: "/missing/key", value: "" });
  tree = await settle(<ExternalApiSection />, own);
  buttonOf(tree, "保存设置").props.onClick();
  tree = await settle(<ExternalApiSection />, own);
  const result = await dialogOf(tree)!.props.onConfirm();
  expect(result.success).toBe(false);
  expect(requests.some((request) => request.method === "PATCH")).toBe(false);
  // The reason stays inside the dialog; the card shows it in the page's language.
  tree = await settle(<ExternalApiSection />, own);
  expect(dialogOf(tree)).toBeDefined();
  expect(allText(tree)).not.toContain("Enter the path of a key file");
});

it("clears every key field after a save, so Save turns off", async () => {
  let tree = await settle(<ExternalApiSection />, own);
  keyField(tree).props.onChoice("env");
  tree = await settle(<ExternalApiSection />, own);
  keyField(tree).props.onInput({ name: "ZAI_API_KEY", path: "", value: "" });
  tree = await settle(<ExternalApiSection />, own);
  buttonOf(tree, "Save settings").props.onClick();
  tree = await settle(<ExternalApiSection />, own);
  await confirm(tree);
  tree = await settle(<ExternalApiSection />, own);
  expect(keyField(tree).props.input).toEqual({ name: "", path: "", value: "" });
  expect(buttonOf(tree, "Save settings").props.disabled).toBe(true);
});

it("asks in a dialog before it replaces a key file, and replaces only after confirm", async () => {
  keyReply = { status: 409, body: { error: "Confirm to replace the existing key file" } };
  let tree = await settle(<ExternalApiSection />, own);
  keyField(tree).props.onChoice("paste");
  tree = await settle(<ExternalApiSection />, own);
  keyField(tree).props.onInput({ name: "zai", path: "", value: "sk-secret-123" });
  tree = await settle(<ExternalApiSection />, own);
  buttonOf(tree, "Save settings").props.onClick();
  tree = await settle(<ExternalApiSection />, own);
  // The save confirms first; the key file question replaces the open dialog, with no second one.
  const saveDialog = dialogOf(tree)!;
  expect(saveDialog.props.confirmLabel).toBe("Save settings");
  expect(
    requests.filter((request) => request.path === "/api/settings/external-api/key")
  ).toHaveLength(0);
  await saveDialog.props.onConfirm();
  tree = await settle(<ExternalApiSection />, own);
  expect(
    requests.filter((request) => request.path === "/api/settings/external-api/key")
  ).toHaveLength(1);
  const replaceDialog = dialogOf(tree)!;
  expect(replaceDialog.props.confirmLabel).toBe("Replace");
  expect(replaceDialog.props.title).toBe("Replace the key file?");
  expect(byType(tree, SettingsConfirmDialog)).toHaveLength(1);
  keyReply = { body: { revision: "rev-3" } };
  const result = await replaceDialog.props.onConfirm();
  expect(result.success).toBe(true);
  const all = requests.filter((request) => request.path === "/api/settings/external-api/key");
  expect(all).toHaveLength(2);
  expect(all[1]!.body.replace).toBe(true);
});

it("keeps a refused save inside the dialog, which stays open until the user decides", async () => {
  const REFUSED = "Config changed. Reload settings and save again.";
  requests = installFetch((request) => {
    if (request.path === "/api/settings/external-api/test") return testReply;
    if (request.method === "PATCH") return { status: 409, body: { error: REFUSED } };
    return { body: snapshot() };
  });
  let tree = await settle(<ExternalApiSection />, own);
  type(inputByHolder(tree, "glm-5-turbo"), "glm-6");
  tree = await settle(<ExternalApiSection />, own);
  buttonOf(tree, "Save settings").props.onClick();
  tree = await settle(<ExternalApiSection />, own);
  const result = await dialogOf(tree)!.props.onConfirm();
  expect(result).toMatchObject({ success: false, error: REFUSED });
  tree = await settle(<ExternalApiSection />, own);
  expect(dialogOf(tree)).toBeDefined();
  expect(allText(tree)).toContain(REFUSED);
  expect(allText(tree)).not.toContain("Saved. New capture and profile work uses these settings.");
});

it("uses no raw button and no window.confirm", () => {
  const source = readFileSync(
    new URL("../src/lib/components/settings/ExternalApiSection.tsx", import.meta.url),
    "utf8"
  );
  expect(source).not.toMatch(/<button|<input|window\.confirm/);
});

it("names all three hosts in its description", async () => {
  const tree = await settle(<ExternalApiSection />, own);
  const words = allText(tree);
  expect(words).toContain("OpenCode, Pi and Claude Code");
  expect(words).not.toContain("either host");
});

it("turns Save off and says why while the config file cannot be read", async () => {
  requests = installFetch((request) =>
    request.method === "GET" && request.path === "/api/settings"
      ? { body: { ...snapshot(), readOnly: true } }
      : { body: { ok: true } }
  );
  let tree = await settle(<ExternalApiSection />, own);
  type(inputByHolder(tree, "glm-5-turbo"), "glm-6");
  tree = await settle(<ExternalApiSection />, own);
  expect(buttonOf(tree, "Save settings").props.disabled).toBe(true);
  expect(allText(tree)).toContain("Saving is turned off until the file is fixed.");
});

it("gives the Reasoning level the saved endpoint and marks an unsaved edit", async () => {
  let tree = await settle(<ExternalApiSection />, own);
  const card = () => byType(tree, ReasoningLevel)[0]!;
  expect(card().props).toMatchObject({
    savedUrl: "https://api.example.com/v1",
    savedProvider: "openai-chat",
    savedModel: "glm-5-turbo",
    unsaved: false,
  });
  type(inputByHolder(tree, "glm-5-turbo"), "glm-6");
  tree = await settle(<ExternalApiSection />, own);
  // The level follows the saved model until the edit is saved, and Save turns off meanwhile.
  expect(card().props).toMatchObject({ savedModel: "glm-5-turbo", unsaved: true });
});
