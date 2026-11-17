import { HOST_INFO, type MemoryHost } from "../shared/hosts.js";

export type BackfillHost = MemoryHost;
export type BackfillModel = "inherit" | "external" | { provider: string; model: string };

/** Parse the global backfill model without importing the runtime config. */
export function parseBackfillModel(
  config: { piBackfillModel?: unknown; opencodeBackfillModel?: unknown },
  host: BackfillHost
): BackfillModel {
  // A host with no backfill key (Claude Code) cannot lend a session model.
  const key = HOST_INFO[host].backfillModelKey;
  if (key === null) return "external";
  const value = config[key];
  if (value === undefined || value === "inherit") return "inherit";
  if (value === "external") return "external";
  if (typeof value !== "string") throw new Error(`Invalid ${key} config`);
  const slash = value.indexOf("/");
  if (slash <= 0 || slash === value.length - 1) {
    throw new Error(`Invalid ${key} config`);
  }
  return { provider: value.slice(0, slash), model: value.slice(slash + 1) };
}
