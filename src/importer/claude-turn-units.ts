import type { CaptureWorkUnit } from "../core/capture.js";
import { stripRetrievalSections } from "../core/retrieval.js";
import { handleFinishedTurn } from "../core/turn-outputs.js";
import { isFullyPrivate, stripPrivateContent } from "../services/privacy.js";
import type { SkillTurnRecorder } from "../services/skill-learning/settings-for.js";
import {
  extractClaudeWindowsAfter,
  type ClaudeConversationWindow,
  type ClaudeTranscriptEntry,
} from "./claude-conversation.js";

// Work units for the Claude Code Stop hook (`claude-hook-api.ts`): the cleaned
// unit memory capture reads, and the raw unit skill learning records.

const HOST = "claude-code";

/**
 * The windows after the cursor. The transcript file can lag the hook, so the
 * hook's final text is added as a last assistant reply when the transcript
 * does not already end with it. It carries no entry id, so `sourceEntryIds`
 * stay the reader's ids.
 */
export function claudeWindowsToCapture(
  entries: ClaudeTranscriptEntry[],
  cursor: string | null,
  finalText: string | undefined
): ClaudeConversationWindow[] {
  const tail = finalText?.trim();
  if (!tail) return extractClaudeWindowsAfter(entries, cursor);
  const hookReply: ClaudeTranscriptEntry = {
    type: "assistant",
    message: { role: "assistant", content: [{ type: "text", text: tail }] },
  };
  const windows = extractClaudeWindowsAfter([...entries, hookReply], cursor);
  const last = windows.at(-1);
  const replies = last?.textResponses ?? [];
  if (replies.length > 1 && replies[replies.length - 2]!.trim().endsWith(tail)) replies.pop();
  return windows;
}

/**
 * The project a session belongs to: the first prompt's directory, the same rule
 * the history import uses. Live capture must file a turn under the project the
 * import would choose, or the import cannot see that the turn is already saved.
 */
export function sessionDirectory(entries: ClaudeTranscriptEntry[], fallback: string): string {
  const first = entries.find((entry) => entry.type === "user" && entry.isSidechain !== true);
  return typeof first?.cwd === "string" && first.cwd ? first.cwd : fallback;
}

/** A cleaned work unit, or null for a prompt with nothing left to capture. */
export function workUnitOf(
  sessionId: string,
  window: ClaudeConversationWindow,
  directory: string
): CaptureWorkUnit | null {
  const prompt = stripRetrievalSections(window.userPrompt);
  if (!prompt || isFullyPrivate(prompt)) return null;
  return {
    host: HOST,
    hostSessionId: sessionId,
    sourceType: "live-capture",
    projectDirectory: directory,
    userPrompt: stripPrivateContent(prompt),
    promptId: window.userEntryId,
    textResponses: window.textResponses.map(stripPrivateContent),
    toolCalls: window.toolCalls.map((call) => ({
      name: call.name,
      input: stripPrivateContent(call.input),
    })),
    sourceEntryIds: window.sourceEntryIds,
    ...(window.sourceTimestamp !== undefined ? { sourceTimestamp: window.sourceTimestamp } : {}),
  };
}

/**
 * The unit skill learning records: OMMS's injected memories removed, nothing
 * else. Private text and secrets are the skill output's job, by its setting,
 * and the tool calls keep their outcome, error and path.
 */
export function skillUnitOf(
  sessionId: string,
  window: ClaudeConversationWindow,
  directory: string
): CaptureWorkUnit {
  return {
    host: HOST,
    hostSessionId: sessionId,
    sourceType: "live-capture",
    projectDirectory: directory,
    userPrompt: stripRetrievalSections(window.userPrompt),
    promptId: window.userEntryId,
    textResponses: window.textResponses,
    toolCalls: window.toolCalls,
    sourceEntryIds: window.sourceEntryIds,
    ...(window.sourceTimestamp !== undefined ? { sourceTimestamp: window.sourceTimestamp } : {}),
  };
}

/** Records windows that memory capture does not run for. Never moves the capture cursor. */
export async function recordClaudeSkillTurns(
  windows: ClaudeConversationWindow[],
  sessionId: string,
  directory: string,
  recorder: SkillTurnRecorder | undefined
): Promise<void> {
  if (!recorder) return;
  for (const window of windows) {
    await handleFinishedTurn(
      skillUnitOf(sessionId, window, directory),
      { memories: false, skills: true },
      { recordSkillTurn: recorder }
    );
  }
}
