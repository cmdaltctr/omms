export type BackfillHost = "pi" | "opencode" | "claude-code";
export type BackfillModel = "inherit" | "external" | { provider: string; model: string };

/** Parse the global backfill model without importing the runtime config. */
export function parseBackfillModel(
  config: { piBackfillModel?: unknown; opencodeBackfillModel?: unknown },
  host: BackfillHost
): BackfillModel {
  // Claude Code hooks cannot call a session model, so its backfill has no setting.
  if (host === "claude-code") return "external";
  const value = host === "pi" ? config.piBackfillModel : config.opencodeBackfillModel;
  if (value === undefined || value === "inherit") return "inherit";
  if (value === "external") return "external";
  if (typeof value !== "string") throw new Error(`Invalid ${host}BackfillModel config`);
  const slash = value.indexOf("/");
  if (slash <= 0 || slash === value.length - 1) {
    throw new Error(`Invalid ${host}BackfillModel config`);
  }
  return { provider: value.slice(0, slash), model: value.slice(slash + 1) };
}
