import { History } from "lucide-react";
import { Button } from "$lib/components/ui/button";
import { useSettingsText } from "$lib/i18n/settings";
import { fill, jobEnded, jobPercent, recordedTurns, countText } from "$lib/skills-model";
import { useRecordPast } from "./use-record-past";

/** Record past turns: the button, progress while it runs, and the count when it ends. */
export function RecordPast({ onEnd }: { onEnd: () => void }) {
  const s = useSettingsText();
  const { job, running, starting, error, start } = useRecordPast(onEnd);
  const percent = job ? jobPercent(job) : 0;
  return (
    <div className="space-y-3">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={running || starting}
        onClick={() => void start()}
      >
        <History aria-hidden="true" />
        {s("Record past turns")}
      </Button>
      {running && job ? (
        <div className="space-y-1 text-sm">
          <div
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-label={s("Record past turns")}
            className="h-2 w-full overflow-hidden rounded bg-muted"
          >
            <div className="h-full bg-primary" style={{ width: `${percent}%` }} />
          </div>
          <p className="text-muted-foreground">
            {s("Skill turns")}: {countText(job.processed ?? 0)} / {countText(job.total ?? 0)} ·{" "}
            {percent}%
          </p>
        </div>
      ) : null}
      {job && jobEnded(job) ? (
        <p role="status" className="text-sm">
          {job.state === "done"
            ? fill(s("Recorded {count} past turns."), { count: countText(recordedTurns(job)) })
            : s("Record past turns did not finish.")}
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive-label">
          {error}
        </p>
      ) : null}
    </div>
  );
}
