import { useEffect, useRef, useState } from "react";
import {
  backfillModelEdit,
  type BackfillHost,
  type ImportRunView,
  type ModelBackfillHost,
} from "$lib/auto-import-settings";
import { onSettingsSnapshot, reloadSettingsSnapshot, settingsRequest } from "$lib/settings-api";
import { useSettingsText } from "$lib/i18n/settings";
import { latestReply } from "$lib/latest-reply";

export type Snapshot = {
  revision: string;
  settings: Record<string, { globalValue?: unknown }>;
  secrets?: Record<string, { set: boolean }>;
};
export type Runs = Record<BackfillHost, { run: ImportRunView; runNowUnavailable: string | null }>;
export type ModelList = {
  available: boolean;
  models?: Array<{ provider: string; model: string; name: string }>;
  reason?: string;
};
export type BackfillRow = {
  state: string;
  model: string | null;
  cutoff: number;
  counts: {
    imported: number;
    skipped: number;
    failed: number;
    pending: number;
    unresolved: number;
  };
  error: string | null;
} | null;
export type Rows = Record<BackfillHost, BackfillRow>;

const POLL_MS = 3000;

/**
 * Every host's backfill state, run record and model list, with the controls
 * the Memory page uses. Mount, snapshot and poll reads overlap, so only the
 * newest reply of each kind counts.
 */
export function useBackfill() {
  const s = useSettingsText();
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [rows, setRows] = useState<Rows>({ pi: null, opencode: null, "claude-code": null });
  const [runs, setRuns] = useState<Runs>();
  const [lists, setLists] = useState<Record<string, ModelList>>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const rowsReply = useRef(latestReply<Rows>(setRows, (error) => setMessage(error.message)));
  const runsReply = useRef(latestReply<Runs>(setRuns, (error) => setMessage(error.message)));
  const loadRows = () => rowsReply.current(settingsRequest<Rows>("/api/settings/backfill"));
  const loadRuns = () => runsReply.current(settingsRequest<Runs>("/api/settings/backfill/runs"));

  useEffect(() => {
    let active = true;
    void settingsRequest<Snapshot>("/api/settings")
      .then((value) => active && setSnapshot(value))
      .catch((error: Error) => active && setMessage(error.message));
    void loadRows();
    void loadRuns();
    // Claude Code has no backfill model setting, so it has no model list.
    for (const host of ["pi", "opencode"] as const) {
      void settingsRequest<ModelList>(`/api/settings/models?host=${host}`)
        .then((value) => active && setLists((previous) => ({ ...previous, [host]: value })))
        .catch(
          () => active && setLists((previous) => ({ ...previous, [host]: { available: false } }))
        );
    }
    const unsubscribe = onSettingsSnapshot((value) => {
      if (!active) return;
      setSnapshot(value as Snapshot);
      // A save such as Ignore can change the unresolved counts the server reports.
      void loadRows();
    });
    // Imports can start from another page or the CLI while this one is idle.
    const timer = setInterval(() => {
      if (!active) return;
      void loadRows();
      void loadRuns();
    }, POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
      unsubscribe();
    };
  }, []);

  async function save(edits: Record<string, unknown>) {
    if (!snapshot) return;
    setBusy(true);
    try {
      await settingsRequest("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({ edits, revision: snapshot.revision }),
      });
      setMessage(s("Saved. Changes apply at the next run."));
    } catch (error) {
      setMessage((error as Error).message);
    }
    await reloadSettingsSnapshot<Snapshot>();
    setBusy(false);
  }

  async function control(host: BackfillHost, action: "run" | "pause" | "resume") {
    setBusy(true);
    // Pausing with no run going only saves the flag; nothing stops "after the current exchange".
    const live = runs?.[host]?.run?.state === "running";
    try {
      await settingsRequest(`/api/settings/backfill/${host}/${action}`, {
        method: "POST",
        body: "{}",
      });
      setMessage(
        s(
          action !== "pause"
            ? "Backfill started."
            : live
              ? "Pausing after the current exchange."
              : "Paused. No import starts until you resume."
        )
      );
    } catch (error) {
      setMessage((error as Error).message);
    }
    await Promise.all([loadRuns(), loadRows()]);
    setBusy(false);
  }

  function saveModel(host: ModelBackfillHost, choice: string) {
    try {
      void save(backfillModelEdit(host, choice.trim()));
    } catch (error) {
      setMessage(s((error as Error).message));
    }
  }

  return { snapshot, rows, runs, lists, message, busy, save, control, saveModel, setMessage };
}

export type Backfill = ReturnType<typeof useBackfill>;
