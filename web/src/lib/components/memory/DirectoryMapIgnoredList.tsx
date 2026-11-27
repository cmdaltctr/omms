import { Button } from "$lib/components/ui/button";
import { useSettingsText } from "$lib/i18n/settings";

type Props = {
  ignored?: string[];
  restoreDisabled: boolean;
  onRestore: (directory: string) => void;
};

/** The Ignored directories disclosure; each Restore asks before it saves. */
export function DirectoryMapIgnoredList({ ignored, restoreDisabled, onRestore }: Props) {
  const s = useSettingsText();
  return (
    <details className="min-w-0 rounded-lg border border-border p-3">
      <summary className="cursor-pointer rounded font-medium focus-visible:outline-2 focus-visible:outline-ring">
        <h3 className="inline text-subsection-title font-semibold">{s("Ignored directories")}</h3> ·{" "}
        {ignored?.length ?? 0}
        <span className="mt-1 block text-xs font-normal text-muted-foreground">
          {s("Ignored directories stay unimported and leave the unresolved counts.")}
        </span>
      </summary>
      <ul className="mt-3 space-y-1 text-sm">
        {!ignored?.length && <li className="text-muted-foreground">{s("none")}</li>}
        {ignored?.map((directory) => (
          <li key={directory} className="flex min-w-0 items-start gap-2">
            <code dir="ltr" className="min-w-0 flex-1 break-all">
              {directory}
            </code>
            <Button
              type="button"
              variant="outline"
              size="xs"
              className="shrink-0"
              aria-label={`${s("Restore")} ${directory}`}
              disabled={restoreDisabled}
              onClick={() => onRestore(directory)}
            >
              {s("Restore")}
            </Button>
          </li>
        ))}
      </ul>
    </details>
  );
}
