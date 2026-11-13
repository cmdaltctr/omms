import { isMemorisationId, parseTagGroups, visibleTags } from "../core/memorisation.js";
import type { RouteResult } from "./chat/chat-routes.js";
import type { LinkedSearchSettings } from "./linked-search.js";

/** Enough for any project: a memorisation is capped in size, and the user saves each on purpose. */
const LIST_LIMIT = 200;
/** The most IDs one bulk delete takes. */
const BULK_DELETE_MAX = 500;

const ok = (data: unknown): RouteResult => ({ status: 200, body: { success: true, data } });
const fail = (status: number, error: string): RouteResult => ({
  status,
  body: { success: false, error },
});

/** The CONFIG values recall needs. The route registration builds them, so this module has no CONFIG import. */
export interface MemorisationRouteConfig {
  linked: LinkedSearchSettings;
  /** The global `memorisationRerank` setting, so text recall may use the reranker. */
  rerank: boolean;
}

/**
 * Routes for the Memorisation page. Returns undefined for paths it does not own.
 * `GET /api/memorisations?tags=a,b` lists, `GET /api/memorisations/recall?q=&tags=` recalls
 * and `POST /api/memorisations/bulk-delete` deletes. Every read covers the whole active
 * space and its linked spaces, so the page works from any folder. The general `/api/memories`
 * delete routes refuse memorisations by design, so this module owns the bulk delete.
 * Memorisation text is returned to the page and never written to the log.
 */
export async function routeMemorisations(
  path: string,
  method: string,
  url: URL,
  config: MemorisationRouteConfig,
  readBody?: () => Promise<any>
): Promise<RouteResult | undefined> {
  const wanted = parseTagGroups(url.searchParams.get("tags") ?? undefined);
  if (method === "GET" && path === "/api/memorisations") return listMemorisations(wanted);
  if (method === "GET" && path === "/api/memorisations/recall") {
    return recall(url.searchParams, wanted, config);
  }
  if (method === "POST" && path === "/api/memorisations/bulk-delete" && readBody) {
    return bulkDelete(await readBody(), config);
  }
  return undefined;
}

async function listMemorisations(wanted: string[][]): Promise<RouteResult> {
  const { listMemorisationsByTags } = await import("./memorisation-store.js");
  const result = await listMemorisationsByTags("", wanted, "all-projects", LIST_LIMIT);
  if (!result.success) return fail(500, result.error);
  const memorisations = result.memories.map((memory) => ({
    id: memory.id,
    content: memory.summary,
    createdAt: memory.createdAt,
    host: typeof memory.metadata?.host === "string" ? memory.metadata.host : undefined,
    kind:
      typeof memory.metadata?.memorisation === "string" ? memory.metadata.memorisation : undefined,
    space: memory.spaceName,
    tags: visibleTags(memory.tags),
  }));
  return ok({ memorisations });
}

async function recall(
  params: URLSearchParams,
  wanted: string[][],
  config: MemorisationRouteConfig
): Promise<RouteResult> {
  const text = params.get("q")?.trim();
  if (!text && wanted.length === 0) return fail(400, "q or tags required: an ID, text or labels");
  const limit = Number(params.get("limit"));
  const { runRecall } = await import("../core/memorisation-operations.js");
  const result = await runRecall(
    {
      query: text,
      tags: wanted.map((group) => group.join("|")).join(","),
      ...(Number.isInteger(limit) && limit > 0 ? { limit } : {}),
    },
    config.linked,
    config.rerank
  );
  if (result.success !== true) {
    // An unknown ID is a missing record. Any other refusal is a server problem.
    const error = String(result.error ?? "Recall failed");
    return fail(error.startsWith("No memorisation has the ID") ? 404 : 500, error);
  }
  return ok({ count: result.count, matches: result.matches });
}

/** Deletes memorisations of any project from the active space. Linked spaces are never touched. */
async function bulkDelete(body: any, config: MemorisationRouteConfig): Promise<RouteResult> {
  const ids: unknown = body?.ids;
  if (
    !Array.isArray(ids) ||
    ids.length < 1 ||
    ids.length > BULK_DELETE_MAX ||
    !ids.every((id) => typeof id === "string" && isMemorisationId(id))
  ) {
    return fail(400, `ids must be 1 to ${BULK_DELETE_MAX} memorisation IDs (ms-xxxxxx)`);
  }
  const { deleteMemorisation } = await import("./memorisation-store.js");
  const deleted: string[] = [];
  const skipped: { id: string; reason: string }[] = [];
  for (const id of new Set(ids as string[])) {
    const outcome = await deleteMemorisation(id, null, config.linked);
    if (outcome === "deleted") deleted.push(id);
    else skipped.push({ id, reason: outcome });
  }
  return ok({ deleted, skipped });
}
