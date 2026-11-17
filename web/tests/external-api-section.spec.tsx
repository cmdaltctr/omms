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
const { KeySourceField } = await import("../src/lib/components/settings/KeySourceField.tsx");
const { SettingsConfirmDialog } =
  await import("../src/lib/components/settings/SettingsConfirmDialog.tsx");
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

it("Save tests the form values first and saves after the test passes, with one test call", async () => {
  let tree = await settle(<ExternalApiSection />, own);
  type(inputByHolder(tree, "glm-5-turbo"), "glm-6");
  tree = await settle(<ExternalApiSection />, own);
  buttonOf(tree, "Save settings").props.onClick();
  await settle(<ExternalApiSection />, own);
  expect(tests()).toHaveLength(1);
  expect(tests()[0]!.body.model).toBe("glm-6");
  const patch = requests.find((request) => request.method === "PATCH")!;
  expect(requests.indexOf(tests()[0]!)).toBeLessThan(requests.indexOf(patch));
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

it("clears the URL: an emptied field saves null so the key is removed", async () => {
  let tree = await settle(<ExternalApiSection />, own);
  type(inputByHolder(tree, "https://api.example.com/v1"), "");
  tree = await settle(<ExternalApiSection />, own);
  buttonOf(tree, "Save settings").props.onClick();
  await settle(<ExternalApiSection />, own);
  const patch = requests.find((request) => request.method === "PATCH")!;
  expect(patch.body).toEqual({ revision: "rev-1", edits: { memoryApiUrl: null } });
  // An emptied address turns the external API off: there is nothing to test.
  expect(post("/api/settings/external-api/test")).toBeUndefined();
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

it("saves nothing when the server refuses the key, and translates the reason", async () => {
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
  expect(requests.some((request) => request.method === "PATCH")).toBe(false);
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
  const dialog = byType(tree, SettingsConfirmDialog)[0]!;
  expect(dialog).toBeDefined();
  const first = requests.filter((request) => request.path === "/api/settings/external-api/key");
  expect(first).toHaveLength(1);
  keyReply = { body: { revision: "rev-3" } };
  const result = await dialog.props.onConfirm();
  expect(result.success).toBe(true);
  const all = requests.filter((request) => request.path === "/api/settings/external-api/key");
  expect(all).toHaveLength(2);
  expect(all[1]!.body.replace).toBe(true);
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
