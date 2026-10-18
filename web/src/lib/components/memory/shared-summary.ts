import type { StatusText } from "./host-status";

type Setting = { value?: unknown; globalValue?: unknown };
export type SharedSettings = Record<string, Setting | undefined>;

const text = (setting: Setting | undefined): string | null => {
  const value = setting?.value ?? setting?.globalValue;
  return value === undefined || value === null || value === "" ? null : String(value);
};

/** One-line state for each row of the Shared view, from the settings snapshot and the saved maps. */
export function sharedSummaries(
  settings: SharedSettings | undefined,
  maps: { saved: number; ignored: number } | undefined
): Record<"profile" | "limits" | "keywords" | "reranker" | "maps", StatusText> {
  const results = text(settings?.maxMemories);
  const similarity = text(settings?.similarityThreshold);
  const mode = text(settings?.keywordMode);
  const model = text(settings?.rerankerModel);
  return {
    profile: { text: "Prompts waiting for profile learning, and re-analysis of old chats" },
    limits:
      results && similarity
        ? { text: "Results {results} · Similarity {similarity}", params: { results, similarity } }
        : { text: "How many memories a search returns" },
    keywords: mode ? { text: "Mode: {mode}", params: { mode } } : { text: "Keyword matching" },
    reranker: text(settings?.rerankerApiUrl)
      ? model
        ? { text: "On · {model}", params: { model } }
        : { text: "On" }
      : { text: "Off" },
    maps: maps
      ? { text: "{saved} saved · {ignored} ignored", params: maps }
      : { text: "Saved maps and ignored directories" },
  };
}
