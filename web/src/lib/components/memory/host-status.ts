import type { BackfillHost, ImportRunView } from "$lib/auto-import-settings";

export type HostState = "not-set-up" | "running" | "paused" | "failed" | "stopped";

export type HostActionKind = "setup" | "pause" | "resume" | "retry";

/** A line of page text: an English key for the translation table, and its values. */
export type StatusText = { text: string; params?: Record<string, string | number> };

export type HostStatusInput = {
  host: BackfillHost;
  run: ImportRunView;
  /** Exchanges the backfill still has to import. */
  pending: number;
  /** When the backfill cutoff was fixed, in milliseconds; null when none is known. */
  cutoff: number | null;
  /** Why a run cannot start here, from the server; null when it can. */
  runNowUnavailable: string | null;
  /** The host's history source exists on this machine, or a custom one is saved. */
  setUp: boolean;
  formatDate: (milliseconds: number) => string;
  /** The newest live capture that saved a memory, in milliseconds; null when none is kept. */
  lastSaved: number | null;
  formatSaved: (milliseconds: number) => string;
};

export type HostStatus = {
  state: HostState;
  action: { kind: HostActionKind; enabled: boolean };
  sentence: StatusText;
  /** The sentence is a blocked model choice that the saved external API would clear. */
  offerExternal: boolean;
};

/**
 * One host's state, its single main action and the sentence under it.
 * Automatic import runs all the time, so a host that is set up, not paused and
 * not failed reads Running with Pause, whether or not a run is in progress.
 * Play (Resume) and Retry mean something is off. Stopped shows only when a run
 * was cut short with work pending, or when the server says a run cannot start.
 */
export function hostStatus(input: HostStatusInput): HostStatus {
  const { run, runNowUnavailable: blocked } = input;
  const enabled = blocked === null;
  // Only a host with its own model can offer a switch to the external API.
  const offerExternal = blocked !== null && input.host !== "claude-code";
  const reason: StatusText = { text: "{reason}", params: { reason: blocked ?? "" } };
  const status = (
    state: HostState,
    kind: HostActionKind,
    sentence: StatusText,
    actionEnabled = true
  ): HostStatus => ({
    state,
    action: { kind, enabled: actionEnabled },
    sentence,
    offerExternal: false,
  });

  if (!input.setUp) {
    return status("not-set-up", "setup", { text: "This host is not set up on this machine." });
  }

  if (run?.state === "running") {
    if (run.paused) {
      return status("running", "pause", { text: "Pausing after the current exchange." }, false);
    }
    const minutes = run.minutesLeft;
    return status("running", "pause", {
      text:
        minutes === null
          ? "Importing {done} / {total}."
          : "Importing {done} / {total}. About {minutes} min left.",
      params: { done: run.done, total: run.total, ...(minutes === null ? {} : { minutes }) },
    });
  }

  if (run?.paused) {
    return {
      ...status(
        "paused",
        "resume",
        enabled ? { text: "Paused. Resume to continue." } : reason,
        enabled
      ),
      offerExternal,
    };
  }

  if (run?.state === "failed") {
    return {
      ...status(
        "failed",
        "retry",
        enabled
          ? { text: "Stopped: {error}", params: { error: run.error ?? "unknown error" } }
          : reason,
        enabled
      ),
      offerExternal,
    };
  }

  // A run cut short with work pending needs the user; so does a blocked host.
  if (!enabled || (run?.state === "stopped" && input.pending > 0)) {
    return {
      ...status(
        "stopped",
        "resume",
        enabled
          ? { text: "{pending} still waiting to import.", params: { pending: input.pending } }
          : reason,
        enabled
      ),
      offerExternal,
    };
  }

  const idle = run?.state === "done" && run.total === 0;
  let sentence: StatusText;
  if (idle && input.cutoff !== null) {
    sentence = {
      text: "Automatic import is on. Nothing was waiting before {date}. Use Sessions below for newer chats.",
      params: { date: input.formatDate(input.cutoff) },
    };
  } else if (input.pending > 0) {
    sentence = { text: "{pending} still waiting to import.", params: { pending: input.pending } };
  } else {
    sentence = { text: "Automatic import is on. Nothing is waiting." };
  }
  return status("running", "pause", sentence);
}

/** The one-line status on a host card. */
export function cardLine(input: HostStatusInput): StatusText {
  const { run } = input;
  if (!input.setUp) return { text: "Not set up" };
  if (run?.state === "running") {
    return { text: "Importing · {percent}%", params: { percent: run.percent } };
  }
  if (run?.paused)
    return { text: "Paused · {pending} pending", params: { pending: input.pending } };
  if (run?.state === "failed") return { text: "Failed" };
  const blocked = input.runNowUnavailable !== null;
  if (blocked || (run?.state === "stopped" && input.pending > 0)) {
    return { text: "Stopped · {pending} pending", params: { pending: input.pending } };
  }
  // The history date is the one-off import; live capture is what keeps memory current.
  const date = run?.updatedAt && run.state === "done" ? input.formatDate(run.updatedAt) : null;
  const when = input.lastSaved === null ? null : input.formatSaved(input.lastSaved);
  if (date && when) {
    return {
      text: "Running · history imported {date} · last saved {when}",
      params: { date, when },
    };
  }
  if (date) return { text: "Running · history imported {date}", params: { date } };
  if (when) return { text: "Running · last saved {when}", params: { when } };
  return { text: "Running" };
}

/** Translate a status line and fill its `{name}` values. */
export function statusText(translate: (message: string) => string, line: StatusText): string {
  const text = translate(line.text);
  return Object.entries(line.params ?? {}).reduce(
    (result, [name, value]) => result.replaceAll(`{${name}}`, String(value)),
    text
  );
}
