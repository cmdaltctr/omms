import { existsSync, readFileSync, mkdirSync, writeFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { stripJsoncComments } from "./services/jsonc.js";
import { isValidClaudeConfigDir } from "./services/claude-folder.js";
import { log } from "./services/logger.js";
import { resolveSecretValue } from "./services/secret-resolver.js";
import { isPlaceholderApiKey } from "./services/ai/api-key-placeholder.js";
import { getAutoCaptureProviderStatus } from "./services/ai/live-model-choice.js";
import { parseBackfillModel } from "./importer/backfill-model.js";
import { parseIgnoredDirectories, parseImportPathMaps } from "./importer/import-path-maps.js";
import { checkedMemoryLimit, MEMORY_LIMITS, type MemoryLimitRule } from "./utils/memory-limits.js";
import { defaultSimilarityThreshold } from "./utils/threshold-default.js";
import {
  RERANKER_TIMEOUT_DEFAULT_MS,
  RERANKER_TIMEOUT_MAX_MS,
  RERANKER_TIMEOUT_MIN_MS,
} from "./services/request-timeouts.js";
import {
  resolveDefaultStoragePath,
  runLegacyStoreMigration,
  legacyMigrationPaths,
} from "./services/legacy-migration.js";

const OMMS_CONFIG_DIR = join(homedir(), ".config", "omms");
const DATA_DIR = join(homedir(), ".omms");
const LEGACY_CONFIG_FILES = [
  join(homedir(), ".config", "opencode", "opencode-mem.jsonc"),
  join(homedir(), ".config", "opencode", "opencode-mem.json"),
];
// Dual-read: the omms config wins; the legacy opencode-mem config is read
// only when no omms config file exists (decision D13 rule 6). The legacy
// file is never written.
const CONFIG_FILES = [
  join(OMMS_CONFIG_DIR, "omms.jsonc"),
  join(OMMS_CONFIG_DIR, "omms.json"),
  ...LEGACY_CONFIG_FILES,
];

if (!existsSync(OMMS_CONFIG_DIR)) {
  mkdirSync(OMMS_CONFIG_DIR, { recursive: true });
}

if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true });
}

interface OmmsConfig {
  storagePath?: string;
  userEmailOverride?: string;
  userNameOverride?: string;
  memory?: {
    defaultScope?: "project" | "all-projects";
  };
  embeddingModel?: string;
  embeddingDimensions?: number;
  embeddingApiUrl?: string;
  embeddingApiKey?: string;
  /** Opt-in Nomic task prefixes (`search_document:` / `search_query:`). Default false. */
  embeddingUseTaskPrefixes?: boolean;
  similarityThreshold?: number;
  maxMemories?: number;
  /** Opt-in reranker (global only): reorder search candidates with an external server. */
  rerankerEnabled?: boolean;
  rerankerApiUrl?: string;
  rerankerModel?: string;
  rerankerApiKey?: string;
  rerankerTimeoutMs?: number;
  /** Shared budget for automatic memory context in approximate tokens (ceil(UTF-8 bytes / 4)). */
  retrievalMaxTokens?: number;
  maxProfileItems?: number;
  injectProfile?: boolean;
  containerTagPrefix?: string;
  autoCaptureEnabled?: boolean;
  autoCaptureMaxIterations?: number;
  autoCaptureIterationTimeout?: number;
  autoCaptureMaxRetries?: number;
  autoCaptureMaxContextBytes?: number;
  autoCaptureLanguage?: string;
  memoryProvider?:
    "openai-chat" | "openai-responses" | "anthropic" | "minimax" | "orcarouter" | "google-gemini";
  memoryModel?: string;
  memoryApiUrl?: string;
  memoryApiKey?: string;
  memoryTemperature?: number | false;
  memoryExtraParams?: Record<string, unknown>;
  opencodeProvider?: string;
  opencodeModel?: string;
  /**
   * Pi adapter: provider/model for live capture and profile learning ("inherit" = session
   * model). Unset: the external API when configured, otherwise the session model.
   */
  piProvider?: string;
  piModel?: string;
  aiSessionRetentionDays?: number;
  /** Write full capture prompts and replies to ~/.omms/traces. Global config only. */
  captureTrace?: boolean;
  captureTraceRetentionDays?: number;
  captureAttemptRetentionDays?: number;
  /** Hours to keep failed live captures for retry. 0 turns the queue off. Global config only. */
  captureRetryRetentionHours?: number;
  autoBackfill?: boolean;
  opencodeBackfillModel?: string;
  piBackfillModel?: string;
  /** Saved directory maps for every history import. Global config only. */
  importPathMaps?: Array<{ from: string; to: string }>;
  /** Unresolved directories the Directory maps page hides. Display only. Global config only. */
  importIgnoredDirectories?: string[];
  /** Claude Code's folder (its transcripts are in `<folder>/projects`). Empty means `CLAUDE_CONFIG_DIR`, then `~/.claude`. Global config only. */
  claudeConfigDir?: string;
  webServerAutoStart?: boolean;
  webServerEnabled?: boolean;
  webServerPort?: number;
  webServerHost?: string;
  webServerAuthPassword?: string;
  webServerAuthUsername?: string;
  webServerApiToken?: string;
  maxVectorsPerShard?: number;
  autoCleanupEnabled?: boolean;
  autoCleanupRetentionDays?: number;
  deduplicationEnabled?: boolean;
  deduplicationSimilarityThreshold?: number;
  userProfileAnalysisInterval?: number;
  userProfileMaxContextBytes?: number;
  userProfileDisplayPreferences?: number;
  userProfileDisplayPatterns?: number;
  userProfileDisplayWorkflows?: number;
  userProfileStaleDays?: number;
  userProfileWorkflowStaleDays?: number;
  userProfileInjectPreferences?: number;
  userProfileInjectPatterns?: number;
  userProfileInjectWorkflows?: number;
  userProfileConfidenceDecayDays?: number;
  userProfileChangelogRetentionCount?: number;
  userProfileEmbeddingThresholdSameCat?: number;
  userProfileEmbeddingThresholdSameCatWeak?: number;
  userProfileEmbeddingThresholdCrossCat?: number;
  userProfileEmbeddingThresholdCrossCatWeak?: number;
  userProfileCentroidDriftThreshold?: number;
  userProfileEmbeddingMinDescriptionLength?: number;
  userProfileMinEvidenceForRetention?: number;
  userProfileAutoCleanupEnabled?: boolean;
  userProfileAutoCleanupInterval?: number;
  userProfileValidationEnabled?: boolean;
  showAutoCaptureToasts?: boolean;
  showUserProfileToasts?: boolean;
  showErrorToasts?: boolean;
  compaction?: {
    enabled?: boolean;
    memoryLimit?: number;
  };
  chatMessage?: {
    enabled?: boolean;
    maxMemories?: number;
    excludeCurrentSession?: boolean;
    maxAgeDays?: number;
    injectOn?: "first" | "always";
  };
}

const DEFAULTS: Required<
  Omit<
    OmmsConfig,
    | "embeddingApiUrl"
    | "embeddingApiKey"
    | "memoryModel"
    | "memoryApiUrl"
    | "memoryApiKey"
    | "memoryProvider"
    | "memoryTemperature"
    | "memoryExtraParams"
    | "similarityThreshold"
    | "rerankerApiUrl"
    | "rerankerModel"
    | "rerankerApiKey"
    | "opencodeProvider"
    | "opencodeModel"
    | "piProvider"
    | "piModel"
    | "autoCaptureLanguage"
    | "userEmailOverride"
    | "userNameOverride"
    | "webServerAuthPassword"
    | "webServerAuthUsername"
    | "webServerApiToken"
  >
> & {
  embeddingApiUrl?: string;
  embeddingApiKey?: string;
  memoryModel?: string;
  memoryApiUrl?: string;
  memoryApiKey?: string;
  memoryProvider?:
    "openai-chat" | "openai-responses" | "anthropic" | "minimax" | "orcarouter" | "google-gemini";
  memoryTemperature?: number | false;
  memoryExtraParams?: Record<string, unknown>;
  similarityThreshold?: number;
  rerankerApiUrl?: string;
  rerankerModel?: string;
  rerankerApiKey?: string;
  opencodeProvider?: string;
  opencodeModel?: string;
  piProvider?: string;
  piModel?: string;
  autoCaptureLanguage?: string;
  userEmailOverride?: string;
  userNameOverride?: string;
  webServerAuthPassword?: string;
  webServerAuthUsername?: string;
  webServerApiToken?: string;
  memory?: {
    defaultScope?: "project" | "all-projects";
  };
} = {
  // Default store: ~/.omms/data (see resolveDefaultStoragePath for the
  // legacy-layout fallback while a legacy store exists unmigrated).
  storagePath: join(DATA_DIR, "data"),
  embeddingModel: "Xenova/nomic-embed-text-v1",
  embeddingDimensions: 768,
  embeddingUseTaskPrefixes: false,
  maxMemories: 10,
  rerankerEnabled: false,
  rerankerTimeoutMs: RERANKER_TIMEOUT_DEFAULT_MS,
  retrievalMaxTokens: 2000,
  maxProfileItems: 5,
  injectProfile: true,
  // omms since the tag prefix migration: new memories carry the fork's
  // identity end to end, and the startup gate (tag-prefix-migration.ts)
  // rewrites any remaining opencode_ rows before the first write is served.
  containerTagPrefix: "omms",
  autoCaptureEnabled: true,
  autoCaptureMaxIterations: 5,
  autoCaptureIterationTimeout: 30000,
  autoCaptureMaxRetries: 3,
  autoCaptureMaxContextBytes: 131072,
  aiSessionRetentionDays: 7,
  captureTrace: false,
  captureTraceRetentionDays: 7,
  captureAttemptRetentionDays: 30,
  captureRetryRetentionHours: 72,
  autoBackfill: true,
  opencodeBackfillModel: "inherit",
  piBackfillModel: "inherit",
  importPathMaps: [],
  importIgnoredDirectories: [],
  claudeConfigDir: "",
  webServerAutoStart: true,
  webServerEnabled: true,
  webServerPort: 4747,
  webServerHost: "127.0.0.1",
  maxVectorsPerShard: 50000,
  autoCleanupEnabled: true,
  autoCleanupRetentionDays: 30,
  deduplicationEnabled: true,
  deduplicationSimilarityThreshold: 0.9,
  userProfileAnalysisInterval: 10,
  userProfileMaxContextBytes: 32768,
  userProfileDisplayPreferences: 20,
  userProfileDisplayPatterns: 15,
  userProfileDisplayWorkflows: 10,
  userProfileStaleDays: 2,
  userProfileWorkflowStaleDays: 30,
  userProfileInjectPreferences: 5,
  userProfileInjectPatterns: 5,
  userProfileInjectWorkflows: 3,
  userProfileConfidenceDecayDays: 30,
  userProfileChangelogRetentionCount: 5,
  userProfileEmbeddingThresholdSameCat: 0.8,
  userProfileEmbeddingThresholdSameCatWeak: 0.5,
  userProfileEmbeddingThresholdCrossCat: 0.9,
  userProfileEmbeddingThresholdCrossCatWeak: 0.8,
  userProfileCentroidDriftThreshold: 0.65,
  userProfileEmbeddingMinDescriptionLength: 5,
  userProfileMinEvidenceForRetention: 3,
  userProfileAutoCleanupEnabled: true,
  userProfileAutoCleanupInterval: 500,
  userProfileValidationEnabled: false,
  showAutoCaptureToasts: true,
  showUserProfileToasts: true,
  showErrorToasts: true,
  memory: {
    defaultScope: "project",
  },
  compaction: {
    enabled: true,
    memoryLimit: 10,
  },
  chatMessage: {
    enabled: true,
    maxMemories: 3,
    excludeCurrentSession: true,
    maxAgeDays: undefined,
    injectOn: "first",
  },
};

function expandPath(path: string): string {
  if (path.startsWith("~/")) {
    return join(homedir(), path.slice(2));
  }
  if (path === "~") {
    return homedir();
  }
  return path;
}

/**
 * Load the first config file that exists, in priority order. A file that
 * exists but cannot be read or parsed is not skipped: falling through would let
 * a lower-priority (legacy) file silently supply settings such as storagePath.
 * `strict` (live reload) throws instead, so running hosts keep their settings.
 */
function loadConfigFromPaths(paths: string[], strict = false): OmmsConfig {
  const path = paths.find((candidate) => existsSync(candidate));
  if (!path) return {};
  try {
    const content = readFileSync(path, "utf-8");
    const json = stripJsoncComments(content);
    return JSON.parse(json) as OmmsConfig;
  } catch (error) {
    // The parser's message can quote file content, so a reload names the file only.
    if (strict) throw new Error(`Config file cannot be parsed: ${path}`, { cause: error });
    log("Config file is invalid; using defaults instead of lower-priority files", {
      path,
      error: String(error),
    });
    return {};
  }
}

const GLOBAL_ONLY_REMOTE_PROVIDER_FIELDS: ReadonlyArray<keyof OmmsConfig> = [
  "embeddingApiUrl",
  "embeddingApiKey",
  "memoryProvider",
  "memoryApiUrl",
  "memoryApiKey",
];

function assertProjectRemoteProviderConfigIsSafe(projectConfig: OmmsConfig): void {
  const configuredFields = GLOBAL_ONLY_REMOTE_PROVIDER_FIELDS.filter((field) =>
    Object.prototype.hasOwnProperty.call(projectConfig, field)
  );

  if (configuredFields.length > 0) {
    throw new Error(
      `Project config cannot set remote provider fields: ${configuredFields.join(", ")}. ` +
        `Move them to the global config at ${CONFIG_FILES[0]}.`
    );
  }
}

import { CONFIG_TEMPLATE } from "./config-template.js";

export { CONFIG_TEMPLATE };

function ensureConfigExists(): void {
  const configPath = join(OMMS_CONFIG_DIR, "omms.jsonc");
  const hasOmmsConfig = CONFIG_FILES.slice(0, 2).some((path) => existsSync(path));
  const hasLegacyConfig = LEGACY_CONFIG_FILES.some((path) => existsSync(path));

  // The template is created only when NO config exists at all. When a legacy
  // opencode-mem config is present, dual-read keeps using it and no omms
  // config file is written (writing one would permanently shadow the legacy
  // fallback on the next start).
  if (hasOmmsConfig || hasLegacyConfig) {
    return;
  }

  try {
    writeFileSync(configPath, CONFIG_TEMPLATE, "utf-8");
    console.log(`\n✓ Created config template: ${configPath}`);
    console.log("  Edit this file to customise omms settings.\n");
  } catch {
    // ignore if the template cannot be written
  }
}

ensureConfigExists();

function getEmbeddingDimensions(model: string): number {
  const dimensionMap: Record<string, number> = {
    // Local Xenova models
    "Xenova/nomic-embed-text-v1": 768,
    "Xenova/nomic-embed-text-v1-unsupervised": 768,
    "Xenova/nomic-embed-text-v1-ablated": 768,
    "Xenova/jina-embeddings-v2-base-en": 768,
    "Xenova/jina-embeddings-v2-base-zh": 768,
    "Xenova/jina-embeddings-v2-base-de": 768,
    "Xenova/jina-embeddings-v2-small-en": 512,
    "Xenova/all-MiniLM-L6-v2": 384,
    "Xenova/all-MiniLM-L12-v2": 384,
    "Xenova/all-mpnet-base-v2": 768,
    "Xenova/bge-base-en-v1.5": 768,
    "Xenova/bge-small-en-v1.5": 384,
    "Xenova/gte-small": 384,
    "Xenova/GIST-small-Embedding-v0": 384,
    "Xenova/text-embedding-ada-002": 1536,

    // OpenAI API models
    "text-embedding-3-small": 1536,
    "text-embedding-3-large": 3072,
    "text-embedding-ada-002": 1536,

    // Cohere API models
    "embed-english-v3.0": 1024,
    "embed-multilingual-v3.0": 1024,
    "embed-english-light-v3.0": 384,
    "embed-multilingual-light-v3.0": 384,

    // Google API models
    "text-embedding-004": 768,
    "text-multilingual-embedding-002": 768,

    // Voyage AI models
    "voyage-3": 1024,
    "voyage-3-lite": 512,
    "voyage-code-3": 1024,
  };
  return dimensionMap[model] || 768;
}

export function normalizeAutoCaptureMaxContextBytes(value: number): number {
  return checkedMemoryLimit(MEMORY_LIMITS.autoCaptureMaxContextBytes, value);
}

/**
 * Validate a top-level memory limit that is present in the file. A missing
 * key uses the default, so only own properties reach the check and a null
 * value is rejected instead of silently becoming the default.
 */
function checkedOwnMemoryLimit(
  rule: MemoryLimitRule,
  container: object,
  key: string,
  fallback: number
): number {
  const value = Object.hasOwn(container, key)
    ? (container as Record<string, unknown>)[key]
    : fallback;
  return checkedMemoryLimit(rule, value);
}

/** Whole hours from 0 to 720. A value that is not a number gives the default. */
export function normalizeCaptureRetryRetentionHours(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULTS.captureRetryRetentionHours;
  }
  return Math.min(720, Math.max(0, Math.floor(value)));
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
function checkedRerankerSettings(fileConfig: OmmsConfig) {
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

export function normalizeAutoCleanupRetentionDays(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Invalid autoCleanupRetentionDays config: ${value}`);
  }
  return value;
}

/**
 * The external API key, or undefined when its `env://` or `file://` source does
 * not resolve in this process (a login web app does not see shell-profile
 * variables). Readiness then reports the key as missing instead of the whole
 * config failing to load.
 */
function resolveMemoryApiKey(value: string | undefined): string | undefined {
  try {
    return resolveSecretValue(value);
  } catch {
    return undefined;
  }
}

function buildConfig(fileConfig: OmmsConfig) {
  const memoryApiKey = resolveMemoryApiKey(fileConfig.memoryApiKey);
  checkedRerankerSettings(fileConfig);
  const embeddingModel = fileConfig.embeddingModel ?? DEFAULTS.embeddingModel;
  // The default follows the embedder; a value present in the file always wins.
  const similarityThreshold = checkedOwnMemoryLimit(
    MEMORY_LIMITS.similarityThreshold,
    fileConfig,
    "similarityThreshold",
    defaultSimilarityThreshold(embeddingModel)
  );
  const embeddingDimensions =
    fileConfig.embeddingDimensions ?? getEmbeddingDimensions(embeddingModel);
  const autoCaptureMaxContextBytes = checkedOwnMemoryLimit(
    MEMORY_LIMITS.autoCaptureMaxContextBytes,
    fileConfig,
    "autoCaptureMaxContextBytes",
    DEFAULTS.autoCaptureMaxContextBytes
  );
  const maxMemories = checkedOwnMemoryLimit(
    MEMORY_LIMITS.maxMemories,
    fileConfig,
    "maxMemories",
    DEFAULTS.maxMemories
  );
  const retrievalMaxTokens = checkedOwnMemoryLimit(
    MEMORY_LIMITS.retrievalMaxTokens,
    fileConfig,
    "retrievalMaxTokens",
    DEFAULTS.retrievalMaxTokens
  );
  const userProfileMaxContextBytes = checkedOwnMemoryLimit(
    MEMORY_LIMITS.userProfileMaxContextBytes,
    fileConfig,
    "userProfileMaxContextBytes",
    DEFAULTS.userProfileMaxContextBytes
  );
  const chatMessageMaxMemories = checkedMemoryLimit(
    MEMORY_LIMITS["chatMessage.maxMemories"],
    fileConfig.chatMessage && Object.hasOwn(fileConfig.chatMessage, "maxMemories")
      ? fileConfig.chatMessage.maxMemories
      : DEFAULTS.chatMessage.maxMemories
  );
  const userProfileAutoCleanupInterval =
    fileConfig.userProfileAutoCleanupInterval ?? DEFAULTS.userProfileAutoCleanupInterval;
  parseBackfillModel(fileConfig, "pi");
  parseBackfillModel(fileConfig, "opencode");
  const importPathMaps = parseImportPathMaps(fileConfig.importPathMaps);
  const importIgnoredDirectories = parseIgnoredDirectories(fileConfig.importIgnoredDirectories);
  if (
    fileConfig.claudeConfigDir !== undefined &&
    !isValidClaudeConfigDir(fileConfig.claudeConfigDir)
  ) {
    throw new Error("Invalid claudeConfigDir config");
  }
  for (const key of ["autoBackfill", "webServerAutoStart"] as const) {
    if (fileConfig[key] !== undefined && typeof fileConfig[key] !== "boolean") {
      throw new Error(`Invalid ${key} config`);
    }
  }

  if (
    !Number.isInteger(embeddingDimensions) ||
    embeddingDimensions <= 0 ||
    embeddingDimensions > 65536
  ) {
    throw new Error(`Invalid embeddingDimensions config: ${embeddingDimensions}`);
  }
  if (!Number.isInteger(userProfileAutoCleanupInterval) || userProfileAutoCleanupInterval <= 0) {
    throw new Error(
      `Invalid userProfileAutoCleanupInterval config: ${userProfileAutoCleanupInterval}`
    );
  }

  return {
    storagePath: fileConfig.storagePath
      ? expandPath(fileConfig.storagePath)
      : resolveDefaultStoragePath(),
    userEmailOverride: fileConfig.userEmailOverride,
    userNameOverride: fileConfig.userNameOverride,
    embeddingModel: fileConfig.embeddingModel ?? DEFAULTS.embeddingModel,
    embeddingDimensions,
    embeddingUseTaskPrefixes:
      fileConfig.embeddingUseTaskPrefixes ?? DEFAULTS.embeddingUseTaskPrefixes,
    embeddingApiUrl: fileConfig.embeddingApiUrl,
    embeddingApiKey: fileConfig.embeddingApiUrl
      ? // No ambient OPENAI_API_KEY: an unset key means no Authorization header.
        resolveSecretValue(fileConfig.embeddingApiKey)
      : undefined,
    similarityThreshold,
    rerankerEnabled: fileConfig.rerankerEnabled ?? DEFAULTS.rerankerEnabled,
    rerankerApiUrl: fileConfig.rerankerApiUrl?.trim() || undefined,
    rerankerModel: fileConfig.rerankerModel?.trim() || undefined,
    rerankerApiKey: fileConfig.rerankerApiKey,
    rerankerTimeoutMs: fileConfig.rerankerTimeoutMs ?? DEFAULTS.rerankerTimeoutMs,
    maxMemories,
    retrievalMaxTokens,
    maxProfileItems: fileConfig.maxProfileItems ?? DEFAULTS.maxProfileItems,
    injectProfile: fileConfig.injectProfile ?? DEFAULTS.injectProfile,
    containerTagPrefix: fileConfig.containerTagPrefix ?? DEFAULTS.containerTagPrefix,
    autoCaptureEnabled: fileConfig.autoCaptureEnabled ?? DEFAULTS.autoCaptureEnabled,
    autoCaptureMaxIterations:
      fileConfig.autoCaptureMaxIterations ?? DEFAULTS.autoCaptureMaxIterations,
    autoCaptureIterationTimeout:
      fileConfig.autoCaptureIterationTimeout ?? DEFAULTS.autoCaptureIterationTimeout,
    autoCaptureMaxRetries: fileConfig.autoCaptureMaxRetries ?? DEFAULTS.autoCaptureMaxRetries,
    autoCaptureMaxContextBytes,
    autoCaptureLanguage: fileConfig.autoCaptureLanguage,
    memoryProvider: (fileConfig.memoryProvider ?? "openai-chat") as
      "openai-chat" | "openai-responses" | "anthropic" | "minimax" | "orcarouter" | "google-gemini",
    memoryModel: fileConfig.memoryModel,
    memoryApiUrl: fileConfig.memoryApiUrl,
    memoryApiKey,
    memoryTemperature: fileConfig.memoryTemperature,
    memoryExtraParams: fileConfig.memoryExtraParams,
    opencodeProvider: fileConfig.opencodeProvider,
    opencodeModel: fileConfig.opencodeModel,
    piProvider: fileConfig.piProvider,
    piModel: fileConfig.piModel,
    autoCaptureProviderStatus: getAutoCaptureProviderStatus({
      opencodeProvider: fileConfig.opencodeProvider,
      opencodeModel: fileConfig.opencodeModel,
      memoryProvider: fileConfig.memoryProvider,
      memoryModel: fileConfig.memoryModel,
      memoryApiUrl: fileConfig.memoryApiUrl,
      memoryApiKey,
    }),
    aiSessionRetentionDays: fileConfig.aiSessionRetentionDays ?? DEFAULTS.aiSessionRetentionDays,
    captureTrace: fileConfig.captureTrace === true,
    captureTraceRetentionDays: Math.max(
      1,
      Math.floor(fileConfig.captureTraceRetentionDays ?? DEFAULTS.captureTraceRetentionDays)
    ),
    captureAttemptRetentionDays: normalizeAutoCleanupRetentionDays(
      fileConfig.captureAttemptRetentionDays ?? DEFAULTS.captureAttemptRetentionDays
    ),
    captureRetryRetentionHours: normalizeCaptureRetryRetentionHours(
      fileConfig.captureRetryRetentionHours
    ),
    autoBackfill: fileConfig.autoBackfill ?? DEFAULTS.autoBackfill,
    opencodeBackfillModel: fileConfig.opencodeBackfillModel ?? DEFAULTS.opencodeBackfillModel,
    piBackfillModel: fileConfig.piBackfillModel ?? DEFAULTS.piBackfillModel,
    importPathMaps,
    importIgnoredDirectories,
    claudeConfigDir: expandPath(fileConfig.claudeConfigDir?.trim() ?? DEFAULTS.claudeConfigDir),
    webServerAutoStart: fileConfig.webServerAutoStart ?? DEFAULTS.webServerAutoStart,
    webServerEnabled: fileConfig.webServerEnabled ?? DEFAULTS.webServerEnabled,
    webServerPort: fileConfig.webServerPort ?? DEFAULTS.webServerPort,
    webServerHost: fileConfig.webServerHost ?? DEFAULTS.webServerHost,
    webServerAuthPassword: resolveSecretValue(fileConfig.webServerAuthPassword),
    webServerAuthUsername: fileConfig.webServerAuthUsername,
    webServerApiToken: fileConfig.webServerApiToken
      ? resolveSecretValue(fileConfig.webServerApiToken)
      : undefined,
    maxVectorsPerShard: fileConfig.maxVectorsPerShard ?? DEFAULTS.maxVectorsPerShard,
    autoCleanupEnabled: fileConfig.autoCleanupEnabled ?? DEFAULTS.autoCleanupEnabled,
    autoCleanupRetentionDays: normalizeAutoCleanupRetentionDays(
      fileConfig.autoCleanupRetentionDays ?? DEFAULTS.autoCleanupRetentionDays
    ),
    deduplicationEnabled: fileConfig.deduplicationEnabled ?? DEFAULTS.deduplicationEnabled,
    deduplicationSimilarityThreshold:
      fileConfig.deduplicationSimilarityThreshold ?? DEFAULTS.deduplicationSimilarityThreshold,
    userProfileAnalysisInterval:
      fileConfig.userProfileAnalysisInterval ?? DEFAULTS.userProfileAnalysisInterval,
    userProfileMaxContextBytes,
    userProfileDisplayPreferences:
      fileConfig.userProfileDisplayPreferences ?? DEFAULTS.userProfileDisplayPreferences,
    userProfileDisplayPatterns:
      fileConfig.userProfileDisplayPatterns ?? DEFAULTS.userProfileDisplayPatterns,
    userProfileDisplayWorkflows:
      fileConfig.userProfileDisplayWorkflows ?? DEFAULTS.userProfileDisplayWorkflows,
    userProfileInjectPreferences:
      fileConfig.userProfileInjectPreferences ?? DEFAULTS.userProfileInjectPreferences,
    userProfileInjectPatterns:
      fileConfig.userProfileInjectPatterns ?? DEFAULTS.userProfileInjectPatterns,
    userProfileInjectWorkflows:
      fileConfig.userProfileInjectWorkflows ?? DEFAULTS.userProfileInjectWorkflows,
    userProfileConfidenceDecayDays:
      fileConfig.userProfileConfidenceDecayDays ?? DEFAULTS.userProfileConfidenceDecayDays,
    userProfileChangelogRetentionCount:
      fileConfig.userProfileChangelogRetentionCount ?? DEFAULTS.userProfileChangelogRetentionCount,
    userProfileEmbeddingThresholdSameCat:
      fileConfig.userProfileEmbeddingThresholdSameCat ??
      DEFAULTS.userProfileEmbeddingThresholdSameCat,
    userProfileEmbeddingThresholdSameCatWeak:
      fileConfig.userProfileEmbeddingThresholdSameCatWeak ??
      DEFAULTS.userProfileEmbeddingThresholdSameCatWeak,
    userProfileEmbeddingThresholdCrossCat:
      fileConfig.userProfileEmbeddingThresholdCrossCat ??
      DEFAULTS.userProfileEmbeddingThresholdCrossCat,
    userProfileEmbeddingThresholdCrossCatWeak:
      fileConfig.userProfileEmbeddingThresholdCrossCatWeak ??
      DEFAULTS.userProfileEmbeddingThresholdCrossCatWeak,
    userProfileCentroidDriftThreshold:
      fileConfig.userProfileCentroidDriftThreshold ?? DEFAULTS.userProfileCentroidDriftThreshold,
    userProfileEmbeddingMinDescriptionLength:
      fileConfig.userProfileEmbeddingMinDescriptionLength ??
      DEFAULTS.userProfileEmbeddingMinDescriptionLength,
    userProfileMinEvidenceForRetention:
      fileConfig.userProfileMinEvidenceForRetention ?? DEFAULTS.userProfileMinEvidenceForRetention,
    userProfileAutoCleanupEnabled:
      fileConfig.userProfileAutoCleanupEnabled ?? DEFAULTS.userProfileAutoCleanupEnabled,
    userProfileAutoCleanupInterval,
    userProfileValidationEnabled:
      fileConfig.userProfileValidationEnabled ?? DEFAULTS.userProfileValidationEnabled,
    userProfileStaleDays: fileConfig.userProfileStaleDays ?? DEFAULTS.userProfileStaleDays,
    userProfileWorkflowStaleDays:
      fileConfig.userProfileWorkflowStaleDays ?? DEFAULTS.userProfileWorkflowStaleDays,
    showAutoCaptureToasts: fileConfig.showAutoCaptureToasts ?? DEFAULTS.showAutoCaptureToasts,
    showUserProfileToasts: fileConfig.showUserProfileToasts ?? DEFAULTS.showUserProfileToasts,
    showErrorToasts: fileConfig.showErrorToasts ?? DEFAULTS.showErrorToasts,
    memory: {
      defaultScope: fileConfig.memory?.defaultScope ?? DEFAULTS.memory.defaultScope,
    },
    compaction: {
      enabled: fileConfig.compaction?.enabled ?? DEFAULTS.compaction.enabled,
      memoryLimit: fileConfig.compaction?.memoryLimit ?? DEFAULTS.compaction.memoryLimit,
    },
    chatMessage: {
      enabled: fileConfig.chatMessage?.enabled ?? DEFAULTS.chatMessage.enabled,
      maxMemories: chatMessageMaxMemories,
      excludeCurrentSession:
        fileConfig.chatMessage?.excludeCurrentSession ?? DEFAULTS.chatMessage.excludeCurrentSession,
      maxAgeDays: fileConfig.chatMessage?.maxAgeDays,
      injectOn: (fileConfig.chatMessage?.injectOn ?? DEFAULTS.chatMessage.injectOn) as
        "first" | "always",
    },
  };
}

export function getGlobalConfigSourcePath(): string | undefined {
  return CONFIG_FILES.find((candidate) => existsSync(candidate));
}

export function getGlobalConfigWritePath(): string {
  const source = getGlobalConfigSourcePath();
  return source && !LEGACY_CONFIG_FILES.includes(source)
    ? source
    : join(OMMS_CONFIG_DIR, "omms.jsonc");
}

export function validateGlobalConfig(value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Global config must be an object");
  }
  buildConfig(value as OmmsConfig);
}

const _globalFileConfig = loadConfigFromPaths(CONFIG_FILES);
let lastFileConfig: OmmsConfig = _globalFileConfig;
export let CONFIG = buildConfig(_globalFileConfig);

type RuntimeConfig = ReturnType<typeof buildConfig>;

export {
  getAutoCaptureProviderStatus,
  type AutoCaptureProviderStatus,
} from "./services/ai/live-model-choice.js";
export { isPlaceholderApiKey };

export function hasAutoCaptureProviderConfig(config: RuntimeConfig = CONFIG): boolean {
  return getAutoCaptureProviderStatus(config).ready;
}

function projectConfigPaths(directory: string): string[] {
  return [
    join(directory, ".opencode", "omms.jsonc"),
    join(directory, ".opencode", "omms.json"),
    join(directory, ".opencode", "opencode-mem.jsonc"),
    join(directory, ".opencode", "opencode-mem.json"),
  ];
}

function configSignature(directory: string): string {
  return [...CONFIG_FILES, ...projectConfigPaths(directory)]
    .filter((path) => existsSync(path))
    .map((path) => {
      try {
        const stat = statSync(path);
        return `${path}:${stat.mtimeMs}:${stat.size}`;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return `${path}:missing`;
        throw error;
      }
    })
    .join("|");
}

let lastConfigDirectory: string | undefined;
let lastConfigSignature: string | undefined;
/** Directory and signature of the last reload that failed. */
let lastFailedConfig: string | undefined;

export function refreshConfigIfChanged(directory: string): void {
  // Both hosts initialise their config at startup. Direct callers that have
  // not initialised it keep their in-memory settings untouched.
  if (lastConfigDirectory === undefined) return;
  let attempt: string | undefined;
  try {
    const signature = configSignature(directory);
    if (directory === lastConfigDirectory && signature === lastConfigSignature) return;
    attempt = `${directory}\0${signature}`;
    if (attempt === lastFailedConfig) return;
    initConfig(directory, { strict: true });
    lastFailedConfig = undefined;
  } catch (error) {
    // A bad hand edit must not stop capture: keep the last good settings, and
    // skip this exact file state until it changes, instead of re-reading it on
    // every unit. The last good directory and signature stay as they were.
    log("Config reload failed; keeping the previous settings", {
      error: error instanceof Error ? error.message : String(error),
    });
    lastFailedConfig = attempt;
  }
}

export function initConfig(directory: string, options: { strict?: boolean } = {}): void {
  // omms project overrides win; the legacy opencode-mem file is still read.
  const globalConfig = loadConfigFromPaths(CONFIG_FILES, options.strict);
  const projectConfig = loadConfigFromPaths(projectConfigPaths(directory), options.strict);
  assertProjectRemoteProviderConfigIsSafe(projectConfig);
  const projectOverrides = { ...projectConfig };
  delete projectOverrides.autoCleanupEnabled;
  delete projectOverrides.autoCleanupRetentionDays;
  delete projectOverrides.userProfileAutoCleanupEnabled;
  delete projectOverrides.userProfileAutoCleanupInterval;
  // A checked-in project file must not start recording conversations; it may
  // only turn tracing off for its project.
  if (projectOverrides.captureTrace === true) {
    log("Project config cannot turn on captureTrace; the value was ignored", { directory });
    delete projectOverrides.captureTrace;
  }
  delete projectOverrides.captureTraceRetentionDays;
  // The queue holds conversation text, so only the global file sets how long.
  delete projectOverrides.captureRetryRetentionHours;
  delete projectOverrides.autoBackfill;
  delete projectOverrides.opencodeBackfillModel;
  delete projectOverrides.piBackfillModel;
  delete projectOverrides.importPathMaps;
  delete projectOverrides.importIgnoredDirectories;
  // The reranker decides where memory text is sent, so only the global file
  // may set it; a checked-in project file must not redirect a user's
  // memories to its own server.
  delete projectOverrides.rerankerEnabled;
  delete projectOverrides.rerankerApiUrl;
  delete projectOverrides.rerankerModel;
  delete projectOverrides.rerankerApiKey;
  delete projectOverrides.rerankerTimeoutMs;
  // A checked-in project file must not point the web app at another folder.
  delete projectOverrides.claudeConfigDir;
  delete projectOverrides.webServerAutoStart;
  delete projectOverrides.webServerEnabled;
  const merged: OmmsConfig = { ...globalConfig, ...projectOverrides };
  const nextConfig = buildConfig(merged);
  lastFileConfig = merged;
  CONFIG = nextConfig;
  lastConfigDirectory = directory;
  lastConfigSignature = configSignature(directory);
}

/**
 * Rebuild CONFIG from the last loaded file config. Used after the legacy
 * migration runs so the storage default can flip from the legacy layout to
 * ~/.omms/data when the migration marker says it succeeded.
 */
function refreshStorageResolution(): void {
  CONFIG = buildConfig(lastFileConfig);
}

/**
 * initConfig plus the one-time legacy store migration (decision D13).
 *
 * The migration only applies while the resolved store sits on a DEFAULT
 * layout (legacy ~/.opencode-mem/data or omms ~/.omms/data). The legacy
 * config template pinned "storagePath": "~/.opencode-mem/data" explicitly,
 * so key-presence cannot be the skip signal; a genuinely custom store path
 * (the user pointing storage elsewhere) skips migration entirely.
 * OMMS_SKIP_LEGACY_MIGRATION=1 (set by the test preload) disables the
 * automatic run without affecting resolution.
 */
export function initConfigWithLegacyMigration(directory: string): void {
  initConfig(directory);
  const { legacyDataDir, ommsDataDir } = legacyMigrationPaths();
  const usesDefaultLayout =
    CONFIG.storagePath === legacyDataDir || CONFIG.storagePath === ommsDataDir;
  if (usesDefaultLayout && process.env.OMMS_SKIP_LEGACY_MIGRATION !== "1") {
    runLegacyStoreMigration();
    refreshStorageResolution();
  }
}

export function isConfigured(): boolean {
  return true;
}

/**
 * The containerTagPrefix explicitly set in the merged config files, or
 * undefined when only the default applies. The tag prefix migration warns
 * when this is "opencode" after migration (the override matches no rows).
 */
export function getExplicitContainerTagPrefix(): string | undefined {
  return lastFileConfig.containerTagPrefix;
}
