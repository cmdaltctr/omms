/**
 * The Keyword matching card's pure definitions, with no React, config, or host
 * imports, so tests and the card share one source (mirrors reranker-controls.ts).
 */

import { PLAIN_TEXT } from "./settings-catalogue-base";

export type KeywordMode = "boost" | "rrf";

/** The labels are plain words; `boost` and `rrf` stay the values saved in the file. */
export const KEYWORD_MODE_OPTIONS: readonly { value: KeywordMode; label: string }[] = [
  { value: "boost", label: PLAIN_TEXT.keywordBoost },
  { value: "rrf", label: PLAIN_TEXT.keywordMerge },
];

/** Every English message the card shows through the Settings table. The plain keyword labels and notes are catalogue text. */
export const KEYWORD_MODE_MESSAGES: readonly string[] = [
  "Keyword matching",
  "Search finds memories by meaning and by exact words from your prompt.",
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
