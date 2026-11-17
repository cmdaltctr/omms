import { randomUUID } from "node:crypto";
import { safeHealthError } from "../services/safe-health-error.js";
import type { MemoryProviderRuntimeConfig } from "../services/ai/provider-config.js";

const OUTPUT_LIMIT = 64;
const TIMEOUT_MS = 20_000;

/** Provider-specific output caps; Anthropic-style providers read `maxTokens`. */
function outputLimitParams(provider: string): Record<string, unknown> {
  if (provider === "openai-chat" || provider === "orcarouter") return { max_tokens: OUTPUT_LIMIT };
  if (provider === "openai-responses") return { max_output_tokens: OUTPUT_LIMIT };
  return {};
}

/**
 * Why a test failed, so the page can say it in plain words and never shows the provider's reply.
 * `unreachable` covers network errors and timeouts: the provider never answered.
 */
export type ExternalApiFailure =
  | "refused"
  | "not-found"
  | "rate-limited"
  | "provider"
  | "unreachable"
  | "not-configured"
  | "failed";

export type ExternalApiTestResult =
  | { ok: true; model: string }
  | { ok: false; error: string; reason: ExternalApiFailure; status?: number };

/** The reason and HTTP status behind a provider's error text. */
export function classifyExternalApiError(message: string): {
  reason: ExternalApiFailure;
  status?: number;
} {
  if (message.startsWith("External API not configured")) return { reason: "not-configured" };
  // Providers word a failed fetch as "TypeError: ..." and an abort as "... timeout (Nms)".
  if (/^TypeError\b/.test(message) || /timeout \(\d+ms\)/i.test(message)) {
    return { reason: "unreachable" };
  }
  const code = /API error: (\d{3})\b/.exec(message)?.[1];
  if (!code) return { reason: "failed" };
  const status = Number(code);
  if (status === 401 || status === 403) return { reason: "refused", status };
  if (status === 404) return { reason: "not-found", status };
  if (status === 429) return { reason: "rate-limited", status };
  if (status >= 500) return { reason: "provider", status };
  return { reason: "failed", status };
}

/**
 * One small call to the saved external API from this process, with a small
 * output limit. The error never contains the key.
 */
export async function testExternalApi(
  given?: MemoryProviderRuntimeConfig & { memoryProvider: string },
  createProvider?: (
    provider: string,
    providerConfig: Record<string, unknown>
  ) => { executeToolCall: (...args: any[]) => Promise<{ success: boolean; error?: string }> }
): Promise<ExternalApiTestResult> {
  // The real config loads only when no config is passed, so tests never read it.
  const config = given ?? (await import("../config.js")).CONFIG;
  const secrets = [config.memoryApiKey];
  try {
    const { buildMemoryProviderConfig } = await import("../services/ai/provider-config.js");
    const base = buildMemoryProviderConfig(config, {
      maxIterations: 1,
      iterationTimeout: TIMEOUT_MS,
    });
    const providerConfig = {
      ...base,
      maxTokens: OUTPUT_LIMIT,
      extraParams: { ...base.extraParams, ...outputLimitParams(config.memoryProvider) },
    };
    const create =
      createProvider ??
      (await import("../services/ai/ai-provider-factory.js")).AIProviderFactory.createProvider;
    const provider = create(config.memoryProvider as never, providerConfig as never);
    const tool = {
      type: "function" as const,
      function: {
        name: "acknowledge",
        description: "Confirm the connection works",
        parameters: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"] },
      },
    };
    const result = await provider.executeToolCall(
      "You are testing a connection. Call the acknowledge tool with ok set to true.",
      "Acknowledge.",
      tool,
      `external-api-test-${randomUUID()}`
    );
    if (!result.success) throw new Error(result.error ?? "The external API call failed");
    return { ok: true, model: `${config.memoryProvider}/${config.memoryModel ?? "default"}` };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: safeHealthError(error, secrets).slice(0, 500),
      ...classifyExternalApiError(message),
    };
  }
}
