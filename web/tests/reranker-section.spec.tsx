import { beforeEach, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import {
  allText,
  byText,
  byType,
  installFetch,
  installReact,
  render,
  resetRender,
  settle,
  text,
  type Node,
  type Request,
} from "./space-kit.tsx";

installReact();

const { RerankerSection } = await import("../src/lib/components/memory/RerankerSection.tsx");
const { SettingRow } = await import("../src/lib/components/settings/SettingRow.tsx");
const { KeySourceField } = await import("../src/lib/components/settings/KeySourceField.tsx");
const { SettingsConfirmDialog } =
  await import("../src/lib/components/settings/SettingsConfirmDialog.tsx");
const { Button } = await import("../src/lib/components/ui/button.tsx");
const { Input } = await import("../src/lib/components/ui/input.tsx");
const { setLanguage } = await import("../src/lib/i18n/index.ts");
const { translateSettings } = await import("../src/lib/i18n/settings.ts");
const controls = await import("../src/lib/reranker-controls.ts");
const { SHARED_ROW_IDS } = await import("../src/lib/memory-sections.ts");

const own = [RerankerSection, SettingRow];
const element = <RerankerSection />;
const SERVER = "http://127.0.0.1:3008/v1";

type Secret = { set: boolean; source: string | null; reference: string | null };
function snapshotFixture(secret: Secret = { set: false, source: null, reference: null }) {
  return {
    revision: "rev-1",
    settings: {
      rerankerEnabled: { value: false, source: "default", globalValue: false },
      rerankerApiUrl: { value: undefined, source: "default" },
      rerankerModel: { value: undefined, source: "default" },
      rerankerTimeoutMs: { value: 4000, source: "default", globalValue: 4000 },
    },
    secrets: { rerankerApiKey: secret },
  };
}

let requests: Request[] = [];
type Reply = { status?: number; body: unknown } | undefined;
function serve(secret?: Secret, reply?: (request: Request) => Reply) {
  requests = installFetch((request) => {
    const custom = reply?.(request);
    if (custom) return custom;
    if (request.method === "PATCH") return { body: { revision: "rev-3" } };
    return { body: snapshotFixture(secret) };
  });
}
async function load(secret?: Secret, reply?: Parameters<typeof serve>[1]) {
  serve(secret, reply);
  return settle(element, own);
}
const after = () => render(element, own);
const flush = async () => {
  for (let tick = 0; tick < 6; tick++) await new Promise((resolve) => setTimeout(resolve, 0));
};
const field = (tree: Node[], id: string) => byType(tree, Input).find((n) => n.props.id === id)!;
const enable = (tree: Node[]) => tree.find((n) => n.props.id === "reranker-enabled")!;
const setEnabled = (tree: Node[], checked: boolean) => enable(tree).props.onCheckedChange(checked);
const keyField = (tree: Node[]) => byType(tree, KeySourceField)[0]!;
const typeInto = (tree: Node[], id: string, value: string) =>
  field(tree, id).props.onChange({ target: { value } });
const statusLine = (tree: Node[]) =>
  text(tree.find((n) => n.props.role === "status" && n.type === "p")?.props.children);
async function fillServer(tree: Node[]) {
  setEnabled(tree, true);
  typeInto(after(), "reranker-url", SERVER);
  typeInto(after(), "reranker-model", "Qwen3-Reranker-0.6B");
  return after();
}
const click = async (tree: Node[], label: string) => {
  await byText(tree, Button, label)[0]!.props.onClick();
  await flush();
};

beforeEach(() => {
  resetRender();
  setLanguage("en");
});

it("shows the default state: switch off, empty fields, timeout 4000, unchanged search", async () => {
  const tree = await load();
  const words = allText(tree);
  expect(words).toContain("Reranker");
  expect(enable(tree).props.checked).toBe(false);
  expect(field(tree, "reranker-url").props.value).toBe("");
  expect(field(tree, "reranker-model").props.value).toBe("");
  expect(field(tree, "reranker-timeout").props.value).toBe("4000");
  expect(words).toContain("Search is unchanged while the switch is off.");
  expect(words).toContain(
    "The reranker sends the prompt and the text of candidate memories to the server URL. A server on the same machine is recommended."
  );
  expect(words).toContain(
    "A project file cannot change these settings. The reranker settings are global only."
  );
  expect(words).not.toContain("leaves this machine");
});

it("leads each row with a plain name and shows the config key as secondary text", async () => {
  const tree = await load();
  const words = allText(tree);
  for (const [name, key] of [
    ["Reorder results with a reranker", "rerankerEnabled"],
    ["Reranker server address", "rerankerApiUrl"],
    ["Reranker model", "rerankerModel"],
    ["Reranker key", "rerankerApiKey"],
    ["Reranker wait time", "rerankerTimeoutMs"],
  ] as const) {
    expect(words, name).toContain(name);
    expect(words.indexOf(name), key).toBeLessThan(words.indexOf(key));
    const code = tree.find((n) => n.type === "code" && text(n.props.children) === key);
    expect(code?.props.dir, key).toBe("ltr");
  }
});

it("refuses to save with the switch on and a blank URL or model", async () => {
  let tree = await load();
  setEnabled(tree, true);
  tree = after();
  expect(byText(tree, Button, "Save")[0]!.props.disabled).toBe(true);
  expect(allText(tree)).toContain("Enter the server URL and model before turning the reranker on.");
  typeInto(tree, "reranker-url", SERVER);
  expect(byText(after(), Button, "Save")[0]!.props.disabled).toBe(true);
  typeInto(after(), "reranker-model", "m");
  expect(byText(after(), Button, "Save")[0]!.props.disabled).toBe(false);
});

it("accepts only an http:// or https:// URL", async () => {
  let tree = await load();
  typeInto(tree, "reranker-url", "127.0.0.1:3008");
  tree = after();
  expect(byText(tree, Button, "Save")[0]!.props.disabled).toBe(true);
  expect(allText(tree)).toContain("Enter a web address that starts with http:// or https://.");
  typeInto(tree, "reranker-url", SERVER);
  expect(byText(after(), Button, "Save")[0]!.props.disabled).toBe(false);
});

it("uses the shared key-entry control with paste and No key, and no free-text reference box", async () => {
  const tree = await load();
  const key = keyField(tree);
  expect(key.props.optional).toBe(true);
  expect(key.props.choice).toBe("none");
  expect(key.props.id).toBe("reranker-key");
  expect(tree.some((n) => n.props.id === "reranker-key" && n.type !== KeySourceField)).toBe(false);
});

it("shows the saved key source and keeps Save off until a chosen key is complete", async () => {
  let tree = await load({ set: true, source: "env", reference: "RERANK_KEY" });
  expect(keyField(tree).props.choice).toBe("env");
  expect(keyField(tree).props.input.name).toBe("RERANK_KEY");
  // An untouched saved key does not block a save.
  typeInto(tree, "reranker-url", SERVER);
  expect(byText(after(), Button, "Save")[0]!.props.disabled).toBe(false);
  // A pasted key with no text does.
  keyField(tree).props.onChoice("paste");
  tree = after();
  expect(byText(tree, Button, "Save")[0]!.props.disabled).toBe(true);
  expect(allText(tree)).toContain("Paste the key");
  keyField(tree).props.onInput({ name: "rerank", path: "", value: "sk-secret" });
  expect(byText(after(), Button, "Save")[0]!.props.disabled).toBe(false);
});

it("refuses an invalid variable name and out-of-range timeouts", async () => {
  let tree = await load();
  keyField(tree).props.onChoice("env");
  keyField(after()).props.onInput({ name: "not a name", path: "", value: "" });
  tree = after();
  expect(byText(tree, Button, "Save")[0]!.props.disabled).toBe(true);
  expect(allText(tree)).toContain("Enter a variable name such as ZAI_API_KEY");
  keyField(tree).props.onChoice("none");
  for (const timeout of ["100", "40000", "2500.5", ""]) {
    typeInto(after(), "reranker-timeout", timeout);
    expect(byText(after(), Button, "Save")[0]!.props.disabled, `timeout ${timeout}`).toBe(true);
  }
  expect(allText(after())).toContain("Enter a whole number from 500 to 30,000.");
  expect(allText(after())).toContain(
    "OpenCode waits up to 5 seconds for memories before it sends your prompt. The default, 4000 milliseconds, finishes in time. Over 5000, OpenCode can send your prompt without memories."
  );
});

it("shows the remote-host notice only for non-loopback URLs", async () => {
  const tree = await load();
  typeInto(tree, "reranker-url", "https://rerank.example.com/v1");
  expect(allText(after())).toContain("memory text leaves this machine");
  typeInto(after(), "reranker-url", SERVER);
  expect(allText(after())).not.toContain("leaves this machine");
});

it("saves a pasted key to a private file first, then the other settings, with the new revision", async () => {
  const tree = await fillServer(await load());
  typeInto(tree, "reranker-timeout", "6000");
  keyField(after()).props.onChoice("paste");
  keyField(after()).props.onInput({ name: "rerank", path: "", value: "sk-secret" });
  requests.length = 0;
  serve(undefined, (request) =>
    request.path === "/api/settings/external-api/key" ? { body: { revision: "rev-2" } } : undefined
  );
  await click(after(), "Save");
  const writes = requests.filter((r) => r.method !== "GET");
  expect(writes.map((r) => `${r.method} ${r.path}`)).toEqual([
    "POST /api/settings/external-api/key",
    "PATCH /api/settings",
  ]);
  expect(writes[0]!.body).toEqual({
    source: "paste",
    name: "rerank",
    value: "sk-secret",
    replace: false,
    setting: "rerankerApiKey",
    revision: "rev-1",
  });
  expect(writes[1]!.body).toEqual({
    edits: {
      rerankerEnabled: true,
      rerankerApiUrl: SERVER,
      rerankerModel: "Qwen3-Reranker-0.6B",
      rerankerTimeoutMs: 6000,
    },
    revision: "rev-2",
  });
  // The pasted key leaves the form and is never shown again.
  expect(keyField(after()).props.input.value).toBe("");
  expect(statusLine(after())).toBe("Saved. New searches use these settings.");
});

it("saves an environment variable key through the same route", async () => {
  const tree = await fillServer(await load());
  keyField(tree).props.onChoice("env");
  keyField(after()).props.onInput({ name: "RERANK_KEY", path: "", value: "" });
  await click(after(), "Save");
  const key = requests.find((r) => r.path === "/api/settings/external-api/key")!;
  expect(key.body).toMatchObject({ source: "env", name: "RERANK_KEY", setting: "rerankerApiKey" });
});

it("asks before it replaces an existing key file, and sends nothing else until it does", async () => {
  const tree = await fillServer(await load());
  keyField(tree).props.onChoice("paste");
  keyField(after()).props.onInput({ name: "rerank", path: "", value: "sk-new" });
  serve(undefined, (request) =>
    request.path === "/api/settings/external-api/key" && request.body.replace !== true
      ? {
          status: 409,
          body: { error: "A key file named rerank.key exists. Confirm to replace it." },
        }
      : request.path === "/api/settings/external-api/key"
        ? { body: { revision: "rev-2" } }
        : undefined
  );
  await click(after(), "Save");
  expect(requests.some((r) => r.method === "PATCH")).toBe(false);
  const dialog = byType(after(), SettingsConfirmDialog)[0]!;
  expect(dialog).toBeTruthy();
  const result = await dialog.props.onConfirm();
  await flush();
  expect(result.success).toBe(true);
  const keyCalls = requests.filter((r) => r.path === "/api/settings/external-api/key");
  expect(keyCalls.map((r) => r.body.replace)).toEqual([false, true]);
  expect(requests.some((r) => r.method === "PATCH")).toBe(true);
});

it("removes the saved key only when the user chooses No key", async () => {
  const tree = await load({ set: true, source: "file", reference: "/keys/rerank.key" });
  expect(keyField(tree).props.choice).toBe("file");
  keyField(tree).props.onChoice("none");
  typeInto(after(), "reranker-model", "m");
  await click(after(), "Save");
  expect(requests.some((r) => r.path === "/api/settings/external-api/key")).toBe(false);
  const patch = requests.find((r) => r.method === "PATCH")!;
  expect(patch.body.edits.rerankerApiKey).toBeNull();
});

it("tests the values in the form, with the key source from the form", async () => {
  const tree = await fillServer(await load());
  typeInto(tree, "reranker-timeout", "6000");
  keyField(after()).props.onChoice("env");
  keyField(after()).props.onInput({ name: "RERANK_KEY", path: "", value: "" });
  serve(undefined, (request) =>
    request.path === "/api/settings/reranker/test" ? { body: { success: true } } : undefined
  );
  await click(after(), "Test");
  const test = requests.find((r) => r.path === "/api/settings/reranker/test")!;
  expect(test.body).toEqual({
    rerankerApiUrl: SERVER,
    rerankerModel: "Qwen3-Reranker-0.6B",
    rerankerApiKey: "env://RERANK_KEY",
    rerankerTimeoutMs: 6000,
  });
  expect(requests.some((r) => r.method === "PATCH")).toBe(false);
  expect(statusLine(after())).toBe("Test passed.");
});

it("sends a pasted key to the test in memory only and saves nothing", async () => {
  const tree = await fillServer(await load());
  keyField(tree).props.onChoice("paste");
  keyField(after()).props.onInput({ name: "rerank", path: "", value: "sk-secret" });
  serve(undefined, (request) =>
    request.path === "/api/settings/reranker/test" ? { body: { success: true } } : undefined
  );
  await click(after(), "Test");
  const test = requests.find((r) => r.path === "/api/settings/reranker/test")!;
  expect(test.body.rerankerApiKeyValue).toBe("sk-secret");
  expect(test.body.rerankerApiKey).toBeUndefined();
  expect(requests.filter((r) => r.method !== "GET").length).toBe(1);
});

it("shows the server's reason when it refuses a pasted key on a network host", async () => {
  const tree = await fillServer(await load());
  keyField(tree).props.onChoice("paste");
  keyField(after()).props.onInput({ name: "rerank", path: "", value: "sk-secret" });
  serve(undefined, (request) =>
    request.path === "/api/settings/reranker/test"
      ? {
          status: 403,
          body: { error: "Testing a pasted key requires Basic Auth on network hosts" },
        }
      : undefined
  );
  await click(after(), "Test");
  const line = statusLine(after());
  expect(line).toContain("Testing a pasted key requires Basic Auth on network hosts");
  expect(line).not.toContain("could not reach");
});

it("says what went wrong in a sentence, not a code", async () => {
  await fillServer(await load());
  serve(undefined, (request) =>
    request.path === "/api/settings/reranker/test"
      ? { body: { success: false, code: "reranker_unreachable" } }
      : undefined
  );
  await click(after(), "Test");
  const line = statusLine(after());
  expect(line).toContain("OMMS could not reach the reranker server.");
  expect(line).toContain("Check the URL");
  expect(allText(after())).not.toContain("reranker_unreachable");
});

it("shows a general sentence with the code as secondary text for an unknown code", async () => {
  await fillServer(await load());
  serve(undefined, (request) =>
    request.path === "/api/settings/reranker/test"
      ? { body: { success: false, code: "reranker_brand_new" } }
      : undefined
  );
  await click(after(), "Test");
  const status = after().find((n) => n.props.role === "status" && n.type === "p")!;
  expect(text(status.props.children)).toContain("The reranker test failed.");
  const secondary = after().find(
    (n) => n.type === "code" && text(n.props.children) === "reranker_brand_new"
  );
  expect(secondary?.props.dir).toBe("ltr");
});

it("shows a message while the test runs and answers again when it ends", async () => {
  await fillServer(await load());
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  requests = installFetch(async (request) => {
    if (request.path === "/api/settings/reranker/test") {
      await gate;
      return { body: { success: true } };
    }
    return { body: snapshotFixture() };
  });
  const pending = byText(after(), Button, "Test")[0]!.props.onClick();
  await flush();
  expect(allText(after())).toContain("Testing the reranker…");
  release();
  await pending;
  await flush();
  expect(statusLine(after())).toBe("Test passed.");
});

it("restores the saved values on Cancel without any request", async () => {
  const tree = await load();
  typeInto(tree, "reranker-url", "http://x");
  typeInto(after(), "reranker-timeout", "9000");
  requests.length = 0;
  await click(after(), "Cancel");
  expect(field(after(), "reranker-url").props.value).toBe("");
  expect(field(after(), "reranker-timeout").props.value).toBe("4000");
  expect(requests).toEqual([]);
});

it("sits in the Shared view below Memory limits", () => {
  const ids: readonly string[] = SHARED_ROW_IDS;
  expect(ids.indexOf("shared-reranker")).toBe(ids.indexOf("shared-keywords") + 1);
  expect(ids.indexOf("shared-keywords")).toBe(ids.indexOf("shared-limits") + 1);
});

it("has no raw button, no window.confirm, and the pure messages stay translated", () => {
  const source = readFileSync(
    new URL("../src/lib/components/memory/RerankerSection.tsx", import.meta.url),
    "utf8"
  );
  expect(source).not.toMatch(/<button|window\.confirm/);
  for (const message of controls.RERANKER_MESSAGES) {
    expect(translateSettings(message, "zh")).not.toBe(message);
    expect(translateSettings(message, "ar")).not.toBe(message);
  }
});

it("reads in Chinese", async () => {
  setLanguage("zh");
  const tree = await load();
  expect(allText(tree)).not.toContain("Search is unchanged while the switch is off.");
  expect(allText(tree)).not.toContain("Reranker server address");
});
