import { useSettingsText } from "$lib/i18n/settings";
import { formatDate } from "$lib/format";
import type { TurnSummary } from "$lib/skills-api";
import { fill } from "$lib/skills-model";

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
            {turn.failedToolCalls > 0 ? (
              <span className="text-destructive-label">
                {fill(
                  s(
                    turn.failedToolCalls === 1
                      ? "{count} failed tool call"
                      : "{count} failed tool calls"
                  ),
                  {
                    count: turn.failedToolCalls,
                  }
                )}
              </span>
            ) : null}
          </p>
        </li>
      ))}
    </ul>
  );
}
