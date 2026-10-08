import { hostLabel } from "$lib/host-label";
import { useSettingsText } from "$lib/i18n/settings";
import type { ImportCounts, ImportJob } from "./import-types";

/** Keep memory work and profile analysis counts separate. */
export function workCounts(counts: ImportCounts, s: (message: string) => string): string {
  const summary = counts.summary;
  const profile = summary?.profile;
  return [
    ["sessions", counts.sessions],
    ["Memory units", summary?.unitsTotal ?? counts.total],
    ["Pending memory units", summary?.unitsWouldImport],
    ["Imported memory units", summary?.unitsImported],
    ["Already handled memory units", summary?.unitsAlreadyHandled],
    ["Skipped memory units", summary?.unitsSkipped],
    ["Failed memory units", summary?.unitsFailed],
    ["Held-back turns", summary?.unitsHeldBack],
    ["Untimed turns", summary?.unitsUntimed],
    ["Load errors", summary?.loadErrors],
    ["Profile prompts", profile ? profile.promptsRecorded + profile.promptsWouldRecord : undefined],
    ["Already handled profile prompts", profile?.promptsAlreadyHandled],
    ["Profile batches", profile?.batchesBuilt],
    ["Estimated profile analysis calls", counts.profileEstimate?.analysisCalls],
    ["Waiting prompts inside OMMS", counts.profileEstimate?.waitingPrompts],
    ["Unresolved sessions", summary?.unresolved],
  ]
    .filter(([, value]) => value !== undefined)
    .map(([label, value]) => `${s(String(label))}: ${value}`)
    .join(" · ");
}

/** Translate controlled feedback without translating hosts or metadata reason codes. */
export function importFeedback(message: string, s: (message: string) => string) {
  const prefix = message.match(/^(Pi|OpenCode|Claude Code): /);
  const body = prefix ? message.slice(prefix[0].length) : message;
  const retry = "Refresh the preview and retry.";
  const hasRetry = body.endsWith(` ${retry}`);
  const reason = hasRetry ? body.slice(0, -retry.length - 1) : body;
  const code = hasRetry && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*\.$/.test(reason);
  const translated = s(reason);
  return (
    <>
      {prefix && (
        <>
          <bdi dir="ltr">{prefix[1]}</bdi>
          {": "}
        </>
      )}
      {code ? (
        <>
          <bdi dir="ltr">{reason.slice(0, -1)}</bdi>
          {"."}
        </>
      ) : translated === reason ? (
        <bdi dir="ltr">{reason}</bdi>
      ) : (
        translated.split(/(Pi|OpenCode|Claude Code)/).map((part, index) =>
          /^(Pi|OpenCode|Claude Code)$/.test(part) ? (
            <bdi dir="ltr" key={index}>
              {part}
            </bdi>
          ) : (
            part
          )
        )
      )}
      {hasRetry && <> {s(retry)}</>}
    </>
  );
}

export function ImportResults({ job }: { job: ImportJob | null }) {
  const s = useSettingsText();
  if (!job) return null;
  const hosts = job.hosts ?? (job.host ? [{ ...job, host: job.host }] : []);
  return (
    <div role="status" className="space-y-3 text-sm" aria-label={s("Import results")}>
      <p>
        {s(job.dryRun ? "Preview (dry run)" : "Import")} · {s(job.state)}
        {job.activeHost && (
          <>
            {" "}
            · {s("Current host")}: {hostLabel(job.activeHost)}
          </>
        )}
      </p>
      <p>
        {s("Combined counts")}: {workCounts(job, s)}
      </p>
      <ul className="space-y-2">
        {hosts.map((child) => (
          <li key={child.host} className="rounded border border-border p-2">
            <p>
              {hostLabel(child.host)} ·{" "}
              {s(child.state === "no-work" ? "No work to process" : child.state)}
              {child.phase && (
                <>
                  {" "}
                  ·{" "}
                  {s(
                    child.phase === "profile"
                      ? "Learning profile"
                      : child.phase === "preparing"
                        ? "preparing"
                        : "Memory extraction"
                  )}
                </>
              )}
            </p>
            {child.phase === "profile" ? (
              <p>
                {s("Profile batches")}: {child.profileProcessed ?? 0}/{child.profileTotal ?? 0}
              </p>
            ) : (
              child.phase === "memory" &&
              child.total !== undefined && (
                <p>
                  {s("Memory units")}: {child.processed ?? 0}/{child.total}
                </p>
              )
            )}
            <p>{workCounts(child, s)}</p>
            {(child.error || child.blocker) && (
              <p role="alert">{importFeedback(child.error ?? child.blocker!, s)}</p>
            )}
            {child.report && (
              <pre
                dir="ltr"
                className="max-w-full overflow-auto whitespace-pre-wrap break-words rounded bg-background p-2 text-xs"
              >
                {child.report}
              </pre>
            )}
          </li>
        ))}
      </ul>
      {job.error && <p role="alert">{importFeedback(job.error, s)}</p>}
      {job.report && (
        <pre
          dir="ltr"
          className="max-w-full overflow-auto whitespace-pre-wrap break-words rounded bg-background p-2 text-xs"
        >
          {job.report}
        </pre>
      )}
      {job.dryRun && (
        <p className="text-xs text-muted-foreground">
          {s(
            "Analysis calls are an estimate. Matching, deduplication, retries, and newly waiting prompts can add calls."
          )}
        </p>
      )}
    </div>
  );
}
