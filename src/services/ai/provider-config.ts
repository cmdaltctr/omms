import type { ProviderConfig } from "./providers/base-provider.js";
import { isPlaceholderApiKey } from "./api-key-placeholder.js";
import { isLocalApiUrl } from "./local-api-url.js";

interface MemoryProviderRuntimeConfig {
  memoryProvider?: string;
  memoryModel?: string;
  memoryApiUrl?: string;
  memoryApiKey?: string;
  memoryTemperature?: number | false;
  memoryExtraParams?: Record<string, unknown>;
  autoCaptureMaxIterations?: number;
  autoCaptureIterationTimeout?: number;
}

interface ProviderConfigOverrides {
  maxIterations?: number;
  iterationTimeout?: number;
  /** Chat only: a model server on this machine needs no key. Other callers still need one. */
  keylessForLocalUrl?: boolean;
}

export function buildMemoryProviderConfig(
  config: MemoryProviderRuntimeConfig,
  overrides: ProviderConfigOverrides = {}
): ProviderConfig {
  const memoryModel = config.memoryModel;
  const memoryApiUrl = config.memoryApiUrl;
  const memoryApiKey = config.memoryApiKey;
  const issues: string[] = [];

  // The orcarouter provider presets its own endpoint and default model, so
  // memoryModel / memoryApiUrl are optional there. An API key is always required.
  const isOrcaRouter = config.memoryProvider === "orcarouter";

  if (!memoryModel && !isOrcaRouter) issues.push("missing memoryModel");
  if (!memoryApiUrl && !isOrcaRouter) issues.push("missing memoryApiUrl");
  const keyOptional = overrides.keylessForLocalUrl === true && isLocalApiUrl(memoryApiUrl);
  if (!memoryApiKey && !keyOptional) issues.push("missing memoryApiKey");
  if (isPlaceholderApiKey(memoryApiKey)) issues.push("replace the placeholder memoryApiKey value");

  if (issues.length > 0) {
    throw new Error(`External API not configured for memory provider: ${issues.join("; ")}`);
  }

  return {
    model: memoryModel || "",
    apiUrl: memoryApiUrl || "",
    apiKey: memoryApiKey || "",
    memoryTemperature: config.memoryTemperature,
    extraParams: config.memoryExtraParams,
    maxIterations: overrides.maxIterations ?? config.autoCaptureMaxIterations,
    iterationTimeout: overrides.iterationTimeout ?? config.autoCaptureIterationTimeout,
  };
}
