/**
 * Validation of the opt-in reranker keys. Lives outside src/config.ts, which is
 * at its size ceiling; config.ts calls it while building CONFIG.
 */
import { RERANKER_TIMEOUT_MAX_MS, RERANKER_TIMEOUT_MIN_MS } from "../services/request-timeouts.js";

export interface RerankerFileSettings {
  rerankerEnabled?: boolean;
  rerankerApiUrl?: string;
  rerankerModel?: string;
  rerankerApiKey?: string;
  rerankerTimeoutMs?: number;
}

/** The reranker key must be a reference, never a literal secret in the file. */
function isRerankerKeyReference(value: string): boolean {
  return /^(env:\/\/[A-Za-z_][A-Za-z0-9_]*|file:\/\/.+)$/.test(value.trim());
}

/**
 * Validate the five opt-in reranker keys when present (openspec change
 * retrieval-threshold-and-reranker). Messages name the setting and its
 * accepted values only; the value is never quoted back.
 */
export function checkedRerankerSettings(fileConfig: RerankerFileSettings) {
  const invalid = (setting: string, accepted: string): Error =>
    new Error(`Invalid ${setting} config (accepted: ${accepted})`);
  if (fileConfig.rerankerEnabled !== undefined && typeof fileConfig.rerankerEnabled !== "boolean") {
    throw invalid("rerankerEnabled", "boolean");
  }
  for (const key of ["rerankerApiUrl", "rerankerModel"] as const) {
    const value = fileConfig[key];
    if (value === undefined) continue;
    if (typeof value !== "string" || value.trim().length === 0) {
      throw invalid(key, "a non-empty string");
    }
  }
  if (
    fileConfig.rerankerApiUrl !== undefined &&
    !/^https?:\/\/\S+$/.test(fileConfig.rerankerApiUrl.trim())
  ) {
    throw invalid("rerankerApiUrl", "an http:// or https:// URL");
  }
  if (fileConfig.rerankerApiKey !== undefined) {
    if (
      typeof fileConfig.rerankerApiKey !== "string" ||
      !isRerankerKeyReference(fileConfig.rerankerApiKey)
    ) {
      throw invalid("rerankerApiKey", "an env:// or file:// secret reference");
    }
  }
  if (fileConfig.rerankerTimeoutMs !== undefined) {
    const value = fileConfig.rerankerTimeoutMs;
    const ok =
      typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= RERANKER_TIMEOUT_MIN_MS &&
      value <= RERANKER_TIMEOUT_MAX_MS;
    if (!ok) {
      throw invalid(
        "rerankerTimeoutMs",
        `integers from ${RERANKER_TIMEOUT_MIN_MS} to ${RERANKER_TIMEOUT_MAX_MS}`
      );
    }
  }
}
