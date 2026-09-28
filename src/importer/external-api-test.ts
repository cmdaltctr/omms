import { randomUUID } from "node:crypto";
import { CONFIG } from "../config.js";
import { safeHealthError } from "../services/safe-health-error.js";

const OUTPUT_LIMIT = 64;
const TIMEOUT_MS = 20_000;

/** Provider-specific output caps; Anthropic-style providers read `maxTokens`. */
function outputLimitParams(provider: string): Record<string, unknown> {
  if (provider === "openai-chat" || provider === "orcarouter") return { max_tokens: OUTPUT_LIMIT };
  if (provider === "openai-responses") return { max_output_tokens: OUTPUT_LIMIT };
  return {};
}

export type ExternalApiTestResult = { ok: true; model: string } | { ok: false; error: string };

/**
 * One small call to the saved external API from this process, with a small
 * output limit. The error never contains the key.
 */
export async function testExternalApi(
  config: typeof CONFIG = CONFIG,
  createProvider?: (
    provider: string,
    providerConfig: Record<string, unknown>
  ) => { executeToolCall: (...args: any[]) => Promise<{ success: boolean; error?: string }> }
): Promise<ExternalApiTestResult> {
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
    return { ok: false, error: safeHealthError(error, secrets).slice(0, 500) };
  }
}
