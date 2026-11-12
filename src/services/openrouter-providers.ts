/**
 * The providers that serve one OpenRouter model, each with a data policy label.
 * It reads two public OpenRouter lists without an API key: the model's endpoints
 * and the zero data retention (ZDR) endpoints. `fetch` and the clock come in as
 * arguments, so the module needs no config and tests need no network.
 */

export type ProviderPolicy = "zdr" | "safety" | "unknown";
export type ProviderRow = { slug: string; name: string; policy: ProviderPolicy };
export type ProviderFailure = "unknown-model" | "timeout" | "unreachable";
export type ProvidersResult =
  { ok: true; providers: ProviderRow[] } | { ok: false; reason: ProviderFailure; error: string };

const BASE = "https://openrouter.ai/api/v1";
const ZDR_TTL_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;
const MODEL_ID = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._:-]+$/;

/** From least private to most private is unknown, safety, zdr. */
const PRIVACY_RANK: Record<ProviderPolicy, number> = { unknown: 0, safety: 1, zdr: 2 };

/** True for `author/slug` model IDs. Dot-only parts are refused so the URL cannot climb out of /models/. */
export function isModelId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    MODEL_ID.test(value) &&
    value.split("/").every((part) => !/^\.+$/.test(part))
  );
}

class ListError extends Error {
  constructor(
    readonly reason: ProviderFailure,
    message: string
  ) {
    super(message);
  }
}

type Row = Record<string, unknown>;
const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value : undefined;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export function createOpenRouterProviders(deps: {
  fetch: FetchLike;
  now: () => number;
  timeoutMs?: number;
}) {
  const timeoutMs = deps.timeoutMs ?? FETCH_TIMEOUT_MS;
  let zdrCache: { at: number; flags: Map<string, boolean> } | undefined;

  /** One keyless GET. Returns undefined for a 404, so the caller can name the model. */
  async function getJson(url: string): Promise<unknown | undefined> {
    let response: Response;
    try {
      response = await deps.fetch(url, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      if (name === "TimeoutError" || name === "AbortError") {
        throw new ListError("timeout", "OpenRouter did not answer within 10 seconds.");
      }
      throw new ListError("unreachable", "OpenRouter could not be reached.");
    }
    if (response.status === 404) return undefined;
    if (!response.ok) {
      throw new ListError("unreachable", `OpenRouter answered with status ${response.status}.`);
    }
    try {
      return await response.json();
    } catch {
      throw new ListError("unreachable", "OpenRouter sent a reply that could not be read.");
    }
  }

  /** `model_id` + `tag` -> safety_retention for every ZDR endpoint. Cached for an hour. */
  async function zdrFlags(): Promise<Map<string, boolean>> {
    if (zdrCache && deps.now() - zdrCache.at < ZDR_TTL_MS) return zdrCache.flags;
    const body = (await getJson(`${BASE}/endpoints/zdr`)) as { data?: unknown } | undefined;
    if (!body || !Array.isArray(body.data)) {
      throw new ListError(
        "unreachable",
        "OpenRouter sent a zero data retention list in an unknown form."
      );
    }
    const flags = new Map<string, boolean>();
    for (const row of body.data as Row[]) {
      const model = text(row?.model_id);
      const tag = text(row?.tag);
      // A missing or non-boolean flag is not stored, so the endpoint stays `unknown`.
      if (model && tag && typeof row.safety_retention === "boolean") {
        flags.set(`${model}\n${tag}`, row.safety_retention);
      }
    }
    // Only a good answer is cached, so a failed fetch is tried again on the next request.
    zdrCache = { at: deps.now(), flags };
    return flags;
  }

  async function list(model: string): Promise<ProvidersResult> {
    try {
      const [body, flags] = await Promise.all([
        getJson(
          `${BASE}/models/${model.split("/").map(encodeURIComponent).join("/")}/endpoints`
        ) as Promise<{ data?: { endpoints?: unknown } } | undefined>,
        zdrFlags(),
      ]);
      const endpoints = body?.data?.endpoints;
      if (body === undefined || (Array.isArray(endpoints) && endpoints.length === 0)) {
        throw new ListError("unknown-model", "OpenRouter has no providers for that model.");
      }
      if (!Array.isArray(endpoints)) {
        throw new ListError("unreachable", "OpenRouter sent a provider list in an unknown form.");
      }
      const bySlug = new Map<string, ProviderRow>();
      for (const endpoint of endpoints as Row[]) {
        const tag = text(endpoint?.tag);
        const name = text(endpoint?.provider_name);
        const slug = tag ? tag.split("/")[0]! : name?.toLowerCase();
        if (!slug) continue;
        const modelId = text(endpoint?.model_id);
        const flag = tag && modelId ? flags.get(`${modelId}\n${tag}`) : undefined;
        const policy: ProviderPolicy = flag === undefined ? "unknown" : flag ? "safety" : "zdr";
        const seen = bySlug.get(slug);
        if (!seen) {
          bySlug.set(slug, { slug, name: name ?? slug, policy });
        } else if (PRIVACY_RANK[policy] < PRIVACY_RANK[seen.policy]) {
          seen.policy = policy;
        }
      }
      const providers = [...bySlug.values()].sort((a, b) => a.name.localeCompare(b.name));
      if (providers.length === 0) {
        throw new ListError("unknown-model", "OpenRouter has no providers for that model.");
      }
      return { ok: true, providers };
    } catch (error) {
      if (error instanceof ListError)
        return { ok: false, reason: error.reason, error: error.message };
      return { ok: false, reason: "unreachable", error: "OpenRouter could not be reached." };
    }
  }

  return { list };
}
