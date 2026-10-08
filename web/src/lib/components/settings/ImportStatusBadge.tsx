import type { ImportBadge } from "$lib/auto-import-settings";
import { useSettingsText } from "$lib/i18n/settings";
import { cn } from "$lib/utils";
import { hostLabel, type WebHost } from "$lib/host-label";
import { revealDirectoryMaps } from "$lib/directory-map-navigation";

/** A small pill with one host's import status. */
export function ImportStatusBadge({ badge, host }: { badge: ImportBadge; host: WebHost }) {
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
  const className = cn("inline-block rounded-full border px-2 py-0.5 text-xs font-medium", tone);
  if (badge.kind === "partly") {
    return (
      <a
        href={`/memory#directory-maps-${host}`}
        onClick={(event) => {
          event.preventDefault();
          revealDirectoryMaps(host);
        }}
        aria-label={`${hostLabel(host)}: ${s("Resolve missing project folders")}. ${text}`}
        className={cn(className, "underline focus-visible:outline-2 focus-visible:outline-ring")}
      >
        {text}
      </a>
    );
  }
  return (
    <span
      className={className}
      title={badge.kind === "failed" && badge.error ? badge.error : undefined}
    >
      {text}
    </span>
  );
}
