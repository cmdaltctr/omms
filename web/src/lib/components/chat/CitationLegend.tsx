import { useI18n } from "$lib/i18n";
import type { CitationLetter } from "$lib/chat-skills";
import { cn } from "$lib/utils";
import { citationColours } from "./CitationChip";

const LEGEND_KEY = {
  S: "chat-legend-memory",
  P: "chat-legend-profile",
  K: "chat-legend-skill",
} as const;

function LegendItem({ label, text }: { label: CitationLetter; text: string }) {
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

/** One line above the thread that says what the letters in a citation stand for. */
export function CitationLegend({ letters }: { letters: CitationLetter[] }) {
  const { t } = useI18n();
  return (
    <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {letters.map((letter) => (
        <LegendItem key={letter} label={letter} text={t(LEGEND_KEY[letter])} />
      ))}
    </p>
  );
}
