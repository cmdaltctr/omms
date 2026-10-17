/**
 * Pure client for the opt-in reranker (openspec change
 * retrieval-threshold-and-reranker). Never imports CONFIG: callers pass the
 * settings so tests and the search path share one module without stubbing
 * src/config.js. The endpoint contract matches llama-server --reranking
 * (path /v1/rerank), Jina, and Cohere-style servers: POST <url>/rerank with
 * {model, query, documents, top_n}; reply {results: [{index, relevance_score}]}.
 */
import { resolveSecretValue } from "./secret-resolver.js";
import { RERANKER_TIMEOUT_DEFAULT_MS } from "./request-timeouts.js";

export interface RerankerSettings {
  apiUrl: string;
  model: string;
  apiKey?: string;
  timeoutMs: number;
}

/** A rerank candidate: the memory text plus the id used to break score ties. */
export interface RerankCandidate {
  id: string;
  memory: string;
}

/** Structural input so rerankSettingsFrom works with any config-shaped object. */
export interface RerankerConfigSlice {
  rerankerEnabled?: boolean;
  rerankerApiUrl?: string;
  rerankerModel?: string;
  rerankerApiKey?: string;
  rerankerTimeoutMs?: number;
}

/** Codes are metadata-only: safe to log, unlike the query or memory text. */
export class RerankError extends Error {
  constructor(
    readonly code:
      | "reranker_unreachable"
      | "reranker_timeout"
      | "reranker_http_error"
      | "reranker_invalid_reply",
    readonly elapsedMs: number,
    readonly status?: number,
    detail?: string
  ) {
    // The detail can quote transport text; callers redact the key first.
    super(detail ? `${code}: ${detail}` : code);
    this.name = "RerankError";
  }
}

function redactKey(text: string, key?: string): string {
  if (!key) return text;
  return text.split(key).join("[redacted]");
}

/** Documents are cut so one long memory cannot dominate the request. */
const MAX_DOCUMENT_CHARS = 4000;

/**
 * Map a config to reranker settings. Undefined means "off": the switch is
 * off, or the URL or model is missing (an incomplete setup is treated as
 * off, never as a broken search). A key reference that does not resolve in
 * this process sends no Authorization header; the server then answers 401
 * and the caller falls back.
 */
export function rerankSettingsFrom(config: RerankerConfigSlice): RerankerSettings | undefined {
  if (!config.rerankerEnabled) return undefined;
  const apiUrl = config.rerankerApiUrl?.trim();
  const model = config.rerankerModel?.trim();
  if (!apiUrl || !model) return undefined;
  let apiKey: string | undefined;
  if (config.rerankerApiKey) {
    try {
      apiKey = resolveSecretValue(config.rerankerApiKey);
    } catch {
      apiKey = undefined;
    }
  }
  return {
    apiUrl: apiUrl.replace(/\/+$/, ""),
    model,
    apiKey,
    timeoutMs: config.rerankerTimeoutMs ?? RERANKER_TIMEOUT_DEFAULT_MS,
  };
}

interface RerankReplyEntry {
  index?: unknown;
  relevance_score?: unknown;
}

/**
 * Ask the reranker to order the documents. Throws RerankError on any
 * failure; the caller falls back to the threshold result. A reply is valid
 * only when it has one entry per document, each index is an integer inside
 * the document range and appears once, and each relevance_score is finite.
 * Partial reranking is never used.
 */
export async function rerankDocuments<T extends RerankCandidate>(
  settings: RerankerSettings,
  query: string,
  documents: T[],
  fetchImpl: typeof fetch = fetch
): Promise<{ ordered: T[]; scores: number[] }> {
  const started = Date.now();
  const elapsed = () => Date.now() - started;
  const documentsText = documents.map((doc) => doc.memory.slice(0, MAX_DOCUMENT_CHARS));
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (settings.apiKey) headers.Authorization = `Bearer ${settings.apiKey}`;
  let response: Response;
  try {
    response = await fetchImpl(`${settings.apiUrl}/rerank`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: settings.model,
        query,
        documents: documentsText,
        top_n: documents.length,
      }),
      signal: AbortSignal.timeout(settings.timeoutMs),
    });
  } catch (error) {
    const name = (error as Error | undefined)?.name;
    const detail = error instanceof Error ? error.message : String(error);
    if (name === "AbortError" || name === "TimeoutError" || /abort/i.test(detail)) {
      throw new RerankError("reranker_timeout", elapsed(), undefined, "timed out");
    }
    throw new RerankError(
      "reranker_unreachable",
      elapsed(),
      undefined,
      redactKey(detail, settings.apiKey)
    );
  }
  if (!response.ok) {
    throw new RerankError("reranker_http_error", elapsed(), response.status);
  }
  let results: unknown;
  try {
    const body = (await response.json()) as { results?: unknown };
    results = body.results;
  } catch {
    throw new RerankError("reranker_invalid_reply", elapsed());
  }
  if (!Array.isArray(results) || results.length !== documents.length) {
    throw new RerankError("reranker_invalid_reply", elapsed());
  }
  const seen = new Set<number>();
  const scored = results.map((entry: RerankReplyEntry) => {
    const index = entry?.index;
    const score = entry?.relevance_score;
    const indexOk =
      typeof index === "number" &&
      Number.isInteger(index) &&
      index >= 0 &&
      index < documents.length;
    const scoreOk = typeof score === "number" && Number.isFinite(score);
    if (!indexOk || !scoreOk || seen.has(index as number)) {
      throw new RerankError("reranker_invalid_reply", elapsed());
    }
    seen.add(index as number);
    return { index: index as number, score: score as number };
  });
  // Highest relevance first; ties break by memory id so the order is stable.
  scored.sort(
    (a, b) => b.score - a.score || documents[a.index]!.id.localeCompare(documents[b.index]!.id)
  );
  return {
    ordered: scored.map((entry) => documents[entry.index]!),
    scores: scored.map((entry) => entry.score),
  };
}
