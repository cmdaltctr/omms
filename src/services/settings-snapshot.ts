import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse, type ParseError } from "jsonc-parser";
import { CONFIG, getGlobalConfigSourcePath } from "../config.js";
import { readGlobalConfigRevision } from "./global-config-writer.js";
import {
  getAutoCaptureProviderStatus,
  isExternalModelReady,
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
  "autoBackfill",
  "opencodeBackfillModel",
  "piBackfillModel",
  "webServerAutoStart",
  "memoryProvider",
  "memoryApiUrl",
  "memoryModel",
  "importPathMaps",
] as const;

/** Keys a project config cannot override, so the page always shows the global value. */
const globalOnly = [
  "autoBackfill",
  "opencodeBackfillModel",
  "piBackfillModel",
  "webServerAutoStart",
  "memoryProvider",
  "memoryApiUrl",
  "importPathMaps",
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
export function getSettingsSnapshot(directory: string) {
  const global = readSettingsFile(getGlobalConfigSourcePath());
  const project = readSettingsFile(projectFile(directory));
  const settings = Object.fromEntries(
    editable.map((key) => {
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
      const value = projectOverrides ? project[key] : (global[key] ?? CONFIG[key]);
      return [key, { value, source, globalValue: global[key] ?? CONFIG[key] }];
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
  return {
    revision: readGlobalConfigRevision(),
    settings,
    secrets,
    fallback: { model: CONFIG.memoryModel ?? null, configured: isExternalModelReady(CONFIG) },
    externalKey: memoryKeyStatus(global.memoryApiKey),
    effective: {
      opencode: getAutoCaptureProviderStatus(CONFIG),
      pi: resolvePiLiveModel(CONFIG),
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
