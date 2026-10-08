import { useEffect, useState } from "react";
import { settingsRequest } from "$lib/settings-api";
import { useSettingsText } from "$lib/i18n/settings";

export type CatchUpJob = {
  state: "idle" | "running" | "paused" | "done" | "failed" | "superseded";
  batchesBuilt: number;
  remaining: number;
  reason?: string;
};
export type CatchUpPreview = { waiting: number; calls: number };

/** Waiting prompts, progress, Pause or Resume, and the reason after a failure. */
export function CatchUpStatus({
  preview,
  job,
  busy,
  onStart,
  onPause,
}: {
  preview: CatchUpPreview;
  job: CatchUpJob;
  busy: boolean;
  onStart: () => void;
  onPause: () => void;
}) {
  const s = useSettingsText();
  const running = job.state === "running";
  return (
    <div className="space-y-2 text-sm">
      <p>
        {s("Prompts waiting for profile learning")}: {preview.waiting} ·{" "}
        {s("Estimated profile analysis calls")}: {preview.calls}
      </p>
      {job.state !== "idle" && (
        <p role="status">
          {s("Batches done")}: {job.batchesBuilt} · {s("Prompts waiting")}: {job.remaining}
          {job.state === "paused" && ` · ${s("Paused")}`}
          {job.state === "done" && ` · ${s("Finished")}`}
        </p>
      )}
      {job.state === "superseded" && <p>{s("A newer catch-up run took over.")}</p>}
      {job.state === "failed" && (
        <p className="text-red-600">
          {s("Stopped")}: {job.reason ?? "error"}
        </p>
      )}
      {running ? (
        <button
          type="button"
          className="rounded border border-border px-3 py-1.5"
          onClick={onPause}
        >
          {s("Pause")}
        </button>
      ) : (
        <button
          type="button"
          className="rounded border border-border px-3 py-1.5"
          disabled={busy || preview.waiting === 0}
          onClick={onStart}
        >
          {s(job.state === "idle" || job.state === "done" ? "Analyse waiting prompts" : "Resume")}
        </button>
      )}
    </div>
  );
}

export function ProfileCatchUpSection({ onReanalyse }: { onReanalyse?: () => void } = {}) {
  const s = useSettingsText();
  const [preview, setPreview] = useState<CatchUpPreview>();
  const [job, setJob] = useState<CatchUpJob>({ state: "idle", batchesBuilt: 0, remaining: 0 });
  const [local, setLocal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function load() {
    const value = await settingsRequest<{ preview: CatchUpPreview; job: CatchUpJob }>(
      "/api/settings/profile/catch-up"
    );
    setPreview(value.preview);
    setJob(value.job);
  }
  useEffect(() => {
    void load().catch((cause: Error) => setError(cause.message));
    void settingsRequest<{ isLocal?: boolean }>("/api/web/status")
      .then((status) => setLocal(Boolean(status.isLocal)))
      .catch(() => {});
  }, []);
  useEffect(() => {
    if (job.state !== "running") return;
    const timer = setInterval(() => void load().catch(() => {}), 2000);
    return () => clearInterval(timer);
  }, [job.state]);

  async function start() {
    if (!preview) return;
    const resume = job.state !== "idle" && job.state !== "done";
    if (
      !window.confirm(
        `${s("Start profile learning for the waiting prompts? Model calls")}: ${preview.calls}`
      )
    )
      return;
    setBusy(true);
    try {
      setJob(
        await settingsRequest<CatchUpJob>(
          `/api/settings/profile/catch-up/${resume ? "resume" : "start"}`,
          { method: "POST", body: "{}" }
        )
      );
      setError("");
    } catch (cause) {
      setError((cause as Error).message);
    }
    setBusy(false);
  }
  async function pause() {
    try {
      setJob(
        await settingsRequest<CatchUpJob>("/api/settings/profile/catch-up/pause", {
          method: "POST",
          body: "{}",
        })
      );
    } catch (cause) {
      setError((cause as Error).message);
    }
  }

  return (
    <section
      className="space-y-3 rounded-xl border border-border bg-card p-4"
      aria-label={s("Profile learning")}
    >
      <h2 className="text-section-title font-semibold">{s("Profile learning")}</h2>
      <p className="text-sm text-muted-foreground">
        {s(
          "Analyse waiting prompts reads prompts already inside OMMS with the saved external API, 50 eligible prompts per analysis call. Completed history is not re-analysed. Preferences, patterns, and workflows are the outputs."
        )}
      </p>
      <p className="text-sm text-muted-foreground">
        {s(
          "Analysis calls are an estimate. Matching, deduplication, retries, and newly waiting prompts can add calls."
        )}
      </p>
      <p className="text-sm text-muted-foreground">
        {s(
          "Re-analyse chat history opens a forced profile-only import. It preserves your profile and project memories. Preview and confirmation are required. Each profile prompt can be forcibly re-analysed once."
        )}
      </p>
      {onReanalyse && (
        <button
          type="button"
          className="rounded border border-border px-3 py-1.5 text-sm"
          onClick={onReanalyse}
        >
          {s("Re-analyse chat history")}
        </button>
      )}
      {preview &&
        (local ? (
          <CatchUpStatus
            preview={preview}
            job={job}
            busy={busy}
            onStart={() => void start()}
            onPause={() => void pause()}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            {s("Open this page on the computer that runs OMMS to start a catch-up run.")}
          </p>
        ))}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
