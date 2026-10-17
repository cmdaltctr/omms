import type { ApiResult } from "$shared/api";
import type { AiCleanupJob } from "$lib/components/explorer/ai-cleanup-job-state";
import type { AutoCleanupRecord } from "$lib/components/explorer/auto-cleanup-undo-state";

export type { ApiResult };

declare global {
  interface Window {
    __OMMS_TOKEN__?: string;
  }
}

export async function fetchAPI<T = unknown>(
  endpoint: string,
  options: RequestInit & { timeout?: number } = {}
): Promise<ApiResult<T>> {
  try {
    const controller = new AbortController();
    const timeoutMs = options.timeout || 60000;
    const { timeout: _timeout, headers: extraHeaders, ...fetchOptions } = options;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const response = await fetch(endpoint, {
      ...fetchOptions,
      headers: {
        ...(extraHeaders as Record<string, string>),
        "x-omms-token": window.__OMMS_TOKEN__ || "",
      },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    return (await response.json()) as ApiResult<T>;
  } catch (error) {
    console.error("API Error:", error);
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

const AI_CLEANUP = "/api/user-profile/ai-cleanup";
const JSON_HEADERS = { "Content-Type": "application/json" };

/** The AI cleanup job runs on the server; these calls start, read, stop and apply it. */
export const aiCleanupApi = {
  start: (includeIds: string[], profileVersion?: number) =>
    fetchAPI<AiCleanupJob>(AI_CLEANUP, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ includeIds, profileVersion }),
    }),
  status: () => fetchAPI<AiCleanupJob | null>(AI_CLEANUP),
  stop: () => fetchAPI<null>(AI_CLEANUP, { method: "DELETE" }),
  apply: (acceptedMerged: string[][], acceptedRemoved: string[]) =>
    fetchAPI<{ applied: number; skipped: number }>(`${AI_CLEANUP}/apply`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ acceptedMerged, acceptedRemoved }),
    }),
};

const AUTO_CLEANUP = "/api/user-profile/auto-cleanup";

/** The newest automatic cleanup that can be undone, and its undo. */
export const autoCleanupApi = {
  status: () => fetchAPI<AutoCleanupRecord | null>(AUTO_CLEANUP),
  undo: () =>
    fetchAPI<{ restored: number; notFound: number }>(`${AUTO_CLEANUP}/undo`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({}),
    }),
};
