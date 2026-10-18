/**
 * The Reranker card's pure definitions and draft maths, with no React,
 * config, or host imports, so tests and the card share one source
 * (mirrors memory-controls.ts).
 */

export type RerankerDraft = {
  enabled: boolean;
  url: string;
  model: string;
  key: string;
  timeout: string;
};

export type RerankerSaveEdits = {
  rerankerEnabled: boolean;
  rerankerApiUrl: string | null;
  rerankerModel: string | null;
  rerankerApiKey: string | null;
  rerankerTimeoutMs: number;
};

export const RERANKER_TIMEOUT_DEFAULT = 4000;
export const RERANKER_TIMEOUT_MIN = 500;
export const RERANKER_TIMEOUT_MAX = 30000;

/** Every English message the card shows or exposes to assistive tech. */
export const RERANKER_MESSAGES: readonly string[] = [
  "Reranker",
  "Use a reranker",
  "Server URL",
  "Model",
  "Key",
  "Timeout",
  "Search is unchanged while the switch is off.",
  "The reranker reorders the best memory search results with your reranker server and keeps the top results.",
  "The reranker sends the prompt and the text of candidate memories to the server URL. A server on the same machine is recommended.",
  "This URL is not on this machine: memory text leaves this machine.",
  "A project file cannot change these settings. The reranker settings are global only.",
  "The default of 4000 keeps the search inside OpenCode V2's 5-second wait. A value over 5000 can make OpenCode V2 send the request with no memory.",
  "Enter the server URL and model before turning the reranker on.",
  "The key must be an env:// or file:// reference, or left empty.",
  "Enter a whole number from 500 to 30,000.",
  "Optional env:// or file:// key reference.",
  "milliseconds",
  "Test",
  "Save",
  "Cancel",
  "Saved. New searches use these settings.",
  "The reranker settings could not be saved. Reload the page to try again.",
  "The reranker settings could not be loaded. Reload the page to try again.",
  "Test passed.",
  "Test failed:",
  "Config changed. Reload settings and save again.",
];

export function parseRerankerTimeout(raw: string): number | undefined {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text || !/^\d+$/.test(text)) return undefined;
  const value = Number(text);
  return value >= RERANKER_TIMEOUT_MIN && value <= RERANKER_TIMEOUT_MAX ? value : undefined;
}

export function isSecretReference(raw: string): boolean {
  return /^(env:\/\/[A-Za-z_][A-Za-z0-9_]*|file:\/\/.+)$/.test(raw.trim());
}

/** A remote URL is any host that is not loopback; those get the notice. */
export function isRemoteRerankerUrl(raw: string): boolean {
  try {
    const host = new URL(raw.trim()).hostname.toLowerCase();
    // URL.hostname keeps the brackets on an IPv6 literal.
    return !(
      host === "localhost" ||
      host === "::1" ||
      host === "[::1]" ||
      /^127\.\d+\.\d+\.\d+$/.test(host)
    );
  } catch {
    return false;
  }
}

export function rerankerFieldProblem(
  draft: RerankerDraft
): { field: "url-model" | "key" | "timeout" } | undefined {
  if (draft.enabled && (draft.url.trim().length === 0 || draft.model.trim().length === 0)) {
    return { field: "url-model" };
  }
  if (draft.key.trim().length > 0 && !isSecretReference(draft.key)) {
    return { field: "key" };
  }
  if (parseRerankerTimeout(draft.timeout) === undefined) {
    return { field: "timeout" };
  }
  return undefined;
}

/** Save needs a valid draft; any problem disables it. */
export function canSaveReranker(draft: RerankerDraft): boolean {
  return rerankerFieldProblem(draft) === undefined;
}

export function rerankerSaveEdits(draft: RerankerDraft): RerankerSaveEdits {
  return {
    rerankerEnabled: draft.enabled,
    rerankerApiUrl: draft.url.trim() || null,
    rerankerModel: draft.model.trim() || null,
    rerankerApiKey: draft.key.trim() || null,
    rerankerTimeoutMs: parseRerankerTimeout(draft.timeout) ?? RERANKER_TIMEOUT_DEFAULT,
  };
}
