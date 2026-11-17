/**
 * The config keys the web app can write. The general Settings save writes `PAGE_KEYS`; the
 * embedding Apply and the browser password routes write the other two sets. A config problem
 * for a key outside all three tells the user to fix the file, not to open the Settings page.
 * No imports: `config-problems.ts` reads this list and must not load the config.
 */
export const PAGE_KEYS: ReadonlySet<string> = new Set([
  "opencodeProvider",
  "opencodeModel",
  "piProvider",
  "piModel",
  "captureTrace",
  "captureTraceRetentionDays",
  "captureAttemptRetentionDays",
  "captureRetryRetentionHours",
  "autoBackfill",
  "opencodeBackfillModel",
  "piBackfillModel",
  "webServerAutoStart",
  "userProfileAutoCleanupEnabled",
  "userProfileAutoCleanupInterval",
  "memoryProvider",
  "memoryApiUrl",
  "memoryModel",
  "memoryApiKey",
  "importPathMaps",
  "importIgnoredDirectories",
  "claudeConfigDir",
  "autoCaptureLanguage",
  "maxMemories",
  "autoCaptureMaxContextBytes",
  "userProfileMaxContextBytes",
  "retrievalMaxTokens",
  "similarityThreshold",
  "keywordMode",
  "rerankerEnabled",
  "rerankerApiUrl",
  "rerankerModel",
  "rerankerApiKey",
  "rerankerTimeoutMs",
  "skillLearning",
  "skillLearningRedact",
  "skillFolders",
  "openingContext",
  "openingContextQuery",
  "subagentMemory",
  "compaction.enabled",
  "compaction.memoryLimit",
  "memorisationRepeat",
  "memorisationMaxSize",
  "memorisationSizeUnit",
  "memorisationRerank",
  "autoCaptureEnabled",
  "chatMessage.enabled",
  "visibleRecall",
  "injectProfile",
  "memory.defaultScope",
  "autoDeleteOldMemories",
  "autoCleanupRetentionDays",
]);

/**
 * Written only by the embedding apply route, together, after a passing test.
 * The general settings save refuses them, so a change always re-embeds.
 */
export const EMBEDDING_KEYS = new Set<string>([
  "embeddingApiUrl",
  "embeddingApiKey",
  "embeddingModel",
  "embeddingDimensions",
]);

/** Written only by the browser password route; the password itself lives in a private key file. */
export const PASSWORD_KEYS = new Set<string>(["webServerAuthPassword", "webServerAuthUsername"]);

/** Written by their own routes: the OpenRouter routing card and the profile email choice. */
const ROUTE_KEYS = new Set<string>(["memoryExtraParams", "userEmailOverride"]);

/** True when a Settings card or route can write `key`. */
export function pageCanEdit(key: string): boolean {
  return [PAGE_KEYS, EMBEDDING_KEYS, PASSWORD_KEYS, ROUTE_KEYS].some((set) => set.has(key));
}
