/**
 * The OpenRouter model list, reduced to ID and name for the Model field
 * suggestions. It reads one public OpenRouter list without an API key. `fetch`
 * and the clock come in as arguments, so the module needs no config and tests
 * need no network.
 */

export type ModelRow = { id: string; name: string };
export type ModelsResult = { ok: true; models: ModelRow[] } | { ok: false; error: string };

const URL_MODELS = "https://openrouter.ai/api/v1/models";
const CACHE_TTL_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 10_000;

const text = (value: unknown): string | undefined =>
  typeof value === "string" && value.trim() ? value : undefined;

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export function createOpenRouterModels(deps: {
  fetch: FetchLike;
  now: () => number;
  timeoutMs?: number;
}) {
  const timeoutMs = deps.timeoutMs ?? FETCH_TIMEOUT_MS;
  let cache: { at: number; models: ModelRow[] } | undefined;

  async function list(): Promise<ModelsResult> {
    if (cache && deps.now() - cache.at < CACHE_TTL_MS) return { ok: true, models: cache.models };
    let response: Response;
    try {
      response = await deps.fetch(URL_MODELS, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      if (name === "TimeoutError" || name === "AbortError") {
        return { ok: false, error: "OpenRouter did not answer within 10 seconds." };
      }
      return { ok: false, error: "OpenRouter could not be reached." };
    }
    if (!response.ok) {
      return { ok: false, error: `OpenRouter answered with status ${response.status}.` };
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      return { ok: false, error: "OpenRouter sent a reply that could not be read." };
    }
    const rows = (body as { data?: unknown } | null)?.data;
    if (!Array.isArray(rows)) {
      return { ok: false, error: "OpenRouter sent a model list in an unknown form." };
    }
    const models: ModelRow[] = [];
    for (const row of rows as Record<string, unknown>[]) {
      const id = text(row?.id);
      if (id) models.push({ id, name: text(row.name) ?? id });
    }
    models.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    // Only a good answer is cached, so a failed fetch is tried again on the next request.
    cache = { at: deps.now(), models };
    return { ok: true, models };
  }

  return { list };
}
