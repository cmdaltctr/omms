import { useI18n } from "$lib/i18n";
import { cn } from "$lib/utils";

type Props = { label: string; deleted?: boolean; onOpen: () => void };

/** A citation marker such as [S1], shown as a small button that opens its source. */
export function CitationChip({ label, deleted, onOpen }: Props) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-label={t("chat-cite-label", { label })}
      onClick={onOpen}
      className={cn(
        "mx-0.5 inline-flex h-5 cursor-pointer items-center rounded-md border px-1.5 align-baseline text-[11px] font-medium tabular-nums transition-colors duration-200 ease-in focus-visible:outline-2 focus-visible:outline-ring",
        label.startsWith("P")
          ? "border-blue-600/40 bg-blue-500/10 text-blue-700 hover:bg-blue-500/20 dark:text-blue-400"
          : "border-primary/30 bg-primary/10 text-primary-label hover:bg-primary/20",
        deleted && "line-through opacity-70"
      )}
    >
      {label}
    </button>
  );
}
