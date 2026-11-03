import type { Context } from "@opencode/plugin/promise/plugin";
import { buildRecallSummary, type RecallSummary } from "../core/recall-summary.js";
import { log } from "../services/logger.js";
import type { V2MemoryBridge } from "./memory-bridge.js";
import { recallRpc } from "./recall-rpc.js";

/** Latest summaries kept per session. The TUI shows recent rows, so older ones are dropped. */
export const MAX_RECALL_SUMMARIES = 20;

/** Longest query kept per summary. The TUI shows at most 300 characters of it. */
export const MAX_RECALL_QUERY_CHARS = 300;

type Bound = <V>(map: Map<string, V>, key: string, value: V) => void;

export interface RecallReporter {
  /**
   * Record the summary of one prompt retrieval. `token` identifies the retrieval: model steps
   * that reuse it record once. A section with no memory entries records nothing, and neither
   * does a subagent session (one with a parent). The call does not wait for the session lookup.
   */
  record(sessionID: string, token: object, query: string, section: string | null): void;
  forget(sessionID: string): void;
  clear(): void;
}

/**
 * Keeps a bounded per-session ring of recall summaries and serves it over plugin RPC to the TUI
 * entrypoint. It never throws and never touches what is injected. Logs carry the mode, count and
 * session id only, never memory text or the query.
 */
export async function createRecallReporter(
  ctx: Context,
  memory: V2MemoryBridge,
  bound: Bound
): Promise<RecallReporter> {
  const rings = new Map<string, RecallSummary[]>();
  // Last number given per session. It keeps rising when the ring drops old entries.
  const sequences = new Map<string, number>();
  const recorded = new WeakSet<object>();
  // One lookup per session. The promise is cached so concurrent records keep their order.
  const subagents = new Map<string, Promise<boolean>>();
  // Records waiting on a session lookup. `forget` and `clear` cancel them, so a late lookup cannot
  // store a summary for a session whose state is gone. Entries leave when their lookup settles.
  const pending = new Map<string, Set<{ cancelled: boolean }>>();
  let emit: ((sessionID: string) => Promise<void>) | undefined;

  try {
    const registration = await ctx.rpc.register(recallRpc, {
      // The contract is plain JSON schema, so the host types the input as unknown.
      list: async (input) => ({
        enabled: memory.isVisibleRecallEnabled(),
        items: [...(rings.get((input as { sessionID: string }).sessionID) ?? [])],
      }),
    });
    emit = (sessionID) => registration.events.emit("recalled", { sessionID });
  } catch (error) {
    log("v2 recall: rpc registration failed", { error: String(error) }, "error");
  }

  const notify = (sessionID: string) => {
    try {
      emit?.(sessionID).catch((error) =>
        log("v2 recall: push failed", { sessionID, error: String(error) }, "error")
      );
    } catch (error) {
      log("v2 recall: push failed", { sessionID, error: String(error) }, "error");
    }
  };

  // A session with a parent is a subagent session. A failed lookup counts as a root session, so
  // the summary still shows.
  const isSubagent = (sessionID: string): Promise<boolean> => {
    const known = subagents.get(sessionID);
    if (known) return known;
    const lookup = (async () => {
      try {
        const info = await ctx.session.get({ sessionID });
        return Boolean(info?.parentID);
      } catch (error) {
        log("v2 recall: session lookup failed", { sessionID, error: String(error) }, "error");
        return false;
      }
    })();
    bound(subagents, sessionID, lookup);
    return lookup;
  };

  const store = (sessionID: string, built: RecallSummary) => {
    const seq = (sequences.get(sessionID) ?? 0) + 1;
    bound(sequences, sessionID, seq);
    const summary = { ...built, seq };
    const ring = [...(rings.get(sessionID) ?? []), summary].slice(-MAX_RECALL_SUMMARIES);
    bound(rings, sessionID, ring);
    log("v2 recall: summary recorded", {
      sessionID,
      mode: summary.mode,
      count: summary.items.length,
    });
    notify(sessionID);
  };

  return {
    record(sessionID, token, query, section) {
      if (recorded.has(token)) return;
      recorded.add(token);
      try {
        const summary = section
          ? buildRecallSummary(section, "search", query.slice(0, MAX_RECALL_QUERY_CHARS))
          : null;
        if (!summary) return;
        const ticket = { cancelled: false };
        const tickets = pending.get(sessionID) ?? new Set();
        tickets.add(ticket);
        pending.set(sessionID, tickets);
        void isSubagent(sessionID).then((subagent) => {
          tickets.delete(ticket);
          if (tickets.size === 0 && pending.get(sessionID) === tickets) pending.delete(sessionID);
          if (subagent || ticket.cancelled) return;
          try {
            store(sessionID, summary);
          } catch (error) {
            log(
              "v2 recall: could not record summary",
              { sessionID, error: String(error) },
              "error"
            );
          }
        });
      } catch (error) {
        log("v2 recall: could not record summary", { sessionID, error: String(error) }, "error");
      }
    },
    forget: (sessionID) => {
      for (const ticket of pending.get(sessionID) ?? []) ticket.cancelled = true;
      pending.delete(sessionID);
      rings.delete(sessionID);
      sequences.delete(sessionID);
      subagents.delete(sessionID);
    },
    clear: () => {
      for (const tickets of pending.values()) for (const ticket of tickets) ticket.cancelled = true;
      pending.clear();
      rings.clear();
      sequences.clear();
      subagents.clear();
    },
  };
}
