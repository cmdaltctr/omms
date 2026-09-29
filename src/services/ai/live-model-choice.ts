import { isPlaceholderApiKey } from "./api-key-placeholder.js";

/**
 * Which model live capture and profile learning call, the same rule on both
 * hosts. Pure functions of the config: callers pass CONFIG, so this module
 * has no dependency on config loading.
 */
export interface AutoCaptureProviderRuntimeConfig {
  opencodeProvider?: string;
  opencodeModel?: string;
  memoryProvider?: string;
  memoryModel?: string;
  memoryApiUrl?: string;
  memoryApiKey?: string;
}

/**
 * Where live capture and profile learning send model calls, the same on both hosts:
 * - `opencode`: the configured host model (`opencodeModel`/`piModel`; "inherit" = session model)
 * - `manual`: the external API (`memoryModel`/`memoryApiUrl`/`memoryApiKey`), because the
 *   host model is "external" or no host model is set
 * - `session`: neither is set, so the session's own model through the host's sign-in
 */
export type AutoCaptureProviderStatus =
  | { ready: true; mode: "opencode" | "manual" | "session"; issues: [] }
  | { ready: false; issues: string[] };

function hasValue(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/** External-API readiness alone; any memory* value set counts as intent to use it. */
function getManualProviderStatus(config: AutoCaptureProviderRuntimeConfig): {
  attempted: boolean;
  ready: boolean;
  issues: string[];
} {
  const hasMemoryModel = hasValue(config.memoryModel);
  const hasMemoryApiUrl = hasValue(config.memoryApiUrl);
  const hasMemoryApiKey = hasValue(config.memoryApiKey);
  const hasPlaceholderMemoryApiKey = isPlaceholderApiKey(config.memoryApiKey);
  const attempted = hasMemoryModel || hasMemoryApiUrl || hasMemoryApiKey;
  const issues: string[] = [];

  // The orcarouter provider presets its endpoint and default model, so only
  // an API key is required for the manual fallback path.
  if (config.memoryProvider === "orcarouter") {
    if (!hasMemoryApiKey) issues.push("memoryApiKey is not configured");
    if (hasPlaceholderMemoryApiKey) issues.push("memoryApiKey contains a placeholder value");
    return { attempted, ready: hasMemoryApiKey && !hasPlaceholderMemoryApiKey, issues };
  }

  if (!hasMemoryModel) issues.push("memoryModel is not configured");
  if (!hasMemoryApiUrl) issues.push("memoryApiUrl is not configured");
  if (!hasMemoryApiKey) issues.push("memoryApiKey is not configured");
  if (hasPlaceholderMemoryApiKey) issues.push("memoryApiKey contains a placeholder value");
  return {
    attempted,
    ready: hasMemoryModel && hasMemoryApiUrl && hasMemoryApiKey && !hasPlaceholderMemoryApiKey,
    issues,
  };
}

/** The host chose the external API: it is the primary call, so there is no fallback. */
function externalChoiceStatus(config: AutoCaptureProviderRuntimeConfig): AutoCaptureProviderStatus {
  const manual = getManualProviderStatus(config);
  return manual.ready
    ? { ready: true, mode: "manual", issues: [] }
    : { ready: false, issues: manual.issues };
}

export function getAutoCaptureProviderStatus(
  config: AutoCaptureProviderRuntimeConfig
): AutoCaptureProviderStatus {
  const hasOpencodeProvider = hasValue(config.opencodeProvider);
  const hasOpencodeModel = hasValue(config.opencodeModel);
  if (config.opencodeModel?.trim() === "inherit") {
    return { ready: true, mode: "session", issues: [] };
  }
  if (config.opencodeModel?.trim() === "external") return externalChoiceStatus(config);
  if (hasOpencodeProvider && hasOpencodeModel) {
    return { ready: true, mode: "opencode", issues: [] };
  }

  const manual = getManualProviderStatus(config);
  if (manual.ready) return { ready: true, mode: "manual", issues: [] };
  // Nothing configured at all: follow the session's model, as Pi always has.
  if (!manual.attempted) return { ready: true, mode: "session", issues: [] };

  // A half-configured external API is a mistake worth reporting, not a silent switch.
  const issues: string[] = [];
  if (!hasOpencodeProvider) issues.push("opencodeProvider is not configured");
  if (!hasOpencodeModel) issues.push("opencodeModel is not configured");
  return { ready: false, issues: [...issues, ...manual.issues] };
}

/** OpenCode host model for live calls, or null when the external API should be used. */
export function resolveOpencodeHostModel(
  config: AutoCaptureProviderRuntimeConfig
): { providerID: string; modelID: string } | null {
  const status = getAutoCaptureProviderStatus(config);
  if (!status.ready || status.mode === "manual") return null;
  if (status.mode === "opencode") {
    return { providerID: config.opencodeProvider!.trim(), modelID: config.opencodeModel!.trim() };
  }
  return { providerID: config.opencodeProvider?.trim() ?? "", modelID: "inherit" };
}

export type PiLiveModelChoice =
  | { kind: "pi"; provider: string; model: string }
  | { kind: "session" }
  | { kind: "manual" }
  | { kind: "unready"; issues: string[] };

/** Pi's live model, by the same rule as OpenCode's (`piProvider`/`piModel` in place of `opencode*`). */
export function resolvePiLiveModel(
  config: AutoCaptureProviderRuntimeConfig & { piProvider?: string; piModel?: string }
): PiLiveModelChoice {
  if (config.piModel?.trim() === "inherit") return { kind: "session" };
  if (config.piModel?.trim() === "external") {
    const status = externalChoiceStatus(config);
    return status.ready ? { kind: "manual" } : { kind: "unready", issues: status.issues };
  }
  if (hasValue(config.piProvider) && hasValue(config.piModel)) {
    return { kind: "pi", provider: config.piProvider!.trim(), model: config.piModel!.trim() };
  }
  const manual = getManualProviderStatus(config);
  if (manual.ready) return { kind: "manual" };
  if (!manual.attempted) return { kind: "session" };
  return { kind: "unready", issues: manual.issues };
}

/**
 * Claude Code's live model: the external API only. Its hooks cannot call the
 * session's model, so there is no host model and no session fallback.
 */
export function resolveClaudeCodeLiveModel(
  config: AutoCaptureProviderRuntimeConfig
): AutoCaptureProviderStatus {
  return externalChoiceStatus(config);
}

/** True when the external API is fully configured and can serve as a fallback. */
export function isExternalModelReady(config: AutoCaptureProviderRuntimeConfig): boolean {
  return getManualProviderStatus(config).ready;
}

/** Why the external API cannot be used as a host's chosen model, or an empty list. */
export function externalModelIssues(config: AutoCaptureProviderRuntimeConfig): string[] {
  const manual = getManualProviderStatus(config);
  return manual.ready ? [] : manual.issues;
}
