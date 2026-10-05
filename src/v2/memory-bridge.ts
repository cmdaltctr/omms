import { CONFIG, isConfigured, refreshConfigIfChanged } from "../config.js";
import {
  buildRetrievalSection,
  formatMemoriesForCompaction,
  retrievalWrapperBytes,
  wrapRetrievalSection,
} from "../core/retrieval.js";
import { DEFAULT_RETRIEVAL_MAX_TOKENS, tokensToByteCeiling } from "../core/context-budget.js";
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
  /**
   * One request's total byte allowance for memory context, from a fresh
   * config read. Call once before the request's async memory work starts; an
   * operation in flight keeps that captured total even if the config changes.
   */
  snapshotRequestBudget(): number;
  /** Wrapped per-prompt retrieval section packed within `budgetBytes`, or null when nothing is relevant. */
  retrieve(prompt: string, sessionID: string, budgetBytes: number): Promise<string | null>;
  /** The session's own memories for restore after compaction, loaded once, or null. */
  restoreSession(sessionID: string): Promise<unknown[] | null>;
  /** Cached restored memories formatted within `budgetBytes`, or null when nothing fits. */
  formatRestoredSession(memories: unknown[], budgetBytes: number): string | null;
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
    snapshotRequestBudget() {
      refreshConfigIfChanged(directory);
      // The default guards partial CONFIG stubs in tests.
      return tokensToByteCeiling(CONFIG.retrievalMaxTokens ?? DEFAULT_RETRIEVAL_MAX_TOKENS);
    },
    async retrieve(prompt, sessionID, budgetBytes) {
      // The wrapper counts against the request budget, so the packed section reserves it.
      const section = await buildRetrievalSection(prompt, directory, sessionID, {
        maxBytes: budgetBytes,
        wrapperBytes: retrievalWrapperBytes(),
      });
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
      // Raw results: the request budget is only known when the restored
      // section is emitted, so formatting happens in formatRestoredSession.
      return result.results;
    },
    formatRestoredSession(memories, budgetBytes) {
      if (memories.length === 0) return null;
      return formatMemoriesForCompaction(memories, { maxBytes: budgetBytes });
    },
  };
}
