import { useState } from "react";
import { Loader } from "lucide-react";
import { useSettingsConfirm } from "@/hooks/useSettingsConfirm";
import { useSettingsChanges } from "@/hooks/useSettingsChanges";
import { Button } from "$lib/components/ui/button";
import { Checkbox } from "$lib/components/ui/checkbox";
import { Input } from "$lib/components/ui/input";
import { SettingsChangeList } from "$lib/components/settings/SettingsChangeList";
import { hostLabel, type WebHost } from "$lib/host-label";
import { useCardText } from "$lib/i18n/settings-cards";
import { settingsRequest } from "$lib/settings-api";
import { saveSettingEdits } from "$lib/settings-save";
import { SettingRow } from "./SettingRow";

type Setting = { value?: unknown; source?: string; globalValue?: unknown };
export type CaptureSnapshot = {
  revision: string;
  readOnly?: boolean;
  settings: Record<string, Setting | undefined>;
};
export type Trace = { file: string; size: number };

const HOSTS = ["pi", "opencode", "claude-code"] as const;
const DAY_KEYS = ["captureTraceRetentionDays", "captureAttemptRetentionDays"] as const;
const HOURS_KEY = "captureRetryRetentionHours";
const ALL_KEYS = [...DAY_KEYS, HOURS_KEY] as const;
const LABELS = {
  captureTraceRetentionDays: "Trace retention (days)",
  captureAttemptRetentionDays: "Attempt retention (days)",
  [HOURS_KEY]: "Retry retention (hours)",
} as const;

/** A whole number inside the range, or null. */
function whole(text: string, min: number, max = Number.MAX_SAFE_INTEGER): number | null {
  const value = Number(text);
  return text.trim() !== "" && Number.isSafeInteger(value) && value >= min && value <= max
    ? value
    : null;
}

/**
 * The capture trace switch, the retention fields, the retry queue and the trace files of the
 * Capture diagnostics card. The switch and the three retention fields save together with one
 * Save button, and every save asks first: a plain change lists what changes, while a change that
 * deletes data keeps its own dialog: turning the retry queue off (0 hours) names how many turns
 * wait, and turning traces on warns that traces can hold conversation text.
 */
export function CaptureControls({
  snapshot,
  queue,
  readQueue,
  traces,
  note,
  onRetry,
  onChanged,
}: {
  snapshot: CaptureSnapshot | undefined;
  /** Turns waiting for a retry, per host. Undefined when the count could not be read. */
  queue: Record<WebHost, number> | undefined;
  /** Reads the waiting count again, so the retry-off dialog names the count at Save time. */
  readQueue: () => Promise<Record<WebHost, number> | undefined>;
  traces: Trace[];
  /** What the last Retry now did. */
  note: string;
  /** Runs Retry now for one host, and reports whether the run started. */
  onRetry: (host: WebHost) => Promise<{ success: boolean; error?: string }>;
  /** Reload what the card shows after a save or a deleted file. */
  onChanged: () => Promise<void>;
}) {
  const t = useCardText();
  const { ask, dialog } = useSettingsConfirm();
  const { changes, name } = useSettingsChanges();
  const [trace, setTrace] = useState<boolean>();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [view, setView] = useState("");

  const settings = snapshot?.settings;
  const saved = (key: string, fallback: number) => Number(settings?.[key]?.globalValue ?? fallback);
  const draft = (key: string, fallback: number) => drafts[key] ?? String(saved(key, fallback));
  const readOnly = snapshot?.readOnly === true;
  const retryHours = saved(HOURS_KEY, 72);

  const parsed = {
    captureTraceRetentionDays: whole(draft("captureTraceRetentionDays", 30), 1),
    captureAttemptRetentionDays: whole(draft("captureAttemptRetentionDays", 30), 1),
    [HOURS_KEY]: whole(draft(HOURS_KEY, 72), 0, 720),
  };
  const invalid = Object.values(parsed).some((value) => value === null);
  const traceOn = trace ?? settings?.captureTrace?.globalValue === true;
  const edits: Record<string, unknown> = {};
  if (traceOn !== (settings?.captureTrace?.globalValue === true)) edits.captureTrace = traceOn;
  for (const key of ALL_KEYS) {
    const next = parsed[key];
    if (next !== null && next !== saved(key, key === HOURS_KEY ? 72 : 30)) edits[key] = next;
  }
  const changed = Object.keys(edits).length > 0;
  const retentionInWords = (hours: boolean, value: unknown) =>
    value == null
      ? t("Not set")
      : hours
        ? t("{count} hours", { count: String(value) })
        : t("{count} days", { count: String(value) });
  const fields = [
    { key: "captureTrace", label: name("captureTrace") },
    ...ALL_KEYS.map((key) => ({
      key,
      label: name(key),
      print: (value: unknown) => retentionInWords(key === HOURS_KEY, value),
    })),
  ];
  const inForce: Record<string, unknown> = {
    captureTrace: settings?.captureTrace?.globalValue === true,
    ...Object.fromEntries(ALL_KEYS.map((key) => [key, saved(key, key === HOURS_KEY ? 72 : 30)])),
  };

  async function commit() {
    const result = await saveSettingEdits(snapshot!.revision, edits);
    setFailed(!result.success);
    if (result.success) {
      setTrace(undefined);
      setDrafts({});
      setMessage(t("Saved."));
      await onChanged();
    }
    return result;
  }

  async function save() {
    if (!snapshot || !changed || invalid) return;
    setMessage("");
    const queueOff = edits[HOURS_KEY] === 0;
    const traceOnNow = edits.captureTrace === true;
    if (!queueOff && !traceOnNow) {
      ask({
        title: t("Save retention?"),
        body: <SettingsChangeList changes={changes(inForce, edits, fields)} />,
        confirmLabel: t("Save retention"),
        busyLabel: t("Saving…"),
        run: async () => {
          setBusy(true);
          const result = await commit();
          setBusy(false);
          if (!result.success) setMessage(result.error ?? "");
          return result;
        },
      });
      return;
    }
    let fresh: Record<WebHost, number> | undefined;
    if (queueOff) {
      setBusy(true);
      fresh = await readQueue().catch(() => undefined);
      setBusy(false);
    }
    const waiting = fresh ? HOSTS.reduce((sum, host) => sum + (fresh[host] ?? 0), 0) : null;
    const sentences: string[] = [];
    if (queueOff) {
      sentences.push(
        waiting === 0
          ? t("No turn is waiting. The queue stays off until you set a number of hours again.")
          : waiting === 1
            ? t(
                "1 waiting turn will be deleted. The queue stays off until you set a number of hours again."
              )
            : t(
                "{count} waiting turns will be deleted. The queue stays off until you set a number of hours again.",
                { count: waiting ?? 0 }
              )
      );
    }
    if (traceOnNow) {
      sentences.push(
        t(
          "Traces save parts of your conversations. OMMS hides keys and text you marked private, but the rest is saved. Keep tracing off unless you need it to find a problem."
        )
      );
    }
    ask({
      title: t(queueOff ? "Turn off the retry queue?" : "Turn on trace saving?"),
      body: (
        <>
          {sentences.map((sentence) => (
            <p key={sentence}>{sentence}</p>
          ))}
        </>
      ),
      confirmLabel: t(queueOff ? "Turn off and delete" : "Turn on"),
      busyLabel: t("Saving…"),
      destructive: queueOff,
      blocked:
        queueOff && waiting === null
          ? t(
              "OMMS could not count the waiting turns, so it will not turn the queue off. Try again."
            )
          : undefined,
      run: commit,
    });
  }

  /** Asks first: Retry now sends the waiting turns of one host to the model again. */
  function retryNow(host: WebHost) {
    ask({
      title: t("Retry waiting turns?"),
      body: <p>{t("The waiting turns will be sent to the model again.")}</p>,
      confirmLabel: t("Retry now"),
      busyLabel: t("Retrying…"),
      run: () => onRetry(host),
    });
  }

  async function openTrace(name: string) {
    try {
      const result = await settingsRequest<{ content: string }>(
        `/api/settings/traces/${encodeURIComponent(name)}`
      );
      setView(result.content);
    } catch (cause) {
      setFailed(true);
      setMessage((cause as Error).message);
    }
  }

  function removeTrace(name: string) {
    ask({
      title: t("Delete trace file?"),
      body: <bdi dir="ltr">{name}</bdi>,
      confirmLabel: t("Delete"),
      busyLabel: t("Saving…"),
      destructive: true,
      run: async () => {
        try {
          await settingsRequest(`/api/settings/traces/${encodeURIComponent(name)}`, {
            method: "DELETE",
          });
          setView("");
          await onChanged();
          return { success: true };
        } catch (cause) {
          return { success: false, error: (cause as Error).message };
        }
      },
    });
  }

  const projectTraceOff = settings?.captureTrace?.source === "project";
  return (
    <div className="space-y-4 border-t border-border pt-3 text-sm">
      <SettingRow setting="captureTrace" controlId="capture-trace" projectNote={projectTraceOff}>
        <Checkbox
          id="capture-trace"
          checked={traceOn}
          disabled={!snapshot || busy}
          onCheckedChange={(checked) => setTrace(checked === true)}
        />
      </SettingRow>
      <p className="text-xs text-muted-foreground">
        {t(
          "Traces save parts of your conversations. OMMS hides keys and text you marked private, but the rest is saved. Keep tracing off unless you need it to find a problem."
        )}
      </p>
      {ALL_KEYS.map((key) => {
        const fallback = key === HOURS_KEY ? 72 : 30;
        const problem = parsed[key] === null;
        return (
          <SettingRow key={key} setting={key} controlId={`capture-${key}`}>
            <Input
              id={`capture-${key}`}
              type="number"
              min={key === HOURS_KEY ? 0 : 1}
              max={key === HOURS_KEY ? 720 : undefined}
              inputMode="numeric"
              aria-label={t(LABELS[key])}
              aria-invalid={problem}
              aria-describedby={problem ? `capture-${key}-problem` : undefined}
              value={draft(key, fallback)}
              disabled={!snapshot || busy}
              onChange={(event) => {
                setDrafts({ ...drafts, [key]: event.target.value });
                setMessage("");
              }}
            />
            {problem ? (
              <p id={`capture-${key}-problem`} className="mt-1 text-xs text-destructive-label">
                {t(
                  key === HOURS_KEY
                    ? "Use a whole number of hours from 0 to 720."
                    : "Use a whole number of days, 1 or more."
                )}
              </p>
            ) : null}
          </SettingRow>
        );
      })}
      <p className="text-xs text-muted-foreground">
        {t(
          "When the capture model cannot be reached, OMMS keeps the turn and tries again later. Waiting turns hold parts of your conversations, with keys and text you marked private hidden. 0 turns the queue off and deletes waiting turns."
        )}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          disabled={busy || !snapshot || readOnly || !changed || invalid}
          onClick={() => void save()}
        >
          {t("Save retention")}
        </Button>
        {readOnly ? (
          <p className="text-xs text-muted-foreground">
            {t("Saving is turned off until the file is fixed.")}
          </p>
        ) : null}
        {busy ? (
          <p role="status" className="flex items-center gap-2 text-muted-foreground">
            <Loader className="size-4 animate-spin" aria-hidden="true" />
            {t("Saving…")}
          </p>
        ) : null}
        {message ? (
          <p role={failed ? "alert" : "status"} className="text-sm">
            {message}
          </p>
        ) : null}
      </div>
      <h3 className="text-subsection-title font-semibold">{t("Turns waiting for retry")}</h3>
      {HOSTS.map((host) => {
        const count = queue?.[host] ?? 0;
        return (
          <div className="flex items-center gap-2" key={host}>
            <span className="w-24">{hostLabel(host)}</span>
            <span className="tabular-nums">{count}</span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={count === 0 || retryHours === 0}
              onClick={() => retryNow(host)}
            >
              {t("Retry now")}
            </Button>
          </div>
        );
      })}
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
      <h3 className="text-subsection-title font-semibold">{t("Trace files")}</h3>
      {traces.map((file) => (
        <div className="flex flex-wrap items-center gap-2" key={file.file}>
          <span>
            <bdi dir="ltr">{file.file}</bdi> ({file.size} bytes)
          </span>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void openTrace(file.file)}
          >
            {t("View")}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => removeTrace(file.file)}>
            {t("Delete")}
          </Button>
        </div>
      ))}
      {view && (
        <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words rounded bg-background p-2 text-xs">
          {view}
        </pre>
      )}
      {dialog}
    </div>
  );
}
