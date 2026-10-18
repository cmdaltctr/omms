import type { BackfillHost, ImportRunView } from "$lib/auto-import-settings";

export type HostState =
  "not-set-up" | "running" | "paused" | "failed" | "stopped" | "done" | "idle";

export type HostActionKind = "setup" | "pause" | "resume" | "retry" | "run";

/** A line of page text: an English key for the translation table, and its values. */
export type StatusText = { text: string; params?: Record<string, string | number> };

export type HostStatusInput = {
  host: BackfillHost;
  run: ImportRunView;
  /** Exchanges the backfill still has to import. */
  pending: number;
  /** When the backfill cutoff was fixed, in milliseconds; null when none is known. */
  cutoff: number | null;
  /** Why Run now cannot start here, from the server; null when it can. */
  runNowUnavailable: string | null;
  /** The host's history source exists on this machine, or a custom one is saved. */
  setUp: boolean;
  formatDate: (milliseconds: number) => string;
};

export type HostStatus = {
  state: HostState;
  action: { kind: HostActionKind; enabled: boolean };
  sentence: StatusText;
  /** The sentence is a blocked model choice that the saved external API would clear. */
  offerExternal: boolean;
};

/**
 * One host's state, its single main action and the sentence under it. The
 * action label follows the state: Pause while running, Resume while paused,
 * Retry after a failure, and Run now otherwise. A blocked action stays on the
 * page with the server's reason as its sentence.
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

  if (!run || run.state === null) {
    return {
      ...status("idle", "run", enabled ? { text: "No import has run yet." } : reason, enabled),
      offerExternal,
    };
  }

  const idle = run.state === "done" && run.total === 0;
  let sentence: StatusText;
  if (!enabled) sentence = reason;
  else if (idle && input.cutoff !== null) {
    sentence = {
      text: "Nothing was waiting before {date}. Use Sessions below for newer chats.",
      params: { date: input.formatDate(input.cutoff) },
    };
  } else if (idle) {
    sentence = { text: "Nothing was waiting. Use Sessions below for newer chats." };
  } else {
    // The details below the header already list what the last run did.
    sentence =
      input.pending > 0
        ? { text: "{pending} still waiting to import.", params: { pending: input.pending } }
        : { text: "Nothing is waiting to import." };
  }
  return {
    ...status(run.state === "stopped" ? "stopped" : "done", "run", sentence, enabled),
    offerExternal,
  };
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
  if (!run || run.state === null) return { text: "Not started" };
  if (run.state === "stopped") {
    return { text: "Stopped · {pending} pending", params: { pending: input.pending } };
  }
  return run.updatedAt
    ? { text: "Imported {date}", params: { date: input.formatDate(run.updatedAt) } }
    : { text: "Imported" };
}

/** Translate a status line and fill its `{name}` values. */
export function statusText(translate: (message: string) => string, line: StatusText): string {
  const text = translate(line.text);
  return Object.entries(line.params ?? {}).reduce(
    (result, [name, value]) => result.replaceAll(`{${name}}`, String(value)),
    text
  );
}
