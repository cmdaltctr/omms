/**
 * The Reranker card's Test route (openspec change
 * retrieval-threshold-and-reranker, task 6.1). Sends two fixed sample
 * documents, never real memory text, through the same rerankDocuments the
 * search uses, and reports success or a failure code only. Same guard rules
 * as the embedding test route: loopback caller, authorised API request,
 * JSON body.
 */
import { isAuthorizedApiRequest } from "./auth-token.js";
import { isLoopbackAddress } from "./web-api-auth.js";
import { resolveSecretValue } from "./secret-resolver.js";
import { rerankDocuments, RerankError, type RerankerSettings } from "./reranker.js";
import {
  RERANKER_TIMEOUT_DEFAULT_MS,
  RERANKER_TIMEOUT_MAX_MS,
  RERANKER_TIMEOUT_MIN_MS,
} from "./request-timeouts.js";

// Fixed samples: they carry no user content, so the test never leaks memory
// text to an unverified server beyond these two strings.
const TEST_QUERY = "Which document is about the omms reranker test?";
const TEST_DOCUMENTS = [
  { id: "sample-1", memory: "This document describes the omms reranker connectivity test." },
  { id: "sample-2", memory: "This document describes an unrelated topic for comparison." },
];

interface RerankerDraft {
  rerankerApiUrl?: unknown;
  rerankerModel?: unknown;
  rerankerApiKey?: unknown;
  rerankerTimeoutMs?: unknown;
}

function reject(message: string): Response {
  return Response.json({ error: message }, { status: 400 });
}

/** Draft validation mirrors the save route's rules; values are never echoed. */
function draftSettings(draft: RerankerDraft): RerankerSettings | Response {
  const url = typeof draft.rerankerApiUrl === "string" ? draft.rerankerApiUrl.trim() : "";
  if (!/^https?:\/\/\S+$/.test(url)) {
    return reject("Invalid rerankerApiUrl setting: accepted an http:// or https:// URL");
  }
  const model = typeof draft.rerankerModel === "string" ? draft.rerankerModel.trim() : "";
  if (!model) {
    return reject("Invalid rerankerModel setting: accepted a non-empty string");
  }
  let apiKey: string | undefined;
  if (draft.rerankerApiKey !== undefined && draft.rerankerApiKey !== "") {
    const key = draft.rerankerApiKey;
    if (
      typeof key !== "string" ||
      !/^(env:\/\/[A-Za-z_][A-Za-z0-9_]*|file:\/\/.+)$/.test(key.trim())
    ) {
      return reject("rerankerApiKey must be an env:// or file:// reference");
    }
    try {
      apiKey = resolveSecretValue(key);
    } catch {
      return reject("rerankerApiKey could not be resolved");
    }
  }
  let timeoutMs = RERANKER_TIMEOUT_DEFAULT_MS;
  if (draft.rerankerTimeoutMs !== undefined && draft.rerankerTimeoutMs !== null) {
    const value = draft.rerankerTimeoutMs;
    if (
      typeof value !== "number" ||
      !Number.isSafeInteger(value) ||
      value < RERANKER_TIMEOUT_MIN_MS ||
      value > RERANKER_TIMEOUT_MAX_MS
    ) {
      return reject(
        `Invalid rerankerTimeoutMs setting: accepted integers from ${RERANKER_TIMEOUT_MIN_MS} to ${RERANKER_TIMEOUT_MAX_MS}`
      );
    }
    timeoutMs = value;
  }
  return { apiUrl: url.replace(/\/+$/, ""), model, apiKey, timeoutMs };
}

export async function testReranker(
  req: Request,
  method: string,
  remoteAddress: string | undefined
): Promise<Response> {
  if (method !== "POST") {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  if (!isLoopbackAddress(remoteAddress) || !isAuthorizedApiRequest(req)) {
    return Response.json({ error: "Only this machine can test a reranker" }, { status: 403 });
  }
  const body = (await req.json().catch(() => null)) as RerankerDraft | null;
  if (!body || typeof body !== "object") {
    return reject("A JSON body with the drafted reranker settings is required");
  }
  const settings = draftSettings(body);
  if (settings instanceof Response) return settings;
  const started = Date.now();
  try {
    const { ordered } = await rerankDocuments(settings, TEST_QUERY, TEST_DOCUMENTS);
    // The spec passes the test only when the relevant sample ranks first.
    if (ordered[0]?.id !== "sample-1") {
      return Response.json({
        success: false,
        code: "reranker_wrong_order",
        elapsedMs: Date.now() - started,
      });
    }
    return Response.json({ success: true });
  } catch (error) {
    // Success or a failure code only; never prompt or memory text.
    const code = error instanceof RerankError ? error.code : "reranker_unreachable";
    const elapsedMs = error instanceof RerankError ? error.elapsedMs : 0;
    return Response.json({ success: false, code, elapsedMs });
  }
}
