import { Fragment, useCallback, useEffect, useState } from "react";
import { Select } from "$lib/components/ui/select";
import { cn } from "$lib/utils";
import { caption, tableWrap, td, th, thead, tr } from "./table-styles";
import { groupOutcomesByHost, groupReasons, percentOf } from "$lib/diagnostics-groups";
import {
  beginSettingsRead,
  onSettingsSnapshot,
  reloadSettingsSnapshot,
  settingsRequest,
  withNote,
  createLatestGate,
} from "$lib/settings-api";
import { useSettingsText } from "$lib/i18n/settings";
import { hostLabel, hostName, type WebHost } from "$lib/host-label";

type Attempt = {
  timestamp: number;
  host: string;
  sourceType: string;
  sessionId: string;
  path?: string;
  provider?: string;
  model?: string;
  stopReason?: string;
  blockTypes?: string[];
  promptChars?: number;
  replyChars?: number;
  durationMs: number;
  outcome: string;
  reason?: string;
};
type Totals = {
  host: string;
  provider?: string;
  model?: string;
  total: number;
  saved: number;
  skipped: number;
  failed: number;
};
type Reason = { host: string; reason: string; count: number };
type RetryHost = WebHost;
type Diagnostics = {
  byModel: Totals[];
  byReason: Reason[];
  recent: Attempt[];
  retryQueue?: Record<RetryHost, number>;
};
type Trace = { file: string; size: number };
type Setting = { value: unknown; source: string };
type Snapshot = { revision: string; settings: Record<string, Setting> };

/** Saved, Skipped, and Failed with their share of the row, then the total. */
function OutcomeCells({
  row,
}: {
  row: { saved: number; skipped: number; failed: number; total: number };
}) {
  return (
    <>
      {([row.saved, row.skipped, row.failed] as const).map((count, column) => (
        <td className={cn(td, "text-end tabular-nums")} key={column}>
          {count}{" "}
          <span className="text-xs text-muted-foreground">{percentOf(count, row.total)}%</span>
        </td>
      ))}
      <td className={cn(td, "text-end font-medium tabular-nums")}>{row.total}</td>
    </>
  );
}

/** The server filters by host, so the recent list fills its limit with the chosen host alone. */
export function diagnosticsPath(days: number, host: WebHost | "all"): string {
  return `/api/settings/diagnostics?days=${days}${host === "all" ? "" : `&host=${host}`}`;
}

export function DiagnosticsSection() {
  const s = useSettingsText();
  const [days, setDays] = useState(7);
  const [host, setHost] = useState<WebHost | "all">("all");
  const [openHosts, setOpenHosts] = useState<Set<string>>(() => new Set());
  const [data, setData] = useState<Diagnostics>();
  const [traces, setTraces] = useState<Trace[]>([]);
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [view, setView] = useState("");
  const [error, setError] = useState("");
  const [retryNote, setRetryNote] = useState("");
  // A Host or range change can start a refresh while an older one still runs.
  const [refreshes] = useState(createLatestGate);
  const refresh = useCallback(
    async (range: number, chosen: WebHost | "all") => {
      const read = beginSettingsRead();
      const isLatest = refreshes.begin();
      try {
        const [attempts, files, settings] = await Promise.all([
          settingsRequest<Diagnostics>(diagnosticsPath(range, chosen)),
          settingsRequest<{ traces: Trace[] }>("/api/settings/traces"),
          settingsRequest<Snapshot>("/api/settings"),
        ]);
        if (!isLatest()) return;
        setData(attempts);
        setTraces(files.traces);
        // A save elsewhere may have published a newer revision while this ran.
        if (read.isCurrent()) setSnapshot(settings);
        setError("");
      } catch (cause) {
        if (!isLatest()) return;
        setError((cause as Error).message);
      }
    },
    [refreshes]
  );
  useEffect(() => {
    void refresh(days, host);
  }, [days, host, refresh]);
  useEffect(() => onSettingsSnapshot((value) => setSnapshot(value as Snapshot)), []);
  async function save(edits: Record<string, boolean | number>) {
    if (!snapshot) return;
    let failure: Error | undefined;
    try {
      await settingsRequest("/api/settings", {
        method: "PATCH",
        body: JSON.stringify({ revision: snapshot.revision, edits }),
      });
    } catch (cause) {
      failure = cause as Error;
    }
    // Publish only settings that were actually reloaded, never the pre-save copy.
    const reloaded = (await reloadSettingsSnapshot<Snapshot>()) !== null;
    if (!failure) {
      // A saved retention change can empty the queue, so an earlier Retry now note is stale.
      setRetryNote("");
      await refresh(days, host);
      if (!reloaded) setError(s("Reload the page before saving again."));
      return;
    }
    setError(
      withNote(
        failure.message,
        reloaded
          ? s("Current settings were reloaded; check the values and save again.")
          : s("The current settings could not be reloaded. Reload the page.")
      )
    );
  }
  async function openTrace(name: string) {
    try {
      const result = await settingsRequest<{ content: string }>(
        `/api/settings/traces/${encodeURIComponent(name)}`
      );
      setView(result.content);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }
  async function removeTrace(name: string) {
    if (!window.confirm(`${s("Delete")} ${name}?`)) return;
    try {
      await settingsRequest(`/api/settings/traces/${encodeURIComponent(name)}`, {
        method: "DELETE",
      });
      setView("");
      await refresh(days, host);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }
  async function retryNow(retryHost: RetryHost) {
    try {
      const { result } = await settingsRequest<{ result: "started" | "scheduled" | "running" }>(
        `/api/settings/capture-retry/${retryHost}/run`,
        { method: "POST", body: "{}" }
      );
      setRetryNote(
        result === "scheduled"
          ? retryHost === "pi"
            ? s("These turns retry at the next Pi session start.")
            : retryHost === "claude-code"
              ? s("These turns retry at the next Claude Code session start.")
              : s("These turns retry at the next OpenCode session start.")
          : result === "running"
            ? s("A retry is already running.")
            : s("Retrying now.")
      );
      await refresh(days, host);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }
  const trace = snapshot?.settings.captureTrace;
  const retryHours = Number(snapshot?.settings.captureRetryRetentionHours?.value ?? 72);
  return (
    <section
      className="space-y-4 rounded-xl border border-border bg-card p-4"
      aria-label={s("Capture diagnostics")}
    >
      <h2 className="text-section-title font-semibold">{s("Capture diagnostics")}</h2>
      <label className="flex items-center gap-2 pb-2 text-sm">
        {s("Time range")}
        <Select
          aria-label={s("Time range")}
          className="rounded-lg border border-border bg-background px-2 py-1"
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
        >
          <option value={1}>{s("24 hours")}</option>
          <option value={7}>{s("7 days")}</option>
          <option value={30}>{s("30 days")}</option>
          <option value={90}>{s("90 days")}</option>
        </Select>
        {s("Host")}
        <Select
          aria-label={s("Host")}
          className="rounded-lg border border-border bg-background px-2 py-1"
          value={host}
          onChange={(e) => setHost(e.target.value as WebHost | "all")}
        >
          <option value="all">{s("All")}</option>
          {(["opencode", "pi", "claude-code"] as const).map((id) => (
            <option key={id} value={id}>
              {hostLabel(id)}
            </option>
          ))}
        </Select>
      </label>
      {error && <p role="alert">{error}</p>}
      <p className="text-xs text-muted-foreground">
        {s(
          "Saved: a memory was stored. Skipped: the model or a rule found nothing worth keeping, or the turn was private or trivial. Failed: the attempt hit an error. Total: the three added up. Each percentage is a share of its row's total."
        )}
      </p>
      <div className={tableWrap}>
        <table className="w-full text-sm">
          <caption className={caption}>{s("Outcomes by host")}</caption>
          <thead className={thead}>
            <tr>
              {["Host / model", "Saved", "Skipped", "Failed", "Total"].map((label, column) => (
                <th scope="col" className={cn(th, column > 0 && "text-end")} key={label}>
                  {s(label)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groupOutcomesByHost(data?.byModel ?? []).map((hostRow) => {
              const open = openHosts.has(hostRow.host);
              return (
                <Fragment key={hostRow.host}>
                  <tr className={cn(tr, "font-medium")}>
                    <td className={td}>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1"
                        aria-expanded={open}
                        onClick={() =>
                          setOpenHosts((all) => {
                            const next = new Set(all);
                            if (open) next.delete(hostRow.host);
                            else next.add(hostRow.host);
                            return next;
                          })
                        }
                      >
                        <span aria-hidden>{open ? "▾" : "▸"}</span>
                        {hostName(hostRow.host)}
                        <span className="text-xs font-normal text-muted-foreground">
                          ({hostRow.models.length}{" "}
                          {s(hostRow.models.length === 1 ? "model" : "models")})
                        </span>
                      </button>
                    </td>
                    <OutcomeCells row={hostRow} />
                  </tr>
                  {open &&
                    hostRow.models.map((model) => (
                      <tr className={tr} key={`${hostRow.host}-${model.label ?? "none"}`}>
                        <td className={cn(td, "ps-8")}>
                          {model.label ? (
                            <span className="font-mono text-xs">{model.label}</span>
                          ) : (
                            <span
                              className="text-xs italic text-muted-foreground"
                              title={s(
                                "No model was recorded for these attempts. This happens with records written by older OMMS versions, and when an attempt stops before a model is chosen."
                              )}
                            >
                              {s("model not recorded")}
                            </span>
                          )}
                        </td>
                        <OutcomeCells row={model} />
                      </tr>
                    ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className={tableWrap}>
        <table className="w-full text-sm">
          <caption className={caption}>{s("Failure reasons")}</caption>
          <thead className={thead}>
            <tr>
              <th scope="col" className={th}>
                {s("Host")}
              </th>
              <th scope="col" className={th}>
                {s("Reason")}
              </th>
              <th scope="col" className={cn(th, "text-end")}>
                {s("Total")}
              </th>
            </tr>
          </thead>
          <tbody>
            {groupReasons(data?.byReason ?? []).map((row, index) => (
              <tr className={tr} key={`${row.host}-${row.reason}-${index}`}>
                <td className={cn(td, "text-muted-foreground")}>{hostName(row.host)}</td>
                <td className={cn(td, "font-mono text-xs")}>{row.reason}</td>
                <td className={cn(td, "text-end tabular-nums")}>{row.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={cn(tableWrap, "max-h-72 overflow-y-auto")}>
        <table className="w-full min-w-max text-sm">
          <caption className={caption}>{s("Recent attempts")}</caption>
          <thead className={cn(thead, "sticky top-0")}>
            <tr>
              {[
                "Time",
                "Host",
                "Source",
                "Session",
                "Path",
                "Model",
                "Stop",
                "Blocks",
                "Prompt",
                "Reply",
                "Duration",
                "Outcome",
                "Reason",
              ].map((column) => (
                <th scope="col" className={th} key={column}>
                  {s(column)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data?.recent.map((row, index) => (
              <tr className={tr} key={`${row.timestamp}-${index}`}>
                {[
                  new Date(row.timestamp).toLocaleString(),
                  hostName(row.host),
                  row.sourceType,
                  row.sessionId,
                  row.path,
                  `${row.provider ?? ""}/${row.model ?? ""}`,
                  row.stopReason,
                  row.blockTypes?.join(", "),
                  row.promptChars,
                  row.replyChars,
                  row.durationMs,
                  row.outcome,
                  row.reason,
                ].map((value, cell) => (
                  <td className={cn(td, "whitespace-nowrap")} key={cell}>
                    {value ?? ""}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="space-y-2 border-t border-border pt-3 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={trace?.value === true}
            disabled={!snapshot}
            onChange={(e) => {
              if (
                e.target.checked &&
                !window.confirm(
                  s(
                    "Traces can contain conversation content after redaction. Keep tracing off unless you need it for debugging."
                  )
                )
              )
                return;
              void save({ captureTrace: e.target.checked });
            }}
          />{" "}
          {s("Save capture traces")}
        </label>
        <p className="text-xs text-muted-foreground">
          {s(
            "Traces can contain conversation content after redaction. Keep tracing off unless you need it for debugging."
          )}
        </p>
        {trace?.source === "project" && (
          <p className="text-xs text-amber-600">
            {s("This project turns tracing off. The global switch cannot turn it on here.")}
          </p>
        )}
        {(["captureTraceRetentionDays", "captureAttemptRetentionDays"] as const).map((key) => (
          <label className="block" key={key}>
            {s(
              key === "captureTraceRetentionDays"
                ? "Trace retention (days)"
                : "Attempt retention (days)"
            )}{" "}
            <input
              key={`${key}-${snapshot?.settings[key]?.value}`}
              type="number"
              min={1}
              className="ms-2 w-20 rounded border border-border bg-background p-1"
              defaultValue={Number(snapshot?.settings[key]?.value ?? 30)}
              onBlur={(e) => {
                const value = Number(e.target.value);
                if (
                  Number.isSafeInteger(value) &&
                  value > 0 &&
                  value !== snapshot?.settings[key]?.value
                )
                  void save({ [key]: value });
              }}
            />
          </label>
        ))}
        <label className="block">
          {s("Retry retention (hours)")}{" "}
          <input
            key={`captureRetryRetentionHours-${retryHours}`}
            type="number"
            min={0}
            max={720}
            className="ms-2 w-20 rounded border border-border bg-background p-1"
            defaultValue={retryHours}
            onBlur={(e) => {
              const value = Number(e.target.value);
              if (Number.isSafeInteger(value) && value >= 0 && value <= 720 && value !== retryHours)
                void save({ captureRetryRetentionHours: value });
            }}
          />
        </label>
        <p className="text-xs text-muted-foreground">
          {s(
            "When the capture model cannot be reached, OMMS keeps the turn and tries again later. Queued turns can hold conversation content after redaction. 0 turns the queue off and deletes waiting turns."
          )}
        </p>
        <h3 className="text-subsection-title font-semibold">{s("Turns waiting for retry")}</h3>
        {(["pi", "opencode", "claude-code"] as const).map((host) => {
          const count = data?.retryQueue?.[host] ?? 0;
          return (
            <div className="flex items-center gap-2" key={host}>
              <span className="w-24">{hostLabel(host)}</span>
              <span className="tabular-nums">{count}</span>
              <button
                type="button"
                disabled={count === 0 || retryHours === 0}
                className="disabled:opacity-50"
                onClick={() => void retryNow(host)}
              >
                {s("Retry now")}
              </button>
            </div>
          );
        })}
        {retryNote && <p className="text-xs text-muted-foreground">{retryNote}</p>}
        <h3 className="text-subsection-title font-semibold">{s("Trace files")}</h3>
        {traces.map((file) => (
          <div className="flex items-center gap-2" key={file.file}>
            <span>
              {file.file} ({file.size} bytes)
            </span>
            <button type="button" onClick={() => void openTrace(file.file)}>
              {s("View")}
            </button>
            <button type="button" onClick={() => void removeTrace(file.file)}>
              {s("Delete")}
            </button>
          </div>
        ))}
        {view && (
          <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words rounded bg-background p-2 text-xs">
            {view}
          </pre>
        )}
      </div>
    </section>
  );
}
