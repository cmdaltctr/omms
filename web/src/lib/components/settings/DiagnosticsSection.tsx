import { useCallback, useEffect, useState } from "react";
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
      <label className="text-sm">
        {s("Time range")}{" "}
        <select
          className="ms-2 rounded border border-border bg-background p-1"
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
        >
          <option value={1}>{s("24 hours")}</option>
          <option value={7}>{s("7 days")}</option>
          <option value={30}>{s("30 days")}</option>
          <option value={90}>{s("90 days")}</option>
        </select>
      </label>
      {error && <p role="alert">{error}</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-start text-sm">
          <caption className="text-start font-medium">{s("Outcomes by model")}</caption>
          <thead>
            <tr>
              {["Host / model", "Saved", "Skipped", "Failed", "Total"].map((label) => (
                <th scope="col" key={label}>
                  {s(label)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data?.byModel.map((row, index) => (
              <tr key={`${row.host}-${row.provider}-${row.model}-${index}`}>
                <td>
                  {row.host}: {row.provider}/{row.model}
                </td>
                <td>
                  {row.saved} ({Math.round((100 * row.saved) / row.total)}%)
                </td>
                <td>
                  {row.skipped} ({Math.round((100 * row.skipped) / row.total)}%)
                </td>
                <td>
                  {row.failed} ({Math.round((100 * row.failed) / row.total)}%)
                </td>
                <td>{row.total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="text-sm">
        <h3 className="font-medium">{s("Failure reasons")}</h3>
        {data?.byReason.map((row, index) => (
          <p key={`${row.host}-${row.reason}-${index}`}>
            {row.host}: {row.reason} ({row.count})
          </p>
        ))}
      </div>
      <div className="max-h-52 overflow-auto text-sm">
        <table className="w-full min-w-max">
          <caption className="text-start font-medium">{s("Recent attempts")}</caption>
          <thead>
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
                <th scope="col" className="pe-3 text-start" key={column}>
                  {s(column)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data?.recent.map((row, index) => (
              <tr key={`${row.timestamp}-${index}`}>
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
                  <td className="pe-3" key={cell}>
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
