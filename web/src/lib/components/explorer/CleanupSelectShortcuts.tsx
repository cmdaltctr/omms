import { useState } from "react";
import { Button } from "$lib/components/ui/button";
import { Tooltip } from "$lib/components/ui/tooltip";
import { useI18n } from "$lib/i18n";
import type { TranslationKey } from "$lib/i18n/translations";

type Hint = "clean" | "low" | "same-cat";

type Props = {
  onSelectClean: () => void;
  onSelectLow: () => void;
  onSelectSameCat: () => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
  /** How many checked memories the last shortcut left out. */
  skipped: number;
};

const HINT_TEXT: Record<Hint, TranslationKey> = {
  clean: "label-ai-cleanup-hint-clean",
  low: "label-ai-cleanup-hint-low",
  "same-cat": "label-ai-cleanup-hint-same-cat",
};

/**
 * The selection shortcuts of the AI Cleanup dialog. Each button has a tooltip that says what
 * it picks. Clean All, Low Freq and Same Category explain their pick below the buttons and say
 * how many checked memories they skipped. Select All and Deselect All clear the note.
 */
export function CleanupSelectShortcuts({
  onSelectClean,
  onSelectLow,
  onSelectSameCat,
  onSelectAll,
  onSelectNone,
  skipped,
}: Props) {
  const { t } = useI18n();
  const [hint, setHint] = useState<Hint | null>(null);

  const shortcut = (
    next: Hint | null,
    run: () => void,
    label: TranslationKey,
    tip: TranslationKey
  ) => (
    <Tooltip content={t(tip)}>
      <Button
        variant="secondary"
        size="xs"
        aria-pressed={next ? hint === next : undefined}
        onClick={() => {
          run();
          setHint(next);
        }}
      >
        {t(label)}
      </Button>
    </Tooltip>
  );

  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap gap-1.5">
        {shortcut(
          "clean",
          onSelectClean,
          "label-ai-cleanup-select-clean",
          "label-ai-cleanup-tip-clean"
        )}
        {shortcut("low", onSelectLow, "label-ai-cleanup-select-low", "label-ai-cleanup-tip-low")}
        {shortcut(
          "same-cat",
          onSelectSameCat,
          "label-ai-cleanup-select-same-cat",
          "label-ai-cleanup-tip-same-cat"
        )}
        {shortcut(null, onSelectAll, "label-ai-cleanup-select-all", "label-ai-cleanup-tip-all")}
        {shortcut(null, onSelectNone, "label-ai-cleanup-deselect-all", "label-ai-cleanup-tip-none")}
      </div>
      {hint ? (
        <div
          role="status"
          className="space-y-1 rounded-lg border border-border bg-muted px-3 py-2 text-xs text-muted-foreground"
        >
          <p>{t(HINT_TEXT[hint])}</p>
          {skipped > 0 ? (
            <p className="font-medium text-foreground">
              {t("label-ai-cleanup-skipped", { count: skipped })}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
