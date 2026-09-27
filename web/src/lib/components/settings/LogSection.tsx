import { useEffect, useState } from "react";
import { settingsRequest } from "$lib/settings-api";
import { useSettingsText } from "$lib/i18n/settings";

type LogTail = { path: string; lines: string[] };

export function LogSection() {
  const s = useSettingsText();
  const [filter, setFilter] = useState(false);
  const [log, setLog] = useState<LogTail>();
  const [error, setError] = useState("");
  async function refresh(captureOnly: boolean) {
    try {
      setLog(
        await settingsRequest<LogTail>(
          `/api/settings/log?lines=200${captureOnly ? "&filter=capture" : ""}`
        )
      );
      setError("");
    } catch (cause) {
      setError((cause as Error).message);
    }
  }
  useEffect(() => {
    void refresh(filter);
  }, [filter]);
  return (
    <section
      className="space-y-3 rounded-xl border border-border bg-card p-4"
      aria-label={s("Log")}
    >
      <h2 className="text-lg font-medium">{s("Log")}</h2>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <label>
          <input
            type="checkbox"
            checked={filter}
            onChange={(event) => setFilter(event.target.checked)}
          />{" "}
          {s("Capture attempts only")}
        </label>
        <button
          type="button"
          className="rounded-lg border border-border px-3 py-1"
          onClick={() => void refresh(filter)}
        >
          {s("Refresh")}
        </button>
        {log && (
          <button
            type="button"
            className="rounded-lg border border-border px-3 py-1"
            onClick={() => void navigator.clipboard.writeText(log.path)}
          >
            {s("Copy log path")}
          </button>
        )}
      </div>
      <p className="break-all text-xs text-muted-foreground">{log?.path}</p>
      {error && <p role="alert">{error}</p>}
      <pre
        className="max-h-80 overflow-auto rounded-lg bg-background p-3 text-xs whitespace-pre-wrap break-words"
        aria-label={s("Log lines")}
      >
        {log
          ? log.lines.length
            ? log.lines.join("\n")
            : s("No log has been written yet.")
          : s("Loading log…")}
      </pre>
    </section>
  );
}
