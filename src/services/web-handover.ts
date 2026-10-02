import { compareVersions } from "./version-compare.js";

// The version handover shared by `web install` and the host start: ask an older
// OMMS web app to step aside, then wait for its port. It imports no host adapter,
// no store, and no embedding model.

export const POLL_MS = 250;
export const POLL_LIMIT = 40;
const REQUEST_TIMEOUT_MS = 2_000;

/** The version an OMMS web app reports on `url`, or null when none answers with one. */
export async function readWebVersion(
  fetchFn: typeof fetch,
  url: string,
  headers: Record<string, string>
): Promise<string | null> {
  try {
    const response = await fetchFn(`${url}/api/settings/version`, {
      headers,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { running?: unknown };
    return typeof body.running === "string" ? body.running : null;
  } catch {
    return null;
  }
}

async function portAnswers(fetchFn: typeof fetch, url: string): Promise<boolean> {
  try {
    await fetchFn(`${url}/api/health`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    return true;
  } catch {
    return false;
  }
}

export type Handover =
  { kind: "none" } | { kind: "handed" } | { kind: "stuck" | "same" | "newer"; owner: string };

export interface HandoverContext {
  fetchFn: typeof fetch;
  sleep: (ms: number) => Promise<void>;
  url: string;
  port: number;
  headers: Record<string, string>;
  version: string;
}

/** Ask an older OMMS web app on the configured port to step aside, and wait for the port. */
export async function negotiateOwner(ctx: HandoverContext): Promise<Handover> {
  const owner = await readWebVersion(ctx.fetchFn, ctx.url, ctx.headers);
  const order = owner === null ? null : compareVersions(owner, ctx.version);
  // A version that cannot be placed is never stopped.
  if (owner === null || order === null) return { kind: "none" };
  if (order === 0) return { kind: "same", owner };
  if (order > 0) return { kind: "newer", owner };
  try {
    const reply = await ctx.fetchFn(`${ctx.url}/api/web/step-aside`, {
      method: "POST",
      headers: { ...ctx.headers, "content-type": "application/json" },
      body: JSON.stringify({ version: ctx.version }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (reply.status !== 202) return { kind: "stuck", owner };
  } catch {
    return { kind: "stuck", owner };
  }
  // If the old app is slow to stop, the login item still takes the port later.
  for (let i = 0; i < POLL_LIMIT && (await portAnswers(ctx.fetchFn, ctx.url)); i++) {
    await ctx.sleep(POLL_MS);
  }
  return { kind: "handed" };
}
