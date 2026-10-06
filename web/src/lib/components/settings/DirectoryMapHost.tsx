import type { MapDecision } from "$lib/external-api-settings";
import { NO_DIRECTORY, rowTarget, type SuggestedDirectory } from "$lib/directory-maps";
import { hostLabel, type WebHost } from "$lib/host-label";
import { useSettingsText } from "$lib/i18n/settings";
import { Button } from "$lib/components/ui/button";
import { Input } from "$lib/components/ui/input";
import { ignoreReasonLabel } from "./DirectoryMapLabels";

type Props = {
  host: WebHost;
  rows: SuggestedDirectory[];
  decisions: Record<string, MapDecision>;
  busy: boolean;
  onDecide: (row: SuggestedDirectory, target: string) => void;
  onResolve: () => void;
  onIgnore: (row: SuggestedDirectory) => void;
};

/** Compact host review; drafts remain in the owning settings section. */
export function DirectoryMapHost({
  host,
  rows,
  decisions,
  busy,
  onDecide,
  onResolve,
  onIgnore,
}: Props) {
  const s = useSettingsText();
  const mappable = rows.filter((row) => row.directory !== NO_DIRECTORY);
  const withTarget = mappable.filter((row) =>
    rowTarget(row, decisions[row.directory]).trim()
  ).length;
  return (
    <details className="min-w-0 rounded-lg border border-border p-3">
      <summary
        id={`directory-maps-${host}`}
        className="scroll-mt-20 cursor-pointer rounded font-medium focus-visible:outline-2 focus-visible:outline-ring"
      >
        <h3 className="inline text-subsection-title font-semibold">
          {hostLabel(host)}: {s("Unresolved directories")}
        </h3>
        <span className="mt-1 block text-xs font-normal text-muted-foreground">
          {s("Directories")}: {mappable.length} · {s("Unresolved sessions")}:{" "}
          {rows.reduce((sum, row) => sum + row.sessions, 0)} · {s("Rows with a target")}:{" "}
          {withTarget}
        </span>
      </summary>
      <div className="mt-3 space-y-2">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {s("No unresolved directories in the latest run.")}
          </p>
        ) : (
          <div className="space-y-2">
            <div className="[&_button]:h-auto [&_button]:min-h-8 [&_button]:whitespace-normal [&_button]:py-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy || mappable.length === 0}
                onClick={onResolve}
              >
                {s("Smart resolve directories")}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {s(
                "Smart resolve shows each proposed map and ignore in a dialog. Tick the ones to keep, then press Confirm. Nothing is saved before that."
              )}
            </p>
          </div>
        )}
        {rows.map((row) => {
          if (row.directory === NO_DIRECTORY) {
            return (
              <p key="no-directory" className="text-sm text-muted-foreground">
                {s("No directory recorded")} ·{" "}
                {row.sessions === 1 ? s("1 session") : `${row.sessions} ${s("sessions")}`} ·{" "}
                {s("These sessions cannot be mapped.")}
              </p>
            );
          }
          const decision = decisions[row.directory];
          const target = rowTarget(row, decision);
          const ignoreProposal =
            !decision && row.suggestion?.kind === "ignore" ? row.suggestion : null;
          return (
            <div
              key={row.directory}
              className="flex min-w-0 items-start gap-2 border-t border-border pt-2 text-sm"
            >
              <details className="min-w-0 flex-1">
                <summary className="cursor-pointer rounded focus-visible:outline-2 focus-visible:outline-ring">
                  <code dir="ltr" className="break-all">
                    {row.directory}
                  </code>{" "}
                  · {row.sessions === 1 ? s("1 session") : `${row.sessions} ${s("sessions")}`}
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {ignoreProposal ? (
                      <>
                        {s("Suggested to ignore")}: {ignoreReasonLabel(s, ignoreProposal.reason)}
                      </>
                    ) : (
                      <>
                        {s("Target directory")}:{" "}
                        {target ? (
                          <code dir="ltr" className="break-all">
                            {target}
                          </code>
                        ) : (
                          s("No target chosen")
                        )}
                      </>
                    )}
                  </span>
                </summary>
                <div className="mt-2 space-y-2">
                  {!row.suggestion && (
                    <p className="text-xs text-muted-foreground">{s("No suggestion found.")}</p>
                  )}
                  <Input
                    aria-label={`${row.directory} ${s("Target directory")}`}
                    dir="ltr"
                    placeholder={s("Target directory")}
                    value={target}
                    disabled={busy}
                    onChange={(event) => onDecide(row, event.target.value)}
                  />
                </div>
              </details>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0"
                aria-label={`${s("Ignore")} ${row.directory}`}
                disabled={busy}
                onClick={() => onIgnore(row)}
              >
                {s("Ignore")}
              </Button>
            </div>
          );
        })}
      </div>
    </details>
  );
}
