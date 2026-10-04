import { useEffect, useState } from "react";
import { Select } from "$lib/components/ui/select";
import {
  backfillActions,
  backfillModelEdit,
  importStatusBadge,
  lastRunSummary,
  manualModelFieldVisible,
  progressView,
  showsExchangeProgress,
  shouldPollBackfill,
  type BackfillHost,
  type ImportRunView,
  type ModelBackfillHost,
} from "$lib/auto-import-settings";
import { externalMissing } from "$lib/external-api-settings";
import { hostLabel } from "$lib/host-label";
import { onSettingsSnapshot, reloadSettingsSnapshot, settingsRequest } from "$lib/settings-api";
import { useSettingsText } from "$lib/i18n/settings";
import { revealDirectoryMaps } from "$lib/directory-map-navigation";

type Snapshot = {
  revision: string;
  settings: Record<string, { globalValue?: unknown }>;
  secrets?: Record<string, { set: boolean }>;
};
type Runs = Record<BackfillHost, { run: ImportRunView; runNowUnavailable: string | null }>;
type ModelList = {
  available: boolean;
  models?: Array<{ provider: string; model: string; name: string }>;
  reason?: string;
};
type Status = {
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
type Rows = Record<BackfillHost, Status>;

const HOSTS = ["pi", "opencode", "claude-code"] as const;

export function AutoImportSection() {
  const s = useSettingsText();
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [rows, setRows] = useState<Rows>({ pi: null, opencode: null, "claude-code": null });
  const [runs, setRuns] = useState<Runs>();
  const [lists, setLists] = useState<Record<string, ModelList>>({});
  const [choices, setChoices] = useState<Partial<Record<BackfillHost, string>>>({});
  const [typedModes, setTypedModes] = useState<Partial<Record<BackfillHost, boolean>>>({});
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const polling =
    shouldPollBackfill(rows) || HOSTS.some((host) => runs?.[host]?.run?.state === "running");
  const loadRuns = () =>
    settingsRequest<Runs>("/api/settings/backfill/runs")
      .then(setRuns)
      .catch((error: Error) => setMessage(error.message));
  useEffect(() => {
    let active = true;
    void settingsRequest<Snapshot>("/api/settings")
      .then((value) => {
        if (active) setSnapshot(value);
      })
      .catch((error: Error) => {
        if (active) setMessage(error.message);
      });
    void settingsRequest<Rows>("/api/settings/backfill")
      .then((value) => {
        if (active) setRows(value);
      })
      .catch((error: Error) => {
        if (active) setMessage(error.message);
      });
    void loadRuns();
    // Claude Code has no backfill model setting, so it has no model list.
    for (const host of ["pi", "opencode"] as const) {
      void settingsRequest<ModelList>(`/api/settings/models?host=${host}`)
        .then((value) => {
          if (active) setLists((previous) => ({ ...previous, [host]: value }));
        })
        .catch(() => {
          if (active) setLists((previous) => ({ ...previous, [host]: { available: false } }));
        });
    }
    const unsubscribe = onSettingsSnapshot((value) => {
      if (active) setSnapshot(value as Snapshot);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!polling) return;
    let active = true;
    const timer = setInterval(() => {
      void settingsRequest<Rows>("/api/settings/backfill")
        .then((value) => {
          if (active) setRows(value);
        })
        .catch((error: Error) => {
          if (active) setMessage(error.message);
        });
      if (active) void loadRuns();
    }, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [polling]);

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
    try {
      await settingsRequest(`/api/settings/backfill/${host}/${action}`, {
        method: "POST",
        body: "{}",
      });
      setMessage(
        s(action === "pause" ? "Pausing after the current exchange." : "Backfill started.")
      );
    } catch (error) {
      setMessage((error as Error).message);
    }
    await loadRuns();
    setBusy(false);
  }
  function saveModel(host: ModelBackfillHost, choice: string) {
    try {
      void save(backfillModelEdit(host, choice.trim()));
    } catch (error) {
      setMessage(s((error as Error).message));
    }
  }

  return (
    <section
      className="space-y-3 rounded-xl border border-border bg-card p-4"
      aria-label={s("Automatic import")}
    >
      <h2 className="text-section-title font-semibold">{s("Automatic import")}</h2>
      <p className="text-sm text-muted-foreground">
        {s(
          "Automatic import makes model calls. A model change applies at the next run. Turning it off stops a running import after the current exchange."
        )}
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={Boolean(snapshot?.settings.autoBackfill?.globalValue)}
          disabled={busy || !snapshot}
          onChange={(event) => void save({ autoBackfill: event.target.checked })}
        />
        {s("Import past chats automatically")}
      </label>
      {HOSTS.map((host) => {
        const saved = String(snapshot?.settings[`${host}BackfillModel`]?.globalValue ?? "inherit");
        const current = choices[host] ?? saved;
        const options = lists[host]?.models ?? [];
        const known =
          current === "inherit" ||
          current === "external" ||
          options.some((item) => `${item.provider}/${item.model}` === current);
        const missing = externalMissing({
          memoryProvider: snapshot?.settings.memoryProvider?.globalValue as string | undefined,
          memoryModel: snapshot?.settings.memoryModel?.globalValue as string | undefined,
          memoryApiUrl: snapshot?.settings.memoryApiUrl?.globalValue as string | undefined,
          keySet: Boolean(snapshot?.secrets?.memoryApiKey?.set),
        });
        const run = runs?.[host]?.run ?? null;
        const unavailable = runs?.[host]?.runNowUnavailable ?? null;
        const actions = backfillActions(run, unavailable);
        const progress = showsExchangeProgress(run) ? progressView(run) : null;
        const summary = lastRunSummary(run);
        const badge = importStatusBadge(rows[host], run);
        const typed = manualModelFieldVisible(typedModes[host], known);
        return (
          <div key={host} className="space-y-2 rounded-lg border border-border p-3 text-sm">
            <h3 className="text-subsection-title font-semibold">{hostLabel(host)}</h3>
            {host === "claude-code" ? (
              <p className="text-muted-foreground">
                {s(
                  "Claude Code backfill always uses the external API. It has no backfill model setting."
                )}
              </p>
            ) : (
              <>
                <label className="block">
                  {s("Backfill model")}
                  <Select
                    aria-label={`${hostLabel(host)} ${s("Backfill model")}`}
                    className="mt-1 block w-full rounded border border-border bg-background p-2"
                    value={typed ? "typed" : current}
                    onChange={(event) => {
                      const value = event.target.value;
                      setTypedModes((previous) => ({ ...previous, [host]: value === "typed" }));
                      setChoices((previous) => ({ ...previous, [host]: value }));
                    }}
                  >
                    <option value="inherit">{s("Same as live capture")}</option>
                    <option value="external" disabled={missing.length > 0}>
                      {s("External API")}
                    </option>
                    {options.map((item) => (
                      <option
                        key={`${item.provider}/${item.model}`}
                        value={`${item.provider}/${item.model}`}
                      >
                        {item.name} ({item.provider}/{item.model})
                      </option>
                    ))}
                    <option value="typed">{s("Manual provider/model")}</option>
                  </Select>
                </label>
                {typed && (
                  <input
                    aria-label={`${host} ${s("Manual provider/model")}`}
                    className="w-full rounded border border-border bg-background p-2"
                    placeholder="provider/model"
                    value={current === "typed" ? "" : current}
                    onChange={(event) =>
                      setChoices((previous) => ({ ...previous, [host]: event.target.value }))
                    }
                  />
                )}
                {missing.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {s("External API needs")}: {missing.join(", ")}
                  </p>
                )}
                {lists[host]?.available === false && (
                  <p>
                    {lists[host].reason
                      ? s(lists[host].reason)
                      : s("Model list unavailable. Enter provider/model manually.")}
                  </p>
                )}
                <button
                  type="button"
                  className="rounded border border-border px-3 py-1.5"
                  disabled={busy || !snapshot}
                  onClick={() => saveModel(host, current)}
                >
                  {s("Save model")}
                </button>
              </>
            )}
            <p>
              {s("State")}:{" "}
              {run?.paused ? s("paused") : s(run?.state ?? rows[host]?.state ?? "not started")}
              {run?.state === "running" && run.surface && ` (${s(`started from ${run.surface}`)})`}
            </p>
            {badge.kind === "learning-profile" && (
              <p className="text-muted-foreground">
                {s("All exchanges are done. Learning the profile from the imported prompts")}:{" "}
                {badge.done} / {badge.total} {s("batches")}
              </p>
            )}
            {progress && (
              <div className="space-y-1">
                <div
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={progress.percent}
                  className="h-2 w-full overflow-hidden rounded bg-muted"
                >
                  <div className="h-full bg-primary" style={{ width: `${progress.percent}%` }} />
                </div>
                <p className="text-muted-foreground">
                  {progress.percent}% · {progress.done} · {s("Minutes left")}:{" "}
                  {progress.minutesLeft === "unknown"
                    ? s("unknown")
                    : progress.minutesLeft.replace("about", s("about"))}
                </p>
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded border border-border px-3 py-1.5"
                disabled={busy || !actions.runNow}
                onClick={() => void control(host, "run")}
              >
                {s("Run now")}
              </button>
              <button
                type="button"
                className="rounded border border-border px-3 py-1.5"
                disabled={busy || !actions.pause}
                onClick={() => void control(host, "pause")}
              >
                {s("Pause")}
              </button>
              <button
                type="button"
                className="rounded border border-border px-3 py-1.5"
                disabled={busy || !actions.resume}
                onClick={() => void control(host, "resume")}
              >
                {s("Resume")}
              </button>
            </div>
            {unavailable && <p className="text-xs text-muted-foreground">{unavailable}</p>}
            {summary && (
              <p className="text-muted-foreground">
                {s("Last run")}: {new Date(summary.finishedAt).toLocaleString()} ·{" "}
                {s(`started from ${summary.surface}`)} · {s(summary.state)} · {s("Imported")}:{" "}
                {summary.imported} · {s("Skipped")}: {summary.skipped} · {s("Failed")}:{" "}
                {summary.failed}
              </p>
            )}
            {rows[host] && (
              <div className="space-y-1 text-muted-foreground">
                {!summary && (
                  <p>
                    {s("Imported")}: {rows[host].counts.imported} · {s("Skipped")}:{" "}
                    {rows[host].counts.skipped} · {s("Failed")}: {rows[host].counts.failed}
                  </p>
                )}
                <p>
                  {s("Pending")}: {rows[host].counts.pending} · {s("Unresolved sessions")}:{" "}
                  {rows[host].counts.unresolved}
                  {rows[host].counts.unresolved > 0 && (
                    <>
                      {" "}
                      <a
                        className="underline focus-visible:outline-2 focus-visible:outline-ring"
                        href={`#directory-maps-${host}`}
                        aria-label={`${hostLabel(host)}: ${s("Directory maps")}`}
                        onClick={() => revealDirectoryMaps(host)}
                      >
                        {s("Directory maps")}
                      </a>
                    </>
                  )}
                </p>
                <p>
                  {s("Model")}: {rows[host].model ?? s("none")}
                </p>
                <p>
                  {s("Cutoff")}: {new Date(rows[host].cutoff).toLocaleString()}
                </p>
                {rows[host].error && <p role="alert">{rows[host].error}</p>}
              </div>
            )}
          </div>
        );
      })}
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
    </section>
  );
}
