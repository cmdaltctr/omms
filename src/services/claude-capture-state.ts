import {
  resolveClaudeCodeLiveModel,
  type AutoCaptureProviderRuntimeConfig,
} from "./ai/live-model-choice.js";

/** `off`: auto capture is off. `ready`: the external API is complete. `needs-setup`: it is not. */
export type ClaudeCaptureState = "off" | "ready" | "needs-setup";

export type ClaudeCaptureConfig = AutoCaptureProviderRuntimeConfig & {
  autoCaptureEnabled?: boolean;
};

/**
 * Whether Claude Code capture can run. Claude Code has no session model, so only a
 * complete external API counts. The state carries no secret.
 */
export function claudeCaptureState(config: ClaudeCaptureConfig): ClaudeCaptureState {
  if (config.autoCaptureEnabled === false) return "off";
  return resolveClaudeCodeLiveModel(config).ready ? "ready" : "needs-setup";
}
