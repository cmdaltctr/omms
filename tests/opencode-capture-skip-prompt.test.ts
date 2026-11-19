import { afterAll, describe, expect, it, mock } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

// A live capture that decides "skip" (nothing worth saving, for example a preference-only
// prompt) must keep the user prompt for profile learning, as Pi does (`recordPiPrompt`). The
// prompt is marked captured, so capture never takes it again. The store is real, in a folder of
// its own. Only the capture model and the memory read are replaced.

const sandbox = mkdtempSync(join(tmpdir(), "omms-opencode-skip-prompt-"));
const configModule = await import("../src/config.js");
configModule.CONFIG.storagePath = join(sandbox, "data");

mock.module("../src/services/client.js", () => ({
  memoryClient: {
    listMemories: async () => ({ success: true, memories: [] }),
    addMemory: async () => ({ success: true, id: "mem-never" }),
    getEmbeddingInitError: () => null,
    close() {},
  },
}));

const { performAutoCapture, settleOpencodeRetriedPrompt } =
  await import("../src/services/auto-capture.js");
const { userPromptManager } = await import("../src/services/user-prompt/user-prompt-manager.js");

afterAll(async () => {
  await cleanupTursoTestDirectory(sandbox);
});

async function rows(sessionId: string) {
  const client = createClient({
    url: `file:${join(configModule.CONFIG.storagePath, "user-prompts.db")}`,
  });
  try {
    const result = await client.execute({
      sql: `SELECT message_id, captured, linked_memory_id, user_learning_captured
            FROM user_prompts WHERE session_id = ? ORDER BY message_id`,
      args: [sessionId],
    });
    return result.rows.map((row) => ({
      messageId: String(row.message_id),
      captured: Number(row.captured),
      linkedMemoryId: row.linked_memory_id === null ? null : String(row.linked_memory_id),
      learned: Number(row.user_learning_captured),
    }));
  } finally {
    client.close();
  }
}

function skippingHost(summaries: string[]) {
  return {
    host: "opencode" as const,
    isCaptureReady: () => true,
    getConversation: async () => ({
      textResponses: ["Noted."],
      toolCalls: [],
      sourceEntryIds: ["a-1"],
    }),
    summarize: async ({ userPrompt }: { userPrompt: string }) => {
      summaries.push(userPrompt);
      return { summary: "", type: "skip", tags: [] };
    },
  };
}

describe("an OpenCode capture that skips a turn", () => {
  it("keeps the prompt for profile learning and does not capture it again", async () => {
    const summaries: string[] = [];
    const host = skippingHost(summaries);
    await userPromptManager.savePrompt(
      "oc-skip-1",
      "m-1",
      sandbox,
      "From now on keep answers short"
    );

    await performAutoCapture(host, "oc-skip-1", sandbox, configModule);

    // The row stays, marked captured and not linked to a memory.
    expect(await rows("oc-skip-1")).toEqual([
      { messageId: "m-1", captured: 1, linkedMemoryId: null, learned: 0 },
    ]);
    // Profile learning still reads it.
    const waiting = await userPromptManager.getPromptsForUserLearning(10);
    expect(waiting.map((prompt) => prompt.content)).toContain("From now on keep answers short");
    // Capture does not take it again: the next idle pass sees no prompt.
    expect(await userPromptManager.getUncapturedPromptsForSession("oc-skip-1", 3)).toEqual([]);
    await performAutoCapture(host, "oc-skip-1", sandbox, configModule);
    expect(summaries).toHaveLength(1);
  });

  it("keeps the prompt when a queued retry of the turn skips it", async () => {
    await userPromptManager.savePrompt("oc-skip-2", "m-1", sandbox, "Always use British spelling");
    const [prompt] = await userPromptManager.getUncapturedPromptsForSession("oc-skip-2", 3);

    await settleOpencodeRetriedPrompt({ host: "opencode", promptId: prompt!.id } as never, {
      status: "skipped",
    });

    expect(await rows("oc-skip-2")).toEqual([
      { messageId: "m-1", captured: 1, linkedMemoryId: null, learned: 0 },
    ]);
    const waiting = await userPromptManager.getPromptsForUserLearning(10);
    expect(waiting.map((p) => p.content)).toContain("Always use British spelling");
  });
});
