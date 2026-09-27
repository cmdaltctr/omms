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
] as const;

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
          : !key.endsWith("RetentionDays") &&
            ![
              "autoBackfill",
              "opencodeBackfillModel",
              "piBackfillModel",
              "webServerAutoStart",
            ].includes(key));
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
      return [
        key,
        {
          set: typeof raw === "string" && raw.length > 0,
          source:
            typeof raw === "string"
              ? raw.startsWith("env://")
                ? "env"
                : raw.startsWith("file://")
                  ? "file"
                  : "literal"
              : null,
        },
      ];
    })
  );
  return {
    revision: readGlobalConfigRevision(),
    settings,
    secrets,
    fallback: { model: CONFIG.memoryModel ?? null, configured: isExternalModelReady(CONFIG) },
    effective: {
      opencode: getAutoCaptureProviderStatus(CONFIG),
      pi: resolvePiLiveModel(CONFIG),
    },
  };
}
