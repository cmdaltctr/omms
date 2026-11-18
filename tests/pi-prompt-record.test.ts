import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { cleanupTursoTestDirectory } from "./turso-test-utils.js";

// Pi records each settled prompt in the shared prompt store (OpenSpec change
// unify-profile-learning, design D4, task 7.1). The store is real, in a folder of its own.
// The id is the Pi session id and the user entry id, as the Pi history import uses them,
// so an import after live recording finds the same row and saves nothing twice.

const sandbox = mkdtempSync(join(tmpdir(), "omms-pi-prompt-record-"));
const { CONFIG } = await import("../src/config.js");
CONFIG.storagePath = join(sandbox, "data");

const { lastSettledPiPrompt, recordPiPrompt } = await import("../src/adapters/pi/user-prompt.js");
const { userPromptManager } = await import("../src/services/user-prompt/user-prompt-manager.js");
const { importProfileFromHistory } = await import("../src/importer/profile-import.js");
const { extractPiConversationWindows } = await import("../src/importer/pi-conversation.js");
type PiSessionEntry = import("../src/importer/pi-conversation.js").PiSessionEntry;
type PiContentBlock = import("../src/importer/pi-conversation.js").PiContentBlock;

afterAll(async () => {
  await cleanupTursoTestDirectory(sandbox);
});

async function rows(sessionId: string) {
  const client = createClient({ url: `file:${join(CONFIG.storagePath, "user-prompts.db")}` });
  try {
    const result = await client.execute({
      sql: `SELECT message_id, content, captured, user_learning_captured FROM user_prompts
            WHERE session_id = ? ORDER BY message_id`,
      args: [sessionId],
    });
    return result.rows.map((row) => ({
      messageId: String(row.message_id),
      content: String(row.content),
      captured: Number(row.captured),
      learned: Number(row.user_learning_captured),
    }));
  } finally {
    client.close();
  }
}

let clock = Date.parse("2026-11-18T10:00:00.000Z");
const user = (id: string, content: string | PiContentBlock[]): PiSessionEntry => ({
  type: "message",
  id,
  parentId: null,
  timestamp: new Date(clock++).toISOString(),
  message: { role: "user", content },
});
const assistant = (id: string, text: string): PiSessionEntry => ({
  type: "message",
  id,
  parentId: null,
  timestamp: new Date(clock++).toISOString(),
  message: { role: "assistant", content: [{ type: "text", text }] },
});

describe("the settled Pi prompt", () => {
  it("is the last user entry, with its id and its text blocks joined", () => {
    const entries = [
      user("u-1", "first prompt"),
      assistant("a-1", "done"),
      user("u-2", [
        { type: "text", text: "second" },
        { type: "image" },
        { type: "text", text: "prompt" },
      ]),
      assistant("a-2", "done"),
    ] as PiSessionEntry[];
    expect(lastSettledPiPrompt(entries)).toEqual({ entryId: "u-2", text: "second\nprompt" });
    expect(lastSettledPiPrompt([assistant("a-0", "hello")])).toBeNull();
  });
});

describe("recordPiPrompt", () => {
  it("saves the prompt without its private text, under the session and entry id, as captured", async () => {
    const saved = await recordPiPrompt(
      "pi-s1",
      "u-1",
      sandbox,
      "use bun not npm <private>token</private>"
    );
    expect(saved).toBe(true);
    // `stripPrivateContent` leaves its marker, as the history import and the other hosts store it.
    expect(await rows("pi-s1")).toEqual([
      { messageId: "u-1", content: "use bun not npm [REDACTED]", captured: 1, learned: 0 },
    ]);
    // Captured: no host's capture takes it. Waiting: the next learning pass reads it.
    expect(await userPromptManager.getLastUncapturedPrompt("pi-s1")).toBeNull();
    const waiting = await userPromptManager.getPromptsForUserLearning(10);
    expect(waiting.map((prompt) => prompt.content)).toContain("use bun not npm [REDACTED]");
    expect(JSON.stringify(waiting)).not.toContain("token");
  });

  it("does not save a fully private prompt", async () => {
    expect(await recordPiPrompt("pi-s2", "u-1", sandbox, "<private>token</private>")).toBe(false);
    expect(await recordPiPrompt("pi-s2", "u-2", sandbox, "   ")).toBe(false);
    expect(await rows("pi-s2")).toEqual([]);
  });

  it("saves one row when the same turn settles twice", async () => {
    await recordPiPrompt("pi-s3", "u-1", sandbox, "Keep answers short please");
    await recordPiPrompt("pi-s3", "u-1", sandbox, "Keep answers short please");
    expect(await rows("pi-s3")).toHaveLength(1);
  });
});

describe("a Pi history import after live recording", () => {
  it("saves no prompt twice and learns no prompt twice", async () => {
    const sessionId = "pi-s4";
    const branch = [
      user("u-1", "Please refactor the settings page into small parts"),
      assistant("a-1", "Done."),
      user("u-2", "Use British spelling in the docs <private>secret</private>"),
      assistant("a-2", "Done."),
    ] as PiSessionEntry[];
    // Live: each turn settles with the branch so far.
    for (const end of [2, 4]) {
      const settled = lastSettledPiPrompt(branch.slice(0, end))!;
      await recordPiPrompt(sessionId, settled.entryId, sandbox, settled.text);
    }
    const live = await rows(sessionId);
    expect(live.map((row) => row.messageId)).toEqual(["u-1", "u-2"]);
    // A live pass learned both prompts (and the earlier tests' prompts, so none waits).
    const waiting = await userPromptManager.getPromptsForUserLearning(100);
    expect(waiting.filter((prompt) => prompt.sessionId === sessionId)).toHaveLength(2);
    await userPromptManager.markMultipleAsUserLearningCaptured(waiting.map((prompt) => prompt.id));

    let modelCalls = 0;
    const ledger = new Map<string, { status: string }>();
    const report = await importProfileFromHistory(
      [
        {
          sessionId,
          directory: sandbox,
          sourceFile: join(sandbox, "session.jsonl"),
          units: extractPiConversationWindows(branch),
        },
      ],
      {
        host: "pi",
        model: {
          provider: "stub",
          modelId: "stub",
          async complete() {
            modelCalls++;
            return JSON.stringify({ preferences: [], patterns: [], workflows: [] });
          },
        },
        ledger: {
          get: async (key: string) => (ledger.get(key) as never) ?? null,
          begin: async ({ key }: { key: string }) => void ledger.set(key, { status: "pending" }),
          complete: async (key: string) => void ledger.set(key, { status: "imported" }),
        } as never,
        profileStore: {
          getActiveProfile: async () => null,
          createProfile: async () => "profile",
        } as never,
      }
    );

    expect(report.promptsRecorded).toBe(2);
    // Same rows, same text, still learned.
    expect(await rows(sessionId)).toEqual(live.map((row) => ({ ...row, learned: 1 })));
    expect(modelCalls).toBe(0);
  });
});
