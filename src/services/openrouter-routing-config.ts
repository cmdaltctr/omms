/**
 * Pure rules for the OpenRouter routing card: check the posted routing, and
 * turn it into config edits that keep every field the card does not manage.
 */

/** The `provider` fields the card owns. Any other field (for example `sort`) is left alone. */
export const MANAGED_PROVIDER_KEYS = [
  "order",
  "only",
  "allow_fallbacks",
  "data_collection",
  "zdr",
] as const;

const SLUG = /^[a-z0-9][a-z0-9._-]{0,63}$/i;
const MAX_SLUGS = 20;

export type RoutingResult =
  { ok: true; routing: Record<string, unknown> } | { ok: false; error: string };

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function slugList(name: string, value: unknown): string[] | string {
  if (!Array.isArray(value)) return `${name} must be a list of provider slugs`;
  if (value.length > MAX_SLUGS) return `${name} can list at most ${MAX_SLUGS} providers`;
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string" || !SLUG.test(entry)) {
      return `${name} has a provider slug that is not valid (letters, digits, dot, dash and underscore only)`;
    }
    const key = entry.toLowerCase();
    if (seen.has(key)) return `${name} lists a provider more than once`;
    seen.add(key);
  }
  return value as string[];
}

/** Check the posted `routing` object. An empty `order` or `only` list is dropped, since it restricts nothing. */
export function parseRouting(input: unknown): RoutingResult {
  if (!isPlainObject(input)) return { ok: false, error: "routing must be an object" };
  const routing: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (key === "data_collection") {
      if (value !== "deny") return { ok: false, error: 'data_collection can only be "deny"' };
      routing[key] = value;
    } else if (key === "zdr") {
      if (value !== true) return { ok: false, error: "zdr can only be true" };
      routing[key] = value;
    } else if (key === "allow_fallbacks") {
      if (value !== false) return { ok: false, error: "allow_fallbacks can only be false" };
      routing[key] = value;
    } else if (key === "order" || key === "only") {
      const list = slugList(key, value);
      if (typeof list === "string") return { ok: false, error: list };
      if (list.length > 0) routing[key] = list;
    } else {
      return { ok: false, error: `routing has a field that is not supported: ${key}` };
    }
  }
  return { ok: true, routing };
}

/** True when the URL's host is exactly `openrouter.ai`. Routing applies only to that endpoint. */
export function isOpenRouterUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    return new URL(value).hostname === "openrouter.ai";
  } catch {
    return false;
  }
}

/**
 * The provider object after the save: the saved object without the five managed
 * fields, plus the posted ones. `undefined` means no provider is left.
 */
export function mergeProvider(
  saved: unknown,
  routing: Record<string, unknown>
): Record<string, unknown> | undefined {
  const merged = isPlainObject(saved) ? { ...saved } : {};
  for (const key of MANAGED_PROVIDER_KEYS) delete merged[key];
  Object.assign(merged, routing);
  return Object.keys(merged).length > 0 ? merged : undefined;
}

/**
 * Config edits that remove the whole `provider` object, managed fields or not, and
 * `memoryExtraParams` when nothing else is in it.
 */
export function removeProviderEdits(savedExtraParams: unknown): Record<string, unknown> {
  const extra = isPlainObject(savedExtraParams) ? savedExtraParams : undefined;
  const others = extra ? Object.keys(extra).filter((key) => key !== "provider") : [];
  if (!extra || others.length === 0) {
    return savedExtraParams === undefined ? {} : { memoryExtraParams: undefined };
  }
  return { "memoryExtraParams.provider": undefined };
}

/**
 * Config edits for `memoryExtraParams.provider`. The nested write keeps the other
 * members and the file's comments. When no provider is left and nothing else is in
 * `memoryExtraParams`, the whole key goes. Returns the edits and the new provider.
 */
export function routingEdits(
  savedExtraParams: unknown,
  routing: Record<string, unknown>
): { edits: Record<string, unknown>; provider: Record<string, unknown> | undefined } {
  const extra = isPlainObject(savedExtraParams) ? savedExtraParams : undefined;
  const provider = mergeProvider(extra?.provider, routing);
  if (provider) {
    // A saved value that is not an object cannot hold a nested key, so it is replaced.
    return {
      edits: extra
        ? { "memoryExtraParams.provider": provider }
        : { memoryExtraParams: { provider } },
      provider,
    };
  }
  return { edits: removeProviderEdits(savedExtraParams), provider };
}
