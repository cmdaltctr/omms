/**
 * The `keywordBoost` and `keywordMode` settings (openspec change hook-search-keywords-and-profile):
 * how much a memory that contains a word of the prompt gains in search. Pure,
 * so config.ts and tests share one rule without importing CONFIG.
 */
export const KEYWORD_BOOST_DEFAULT = 0.1;
export const KEYWORD_BOOST_MAX = 0.5;

/**
 * The setting from the file: the default when absent, otherwise a number from
 * 0 to 0.5. The message names the setting and its accepted values only.
 */
export function checkedKeywordBoost(value: unknown): number {
  if (value === undefined) return KEYWORD_BOOST_DEFAULT;
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > KEYWORD_BOOST_MAX
  ) {
    throw new Error(
      `Invalid keywordBoost config (accepted: numbers from 0 to ${KEYWORD_BOOST_MAX})`
    );
  }
  return value;
}

/** How word matches join the results: an added boost, or rank fusion (experimental). */
export type KeywordMode = "boost" | "rrf";
export const KEYWORD_MODES: readonly KeywordMode[] = ["boost", "rrf"];

/** The `keywordMode` setting from the file: `boost` when absent, otherwise `boost` or `rrf`. */
export function checkedKeywordMode(value: unknown): KeywordMode {
  if (value === undefined) return "boost";
  if (value !== "boost" && value !== "rrf") {
    throw new Error(`Invalid keywordMode config (accepted: ${KEYWORD_MODES.join(", ")})`);
  }
  return value;
}
