import { useCallback, useEffect, useState } from "react";
import { Select } from "$lib/components/ui/select";
import { cn } from "$lib/utils";

const tableWrap = "overflow-x-auto rounded-lg border border-border";
const caption = "px-3 py-2 text-start font-medium";
const thead = "bg-muted/50 text-xs text-muted-foreground";
const th = "px-3 py-2 text-start font-medium";
const tr = "border-t border-border transition-colors hover:bg-muted/30";
const td = "px-3 py-1.5";
import {
  beginSettingsRead,
  onSettingsSnapshot,
  reloadSettingsSnapshot,
  settingsRequest,
  withNote,
} from "$lib/settings-api";
import { useSettingsText } from "$lib/i18n/settings";

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
type Diagnostics = { byModel: Totals[]; byReason: Reason[]; recent: Attempt[] };
type Trace = { file: string; size: number };
type Setting = { value: unknown; source: string };
type Snapshot = { revision: string; settings: Record<string, Setting> };

export function DiagnosticsSection() {
  const s = useSettingsText();
  const [days, setDays] = useState(7);
  const [data, setData] = useState<Diagnostics>();
  const [traces, setTraces] = useState<Trace[]>([]);
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [view, setView] = useState("");
  const [error, setError] = useState("");
  const refresh = useCallback(async (range: number) => {
    const read = beginSettingsRead();
    try {
      const [attempts, files, settings] = await Promise.all([
        settingsRequest<Diagnostics>(`/api/settings/diagnostics?days=${range}`),
        settingsRequest<{ traces: Trace[] }>("/api/settings/traces"),
        settingsRequest<Snapshot>("/api/settings"),
      ]);
      setData(attempts);
      setTraces(files.traces);
      // A save elsewhere may have published a newer revision while this ran.
      if (read.isCurrent()) setSnapshot(settings);
      setError("");
    } catch (cause) {
      setError((cause as Error).message);
    }
  }, []);
  useEffect(() => {
    void refresh(days);
  }, [days, refresh]);
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
      await refresh(days);
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
      await refresh(days);
    } catch (cause) {
      setError((cause as Error).message);
    }
  }
  const trace = snapshot?.settings.captureTrace;
  return (
    <section
      className="space-y-4 rounded-xl border border-border bg-card p-4"
      aria-label={s("Capture diagnostics")}
    >
      <h2 className="text-lg font-medium">{s("Capture diagnostics")}</h2>
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
      </label>
      {error && <p role="alert">{error}</p>}
      <div className={tableWrap}>
        <table className="w-full text-sm">
          <caption className={caption}>{s("Outcomes by model")}</caption>
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
            {data?.byModel.map((row, index) => (
              <tr className={tr} key={`${row.host}-${row.provider}-${row.model}-${index}`}>
                <td className={td}>
                  <span className="text-muted-foreground">{row.host}</span>{" "}
                  <span className="font-mono text-xs">
                    {row.provider || row.model ? `${row.provider ?? ""}/${row.model ?? ""}` : "—"}
                  </span>
                </td>
                {([row.saved, row.skipped, row.failed] as const).map((count, column) => (
                  <td className={cn(td, "text-end tabular-nums")} key={column}>
                    {count}{" "}
                    <span className="text-xs text-muted-foreground">
                      {Math.round((100 * count) / row.total)}%
                    </span>
                  </td>
                ))}
                <td className={cn(td, "text-end font-medium tabular-nums")}>{row.total}</td>
              </tr>
            ))}
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
            {data?.byReason.map((row, index) => (
              <tr className={tr} key={`${row.host}-${row.reason}-${index}`}>
                <td className={cn(td, "text-muted-foreground")}>{row.host}</td>
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
                  row.host,
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
        <h3 className="font-medium">{s("Trace files")}</h3>
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
