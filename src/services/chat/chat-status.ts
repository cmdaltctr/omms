import { isPlaceholderApiKey } from "../ai/api-key-placeholder.js";

export interface ChatSettings {
  memoryProvider?: string;
  memoryModel?: string;
  memoryApiUrl?: string;
  memoryApiKey?: string;
}

export interface ChatStatus {
  ready: boolean;
  /** Names of the settings still needed. Never their values. */
  missing: string[];
  provider: string;
  /** The host that receives questions and memory text, so the page can name it. */
  apiHost: string | null;
}

/** Whether chat can call the external memory model. Mirrors `buildMemoryProviderConfig`. */
export function chatStatus(config: ChatSettings): ChatStatus {
  const provider = config.memoryProvider ?? "openai-chat";
  const presetEndpoint = provider === "orcarouter";
  const missing: string[] = [];
  if (!config.memoryModel && !presetEndpoint) missing.push("memoryModel");
  if (!config.memoryApiUrl && !presetEndpoint) missing.push("memoryApiUrl");
  if (!config.memoryApiKey || isPlaceholderApiKey(config.memoryApiKey)) {
    missing.push("memoryApiKey");
  }
  return { ready: missing.length === 0, missing, provider, apiHost: hostOf(config.memoryApiUrl) };
}

function hostOf(url: string | undefined): string | null {
  try {
    return url ? new URL(url).host : null;
  } catch {
    return null;
  }
}
