import { Fragment, useCallback, useEffect, useState } from "react";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "$lib/components/ui/button";
import { Label } from "$lib/components/ui/label";
import { Select } from "$lib/components/ui/select";
import { CaptureControls, type CaptureSnapshot, type Trace } from "./CaptureControls";
import { cn } from "$lib/utils";
import { caption, tableWrap, td, th, thead, tr } from "./table-styles";
import { groupOutcomesByHost, groupReasons, percentOf } from "$lib/diagnostics-groups";
import {
  beginSettingsRead,
  onSettingsSnapshot,
  settingsRequest,
  createLatestGate,
} from "$lib/settings-api";
import { useSettingsText } from "$lib/i18n/settings";
import { formatDate } from "$lib/format";
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
type Snapshot = CaptureSnapshot;

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
  /** Runs Retry now for one host. The confirm dialog in the capture controls calls this. */
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
      return { success: true };
    } catch (cause) {
      setError((cause as Error).message);
      return { success: false, error: (cause as Error).message };
    }
  }
  return (
    <section
      className="space-y-4 rounded-xl border border-border bg-card p-4"
      aria-label={s("Capture diagnostics")}
    >
      <h2 className="text-section-title font-semibold">{s("Capture diagnostics")}</h2>
      <div className="flex flex-wrap items-center gap-2 pb-2 text-sm">
        <Label htmlFor="diagnostics-range">{s("Time range")}</Label>
        <Select
          id="diagnostics-range"
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
        <Label htmlFor="diagnostics-host">{s("Host")}</Label>
        <Select
          id="diagnostics-host"
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
      </div>
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
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="gap-1 px-1 font-medium"
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
                        {open ? (
                          <ChevronDown aria-hidden="true" />
                        ) : (
                          <ChevronRight className="rtl:rotate-180" aria-hidden="true" />
                        )}
                        {hostName(hostRow.host)}
                        <span className="text-xs font-normal text-muted-foreground">
                          ({hostRow.models.length}{" "}
                          {s(hostRow.models.length === 1 ? "model" : "models")})
                        </span>
                      </Button>
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
                "Why the reply ended",
                "Reply parts",
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
                  formatDate(row.timestamp),
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
      <CaptureControls
        snapshot={snapshot}
        queue={data?.retryQueue}
        readQueue={async () =>
          (await settingsRequest<Diagnostics>(diagnosticsPath(days, host))).retryQueue
        }
        traces={traces}
        note={retryNote}
        onRetry={retryNow}
        onChanged={async () => {
          // A saved retention change can empty the queue, so an earlier Retry now note is stale.
          setRetryNote("");
          await refresh(days, host);
        }}
      />
    </section>
  );
}
