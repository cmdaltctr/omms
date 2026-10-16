import { useState } from "react";
import { Button } from "$lib/components/ui/button";
import { useI18n } from "$lib/i18n";

type Hint = "low" | "same-cat";

type Props = {
  onSelectAll: () => void;
  onSelectNone: () => void;
  onSelectLow: () => void;
  onSelectSameCat: () => void;
};

/**
 * The selection shortcuts of the AI Cleanup dialog. Choosing Low Freq or Same Category
 * explains below the buttons which items it picked. Select All and Deselect All clear the note.
 */
export function CleanupSelectShortcuts({
  onSelectAll,
  onSelectNone,
  onSelectLow,
  onSelectSameCat,
}: Props) {
  const { t } = useI18n();
  const [hint, setHint] = useState<Hint | null>(null);

  const choose = (next: Hint | null, run: () => void) => () => {
    run();
    setHint(next);
  };

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        <Button variant="secondary" size="xs" onClick={choose(null, onSelectAll)}>
          {t("label-ai-cleanup-select-all")}
        </Button>
        <Button variant="secondary" size="xs" onClick={choose(null, onSelectNone)}>
          {t("label-ai-cleanup-deselect-all")}
        </Button>
        <Button
          variant="secondary"
          size="xs"
          aria-pressed={hint === "low"}
          onClick={choose("low", onSelectLow)}
        >
          {t("label-ai-cleanup-select-low")}
        </Button>
        <Button
          variant="secondary"
          size="xs"
          aria-pressed={hint === "same-cat"}
          onClick={choose("same-cat", onSelectSameCat)}
        >
          {t("label-ai-cleanup-select-same-cat")}
        </Button>
      </div>
      {hint ? (
        <p
          role="status"
          className="rounded-lg border border-border bg-muted px-3 py-2 text-xs text-muted-foreground"
        >
          {t(hint === "low" ? "label-ai-cleanup-hint-low" : "label-ai-cleanup-hint-same-cat")}
        </p>
      ) : null}
    </div>
  );
}
