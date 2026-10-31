import { callTool, type ChatRuntimeConfig } from "../chat/chat-runtime.js";
import { chatStatus } from "../chat/chat-status.js";
import type { SkillModel } from "./drafting.js";

/** A draft sends a whole SKILL.md and up to 60,000 characters of turns, so it gets longer than chat. */
export const SKILL_MODEL_TIMEOUT_MS = 120_000;

/**
 * The external API model through the chat's client and readiness check
 * (ADR-033). Claude Code has no session model, so drafting uses this on
 * every host. The caller passes `CONFIG`.
 */
export function skillModel(config: ChatRuntimeConfig): SkillModel {
  return {
    ready: chatStatus(config).ready,
    callTool: (system, user, tool) => callTool(config, system, user, tool, SKILL_MODEL_TIMEOUT_MS),
  };
}
