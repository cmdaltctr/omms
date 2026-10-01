import type { ImportBadge } from "$lib/auto-import-settings";
import { useSettingsText } from "$lib/i18n/settings";
import { cn } from "$lib/utils";

/** A small pill with one host's import status. */
export function ImportStatusBadge({ badge }: { badge: ImportBadge }) {
  const s = useSettingsText();
  const [text, tone] = ((): [string, string] => {
    switch (badge.kind) {
      case "imported":
        return [`${s("Imported")} ✅`, "border-green-600/40 text-green-700"];
      case "partly":
        return [
          `${s("Partly imported")} (${badge.unresolved} ${s("unresolved")})`,
          "border-amber-500/50 text-amber-700",
        ];
      case "running":
        return [s("Running"), "border-primary/50 text-primary"];
      case "learning-profile":
        return [
          `${s("Learning profile")} ${badge.done} / ${badge.total}`,
          "border-primary/50 text-primary",
        ];
      case "paused":
        return [s("Paused"), "border-border text-muted-foreground"];
      case "stopped":
        return [
          `${s("Stopped")} (${badge.pending} ${s("pending")})`,
          "border-amber-500/50 text-amber-700",
        ];
      case "failed":
        return [`${s("Failed")} ⛔️`, "border-red-600/40 text-red-700"];
      case "not-started":
        return [s("Not started"), "border-border text-muted-foreground"];
    }
  })();
  return (
    <span
      className={cn("inline-block rounded-full border px-2 py-0.5 text-xs font-medium", tone)}
      title={badge.kind === "failed" && badge.error ? badge.error : undefined}
    >
      {text}
    </span>
  );
}
