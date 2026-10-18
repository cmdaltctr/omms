import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { Button } from "$lib/components/ui/button";
import { settingsRequest } from "$lib/settings-api";
import { useSettingsText } from "$lib/i18n/settings";
import { logQuery, recordsToText, type LevelFilter, type LogTail } from "$lib/log-records";
import { LogPanel } from "./LogPanel";

const POLL_MS = 5000;
const LEVEL_CHIPS: { level: LevelFilter; label: string }[] = [
  { level: "all", label: "All" },
  { level: "warn", label: "Warning" },
  { level: "error", label: "Error" },
];

/** True while the node is on screen and the browser tab is in front. */
function useOnScreen(ref: RefObject<HTMLElement | null>): boolean {
  const [shown, setShown] = useState(true);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    let intersecting = true;
    let tabVisible = document.visibilityState === "visible";
    const update = () => setShown(intersecting && tabVisible);
    const observer =
      typeof IntersectionObserver === "undefined"
        ? undefined
        : new IntersectionObserver(([entry]) => {
            intersecting = entry?.isIntersecting ?? true;
            update();
          });
    observer?.observe(node);
    const onVisibility = () => {
      tabVisible = document.visibilityState === "visible";
      update();
    };
    document.addEventListener("visibilitychange", onVisibility);
    update();
    return () => {
      observer?.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [ref]);
  return shown;
}

export function LogSection() {
  const s = useSettingsText();
  const section = useRef<HTMLElement>(null);
  const latest = useRef(0);
  const [level, setLevel] = useState<LevelFilter>("all");
  const [captureOnly, setCaptureOnly] = useState(false);
  const [paused, setPaused] = useState(false);
  const [log, setLog] = useState<LogTail>();
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const onScreen = useOnScreen(section);

  const load = useCallback(async () => {
    const request = ++latest.current;
    try {
      const tail = await settingsRequest<LogTail>(logQuery(level, captureOnly));
      if (request !== latest.current) return;
      setLog(tail);
      setError("");
    } catch (cause) {
      if (request === latest.current) setError((cause as Error).message);
    }
  }, [level, captureOnly]);

  // A changed filter reads again at once. While paused the shown records stay
  // frozen: a read already in flight is dropped, and Resume reads with the
  // filter chosen meanwhile.
  useEffect(() => {
    if (paused) {
      latest.current++;
      return;
    }
    void load();
  }, [load, paused]);

  useEffect(() => {
    if (paused || !onScreen) return;
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [paused, onScreen, load]);

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  const records = log?.records ?? [];
  const emptyText =
    level === "all" && !captureOnly
      ? s("No log has been written yet.")
      : s("No matching log records.");

  return (
    <section
      ref={section}
      className="space-y-3 rounded-xl border border-border bg-card p-4"
      aria-label={s("Log")}
    >
      <h2 className="text-section-title font-semibold">{s("Log")}</h2>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <div role="group" aria-label={s("Level")} className="flex gap-1.5">
          {LEVEL_CHIPS.map((chip) => (
            <Button
              key={chip.level}
              type="button"
              size="sm"
              variant={level === chip.level ? "default" : "outline"}
              aria-pressed={level === chip.level}
              onClick={() => setLevel(chip.level)}
            >
              {s(chip.label)}
            </Button>
          ))}
        </div>
        <label>
          <input
            type="checkbox"
            checked={captureOnly}
            onChange={(event) => setCaptureOnly(event.target.checked)}
          />{" "}
          {s("Capture attempts only")}
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-pressed={paused}
          onClick={() => setPaused(!paused)}
        >
          {paused ? s("Resume") : s("Pause")}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => void load()}>
          {s("Refresh")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={records.length === 0}
          onClick={() => void copy(recordsToText(records))}
        >
          {s("Copy visible records")}
        </Button>
        {log && (
          <Button type="button" size="sm" variant="outline" onClick={() => void copy(log.path)}>
            {s("Copy log path")}
          </Button>
        )}
        <span role="status" className="text-xs text-muted-foreground">
          {copied ? s("Copied") : paused ? s("Paused") : ""}
        </span>
      </div>
      <p dir="ltr" className="break-all text-start font-mono text-xs text-muted-foreground">
        {log?.path}
      </p>
      {error && <p role="alert">{error}</p>}
      <LogPanel
        records={records}
        label={s("Log lines")}
        emptyText={log ? emptyText : s("Loading log…")}
      />
    </section>
  );
}
