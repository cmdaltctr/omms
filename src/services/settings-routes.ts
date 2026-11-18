/**
 * Settings routes of openspec change friendly-settings, kept out of
 * web-server.ts, which sits at its size ceiling. web-server.ts checks the
 * origin, the token and the JSON content type before a request gets here.
 *
 * Pasted keys stay in this request only: they are never logged, never echoed
 * and redacted from every error. Error messages never quote a rejected value.
 */
import type { RouteResult } from "./chat/chat-routes.js";
import type { MemoryProviderRuntimeConfig } from "./ai/provider-config.js";
const PREVIEW_PATH = "/api/settings/auto-cleanup/preview";
const KEY_PATH = "/api/settings/external-api/key";
const EXTERNAL_TEST_PATH = "/api/settings/external-api/test";

type ExternalTestConfig = MemoryProviderRuntimeConfig & { memoryProvider: string };
/** The importer's `ExternalApiTestResult`, repeated: services may not import the importer. */
type ExternalApiTestResult =
  { ok: true; model: string } | { ok: false; error: string; reason: string; status?: number };

export interface SettingsRouteContext {
  cwd: string;
  /** The web app listens on a network address without Basic Auth: pasted keys are refused. */
  networkWithoutAuth: boolean;
  /** The importer's External API test; web-server.ts passes it, because services may not import the importer. */
  testExternalApi: (given?: ExternalTestConfig) => Promise<ExternalApiTestResult>;
  /** The config module, passed in so this file adds no `CONFIG` import (modularity ratchet). */
  configModule: typeof import("../config.js");
}

const fail = (status: number, error: string): RouteResult => ({ status, body: { error } });
const PASTE_REFUSED = "Saving a key requires Basic Auth on network hosts";
const KEY_SETTINGS = ["memoryApiKey", "rerankerApiKey"];
const URL_PATTERN = /^https?:\/\/\S+$/;

const redact = (message: string, secret: string) =>
  secret ? message.replaceAll(secret, "[redacted]") : message;

/** Returns undefined for paths it does not own. */
export async function routeSettings(
  path: string,
  method: string,
  url: URL,
  readBody: () => Promise<any>,
  ctx: SettingsRouteContext
): Promise<RouteResult | undefined> {
  if (path === PREVIEW_PATH && method === "GET") return cleanupPreview(url);
  if (path === KEY_PATH && method === "POST") return saveKey(await readBody(), ctx);
  if (path === EXTERNAL_TEST_PATH && method === "POST") {
    return testExternal(await readBody(), ctx);
  }
  return undefined;
}

/** Counts what deletion with `days` would remove now; deletes nothing. */
async function cleanupPreview(url: URL): Promise<RouteResult> {
  const text = url.searchParams.get("days") ?? "";
  const days = /^\d+$/.test(text) ? Number(text) : NaN;
  // The same rule as autoCleanupRetentionDays in the config and the writer.
  if (!Number.isSafeInteger(days) || days < 1) {
    return fail(400, "Invalid days: accepted whole numbers of 1 or more");
  }
  try {
    const { cleanupService } = await import("./cleanup-service.js");
    return {
      status: 200,
      body: { days, count: await cleanupService.countCleanupCandidates(days) },
    };
  } catch (error) {
    const { log } = await import("./logger.js");
    log(
      "Cleanup preview failed",
      { code: error instanceof Error ? error.name : "unknown" },
      "error"
    );
    return fail(500, "The number of memories could not be counted");
  }
}

/** Saves `memoryApiKey` or `rerankerApiKey` as an env:// or file:// reference. */
async function saveKey(body: Record<string, unknown> | null, ctx: SettingsRouteContext) {
  const secret = typeof body?.value === "string" ? body.value.trim() : "";
  const setting = body?.setting ?? "memoryApiKey";
  if (typeof setting !== "string" || !KEY_SETTINGS.includes(setting)) {
    return fail(400, "Choose memoryApiKey or rerankerApiKey");
  }
  const { MemoryKeySourceError, parseMemoryKeySource, storeMemoryKeySource } =
    await import("./memory-key-source.js");
  try {
    const request = parseMemoryKeySource(body);
    if (request.source === "paste" && ctx.networkWithoutAuth) return fail(403, PASTE_REFUSED);
    if (typeof body?.revision !== "string") return fail(400, "Revision required");
    const stored = await storeMemoryKeySource(request);
    const { writeGlobalConfigKeys } = await import("./global-config-writer.js");
    const result = await writeGlobalConfigKeys({ [setting]: stored.reference }, body.revision);
    ctx.configModule.refreshConfigIfChanged(ctx.cwd);
    const { keyResolves, memoryKeyStatus } = await import("./settings-snapshot.js");
    const key =
      setting === "rerankerApiKey"
        ? memoryKeyStatus(stored.reference, keyResolves(stored.reference) ? "set" : undefined)
        : memoryKeyStatus(stored.reference, ctx.configModule.CONFIG.memoryApiKey);
    return { status: 200, body: { ...result, key } };
  } catch (error) {
    const status =
      error instanceof MemoryKeySourceError
        ? error.status
        : ((error as { status?: number }).status ?? 400);
    const message = error instanceof Error ? error.message : "Key source not saved";
    return fail(status, redact(message, secret));
  }
}

const FORM_FIELDS = ["provider", "url", "model", "key"];

/**
 * Tests the External API card's form values, saved or not. An empty body tests
 * the saved values. A field left out of the body keeps its saved value.
 */
async function testExternal(body: Record<string, unknown> | null, ctx: SettingsRouteContext) {
  const form = body && typeof body === "object" ? body : {};
  if (!FORM_FIELDS.some((field) => field in form)) {
    return { status: 200, body: await ctx.testExternalApi() };
  }
  const key = typeof form.key === "string" ? form.key.trim() : "";
  const isReference = /^(env|file):\/\//.test(key);
  const pasted = key && !isReference ? key : "";
  if (pasted && ctx.networkWithoutAuth) {
    return fail(403, "Testing a pasted key requires Basic Auth on network hosts");
  }
  const { CONFIG } = ctx.configModule;
  const [{ MEMORY_PROVIDERS }, { resolveSecretValue }] = await Promise.all([
    import("./global-config-writer.js"),
    import("./secret-resolver.js"),
  ]);
  const given: ExternalTestConfig = {
    memoryProvider: CONFIG.memoryProvider,
    memoryModel: CONFIG.memoryModel,
    memoryApiUrl: CONFIG.memoryApiUrl,
    memoryApiKey: CONFIG.memoryApiKey,
    memoryTemperature: CONFIG.memoryTemperature,
    memoryExtraParams: CONFIG.memoryExtraParams,
  };
  if ("provider" in form) {
    if (!MEMORY_PROVIDERS.includes(form.provider as string)) {
      return fail(400, "Invalid memoryProvider setting");
    }
    given.memoryProvider = form.provider as string;
  }
  if ("url" in form) {
    const value = typeof form.url === "string" ? form.url.trim() : form.url;
    if (value !== "" && value !== null && !(typeof value === "string" && URL_PATTERN.test(value))) {
      return fail(400, "Invalid memoryApiUrl setting: accepted an http:// or https:// URL");
    }
    given.memoryApiUrl = value || undefined;
  }
  if ("model" in form) {
    if (form.model !== null && typeof form.model !== "string") {
      return fail(400, "Invalid memoryModel setting");
    }
    given.memoryModel = form.model?.trim() || undefined;
  }
  if ("key" in form) {
    try {
      given.memoryApiKey = isReference ? resolveSecretValue(key) : key || undefined;
    } catch {
      return fail(400, "The key could not be read from that variable or file");
    }
  }
  const result = await ctx.testExternalApi(given);
  return {
    status: 200,
    body: result.ok ? result : { ...result, error: redact(result.error, pasted) },
  };
}
