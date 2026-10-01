import { randomUUID } from "node:crypto";
import { CONFIG } from "../config.js";
import { buildBoundedSummaryPrompt } from "../core/capture-context.js";
import { httpStatusError } from "../core/capture-retry-policy.js";
import {
  buildCaptureSystemPrompt,
  captureSummaryToolSchema,
  normalizeStopReason,
  parseCaptureSummary,
} from "../core/extraction.js";
import type { CaptureSummaryProvider } from "../core/host.js";
import type { ModelPort } from "../core/profile-analysis.js";
import { ProfileModelError, profileResultCode } from "../core/profile-failure.js";
import { AIProviderFactory } from "../services/ai/ai-provider-factory.js";
import { toolCallFailureReason } from "../services/ai/providers/base-provider.js";
import { buildMemoryProviderConfig } from "../services/ai/provider-config.js";
import { resolveSecretValue } from "../services/secret-resolver.js";
import type { AIProviderType } from "../services/ai/session/session-types.js";

/** The same limit the Pi and OpenCode host-model profile paths use. */
export const PROFILE_REQUEST_TIMEOUT_MS = 120_000;

export interface ImportModelFlags {
  provider?: string;
  model?: string;
  apiUrl?: string;
  apiKeyEnv?: string;
}
export interface SelectedImportModel {
  provider: string;
  modelId: string;
  capture: CaptureSummaryProvider;
  profile: ModelPort;
}

/** Merge import-only model settings without changing the saved omms config. */
export function selectImportModel(flags: ImportModelFlags): SelectedImportModel {
  const providerName = flags.provider ?? CONFIG.memoryProvider;
  // The saved URL belongs to the saved provider; never send a request for another one there.
  const providerOverridden =
    flags.provider !== undefined && flags.provider !== CONFIG.memoryProvider;
  if (providerOverridden && !flags.apiUrl && providerName !== "orcarouter") {
    throw new Error("--api-url is required when --provider differs from memoryProvider");
  }
  const modelId = flags.model ?? CONFIG.memoryModel;
  const apiUrl = flags.apiUrl ?? CONFIG.memoryApiUrl;
  const key = flags.apiKeyEnv
    ? resolveSecretValue(`env://${flags.apiKeyEnv}`)
    : CONFIG.memoryApiKey;
  if (!modelId && providerName !== "orcarouter") throw new Error("Missing memoryModel or --model");
  if (!apiUrl && providerName !== "orcarouter")
    throw new Error("Missing memoryApiUrl or --api-url");
  if (!key) throw new Error("Missing memoryApiKey or --api-key-env");
  if (!AIProviderFactory.getSupportedProviders().includes(providerName as AIProviderType)) {
    throw new Error(`Unsupported import provider: ${providerName}`);
  }
  const settings = {
    ...CONFIG,
    memoryProvider: providerName,
    memoryModel: modelId,
    memoryApiUrl: apiUrl,
    memoryApiKey: key,
  };
  const provider = AIProviderFactory.createProvider(
    providerName as AIProviderType,
    buildMemoryProviderConfig(settings)
  );
  // A profile reply can take over a minute; captures keep autoCaptureIterationTimeout.
  const profileProvider = AIProviderFactory.createProvider(
    providerName as AIProviderType,
    buildMemoryProviderConfig(settings, { iterationTimeout: PROFILE_REQUEST_TIMEOUT_MS })
  );
  const capture: CaptureSummaryProvider = {
    async summarize(request) {
      if (request.diagnostics) {
        request.diagnostics.path = "external-api";
        request.diagnostics.provider = providerName;
        request.diagnostics.model = modelId ?? "";
      }
      const { detectLanguage, getLanguageName } = await import("../services/language-detector.js");
      const target =
        CONFIG.autoCaptureLanguage && CONFIG.autoCaptureLanguage !== "auto"
          ? CONFIG.autoCaptureLanguage
          : detectLanguage(request.userPrompt);
      const system = buildCaptureSystemPrompt(getLanguageName(target));
      const tool = {
        type: "function" as const,
        function: {
          name: "save_memory",
          description: "Save a technical memory",
          parameters: captureSummaryToolSchema,
        },
      };
      const result = await provider.executeToolCall(
        system,
        buildBoundedSummaryPrompt(request.context, system, tool),
        tool,
        `history-capture-${randomUUID()}`
      );
      if (!result.success || !result.data) {
        if (request.diagnostics) {
          // Only an HTTP error or a request with no reply is worth a later retry.
          request.diagnostics.failureReason = toolCallFailureReason(
            result,
            normalizeStopReason(result.stopReason) === "length"
          );
          request.diagnostics.httpStatus = result.httpStatus;
          request.diagnostics.retryAfterMs = result.retryAfterMs;
        }
        if (result.httpStatus === undefined) throw new Error("History capture model call failed");
        throw httpStatusError(
          "History capture model call failed",
          result.httpStatus,
          result.retryAfterMs
        );
      }
      const raw = typeof result.data === "string" ? result.data : JSON.stringify(result.data);
      const parsed = parseCaptureSummary(raw);
      if (!parsed) throw new Error("History capture returned an invalid summary");
      return parsed;
    },
  };
  const profile: ModelPort = {
    provider: providerName,
    modelId: modelId ?? "",
    async complete(system, prompt) {
      const { z } = await import("zod");
      const { createUserProfileAnalysisSchema } = await import("../core/extraction.js");
      const tool = {
        type: "function" as const,
        function: {
          name: "update_user_profile",
          description: "Analyse historical user prompts",
          parameters: z.toJSONSchema(createUserProfileAnalysisSchema(z)),
        },
      };
      const result = await profileProvider.executeToolCall(
        system,
        prompt,
        tool,
        `history-profile-${randomUUID()}`
      );
      if (!result.success || !result.data) throw new ProfileModelError(profileResultCode(result));
      return typeof result.data === "string" ? result.data : JSON.stringify(result.data);
    },
  };
  return { provider: providerName, modelId: modelId ?? "", capture, profile };
}
