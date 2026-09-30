import { existsSync } from "node:fs";
import { CONFIG } from "../config.js";
import type { ImportHost } from "./import-args.js";
import { defaultClaudeSourcePath } from "./import-sources.js";

/**
 * What a real web import could use right now, checked inside the web app
 * process that runs it. `env://` and `file://` keys were resolved when the
 * config loaded, so a variable set only in the user's shell shows as missing.
 * "Ready" means configured, not tested: the Health section runs test calls.
 */

export type ExternalApiState =
  "ready" | "missing-model" | "missing-url" | "missing-key" | "unsupported-provider";

export interface ImportReadiness {
  external: { state: ExternalApiState; provider: string; model: string | null };
  opencode: {
    available: boolean;
    models: Array<{ provider: string; model: string; name: string }>;
  };
  piReader: { available: boolean; reason?: string };
  /**
   * The Claude Code reader ships with OMMS, so it is always available. Its
   * imports have no session model and always use the external API.
   */
  claudeCode: {
    available: true;
    defaultRoot: string;
    defaultRootFound: boolean;
    modelChoices: ["external"];
  };
}

export interface ReadinessDeps {
  supportedProviders?: () => Promise<string[]>;
  listOpencodeModels?: () => Promise<{
    available: boolean;
    models?: Array<{ provider: string; model: string; name: string }>;
  }>;
  loadPiSdk?: () => Promise<unknown>;
  claudeRoot?: () => string;
}

const EXTERNAL_REASONS: Record<Exclude<ExternalApiState, "ready">, string> = {
  "missing-model": "The external API has no memoryModel in the global config",
  "missing-url": "The external API has no memoryApiUrl in the global config",
  "missing-key":
    "The external API key is missing in the OpenCode process; check memoryApiKey and its env:// or file:// source",
  "unsupported-provider": "The memoryProvider in the global config is not supported for imports",
};

/** Mirrors the checks in `selectImportModel`, without building a provider. */
export async function externalApiState(
  supportedProviders: () => Promise<string[]> = async () =>
    (
      await import("../services/ai/ai-provider-factory.js")
    ).AIProviderFactory.getSupportedProviders()
): Promise<ExternalApiState> {
  const provider = CONFIG.memoryProvider;
  if (!(await supportedProviders()).includes(provider)) return "unsupported-provider";
  if (provider !== "orcarouter") {
    if (!CONFIG.memoryModel) return "missing-model";
    if (!CONFIG.memoryApiUrl) return "missing-url";
  }
  if (!CONFIG.memoryApiKey) return "missing-key";
  return "ready";
}

export async function importReadiness(deps: ReadinessDeps = {}): Promise<ImportReadiness> {
  const [state, opencode, piReader] = await Promise.all([
    externalApiState(deps.supportedProviders),
    (
      deps.listOpencodeModels ??
      // Imports run OpenCode models, so they need a session, not the standalone list.
      (async () =>
        (await import("./settings-models.js")).listOpencodeSettingsModels(undefined, null))
    )(),
    (deps.loadPiSdk ?? (() => import("@earendil-works/pi-coding-agent")))().then(
      () => ({ available: true }),
      () => ({
        available: false,
        reason: "The Pi SDK (@earendil-works/pi-coding-agent) is not installed for OpenCode",
      })
    ),
  ]);
  return {
    external: { state, provider: CONFIG.memoryProvider, model: CONFIG.memoryModel ?? null },
    opencode: { available: opencode.available, models: opencode.models ?? [] },
    piReader,
    claudeCode: claudeReadiness(deps.claudeRoot?.() ?? defaultClaudeSourcePath()),
  };
}

function claudeReadiness(defaultRoot: string): ImportReadiness["claudeCode"] {
  return {
    available: true,
    defaultRoot,
    defaultRootFound: existsSync(defaultRoot),
    modelChoices: ["external"],
  };
}

/** Why a job cannot start, or `null` when it can. */
export function importBlockedReason(
  readiness: ImportReadiness,
  request: { host: ImportHost; needsModel: boolean; modelChoice?: string }
): string | null {
  if (request.host === "pi" && !readiness.piReader.available) {
    return readiness.piReader.reason ?? "The Pi session reader is unavailable";
  }
  if (!request.needsModel) return null;
  if (request.host === "claude-code") {
    // Claude Code has no host models to offer.
    if (request.modelChoice !== undefined && request.modelChoice !== "external") {
      return "Claude Code imports use the external API";
    }
    const state = readiness.external.state;
    return state === "ready" ? null : EXTERNAL_REASONS[state];
  }
  if (!request.modelChoice) return "Choose an import model";
  if (request.modelChoice === "external") {
    const state = readiness.external.state;
    return state === "ready" ? null : EXTERNAL_REASONS[state];
  }
  const connected = readiness.opencode.models.some(
    (model) => `${model.provider}/${model.model}` === request.modelChoice
  );
  if (connected) return null;
  // The web app has no OpenCode session, so no host model is ever connected here.
  return readiness.opencode.available
    ? "The chosen OpenCode model is not connected"
    : "The chosen OpenCode model is not connected here. An import with an OpenCode signed-in model runs from the terminal or with /import in OpenCode. Choose the external API for a web import.";
}
