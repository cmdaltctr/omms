import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import { CONFIG } from "../../config.js";
import { buildFirstPromptSections, openingQueryFor } from "../../core/opening-context.js";
import {
  buildRetrievalSection,
  formatMemoriesForCompaction,
  retrievalWrapperBytes,
  wrapRetrievalSection,
} from "../../core/retrieval.js";
import { memoryClient } from "../../services/client.js";
import { log } from "../../services/logger.js";
import { getTags } from "../../services/tags.js";
import { utf8ByteLength } from "../../utils/context-limit.js";
import type { PiRecallRows } from "./recall-rows.js";

/** The blank line before each section. The budget counts it for the second section on. */
const SECTION_SEPARATOR = "\n\n";
const SECTION_SEPARATOR_BYTES = 2;

/**
 * What Pi adds to the system prompt of one run beyond the prompt's own recall (change
 * align-recall-host-parity, design D1d, D4, D5): the opening section on the first prompt of a
 * main session, and the session's own memories after a compaction or a resume. In memory only.
 */

/** Session ids remembered as seen, and restored sessions kept. The oldest is dropped first. */
export const MAX_TRACKED_SESSIONS = 500;
const HOST = "pi";

/** A Pi child started by om-pi-subagents (`--mode rpc --no-session --no-extensions`). */
export function isPiChild(): boolean {
  return process.env.OMPS_CHILD === "1";
}

function hasEarlierUserEntry(branch: unknown): boolean {
  return (
    Array.isArray(branch) &&
    branch.some((entry) => entry?.type === "message" && entry.message?.role === "user")
  );
}

function remember<T>(map: Map<string, T>, key: string, value: T): void {
  map.delete(key);
  map.set(key, value);
  if (map.size > MAX_TRACKED_SESSIONS) map.delete(map.keys().next().value as string);
}

export interface PiSessionContext {
  /** Note that the session has had a prompt, so a later prompt is not its first. */
  markSeen(sessionId: string): void;
  /** Load the session's own memories for restore, replacing any earlier load. */
  loadRestore(ctx: ExtensionContext): Promise<void>;
  /** Text to append to the system prompt for this run, or null. */
  recall(ctx: ExtensionContext, prompt: string, budgetBytes: number): Promise<string | null>;
  /** Forget every restored session. */
  reset(): void;
}

export function createPiSessionContext(rows: PiRecallRows): PiSessionContext {
  const seen = new Map<string, true>();
  const restored = new Map<string, { memories: any[]; announced: boolean }>();

  const restoreEnabled = () => !isPiChild() && CONFIG.compaction?.enabled === true;

  async function loadRestore(ctx: ExtensionContext): Promise<void> {
    if (!restoreEnabled()) return;
    const sessionId = ctx.sessionManager.getSessionId();
    try {
      const result = await memoryClient.searchMemoriesBySessionID(
        sessionId,
        getTags(ctx.cwd).project.tag,
        CONFIG.compaction.memoryLimit
      );
      const own = result.success
        ? result.results.filter((memory: any) => memory.metadata?.host === HOST)
        : [];
      if (own.length > 0) remember(restored, sessionId, { memories: own, announced: false });
      else restored.delete(sessionId);
    } catch (error) {
      log(
        "Pi restore load failed",
        { code: error instanceof Error ? error.name : "unknown" },
        "error"
      );
    }
  }

  return {
    markSeen(sessionId) {
      remember(seen, sessionId, true);
    },
    loadRestore,

    async recall(ctx, prompt, budgetBytes) {
      const sessionId = ctx.sessionManager.getSessionId();
      const child = isPiChild();
      const visible = CONFIG.visibleRecall !== false;
      const budget = { maxBytes: budgetBytes, wrapperBytes: retrievalWrapperBytes() };

      // A session this process has not seen: first prompt when its branch holds no user entry,
      // else a resumed session.
      const unseen = !child && !seen.has(sessionId);
      if (unseen) remember(seen, sessionId, true);
      const resumed = unseen && hasEarlierUserEntry(ctx.sessionManager.getBranch());
      const openingQuery =
        unseen && !resumed
          ? openingQueryFor({
              openingContext: CONFIG.openingContext,
              openingContextQuery: CONFIG.openingContextQuery,
            })
          : null;

      let promptSection: string | null = null;
      let openingSection: string | null = null;
      if (CONFIG.chatMessage.enabled && (!child || CONFIG.subagentMemory)) {
        if (openingQuery) {
          ({ promptSection, openingSection } = await buildFirstPromptSections({
            prompt,
            openingQuery,
            directory: ctx.cwd,
            sessionId,
            budget,
            openingReserveBytes: SECTION_SEPARATOR_BYTES,
          }));
        } else {
          const section = await buildRetrievalSection(prompt, ctx.cwd, sessionId, budget);
          promptSection = section ? wrapRetrievalSection(section) : null;
        }
      }

      if (resumed) await loadRestore(ctx);
      let restoredSection: string | null = null;
      const entry = restoreEnabled() ? restored.get(sessionId) : undefined;
      if (entry) {
        const left =
          budgetBytes -
          (promptSection ? utf8ByteLength(promptSection) + SECTION_SEPARATOR_BYTES : 0);
        const text =
          left > budget.wrapperBytes
            ? formatMemoriesForCompaction(entry.memories, {
                maxBytes: left,
                wrapperBytes: budget.wrapperBytes,
              })
            : "";
        restoredSection = text ? wrapRetrievalSection(text) : null;
      }

      // Screen-only rows; the returned text stays the same with them on or off.
      await rows.record(ctx, prompt, promptSection, visible);
      if (openingSection)
        await rows.record(ctx, openingQuery ?? "", openingSection, visible, "opening");
      if (restoredSection && entry && !entry.announced) {
        entry.announced = true;
        await rows.record(ctx, "", restoredSection, visible, "restore");
      }

      const parts = [promptSection, openingSection, restoredSection].filter(Boolean);
      return parts.length > 0 ? SECTION_SEPARATOR + parts.join(SECTION_SEPARATOR) : null;
    },

    reset() {
      restored.clear();
    },
  };
}
