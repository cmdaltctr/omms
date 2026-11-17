import {
  claudeCaptureState,
  type ClaudeCaptureConfig,
  type ClaudeCaptureState,
} from "./claude-capture-state.js";

export interface HealthBody {
  success: true;
  status: "ok";
  authEnabled: boolean;
  /** Opaque per process; a restart finds its copy by it even behind basic auth. */
  instance: string;
  /** Lets the Claude Code status label show `capture off`. An older web app omits it. */
  claudeCapture: ClaudeCaptureState;
}

/** The `/api/health` answer. The route is open without a token, so nothing here is secret. */
export function healthBody(input: {
  authEnabled: boolean;
  instance: string;
  config: ClaudeCaptureConfig;
}): HealthBody {
  return {
    success: true,
    status: "ok",
    authEnabled: input.authEnabled,
    instance: input.instance,
    claudeCapture: claudeCaptureState(input.config),
  };
}
