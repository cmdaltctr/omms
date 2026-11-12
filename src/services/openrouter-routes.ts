import { log } from "./logger.js";
import { createOpenRouterProviders, isModelId } from "./openrouter-providers.js";
import {
  isOpenRouterUrl,
  parseRouting,
  removeProviderEdits,
  routingEdits,
} from "./openrouter-routing-config.js";
import type { RouteResult } from "./chat/chat-routes.js";

const PROVIDERS_PATH = "/api/settings/external-api/openrouter-providers";
const ROUTING_PATH = "/api/settings/external-api/openrouter-routing";

/** Reads `globalThis.fetch` at call time, so a test can replace it. */
const providers = createOpenRouterProviders({
  fetch: (input, init) => globalThis.fetch(input, init),
  now: () => Date.now(),
});

const NOT_OPENROUTER =
  "Save the OpenRouter endpoint first. Routing applies only to an OpenRouter API URL.";

const fail = (status: number, error: string): RouteResult => ({ status, body: { error } });

/**
 * The OpenRouter routing routes of the External API card: the provider list of a
 * model with data policy labels, and the save of `memoryExtraParams.provider`.
 * Returns undefined for paths it does not own.
 */
export async function routeOpenRouter(
  path: string,
  method: string,
  url: URL,
  readBody: () => Promise<any>,
  ctx: { cwd: string }
): Promise<RouteResult | undefined> {
  if (path === PROVIDERS_PATH && method === "GET") {
    const model = url.searchParams.get("model");
    if (!isModelId(model)) {
      return fail(
        400,
        "Enter a model ID in the form author/model, for example deepseek/deepseek-chat"
      );
    }
    return { status: 200, body: await providers.list(model) };
  }

  if (path === ROUTING_PATH && method === "POST") {
    const body = await readBody();
    if (typeof body?.revision !== "string") return fail(400, "Revision required");
    // `routing: null` removes the whole provider object. `{}` clears the managed fields only.
    const removeAll = body.routing === null;
    const parsed = removeAll ? { ok: true as const, routing: {} } : parseRouting(body.routing);
    if (!parsed.ok) return fail(400, parsed.error);

    const { writeGlobalConfigKeys, ConfigConflictError } =
      await import("./global-config-writer.js");
    let provider: Record<string, unknown> | undefined;
    let revision: string;
    try {
      ({ revision } = await writeGlobalConfigKeys({}, body.revision, {
        only: new Set(["memoryExtraParams", "memoryExtraParams.provider"]),
        derive: (current) => {
          // A clearing save is always allowed, so a stale provider can go after a switch of endpoint.
          if (Object.keys(parsed.routing).length > 0 && !isOpenRouterUrl(current.memoryApiUrl)) {
            throw new Error(NOT_OPENROUTER);
          }
          if (removeAll) return removeProviderEdits(current.memoryExtraParams);
          const result = routingEdits(current.memoryExtraParams, parsed.routing);
          provider = result.provider;
          return result.edits;
        },
      }));
    } catch (error) {
      return fail(
        error instanceof ConfigConflictError ? 409 : 400,
        error instanceof Error ? error.message : "Routing not saved"
      );
    }
    // The file is already saved; a reload problem must not report the save as failed.
    try {
      const { refreshConfigIfChanged } = await import("../config.js");
      refreshConfigIfChanged(ctx.cwd);
    } catch (error) {
      log(
        "Routing saved, but reloading settings failed",
        { error: error instanceof Error ? error.message : String(error) },
        "error"
      );
    }
    return { status: 200, body: { revision, provider: provider ?? null } };
  }

  return undefined;
}
