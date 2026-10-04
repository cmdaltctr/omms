import type { MapDecision } from "$lib/external-api-settings";
import { NO_DIRECTORY, type SuggestedDirectory } from "$lib/directory-maps";
import { hostLabel, type WebHost } from "$lib/host-label";
import { useSettingsText } from "$lib/i18n/settings";
import { Button } from "$lib/components/ui/button";
import { Input } from "$lib/components/ui/input";

type ResolveNote = { filled: number; alreadySelected: number; notFilled: number };
type Props = {
  host: WebHost;
  rows: SuggestedDirectory[];
  decisions: Record<string, MapDecision>;
  busy: boolean;
  note?: ResolveNote;
  onDecide: (row: SuggestedDirectory, change: Partial<MapDecision>) => void;
  onSelect: () => void;
  onClear: () => void;
  onResolve: () => void;
};

/** Compact host review; drafts remain in the owning settings section. */
export function DirectoryMapHost({
  host,
  rows,
  decisions,
  busy,
  note,
  onDecide,
  onSelect,
  onClear,
  onResolve,
}: Props) {
  const s = useSettingsText();
  const mappable = rows.filter((row) => row.directory !== NO_DIRECTORY);
  const selected = mappable.filter((row) => decisions[row.directory]?.accepted).length;
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
          {rows.reduce((sum, row) => sum + row.sessions, 0)} · {s("Selected maps")}: {selected}
        </span>
      </summary>
      <div className="mt-3 space-y-2">
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {s("No unresolved directories in the latest run.")}
          </p>
        ) : (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2 [&_button]:h-auto [&_button]:min-h-8 [&_button]:whitespace-normal [&_button]:py-1.5">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy || mappable.length === 0}
                onClick={onResolve}
              >
                {s("Smart resolve directories")}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy || mappable.length === 0}
                onClick={onSelect}
              >
                {s("Select all with targets")}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy || selected === 0}
                onClick={onClear}
              >
                {s("Clear selection")}
              </Button>
            </div>
            {note && (
              <p role="status" aria-live="polite" className="text-xs">
                {s("Newly selected")}: {note.filled} · {s("Already selected")}:{" "}
                {note.alreadySelected} · {s("No suggestion")}: {note.notFilled}.{" "}
                {note.filled === 0 && s("No suggested targets were selected.")}{" "}
                {note.filled === 0 && note.alreadySelected > 0 && s("Maps are already selected.")}{" "}
                {note.notFilled > 0 && s("Choose targets for rows without suggestions.")}{" "}
                {selected > 0 && s("Check them, then press Save maps.")}
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              {s(
                "Finds the project each missing directory belongs to, mostly the main repository of a deleted worktree, and fills it in for you to check. Nothing is saved until you press Save maps."
              )}
            </p>
            <p className="text-xs text-muted-foreground">
              {s(
                "Selecting or clearing a shared directory updates every host. Clear selection keeps target text. Review targets, then press Save maps."
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
          const target = decision?.target ?? row.suggestion ?? "";
          return (
            <div
              key={row.directory}
              className="flex min-w-0 items-start gap-2 border-t border-border pt-2 text-sm"
            >
              <input
                type="checkbox"
                className="mt-1 shrink-0"
                aria-label={`${row.directory} ${s("Use this map")}`}
                checked={decision?.accepted ?? false}
                disabled={busy}
                onChange={(event) => onDecide(row, { accepted: event.target.checked })}
              />
              <details className="min-w-0 flex-1">
                <summary className="cursor-pointer rounded focus-visible:outline-2 focus-visible:outline-ring">
                  <code dir="ltr" className="break-all">
                    {row.directory}
                  </code>{" "}
                  · {row.sessions === 1 ? s("1 session") : `${row.sessions} ${s("sessions")}`}
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {s("Target directory")}:{" "}
                    {target ? (
                      <code dir="ltr" className="break-all">
                        {target}
                      </code>
                    ) : (
                      s("No target chosen")
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
                    onChange={(event) => onDecide(row, { target: event.target.value })}
                  />
                  <p className="text-xs text-muted-foreground">{s("Use this map")}</p>
                </div>
              </details>
            </div>
          );
        })}
      </div>
    </details>
  );
}
