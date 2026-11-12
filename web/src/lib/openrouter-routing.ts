/** Pure helpers for the OpenRouter routing block of the External API card. */

export type ProviderPolicy = "zdr" | "safety" | "unknown";
export type ProviderRow = { slug: string; name: string; policy: ProviderPolicy };

/** What the card shows: two switches, Use only these, and the ticked slugs in try order. */
export type RoutingState = {
  dataCollection: boolean;
  zdr: boolean;
  only: boolean;
  ticked: string[];
};

/** The `provider` fields the card manages. Anything else in the saved object is left alone. */
const MANAGED = new Set(["order", "only", "allow_fallbacks", "data_collection", "zdr"]);

export const OPENROUTER_API_URL = "https://openrouter.ai/api/v1";

export const isOpenRouterUrl = (url: string): boolean => {
  try {
    return new URL(url.trim()).hostname === "openrouter.ai";
  } catch {
    return false;
  }
};

const slugs = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((slug): slug is string => typeof slug === "string") : [];

/**
 * A saved `only` list is the whole ticked set, ordered by its place in `order` first. Without
 * `only`, `order` is the ticked set. `order` never adds a slug that `only` leaves out.
 */
export function routingFromProvider(provider: Record<string, unknown> | null | undefined) {
  const saved = provider ?? {};
  const order = slugs(saved.order);
  const only = slugs(saved.only);
  const ticked = only.length
    ? [
        ...order.filter((slug) => only.includes(slug)),
        ...only.filter((slug) => !order.includes(slug)),
      ]
    : order;
  return {
    dataCollection: saved.data_collection === "deny",
    zdr: saved.zdr === true,
    only: saved.allow_fallbacks === false || only.length > 0,
    ticked,
  } satisfies RoutingState;
}

/** The ticked slugs that can be used: with ZDR on, loaded providers that may keep data are out. */
export function usableTicked(state: RoutingState, rows: ProviderRow[]): string[] {
  if (!state.zdr) return state.ticked;
  const unknown = new Set(rows.filter((row) => row.policy === "unknown").map((row) => row.slug));
  return state.ticked.filter((slug) => !unknown.has(slug));
}

/** The `routing` object the save route takes. An empty object clears the card's fields. */
export function providerFromRouting(state: RoutingState, rows: ProviderRow[]) {
  const ticked = usableTicked(state, rows);
  const routing: {
    data_collection?: "deny";
    zdr?: true;
    order?: string[];
    only?: string[];
    allow_fallbacks?: false;
  } = {};
  if (state.dataCollection) routing.data_collection = "deny";
  if (state.zdr) routing.zdr = true;
  if (ticked.length) routing.order = ticked;
  if (ticked.length && state.only) {
    routing.only = ticked;
    routing.allow_fallbacks = false;
  }
  return routing;
}

/** The English label of a policy. The card passes it through its text function. */
export const policyLabelKey = (policy: ProviderPolicy): string =>
  policy === "zdr"
    ? "No retention"
    : policy === "safety"
      ? "Abuse checks only"
      : "May keep or train on data";

export const hasUnmanagedFields = (provider: Record<string, unknown> | null | undefined) =>
  Object.keys(provider ?? {}).some((key) => !MANAGED.has(key));

/** The preset sets the URL and the provider. The model and the key stay as they are. */
export const applyOpenRouterPreset = (fields: Record<string, string>): Record<string, string> => ({
  ...fields,
  memoryApiUrl: OPENROUTER_API_URL,
  memoryProvider: "openai-chat",
});
