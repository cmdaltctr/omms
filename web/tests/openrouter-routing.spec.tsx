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

const routing = await import("../src/lib/openrouter-routing.ts");
const { OpenRouterRouting, ProviderRows } =
  await import("../src/lib/components/settings/OpenRouterRouting.tsx");
const { ExternalApiSection } =
  await import("../src/lib/components/settings/ExternalApiSection.tsx");
const { Checkbox } = await import("../src/lib/components/ui/checkbox.tsx");
const { Button } = await import("../src/lib/components/ui/button.tsx");
const { Badge } = await import("../src/lib/components/ui/badge.tsx");
const { Label } = await import("../src/lib/components/ui/label.tsx");
const { Input } = await import("../src/lib/components/ui/input.tsx");
const { Select } = await import("../src/lib/components/ui/select.tsx");
const { setLanguage } = await import("../src/lib/i18n/index.ts");
const { translateSettings } = await import("../src/lib/i18n/settings.ts");

const {
  applyOpenRouterPreset,
  hasUnmanagedFields,
  isOpenRouterUrl,
  policyLabelKey,
  providerFromRouting,
  routingFromProvider,
} = routing;

type Row = { slug: string; name: string; policy: "zdr" | "safety" | "unknown" };
const rows: Row[] = [
  { slug: "deepinfra", name: "DeepInfra", policy: "zdr" },
  { slug: "novita", name: "Novita", policy: "safety" },
  { slug: "together", name: "Together", policy: "unknown" },
];
const off = { dataCollection: false, zdr: false, only: false, ticked: [] as string[] };

// ---- pure helpers ----

it("detects an OpenRouter URL by exact host only", () => {
  expect(isOpenRouterUrl("https://openrouter.ai/api/v1")).toBe(true);
  expect(isOpenRouterUrl("https://openrouter.ai.evil.com/api/v1")).toBe(false);
  expect(isOpenRouterUrl("https://example.com/openrouter.ai")).toBe(false);
  expect(isOpenRouterUrl("https://example.com")).toBe(false);
  expect(isOpenRouterUrl("not a url")).toBe(false);
  expect(isOpenRouterUrl("")).toBe(false);
});

it("saves tried providers as order, and as order + only + no fallback when Use only is on", () => {
  expect(providerFromRouting({ ...off, ticked: ["deepinfra", "novita"] }, rows)).toEqual({
    order: ["deepinfra", "novita"],
  });
  expect(
    providerFromRouting(
      { dataCollection: true, zdr: true, only: true, ticked: ["deepinfra"] },
      rows
    )
  ).toEqual({
    data_collection: "deny",
    zdr: true,
    order: ["deepinfra"],
    only: ["deepinfra"],
    allow_fallbacks: false,
  });
});

it("sends nothing for the list when no provider is ticked, even with Use only on", () => {
  expect(providerFromRouting({ ...off, only: true }, rows)).toEqual({});
  expect(providerFromRouting({ ...off, zdr: true, only: true }, rows)).toEqual({ zdr: true });
  expect(providerFromRouting(off, rows)).toEqual({});
});

it("drops loaded providers that may keep data when Zero data retention only is on", () => {
  const state = { ...off, zdr: true, ticked: ["together", "deepinfra", "my-own-host"] };
  expect(providerFromRouting(state, rows)).toEqual({
    zdr: true,
    order: ["deepinfra", "my-own-host"],
  });
  // Without the switch the same ticks are all kept.
  expect(providerFromRouting({ ...state, zdr: false }, rows).order).toEqual([
    "together",
    "deepinfra",
    "my-own-host",
  ]);
});

it("reads the card state back from a saved provider object", () => {
  const saved = {
    data_collection: "deny",
    zdr: true,
    order: ["deepinfra"],
    only: ["deepinfra"],
    allow_fallbacks: false,
  };
  const state = routingFromProvider(saved);
  expect(state).toEqual({ dataCollection: true, zdr: true, only: true, ticked: ["deepinfra"] });
  expect(providerFromRouting(state, rows)).toEqual(saved);
  expect(routingFromProvider(null)).toEqual(off);
  expect(routingFromProvider({ only: ["novita"] })).toEqual({
    ...off,
    only: true,
    ticked: ["novita"],
  });
  expect(routingFromProvider({ order: ["a", "b"], allow_fallbacks: true }).only).toBe(false);
});

it("never widens the saved only list from order", () => {
  const state = routingFromProvider({ order: ["a", "b", "c"], only: ["a"] });
  expect(state).toEqual({ ...off, only: true, ticked: ["a"] });
  expect(providerFromRouting(state, rows)).toEqual({
    order: ["a"],
    only: ["a"],
    allow_fallbacks: false,
  });
  // The only slugs follow their place in order first, then the rest of only in its own order.
  expect(routingFromProvider({ order: ["c", "x", "a"], only: ["b", "a", "c"] }).ticked).toEqual([
    "c",
    "a",
    "b",
  ]);
});

it("names the policy labels in words", () => {
  expect(policyLabelKey("zdr")).toBe("No retention");
  expect(policyLabelKey("safety")).toBe("Abuse checks only");
  expect(policyLabelKey("unknown")).toBe("May keep or train on data");
});

it("spots provider fields the card does not manage", () => {
  expect(hasUnmanagedFields(null)).toBe(false);
  expect(hasUnmanagedFields({ order: ["a"], only: ["a"], zdr: true })).toBe(false);
  expect(hasUnmanagedFields({ order: ["a"], sort: "price" })).toBe(true);
});

it("the preset changes only the URL and the provider", () => {
  const fields = {
    memoryModel: "deepseek/deepseek-chat",
    memoryApiKey: "env://KEY",
    memoryApiUrl: "https://api.example.com/v1",
    memoryProvider: "anthropic",
  };
  expect(applyOpenRouterPreset(fields)).toEqual({
    memoryModel: "deepseek/deepseek-chat",
    memoryApiKey: "env://KEY",
    memoryApiUrl: "https://openrouter.ai/api/v1",
    memoryProvider: "openai-chat",
  });
  expect(applyOpenRouterPreset({})).toEqual({
    memoryApiUrl: "https://openrouter.ai/api/v1",
    memoryProvider: "openai-chat",
  });
});

// ---- the routing block ----

const own = [OpenRouterRouting, ProviderRows];
const LIST = "/api/settings/external-api/openrouter-providers";
const SAVE = "/api/settings/external-api/openrouter-routing";

let requests: Request[] = [];
beforeEach(() => {
  resetRender();
  setLanguage("en");
});

const block = (props: Partial<Parameters<typeof OpenRouterRouting>[0]> = {}) => (
  <OpenRouterRouting
    model="deepseek/deepseek-chat"
    revision="rev-9"
    saved={null}
    savedIsOpenRouter
    debounceMs={0}
    {...props}
  />
);
const box = (tree: Node[], id: string) =>
  byType(tree, Checkbox).find((node) => node.props.id === id)!;
const statusLines = (tree: Node[]) =>
  tree.filter((node) => node.props.role === "status").map((node) => text(node.props.children));
const buttonNamed = (tree: Node[], label: string) =>
  byType(tree, Button).find((node) => text(node.props.children).trim() === label)!;
const tick = (tree: Node[], slug: string, checked = true) =>
  (box(tree, `openrouter-provider-${slug}`).props.onCheckedChange as (v: boolean) => void)(checked);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

it("shows a loading line while the provider list is requested, then the labels in words", async () => {
  const pending = deferred<{ body: unknown }>();
  requests = installFetch((request) =>
    request.path.startsWith(LIST) ? pending.promise : { body: {} }
  );

  const during = await settle(block(), own);
  expect(statusLines(during).join(" ")).toContain("Loading the provider list");
  expect(allText(during)).not.toContain("No retention");
  expect(requests[0].path).toBe(`${LIST}?model=${encodeURIComponent("deepseek/deepseek-chat")}`);

  pending.resolve({ body: { ok: true, providers: rows } });
  const after = await settle(block(), own);
  expect(statusLines(after).join(" ")).not.toContain("Loading the provider list");
  const words = allText(after);
  expect(words).toContain("DeepInfra");
  expect(words).toContain("No retention");
  expect(words).toContain("Abuse checks only");
  expect(words).toContain("May keep or train on data");
});

it("keeps the switches and the manual field working when the list is not available", async () => {
  requests = installFetch(() => ({
    body: { ok: false, reason: "unreachable", error: "fetch failed: ECONNRESET" },
  }));
  const tree = await settle(block(), own);
  const words = allText(tree);
  expect(words).toContain("The provider list is not available.");
  expect(words).toContain("OpenRouter could not be reached.");
  expect(words).not.toContain("ECONNRESET");
  expect(box(tree, "openrouter-data-collection").props.disabled).toBeFalsy();
  expect(box(tree, "openrouter-zdr").props.disabled).toBeFalsy();
  expect(byType(tree, Input).length).toBe(1);
  expect(buttonNamed(tree, "Add provider").props.disabled).toBeFalsy();
});

it("says OpenRouter has no providers for an unknown model", async () => {
  requests = installFetch(() => ({ body: { ok: false, reason: "unknown-model", error: "x" } }));
  expect(allText(await settle(block(), own))).toContain(
    "OpenRouter has no providers for this model."
  );
});

it("asks for a model ID first and sends no request without one", async () => {
  requests = installFetch(() => ({ body: { ok: true, providers: rows } }));
  const tree = await settle(block({ model: "  " }), own);
  expect(allText(tree)).toContain("Enter a model ID to see its providers.");
  expect(requests.filter((request) => request.path.startsWith(LIST))).toEqual([]);
});

it("loads the list again when the model changes", async () => {
  requests = installFetch(() => ({ body: { ok: true, providers: rows } }));
  await settle(block(), own);
  await settle(block({ model: "qwen/qwen3" }), own);
  const paths = requests.map((request) => request.path);
  expect(paths).toContain(`${LIST}?model=${encodeURIComponent("qwen/qwen3")}`);
});

it("disables and unticks providers that may keep data while Zero data retention only is on", async () => {
  requests = installFetch(() => ({ body: { ok: true, providers: rows } }));
  const saved = { zdr: true, order: ["together", "deepinfra"] };
  const tree = await settle(block({ saved }), own);
  const together = box(tree, "openrouter-provider-together");
  expect(together.props.disabled).toBe(true);
  expect(together.props.checked).toBe(false);
  expect(allText(tree)).toContain("Not available while Zero data retention only is on.");
  const deepinfra = box(tree, "openrouter-provider-deepinfra");
  expect(deepinfra.props.disabled).toBeFalsy();
  expect(deepinfra.props.checked).toBe(true);
  // Its try position counts only the providers that can be used.
  const positions = tree.filter((node) => node.props["data-position"] !== undefined);
  expect(positions.map((node) => [node.props["data-position"], node.props["data-slug"]])).toEqual([
    [1, "deepinfra"],
  ]);
});

it("shows the try order, adds a provider by hand and rejects a bad or repeated slug", async () => {
  requests = installFetch(() => ({ body: { ok: true, providers: rows } }));
  let tree = await settle(block(), own);
  tick(tree, "novita");
  tick(tree, "deepinfra");
  tree = await settle(block(), own);
  expect(box(tree, "openrouter-provider-novita").props.checked).toBe(true);
  const positions = tree
    .filter((node) => node.props["data-position"] !== undefined)
    .map((node) => [node.props["data-position"], node.props["data-slug"]])
    .sort((a, b) => a[0] - b[0]);
  expect(positions).toEqual([
    [1, "novita"],
    [2, "deepinfra"],
  ]);

  const field = byType(tree, Input)[0];
  (field.props.onChange as (event: unknown) => void)({ target: { value: "bad slug!" } });
  tree = await settle(block(), own);
  (buttonNamed(tree, "Add provider").props.onClick as () => void)();
  tree = await settle(block(), own);
  expect(allText(tree)).toContain("Not a valid provider slug.");

  (byType(tree, Input)[0].props.onChange as (event: unknown) => void)({
    target: { value: "DeepInfra" },
  });
  tree = await settle(block(), own);
  (buttonNamed(tree, "Add provider").props.onClick as () => void)();
  tree = await settle(block(), own);
  expect(allText(tree)).toContain("That provider is already in the list.");

  (byType(tree, Input)[0].props.onChange as (event: unknown) => void)({
    target: { value: "my-host" },
  });
  tree = await settle(block(), own);
  (buttonNamed(tree, "Add provider").props.onClick as () => void)();
  tree = await settle(block(), own);
  expect(box(tree, "openrouter-provider-my-host").props.checked).toBe(true);
});

it("saves the choice with the snapshot revision, answers at once, and reloads the settings", async () => {
  const pending = deferred<{ status?: number; body: unknown }>();
  requests = installFetch((request) => {
    if (request.path.startsWith(LIST)) return { body: { ok: true, providers: rows } };
    if (request.path === SAVE) return pending.promise;
    return { body: { revision: "rev-10", settings: {} } };
  });
  let tree = await settle(block(), own);
  (box(tree, "openrouter-data-collection").props.onCheckedChange as (v: boolean) => void)(true);
  tick(tree, "deepinfra");
  tick(tree, "novita");
  tree = await settle(block(), own);
  (box(tree, "openrouter-only").props.onCheckedChange as (v: boolean) => void)(true);
  tree = await settle(block(), own);

  (buttonNamed(tree, "Save routing").props.onClick as () => void)();
  tree = await settle(block(), own);
  expect(statusLines(tree).join(" ")).toContain("Saving routing");
  const post = requests.find((request) => request.path === SAVE)!;
  expect(post.method).toBe("POST");
  expect(post.body).toEqual({
    revision: "rev-9",
    routing: {
      data_collection: "deny",
      order: ["deepinfra", "novita"],
      only: ["deepinfra", "novita"],
      allow_fallbacks: false,
    },
  });

  pending.resolve({ body: { revision: "rev-10", provider: {} } });
  tree = await settle(block(), own);
  expect(statusLines(tree).join(" ")).toContain("Routing saved.");
  expect(requests.some((request) => request.path === "/api/settings")).toBe(true);
});

it("shows the server error when the save fails and keeps the ticks", async () => {
  requests = installFetch((request) => {
    if (request.path.startsWith(LIST)) return { body: { ok: true, providers: rows } };
    if (request.path === SAVE)
      return { status: 409, body: { error: "Settings changed elsewhere" } };
    return { body: { revision: "rev-10", settings: {} } };
  });
  let tree = await settle(block(), own);
  tick(tree, "deepinfra");
  tree = await settle(block(), own);
  (buttonNamed(tree, "Save routing").props.onClick as () => void)();
  tree = await settle(block(), own);
  const alerts = tree
    .filter((node) => node.props.role === "alert")
    .map((n) => text(n.props.children));
  expect(alerts.join(" ")).toContain("Settings changed elsewhere");
  expect(box(tree, "openrouter-provider-deepinfra").props.checked).toBe(true);
});

it("states that other routing fields in the config file are kept", async () => {
  requests = installFetch(() => ({ body: { ok: true, providers: rows } }));
  const withSort = await settle(block({ saved: { order: ["deepinfra"], sort: "price" } }), own);
  expect(allText(withSort)).toContain(
    "Other routing fields are set in the config file and are kept."
  );
  resetRender();
  const plain = await settle(block({ saved: { order: ["deepinfra"] } }), own);
  expect(allText(plain)).not.toContain("Other routing fields");
});

// ---- the External API card ----

const cardOwn = [ExternalApiSection, OpenRouterRouting, ProviderRows];
const cardSnapshot = (url: string) => ({
  revision: "rev-9",
  settings: {
    memoryApiUrl: { globalValue: url },
    memoryModel: { globalValue: "deepseek/deepseek-chat" },
    memoryProvider: { globalValue: "anthropic" },
  },
  openrouterProvider: null,
});

it("shows the routing block only for an OpenRouter URL, and the preset follows the URL", async () => {
  requests = installFetch((request) =>
    request.path.startsWith(LIST)
      ? { body: { ok: true, providers: rows } }
      : { body: cardSnapshot("https://openrouter.ai/api/v1") }
  );
  const open = await settle(<ExternalApiSection />, cardOwn);
  expect(allText(open)).toContain("OpenRouter routing");
  const preset = byType(open, Select).find((node) => node.props["aria-label"] === "Preset")!;
  expect(preset.props.value).toBe("openrouter");

  resetRender();
  requests = installFetch(() => ({ body: cardSnapshot("https://api.example.com/v1") }));
  const closed = await settle(<ExternalApiSection />, cardOwn);
  expect(allText(closed)).not.toContain("OpenRouter routing");
  const custom = byType(closed, Select).find((node) => node.props["aria-label"] === "Preset")!;
  expect(custom.props.value).toBe("custom");
});

it("choosing the OpenRouter preset fills the URL and provider and leaves the model alone", async () => {
  requests = installFetch((request) =>
    request.path.startsWith(LIST)
      ? { body: { ok: true, providers: rows } }
      : { body: cardSnapshot("https://api.example.com/v1") }
  );
  let tree = await settle(<ExternalApiSection />, cardOwn);
  const preset = byType(tree, Select).find((node) => node.props["aria-label"] === "Preset")!;
  (preset.props.onChange as (event: unknown) => void)({ target: { value: "openrouter" } });
  tree = await settle(<ExternalApiSection />, cardOwn);

  const url = tree.find((node) => node.props.placeholder === "https://api.example.com/v1")!;
  const model = tree.find((node) => node.props.placeholder === "glm-5-turbo")!;
  const provider = byType(tree, Select).find((node) => node.props["aria-label"] === "Provider")!;
  expect(url.props.value).toBe("https://openrouter.ai/api/v1");
  expect(provider.props.value).toBe("openai-chat");
  expect(model.props.value).toBe("deepseek/deepseek-chat");
  expect(allText(tree)).toContain("OpenRouter routing");
});

it("choosing Custom empties the unsaved URL and leaves the model and provider alone", async () => {
  requests = installFetch((request) =>
    request.path.startsWith(LIST)
      ? { body: { ok: true, providers: rows } }
      : { body: cardSnapshot("https://api.example.com/v1") }
  );
  let tree = await settle(<ExternalApiSection />, cardOwn);
  const pick = (value: string) =>
    (
      byType(tree, Select).find((node) => node.props["aria-label"] === "Preset")!.props
        .onChange as (event: unknown) => void
    )({ target: { value } });
  pick("openrouter");
  tree = await settle(<ExternalApiSection />, cardOwn);
  pick("custom");
  tree = await settle(<ExternalApiSection />, cardOwn);

  const url = tree.find((node) => node.props.placeholder === "https://api.example.com/v1")!;
  const model = tree.find((node) => node.props.placeholder === "glm-5-turbo")!;
  const provider = byType(tree, Select).find((node) => node.props["aria-label"] === "Provider")!;
  expect(url.props.value).toBe("");
  expect(model.props.value).toBe("deepseek/deepseek-chat");
  expect(provider.props.value).toBe("openai-chat");
  const preset = byType(tree, Select).find((node) => node.props["aria-label"] === "Preset")!;
  expect(preset.props.value).toBe("custom");
  expect(allText(tree)).not.toContain("OpenRouter routing");
});

// ---- Save routing waits for a saved OpenRouter URL ----

const SAVE_REASON = "Save the endpoint first. Routing applies after the OpenRouter URL is saved.";

it("disables Save routing with a visible reason while the saved URL is not OpenRouter", async () => {
  requests = installFetch(() => ({ body: { ok: true, providers: rows } }));
  const blocked = await settle(block({ savedIsOpenRouter: false }), own);
  const save = buttonNamed(blocked, "Save routing");
  expect(save.props.disabled).toBe(true);
  expect(allText(blocked)).toContain(SAVE_REASON);
  const reasonId = save.props["aria-describedby"] as string;
  expect(reasonId).toBeTruthy();
  expect(blocked.some((node) => node.props.id === reasonId)).toBe(true);

  resetRender();
  const ready = await settle(block({ savedIsOpenRouter: true }), own);
  expect(buttonNamed(ready, "Save routing").props.disabled).toBeFalsy();
  expect(allText(ready)).not.toContain(SAVE_REASON);
});

it("keeps Save routing disabled after choosing the preset until the endpoint is saved", async () => {
  requests = installFetch((request) =>
    request.path.startsWith(LIST)
      ? { body: { ok: true, providers: rows } }
      : { body: cardSnapshot("https://api.example.com/v1") }
  );
  let tree = await settle(<ExternalApiSection />, cardOwn);
  const preset = byType(tree, Select).find((node) => node.props["aria-label"] === "Preset")!;
  (preset.props.onChange as (event: unknown) => void)({ target: { value: "openrouter" } });
  tree = await settle(<ExternalApiSection />, cardOwn);
  expect(buttonNamed(tree, "Save routing").props.disabled).toBe(true);
  expect(allText(tree)).toContain(SAVE_REASON);

  resetRender();
  requests = installFetch((request) =>
    request.path.startsWith(LIST)
      ? { body: { ok: true, providers: rows } }
      : { body: cardSnapshot("https://openrouter.ai/api/v1") }
  );
  tree = await settle(<ExternalApiSection />, cardOwn);
  expect(buttonNamed(tree, "Save routing").props.disabled).toBeFalsy();
});

// ---- Stale routing on a non-OpenRouter endpoint ----

const STALE = "OpenRouter routing is still saved and is sent with every request to this endpoint.";
const staleSnapshot = (url: string, provider: Record<string, unknown> | null) => ({
  ...cardSnapshot(url),
  openrouterProvider: provider,
});
const confirmWith = (answer: boolean) => {
  const asked: string[] = [];
  (globalThis as any).window.confirm = (message: string) => (asked.push(message), answer);
  return asked;
};

it("offers to remove saved routing when the endpoint is not OpenRouter, after a confirm", async () => {
  const pending = deferred<{ status?: number; body: unknown }>();
  requests = installFetch((request) => {
    if (request.path === SAVE) return pending.promise;
    return { body: staleSnapshot("https://api.example.com/v1", { order: ["deepinfra"] }) };
  });
  let tree = await settle(<ExternalApiSection />, cardOwn);
  expect(allText(tree)).toContain(STALE);
  const remove = buttonNamed(tree, "Remove OpenRouter routing");
  expect(remove.props.variant).toBe("outline");

  // Cancel in the confirm sends nothing.
  const refused = confirmWith(false);
  (remove.props.onClick as () => void)();
  tree = await settle(<ExternalApiSection />, cardOwn);
  expect(refused.length).toBe(1);
  expect(requests.some((request) => request.path === SAVE)).toBe(false);

  // Confirm sends the remove-everything save with the snapshot revision, shows progress, then the result.
  confirmWith(true);
  (buttonNamed(tree, "Remove OpenRouter routing").props.onClick as () => void)();
  tree = await settle(<ExternalApiSection />, cardOwn);
  const post = requests.find((request) => request.path === SAVE)!;
  expect(post.method).toBe("POST");
  expect(post.body).toEqual({ revision: "rev-9", routing: null });
  expect(statusLines(tree).join(" ")).toContain("Removing OpenRouter routing");
  expect(buttonNamed(tree, "Remove OpenRouter routing").props.disabled).toBe(true);

  const reloads = requests.filter((request) => request.path === "/api/settings").length;
  pending.resolve({ body: { revision: "rev-10", provider: {} } });
  tree = await settle(<ExternalApiSection />, cardOwn);
  expect(statusLines(tree).join(" ")).toContain("OpenRouter routing removed.");
  expect(requests.filter((request) => request.path === "/api/settings").length).toBeGreaterThan(
    reloads
  );
});

it("shows the server error when removing the saved routing fails", async () => {
  requests = installFetch((request) =>
    request.path === SAVE
      ? { status: 409, body: { error: "Settings changed elsewhere" } }
      : { body: staleSnapshot("https://api.example.com/v1", { zdr: true }) }
  );
  confirmWith(true);
  let tree = await settle(<ExternalApiSection />, cardOwn);
  (buttonNamed(tree, "Remove OpenRouter routing").props.onClick as () => void)();
  tree = await settle(<ExternalApiSection />, cardOwn);
  expect(statusLines(tree).join(" ")).toContain("Settings changed elsewhere");
});

it("shows no stale-routing line for OpenRouter or for no saved routing", async () => {
  for (const snapshot of [
    staleSnapshot("https://openrouter.ai/api/v1", { order: ["deepinfra"] }),
    staleSnapshot("https://openrouter.ai/api/v1", { sort: "price" }),
    staleSnapshot("https://api.example.com/v1", null),
  ]) {
    resetRender();
    requests = installFetch((request) =>
      request.path.startsWith(LIST) ? { body: { ok: true, providers: rows } } : { body: snapshot }
    );
    const tree = await settle(<ExternalApiSection />, cardOwn);
    expect(allText(tree)).not.toContain(STALE);
    expect(allText(tree)).not.toContain("Remove OpenRouter routing");
  }
});

it("shows the stale-routing line for unmanaged fields only, and removes the whole object", async () => {
  requests = installFetch(() => ({
    body: staleSnapshot("https://api.openai.com/v1", { sort: "price" }),
  }));
  confirmWith(true);
  const tree = await settle(<ExternalApiSection />, cardOwn);
  expect(allText(tree)).toContain(STALE);
  (buttonNamed(tree, "Remove OpenRouter routing").props.onClick as () => void)();
  await settle(<ExternalApiSection />, cardOwn);
  const post = requests.find((request) => request.path === SAVE)!;
  expect(post.body).toEqual({ revision: "rev-9", routing: null });
});

// ---- Texts ----

it("has Chinese and Arabic text for Preset, Custom and every new string", () => {
  const strings = [
    "Preset",
    "Custom",
    SAVE_REASON,
    STALE,
    "Remove OpenRouter routing",
    "Remove OpenRouter routing? Requests to this endpoint will no longer carry the routing choices.",
    "Removing OpenRouter routing…",
    "OpenRouter routing removed.",
    "Tick at least one provider first.",
    "OpenRouter did not answer within 10 seconds.",
    "OpenRouter could not be reached.",
  ];
  const missing = strings.filter(
    (label) => translateSettings(label, "zh") === label || translateSettings(label, "ar") === label
  );
  expect(missing).toEqual([]);
});

// ---- Provider list requests ----

const listReplies = () => {
  const replies = new Map<string, ReturnType<typeof deferred<{ body: unknown }>>>();
  const reply = (model: string) => {
    if (!replies.has(model)) replies.set(model, deferred());
    return replies.get(model)!;
  };
  requests = installFetch((request) => {
    if (!request.path.startsWith(LIST)) return { body: {} };
    return reply(decodeURIComponent(request.path.split("model=")[1])).promise;
  });
  return reply;
};

it("ignores a provider list that arrives after the model field was cleared", async () => {
  const reply = listReplies();
  await settle(block({ model: "deepseek/deepseek-chat" }), own);
  let tree = await settle(block({ model: "" }), own);
  expect(allText(tree)).toContain("Enter a model ID to see its providers.");

  reply("deepseek/deepseek-chat").resolve({ body: { ok: true, providers: rows } });
  tree = await settle(block({ model: "" }), own);
  expect(allText(tree)).toContain("Enter a model ID to see its providers.");
  expect(allText(tree)).not.toContain("DeepInfra");
});

it("ignores an older provider list that arrives after a newer one", async () => {
  const reply = listReplies();
  await settle(block({ model: "model/one" }), own);
  await settle(block({ model: "model/two" }), own);

  reply("model/two").resolve({
    body: { ok: true, providers: [{ slug: "deepinfra", name: "DeepInfra", policy: "zdr" }] },
  });
  await settle(block({ model: "model/two" }), own);
  reply("model/one").resolve({
    body: { ok: true, providers: [{ slug: "novita", name: "Novita", policy: "safety" }] },
  });
  const tree = await settle(block({ model: "model/two" }), own);
  const words = allText(tree);
  expect(words).toContain("DeepInfra");
  expect(words).not.toContain("Novita");
});

// ---- Use only these providers ----

const ONLY_REASON = "Tick at least one provider first.";
const NO_FALLBACK = "OpenRouter never falls back to other providers.";

it("disables Use only these providers with a reason while no usable provider is ticked", async () => {
  requests = installFetch(() => ({ body: { ok: true, providers: rows } }));
  // Saved as "only" with nothing ticked: the box must not claim a restriction.
  let tree = await settle(block({ saved: { allow_fallbacks: false } }), own);
  let only = box(tree, "openrouter-only");
  expect(only.props.disabled).toBe(true);
  expect(only.props.checked).toBe(false);
  expect(allText(tree)).toContain(ONLY_REASON);
  expect(allText(tree)).not.toContain(NO_FALLBACK);
  expect(only.props["aria-describedby"]).toBeTruthy();

  // Every ticked row is blocked by Zero data retention only.
  resetRender();
  tree = await settle(block({ saved: { zdr: true, order: ["together"] } }), own);
  only = box(tree, "openrouter-only");
  expect(only.props.disabled).toBe(true);
  expect(allText(tree)).toContain(ONLY_REASON);
  expect(allText(tree)).not.toContain(NO_FALLBACK);

  // Ticking a usable provider enables it, and the note comes back when it is on.
  resetRender();
  tree = await settle(block({ saved: { allow_fallbacks: false } }), own);
  tick(tree, "deepinfra");
  tree = await settle(block({ saved: { allow_fallbacks: false } }), own);
  only = box(tree, "openrouter-only");
  expect(only.props.disabled).toBeFalsy();
  expect(only.props.checked).toBe(true);
  expect(allText(tree)).not.toContain(ONLY_REASON);
  expect(allText(tree)).toContain(NO_FALLBACK);
});

// ---- Provider list failures ----

it("builds the failure line from the reason, not from the server sentence", async () => {
  requests = installFetch(() => ({
    body: { ok: false, reason: "timeout", error: "Timed out after 10000 ms" },
  }));
  const words = allText(await settle(block(), own));
  expect(words).toContain("The provider list is not available.");
  expect(words).toContain("OpenRouter did not answer within 10 seconds.");
  expect(words).not.toContain("Timed out after");
});

it("keeps the lead line and shows the server text as a small detail when there is no reason", async () => {
  requests = installFetch(() => ({ status: 400, body: { error: "Model is required" } }));
  const tree = await settle(block(), own);
  const paragraphs = tree.filter((node) => node.type === "p");
  const lead = paragraphs.find((node) => text(node.props.children).includes("not available"))!;
  expect(text(lead.props.children)).toContain("The provider list is not available.");
  expect(text(lead.props.children)).not.toContain("Model is required");
  const detail = paragraphs.find((node) =>
    text(node.props.children).includes("Model is required")
  )!;
  expect(detail.props.className).toContain("text-muted-foreground");
});

// ---- Provider rows on a narrow screen ----

it("lets a row wrap: the name takes the width and the badge drops to its own line", async () => {
  requests = installFetch(() => ({ body: { ok: true, providers: rows } }));
  const tree = await settle(block(), own);
  const label = byType(tree, Label).find(
    (node) => node.props.htmlFor === "openrouter-provider-novita"
  )!;
  const classes = String(label.props.className);
  expect(classes).toContain("min-w-0");
  expect(classes).toContain("flex-1");
  expect(classes).toContain("basis-[min(100%,12rem)]");
  expect(classes).not.toContain("break-all");
  const badge = byType(tree, Badge).find(
    (node) => text(node.props.children) === "Abuse checks only"
  )!;
  expect(String(badge.props.className)).toContain("ms-auto");
});
