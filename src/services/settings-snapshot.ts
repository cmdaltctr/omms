import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse, type ParseError } from "jsonc-parser";
import { CONFIG, getGlobalConfigSourcePath } from "../config.js";
import { hasUnexpiredApiToken } from "./api-tokens.js";
import { resolveClaudeFolder } from "./claude-folder.js";
import { readGlobalConfigRevision } from "./global-config-writer.js";
import {
  getMemoryLimitRule,
  MEMORY_LIMIT_SETTINGS,
  type MemoryLimitRule,
} from "../utils/memory-limits.js";
import {
  getAutoCaptureProviderStatus,
  isExternalModelReady,
  resolveClaudeCodeLiveModel,
  resolvePiLiveModel,
} from "./ai/live-model-choice.js";

const editable = [
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
  "memoryProvider",
  "memoryApiUrl",
  "memoryModel",
  "importPathMaps",
  "importIgnoredDirectories",
  "claudeConfigDir",
  ...MEMORY_LIMIT_SETTINGS,
] as const;

/** Keys a project config cannot override, so the page always shows the global value. */
const globalOnly = [
  "captureRetryRetentionHours",
  "autoBackfill",
  "opencodeBackfillModel",
  "piBackfillModel",
  "webServerAutoStart",
  "memoryProvider",
  "memoryApiUrl",
  "importPathMaps",
  "importIgnoredDirectories",
  "claudeConfigDir",
];

function readSettingsFile(path: string | undefined): Record<string, unknown> {
  if (!path) return {};
  const errors: ParseError[] = [];
  const result: unknown = parse(readFileSync(path, "utf8"), errors, { allowTrailingComma: true });
  if (errors.length || !result || typeof result !== "object" || Array.isArray(result)) {
    throw new Error("Config file cannot be parsed");
  }
  return result as Record<string, unknown>;
}

function projectFile(directory: string): string | undefined {
  return ["omms.jsonc", "omms.json", "opencode-mem.jsonc", "opencode-mem.json"]
    .map((name) => join(directory, ".opencode", name))
    .find((path) => existsSync(path));
}

/**
 * Snapshot entry for a nested limit (chatMessage.maxMemories). The runtime
 * merge is shallow, so a project chatMessage object replaces the global one:
 * a missing count means the default even when the global file sets a value,
 * and the source must not be inferred from dotted-key presence alone.
 */
function nestedMemorySetting(
  rule: MemoryLimitRule,
  global: Record<string, unknown>,
  project: Record<string, unknown>
) {
  const parent = rule.path[0]!;
  const leaf = rule.path[1]!;
  const container = (source: Record<string, unknown>): Record<string, unknown> | undefined => {
    const raw = source[parent];
    return raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : undefined;
  };
  const projectHasParent = Object.hasOwn(project, parent);
  const effective = projectHasParent ? container(project) : container(global);
  const globalContainer = container(global);
  const hasValue = effective !== undefined && Object.hasOwn(effective, leaf);
  const hasGlobal = globalContainer !== undefined && Object.hasOwn(globalContainer, leaf);
  return {
    value: hasValue ? effective![leaf] : rule.default,
    source: hasValue ? (projectHasParent ? "project" : "global") : "default",
    globalValue: hasGlobal ? globalContainer![leaf] : rule.default,
    default: rule.default,
  };
}

export function getSettingsSnapshot(directory: string) {
  const global = readSettingsFile(getGlobalConfigSourcePath());
  const project = readSettingsFile(projectFile(directory));
  // Dotted limit identifiers (chatMessage.maxMemories) are resolved by the
  // nested rule above, so the runtime lookup only handles flat keys.
  const runtime = CONFIG as unknown as Record<string, unknown>;
  const settings = Object.fromEntries(
    editable.map((key) => {
      const limitRule = getMemoryLimitRule(key);
      if (limitRule && limitRule.path.length > 1) {
        return [key, nestedMemorySetting(limitRule, global, project)];
      }
      const projectOverrides =
        Object.hasOwn(project, key) &&
        (key === "captureTrace"
          ? project[key] === false
          : !key.endsWith("RetentionDays") && !globalOnly.includes(key));
      const source = projectOverrides
        ? "project"
        : Object.hasOwn(global, key)
          ? "global"
          : "default";
      const value = projectOverrides ? project[key] : (global[key] ?? runtime[key]);
      // The five memory limits also carry their documented default for the UI.
      return [
        key,
        limitRule
          ? {
              value,
              source,
              globalValue: global[key] ?? limitRule.default,
              default: limitRule.default,
            }
          : { value, source, globalValue: global[key] ?? runtime[key] },
      ];
    })
  );
  const secrets = Object.fromEntries(
    ["memoryApiKey", "embeddingApiKey", "webServerApiToken", "webServerAuthPassword"].map((key) => {
      const raw = global[key];
      const source =
        typeof raw === "string"
          ? raw.startsWith("env://")
            ? "env"
            : raw.startsWith("file://")
              ? "file"
              : "literal"
          : null;
      return [
        key,
        {
          set: typeof raw === "string" && raw.length > 0,
          source,
          // The variable name or file path, never a literal value.
          reference: memoryKeyStatus(raw).reference,
        },
      ];
    })
  );
  const claudeSetting = global.claudeConfigDir ?? CONFIG.claudeConfigDir;
  const claude = resolveClaudeFolder(typeof claudeSetting === "string" ? claudeSetting : "");
  const claudeRoot = join(claude.folder, "projects");
  return {
    revision: readGlobalConfigRevision(),
    settings,
    secrets,
    fallback: { model: CONFIG.memoryModel ?? null, configured: isExternalModelReady(CONFIG) },
    externalKey: memoryKeyStatus(global.memoryApiKey),
    effective: {
      opencode: getAutoCaptureProviderStatus(CONFIG),
      pi: resolvePiLiveModel(CONFIG),
      // Claude Code capture uses the external API only; `issues` names each missing setting.
      "claude-code": resolveClaudeCodeLiveModel(CONFIG),
    },
    // The folder Claude Code capture and import read; the check never reads transcripts.
    claudeFolder: { root: claudeRoot, source: claude.source, exists: existsSync(claudeRoot) },
    // What the Keys and access card needs to mark each credential; no secret values.
    access: {
      host: CONFIG.webServerHost,
      authEnabled: Boolean(CONFIG.webServerAuthPassword),
      authUsername: CONFIG.webServerAuthUsername ?? null,
      tokenAvailable: hasUnexpiredApiToken(),
      embeddingApiUrl: CONFIG.embeddingApiUrl ?? null,
      // The config key is imported once, then no longer read.
      configTokenIgnored:
        typeof global.webServerApiToken === "string" && global.webServerApiToken !== "",
    },
  };
}

/**
 * Where `memoryApiKey` comes from and whether it resolves in this web
 * server's own process. The key value itself is never returned.
 */
export function memoryKeyStatus(raw: unknown, resolved = CONFIG.memoryApiKey) {
  const source =
    typeof raw !== "string" || !raw
      ? null
      : raw.startsWith("env://")
        ? "env"
        : raw.startsWith("file://")
          ? "file"
          : "literal";
  return {
    source,
    reference:
      source === "env"
        ? (raw as string).slice("env://".length)
        : source === "file"
          ? (raw as string).slice("file://".length)
          : null,
    resolvesInWebApp: Boolean(resolved),
    warning:
      source === "env"
        ? "A login web app does not see variables set only in a shell profile; a key file works everywhere."
        : null,
  };
}
