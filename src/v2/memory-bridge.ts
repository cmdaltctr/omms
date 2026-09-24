import { CONFIG, isConfigured } from "../config.js";
import {
  buildRetrievalSection,
  formatMemoriesForCompaction,
  wrapRetrievalSection,
} from "../core/retrieval.js";
import { isInternalPrompt, recordUserPrompt } from "../adapters/opencode/user-prompt.js";
import { memoryClient } from "../services/client.js";
import { V2_RETRIEVAL_TIMEOUT_MS } from "../services/request-timeouts.js";
import { getTags } from "../services/tags.js";

/**
 * The memory operations the native OpenCode v2 hooks need, bound to the
 * plugin's location. Kept separate from the adapter so hook wiring can be
 * tested without a real store.
 */
export interface V2MemoryBridge {
  readonly retrievalTimeoutMs: number;
  isConfigured(): boolean;
  isInjectionEnabled(): boolean;
  isCompactionEnabled(): boolean;
  isInternalPrompt(sessionID: string, text: string): boolean;
  recordPrompt(sessionID: string, messageID: string, text: string): Promise<void>;
  /** Wrapped per-prompt retrieval section, or null when nothing is relevant. */
  retrieve(prompt: string, sessionID: string): Promise<string | null>;
  /** The session's own memories formatted for restore after compaction, or null. */
  restoreSession(sessionID: string): Promise<string | null>;
}

export function createV2MemoryBridge(directory: string): V2MemoryBridge {
  return {
    retrievalTimeoutMs: V2_RETRIEVAL_TIMEOUT_MS,
    isConfigured,
    isInjectionEnabled: () => isConfigured() && Boolean(CONFIG.chatMessage.enabled),
    isCompactionEnabled: () => isConfigured() && Boolean(CONFIG.compaction.enabled),
    isInternalPrompt,
    async recordPrompt(sessionID, messageID, text) {
      await recordUserPrompt(sessionID, messageID, directory, text);
    },
    async retrieve(prompt, sessionID) {
      const section = await buildRetrievalSection(prompt, directory, sessionID);
      return section ? wrapRetrievalSection(section) : null;
    },
    async restoreSession(sessionID) {
      const tags = getTags(directory);
      const result = await memoryClient.searchMemoriesBySessionID(
        sessionID,
        tags.project.tag,
        CONFIG.compaction.memoryLimit
      );
      if (!result.success || result.results.length === 0) return null;
      return formatMemoriesForCompaction(result.results);
    },
  };
}
