import { CONFIG, isConfigured } from "../../config.js";
import { resolveOpencodeHostModel } from "../../services/ai/live-model-choice.js";
import { log } from "../../services/logger.js";
import { userPromptManager } from "../../services/user-prompt/user-prompt-manager.js";
import { rememberOpencodeSessionModel } from "./opencode-host.js";

/**
 * Remember a model request's model as the session model, and store it on its recorded
 * prompt row so capture can follow it. The row is written only while live calls follow
 * the session model ("inherit", or nothing configured).
 */
export async function recordOpencodePromptModel(
  messageID: string,
  model: { readonly providerID: string; readonly id: string }
): Promise<void> {
  rememberOpencodeSessionModel(model);
  if (!isConfigured() || resolveOpencodeHostModel(CONFIG)?.modelID !== "inherit") return;
  try {
    await userPromptManager.setPromptModel(messageID, model.providerID, model.id);
  } catch (error) {
    log("v2 context: failed to record the prompt model", { error: String(error) }, "error");
  }
}
