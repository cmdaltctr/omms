import { useState } from "react";
import { Button } from "$lib/components/ui/button";
import { useSettingsText } from "$lib/i18n/settings";
import { formatDate } from "$lib/format";
import { skillsApi, type FailedCall, type TurnSummary } from "$lib/skills-api";
import { fill } from "$lib/skills-model";
import { FailedCallsDialog } from "./FailedCallsDialog";

/** The failed-call label of one row; the request starts when the dialog opens. */
function FailedCallsButton({ turn }: { turn: TurnSummary }) {
  const s = useSettingsText();
  const label = fill(
    s(turn.failedToolCalls === 1 ? "{count} failed tool call" : "{count} failed tool calls"),
    { count: turn.failedToolCalls }
  );
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [calls, setCalls] = useState<FailedCall[]>([]);
  const [error, setError] = useState("");

  async function openDialog() {
    setOpen(true);
    setLoading(true);
    setError("");
    const reply = await skillsApi.turnFailures(turn.id);
    setLoading(false);
    if (!reply.ok) {
      setError(reply.error);
      return;
    }
    setCalls(reply.data.failures);
  }

  return (
    <>
      <Button
        type="button"
        variant="link"
        aria-haspopup="dialog"
        className="h-auto p-0 text-xs font-normal text-destructive-label underline decoration-dotted underline-offset-2"
        onClick={() => void openDialog()}
      >
        {label}
      </Button>
      {open ? (
        <FailedCallsDialog
          title={label}
          calls={calls}
          loading={loading}
          loadError={error}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

/** Recorded turns as short rows: prompt preview, host, project, time and failed tool calls. */
export function TurnList({ turns }: { turns: TurnSummary[] }) {
  const s = useSettingsText();
  if (turns.length === 0) {
    return <p className="text-sm text-muted-foreground">{s("No recorded turns.")}</p>;
  }
  return (
    <ul className="space-y-3">
      {turns.map((turn) => (
        <li
          key={turn.id}
          className="min-w-0 space-y-1 rounded-xl border border-border bg-card px-3 py-2.5"
        >
          <p className="line-clamp-3 break-words text-sm" dir="auto">
            {turn.promptPreview || s("(empty prompt)")}
          </p>
          <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            <span>{formatDate(turn.createdAt)}</span>
            <span dir="ltr">{turn.host}</span>
            {turn.projectName ? <bdi>{turn.projectName}</bdi> : null}
            {turn.failedToolCalls > 0 ? <FailedCallsButton turn={turn} /> : null}
          </p>
        </li>
      ))}
    </ul>
  );
}
