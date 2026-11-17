import type { EnsureResult } from "./web-ensure.js";

/** A notice a host shows when the web app could not start. `warning` maps to each host's own level. */
export interface WebStartNotice {
  level: "warning";
  text: string;
}

/**
 * The one wording every host uses when `ensureWebApp` cannot start the web app.
 * Results that need no notice (running, started, disabled, start-timeout) give null.
 */
export function webStartNotice(result: EnsureResult, port: number): WebStartNotice | null {
  if (result === "port-busy") {
    return {
      level: "warning",
      text: `The OMMS web app cannot start: another program uses port ${port}. Stop that program, or set "webServerPort" in the global config to a free port.`,
    };
  }
  if (result === "no-runtime") {
    return {
      level: "warning",
      text: "The OMMS web app cannot start: no Node 22.14 or later (or Bun) was found. Install Node 22.14 or later, then start a new session.",
    };
  }
  return null;
}
