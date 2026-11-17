/**
 * The Reranker card's pure definitions and draft maths, with no React,
 * config, or host imports, so tests and the card share one source
 * (mirrors memory-controls.ts).
 */
import { keySourceBody, type KeySourceBody } from "./external-api-settings";

/** How the key is supplied. `none` sends no key; `paste` saves the typed key to a private file. */
export type RerankerKeyChoice = "env" | "file" | "paste" | "none";
export type RerankerKeyInput = { name: string; path: string; value: string };
/** The saved key as the settings snapshot reports it: a source and a reference, never the key. */
export type RerankerSecret = { set: boolean; source: string | null; reference: string | null };

export type RerankerDraft = {
  enabled: boolean;
  url: string;
  model: string;
  timeout: string;
  keyChoice: RerankerKeyChoice;
  keyInput: RerankerKeyInput;
};

/** The edits the Save PATCH carries. The key is saved on its own route, so it is not here. */
export type RerankerSaveEdits = {
  rerankerEnabled: boolean;
  rerankerApiUrl: string | null;
  rerankerModel: string | null;
  rerankerTimeoutMs: number;
  /** Present, and null, only when the user chose No key while a key was saved. */
  rerankerApiKey?: null;
};

export type RerankerProblem = {
  field: "url-model" | "url" | "key" | "timeout";
  /** The English message of a key problem, for the card to translate. */
  message?: string;
};

export const RERANKER_TIMEOUT_DEFAULT = 4000;
export const RERANKER_TIMEOUT_MIN = 500;
export const RERANKER_TIMEOUT_MAX = 30000;

/**
 * Every English message the card shows through the Settings table. The row names, the reranker
 * sentences and the new key and URL texts are catalogue text.
 */
export const RERANKER_MESSAGES: readonly string[] = [
  "Reranker",
  "Search is unchanged while the switch is off.",
  "The reranker reorders the best memory search results with your reranker server and keeps the top results.",
  "The reranker sends the prompt and the text of candidate memories to the server URL. A server on the same machine is recommended.",
  "This URL is not on this machine: memory text leaves this machine.",
  "A project file cannot change these settings. The reranker settings are global only.",
  "OpenCode waits up to 5 seconds for memories before it sends your prompt. The default, 4000 milliseconds, finishes in time. Over 5000, OpenCode can send your prompt without memories.",
  "Enter the server URL and model before turning the reranker on.",
  "Enter a whole number from 500 to 30,000.",
  "Test",
  "Save",
  "Cancel",
  "Saved. New searches use these settings.",
  "The reranker settings could not be saved. Reload the page to try again.",
  "The reranker settings could not be loaded. Reload the page to try again.",
  "Test passed.",
  "Test failed:",
  "Config changed. Reload settings and save again.",
  "A key file with this name exists. Replace it?",
];

const EMPTY_KEY_INPUT: RerankerKeyInput = { name: "", path: "", value: "" };

/** The key choice and fields that show a saved key. A key set in the file by hand shows as No key. */
export function keyDraftFromSecret(
  secret: RerankerSecret | undefined
): Pick<RerankerDraft, "keyChoice" | "keyInput"> {
  if (secret?.set && secret.source === "env") {
    return { keyChoice: "env", keyInput: { ...EMPTY_KEY_INPUT, name: secret.reference ?? "" } };
  }
  if (secret?.set && secret.source === "file") {
    return { keyChoice: "file", keyInput: { ...EMPTY_KEY_INPUT, path: secret.reference ?? "" } };
  }
  return { keyChoice: "none", keyInput: { ...EMPTY_KEY_INPUT } };
}

/** True when the key part of the form differs from the saved key. A pasted key is always new. */
export function keyChanged(draft: RerankerDraft, secret: RerankerSecret | undefined): boolean {
  if (draft.keyChoice === "paste") return true;
  const saved = keyDraftFromSecret(secret);
  if (draft.keyChoice !== saved.keyChoice) return true;
  if (draft.keyChoice === "env") return draft.keyInput.name.trim() !== saved.keyInput.name;
  if (draft.keyChoice === "file") return draft.keyInput.path.trim() !== saved.keyInput.path;
  return false;
}

/** The file name used when a pasted key has no name, so it never replaces the External API key. */
export const RERANKER_KEY_FILE = "reranker";

/** The key-source request for the form, or the English reason it cannot be built. */
export function rerankerKeyBody(
  draft: RerankerDraft,
  replace = false
): { body: KeySourceBody } | { error: string } {
  if (draft.keyChoice === "none") return { error: "No key is chosen" };
  try {
    const input = { ...draft.keyInput, replace };
    if (draft.keyChoice === "paste") input.name = input.name.trim() || RERANKER_KEY_FILE;
    return { body: keySourceBody(draft.keyChoice, input) };
  } catch (error) {
    return { error: (error as Error).message };
  }
}

/** The `env://` or `file://` reference a Test sends for the key in the form. */
export function keyReference(draft: RerankerDraft): string | undefined {
  if (draft.keyChoice === "env" && draft.keyInput.name.trim()) {
    return `env://${draft.keyInput.name.trim()}`;
  }
  if (draft.keyChoice === "file" && draft.keyInput.path.trim()) {
    return `file://${draft.keyInput.path.trim()}`;
  }
  return undefined;
}

export function parseRerankerTimeout(raw: string): number | undefined {
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text || !/^\d+$/.test(text)) return undefined;
  const value = Number(text);
  return value >= RERANKER_TIMEOUT_MIN && value <= RERANKER_TIMEOUT_MAX ? value : undefined;
}

const HTTP_URL = /^https?:\/\/\S+$/;

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
  draft: RerankerDraft,
  secret?: RerankerSecret
): RerankerProblem | undefined {
  if (draft.enabled && (draft.url.trim().length === 0 || draft.model.trim().length === 0)) {
    return { field: "url-model" };
  }
  if (draft.url.trim().length > 0 && !HTTP_URL.test(draft.url.trim())) {
    return { field: "url" };
  }
  if (draft.keyChoice !== "none" && keyChanged(draft, secret)) {
    const key = rerankerKeyBody(draft);
    if ("error" in key) return { field: "key", message: key.error };
  }
  if (parseRerankerTimeout(draft.timeout) === undefined) {
    return { field: "timeout" };
  }
  return undefined;
}

/** Save needs a valid draft; any problem disables it. */
export function canSaveReranker(draft: RerankerDraft, secret?: RerankerSecret): boolean {
  return rerankerFieldProblem(draft, secret) === undefined;
}

export function rerankerSaveEdits(
  draft: RerankerDraft,
  secret?: RerankerSecret
): RerankerSaveEdits {
  const edits: RerankerSaveEdits = {
    rerankerEnabled: draft.enabled,
    rerankerApiUrl: draft.url.trim() || null,
    rerankerModel: draft.model.trim() || null,
    rerankerTimeoutMs: parseRerankerTimeout(draft.timeout) ?? RERANKER_TIMEOUT_DEFAULT,
  };
  if (draft.keyChoice === "none" && keyChanged(draft, secret)) edits.rerankerApiKey = null;
  return edits;
}
