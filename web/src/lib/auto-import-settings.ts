export type BackfillHost = "pi" | "opencode" | "claude-code";
/** Hosts with a backfill model setting. Claude Code always uses the external API. */
export type ModelBackfillHost = Exclude<BackfillHost, "claude-code">;
export type BackfillState = { state: string } | null;

export function shouldPollBackfill(rows: Partial<Record<BackfillHost, BackfillState>>): boolean {
  return Object.values(rows).some((row) => row?.state === "running");
}

/** One host's run record, as `/api/settings/backfill/runs` reports it. */
export type ImportRunView = {
  surface: "auto" | "web" | "cli" | "slash" | null;
  state: string | null;
  total: number;
  done: number;
  percent: number;
  minutesLeft: number | null;
  paused: boolean;
  /** Exchanges first, then the profile step; older servers send no phase. */
  phase?: "exchanges" | "profile";
  profileDone?: number;
  profileTotal?: number;
  startedAt?: number | null;
  updatedAt?: number | null;
  imported?: number;
  skipped?: number;
  failed?: number;
} | null;

/** Progress text for a run: percentage, done of total, and minutes left or unknown. */
export function progressView(run: ImportRunView): {
  percent: number;
  done: string;
  minutesLeft: string;
} | null {
  if (!run || run.total <= 0) return null;
  return {
    percent: run.percent,
    done: `${run.done.toLocaleString("en-US")} / ${run.total.toLocaleString("en-US")}`,
    minutesLeft: run.minutesLeft === null ? "unknown" : `about ${run.minutesLeft}`,
  };
}

/** Which of Run now, Pause, and Resume apply to a host right now. */
export function backfillActions(
  run: ImportRunView,
  unavailable: string | null
): { runNow: boolean; pause: boolean; resume: boolean } {
  const running = run?.state === "running";
  const paused = run?.paused === true;
  return {
    runNow: !running && !paused && !unavailable,
    pause: running && !paused,
    resume: paused && !unavailable,
  };
}

/** Which Automatic import host cards open on the first status load: a running or paused run. */
export function initialCardsOpen(
  runs: Partial<Record<BackfillHost, { run: ImportRunView | null }>>
): Record<BackfillHost, boolean> {
  const open = (host: BackfillHost) => {
    const run = runs[host]?.run;
    return run?.state === "running" || run?.paused === true;
  };
  return { pi: open("pi"), opencode: open("opencode"), "claude-code": open("claude-code") };
}

export function manualModelFieldVisible(typedMode: boolean | undefined, known: boolean): boolean {
  return typedMode ?? !known;
}

export function backfillModelEdit(host: ModelBackfillHost, value: string): Record<string, string> {
  const slash = value.indexOf("/");
  if (value !== "inherit" && value !== "external" && (slash < 1 || slash === value.length - 1)) {
    throw new Error("Enter a model as provider/model.");
  }
  return { [`${host}BackfillModel`]: value };
}

/** The backfill status fields the badge reads. */
export type BackfillStatusView = {
  state: string;
  counts: { pending: number; unresolved: number; failed?: number };
  error: string | null;
} | null;

export type ImportBadge =
  | { kind: "imported" }
  | { kind: "partly"; unresolved: number }
  | { kind: "running" }
  | { kind: "learning-profile"; done: number; total: number }
  | { kind: "paused" }
  | { kind: "stopped"; pending: number }
  | { kind: "failed"; error: string | null }
  | { kind: "not-started" };

/** One host's import status for its badge, from its backfill status and latest run. */
export function importStatusBadge(status: BackfillStatusView, run: ImportRunView): ImportBadge {
  if (run?.state === "running") {
    return run.phase === "profile"
      ? { kind: "learning-profile", done: run.profileDone ?? 0, total: run.profileTotal ?? 0 }
      : { kind: "running" };
  }
  if (run?.paused) return { kind: "paused" };
  if (!status || status.state === "not-started") {
    return run?.state === "done" ? { kind: "imported" } : { kind: "not-started" };
  }
  // A run that finished with some failed exchanges is not a failed run: the
  // ledger retries those exchanges next time.
  const finishedWithFailedUnits = run?.state === "done" && (status.counts.failed ?? 0) > 0;
  if (status.state === "failed" && !finishedWithFailedUnits) {
    return { kind: "failed", error: status.error };
  }
  if (status.state === "running") return { kind: "running" };
  if (status.counts.pending > 0) return { kind: "stopped", pending: status.counts.pending };
  if (status.counts.unresolved > 0) return { kind: "partly", unresolved: status.counts.unresolved };
  return { kind: "imported" };
}

/** True when the card should draw the exchange progress bar. */
export function showsExchangeProgress(run: ImportRunView): boolean {
  return run?.state === "running" && run.phase !== "profile";
}

/** The latest finished run's summary, or null while a run is active or none ran. */
export function lastRunSummary(run: ImportRunView): {
  finishedAt: number;
  surface: NonNullable<NonNullable<ImportRunView>["surface"]>;
  imported: number;
  skipped: number;
  failed: number;
  state: string;
} | null {
  if (!run || run.state === "running" || !run.state || !run.updatedAt || !run.surface) return null;
  return {
    finishedAt: run.updatedAt,
    surface: run.surface,
    imported: run.imported ?? 0,
    skipped: run.skipped ?? 0,
    failed: run.failed ?? 0,
    state: run.state,
  };
}
