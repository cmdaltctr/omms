import { log } from "../logger.js";
import { userPromptManager } from "../user-prompt/user-prompt-manager.js";
import { handleDeleteMemory } from "./memory-write.js";
import type { ApiResponse } from "./shared.js";

export async function handleDeletePrompt(
  id: string,
  cascade: boolean = false
): Promise<ApiResponse<{ deletedMemory: boolean }>> {
  try {
    if (!id) return { success: false, error: "id is required" };
    const prompt = await userPromptManager.getPromptById(id);
    if (!prompt) return { success: false, error: "Prompt not found" };
    let deletedMemory = false;
    if (cascade && prompt.linkedMemoryId) {
      const result = await handleDeleteMemory(prompt.linkedMemoryId, false);
      if (result.success) deletedMemory = true;
    }
    await userPromptManager.deletePrompt(id);
    return { success: true, data: { deletedMemory } };
  } catch (error) {
    log("handleDeletePrompt: error", { error: String(error) }, "error");
    return { success: false, error: String(error) };
  }
}

export async function handleBulkDeletePrompts(
  ids: string[],
  cascade: boolean = false
): Promise<ApiResponse<{ deleted: number }>> {
  try {
    if (!ids || ids.length === 0) return { success: false, error: "ids array is required" };
    let deleted = 0;
    for (const id of ids) {
      const result = await handleDeletePrompt(id, cascade);
      if (result.success) deleted++;
    }
    return { success: true, data: { deleted } };
  } catch (error) {
    log("handleBulkDeletePrompts: error", { error: String(error) }, "error");
    return { success: false, error: String(error) };
  }
}
