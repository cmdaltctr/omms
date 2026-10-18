import { useI18n } from "$lib/i18n";
import { cn } from "$lib/utils";
import { citationColours } from "./CitationChip";

function LegendItem({ label, text }: { label: "S" | "P"; text: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className={cn(
          "inline-flex h-5 items-center rounded-md border px-1.5 text-[11px] font-medium",
          citationColours(label)
        )}
      >
        {label}
      </span>
      <span dir="auto">{text}</span>
    </span>
  );
}

/** One line above the thread that says what the S and P in a citation stand for. */
export function CitationLegend() {
  const { t } = useI18n();
  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <LegendItem label="S" text={t("chat-legend-memory")} />
      <LegendItem label="P" text={t("chat-legend-profile")} />
    </p>
  );
}
