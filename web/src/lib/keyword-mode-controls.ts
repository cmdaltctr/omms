/**
 * The Keyword matching card's pure definitions, with no React, config, or host
 * imports, so tests and the card share one source (mirrors reranker-controls.ts).
 */

export type KeywordMode = "boost" | "rrf";

export const KEYWORD_MODE_OPTIONS: readonly { value: KeywordMode; label: string }[] = [
  { value: "boost", label: "Boost (default)" },
  { value: "rrf", label: "Rank fusion (experimental)" },
];

/** Every English message the card shows or exposes to assistive tech. */
export const KEYWORD_MODE_MESSAGES: readonly string[] = [
  "Keyword matching",
  "Search finds memories by meaning and by exact words from your prompt.",
  "Word matching mode",
  "Boost (default)",
  "Rank fusion (experimental)",
  "Boost adds a small score bonus to memories that contain a word of your prompt.",
  "Rank fusion merges a list by meaning and a list by words. A memory that contains a word of your prompt can be returned even when its meaning score is below the similarity threshold. Experimental: it has not been shown to find more relevant memories.",
  "Rank fusion is not used while the reranker is on. Search uses the boost.",
  "A project file can override this setting. This page edits the global value.",
  "Saved. New searches use this mode.",
  "The keyword matching setting could not be saved. Reload the page to try again.",
  "The keyword matching setting could not be loaded. Reload the page to try again.",
  "Save",
  "Cancel",
  "Config changed. Reload settings and save again.",
];

export function isKeywordMode(value: unknown): value is KeywordMode {
  return value === "boost" || value === "rrf";
}

/** The mode from a settings snapshot value; anything else shows the default. */
export function modeFromSetting(value: unknown): KeywordMode {
  return isKeywordMode(value) ? value : "boost";
}

/** The body of the save request: the mode itself, so the file always shows the choice. */
export function keywordModeSaveEdits(mode: KeywordMode): { keywordMode: KeywordMode } {
  return { keywordMode: mode };
}

/**
 * Search keeps the boost while the reranker is on. The reranker is on only when
 * the switch is set and both its URL and model are filled in (as in the server).
 */
export function rerankerOverridesMode(settings: Record<string, { value?: unknown } | undefined>) {
  const text = (key: string) => {
    const value = settings[key]?.value;
    return typeof value === "string" && value.trim().length > 0;
  };
  return (
    settings.rerankerEnabled?.value === true && text("rerankerApiUrl") && text("rerankerModel")
  );
}
