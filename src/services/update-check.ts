import { isOlderVersion } from "./version-compare.js";

/** The `latest` version on npm, or null when the registry cannot be reached. */
export async function latestNpmVersion(
  fetchFn: typeof fetch,
  timeoutMs = 5_000
): Promise<string | null> {
  try {
    const response = await fetchFn("https://registry.npmjs.org/om-memory-system/latest", {
      signal: AbortSignal.timeout(timeoutMs),
      headers: { accept: "application/json" },
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { version?: unknown };
    return typeof body.version === "string" ? body.version : null;
  } catch {
    return null;
  }
}

/** A newer release than `current`, ignoring prereleases; null otherwise. */
export function availableUpdate(current: string, latest: string | null): string | null {
  if (!latest || latest.includes("-")) return null;
  return isOlderVersion(current, latest) ? latest : null;
}
