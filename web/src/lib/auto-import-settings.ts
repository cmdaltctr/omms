export type BackfillHost = "pi" | "opencode";
export type BackfillState = { state: string } | null;

export function shouldPollBackfill(rows: Record<BackfillHost, BackfillState>): boolean {
  return rows.pi?.state === "running" || rows.opencode?.state === "running";
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

export function manualModelFieldVisible(typedMode: boolean | undefined, known: boolean): boolean {
  return typedMode ?? !known;
}

export function backfillModelEdit(host: BackfillHost, value: string): Record<string, string> {
  const slash = value.indexOf("/");
  if (value !== "inherit" && value !== "external" && (slash < 1 || slash === value.length - 1)) {
    throw new Error("Enter a model as provider/model.");
  }
  return { [`${host}BackfillModel`]: value };
}
