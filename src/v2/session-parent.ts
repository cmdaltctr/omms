import type { Context } from "@opencode/plugin/promise/plugin";
import { log } from "../services/logger.js";

type Bound = <V>(map: Map<string, V>, key: string, value: V) => void;

export interface SessionParents {
  /**
   * Whether the session has a parent, which makes it a subagent session. One lookup per session;
   * the promise is cached so concurrent callers share it. A failed lookup counts as a root session.
   */
  isSubagent(sessionID: string): Promise<boolean>;
  forget(sessionID: string): void;
  clear(): void;
}

/** The cached parent lookup shared by the recall reporter and the adapter's subagent gate. */
export function createSessionParents(ctx: Context, bound: Bound): SessionParents {
  const lookups = new Map<string, Promise<boolean>>();
  return {
    isSubagent(sessionID) {
      const known = lookups.get(sessionID);
      if (known) return known;
      const lookup = (async () => {
        try {
          const info = await ctx.session.get({ sessionID });
          return Boolean(info?.parentID);
        } catch (error) {
          log("v2 session: parent lookup failed", { sessionID, error: String(error) }, "error");
          return false;
        }
      })();
      bound(lookups, sessionID, lookup);
      return lookup;
    },
    forget: (sessionID) => void lookups.delete(sessionID),
    clear: () => lookups.clear(),
  };
}
