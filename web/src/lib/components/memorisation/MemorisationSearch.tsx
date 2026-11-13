import { useState } from "react";
import { Loader, Search, X } from "lucide-react";
import { MemorisationRow } from "./MemorisationRow";
import { Button } from "$lib/components/ui/button";
import { Input } from "$lib/components/ui/input";
import { Label } from "$lib/components/ui/label";
import { useI18n } from "$lib/i18n";
import { parseRecallInput } from "$lib/memorisation-query";
import type { RecallState } from "@/hooks/useMemorisations";
import type { Memorisation } from "$lib/memorisation-model";

/**
 * The recall box. It runs the same recall as the `recall` mode: an ID shows that one record,
 * words show the best matches with a confidence score on each. `label:name` narrows by label.
 */
export function MemorisationSearch({
  recall,
  onSearch,
  onClear,
  onDelete,
  onLabel,
  activeLabels,
}: {
  recall: RecallState;
  onSearch: (text: string) => void;
  onClear: () => void;
  onDelete: (item: Memorisation) => void;
  onLabel: (label: string) => void;
  activeLabels: readonly string[];
}) {
  const { t } = useI18n();
  const [text, setText] = useState("");
  const running = recall.kind === "running";
  const { q, labels } = parseRecallInput(text);

  return (
    <section aria-labelledby="memorisation-recall" className="space-y-3">
      <h2
        id="memorisation-recall"
        className="text-section-title font-semibold text-muted-foreground"
      >
        {t("memorisation-search-title")}
      </h2>
      <form
        className="flex flex-wrap items-end gap-2 md:w-1/2"
        onSubmit={(event) => {
          event.preventDefault();
          onSearch(text);
        }}
      >
        <div className="min-w-0 max-w-full flex-1 basis-72 space-y-1">
          <Label htmlFor="memorisation-search-input">{t("memorisation-search-label")}</Label>
          <Input
            id="memorisation-search-input"
            type="search"
            value={text}
            placeholder={t("memorisation-search-placeholder")}
            aria-describedby="memorisation-search-help"
            onChange={(event) => setText(event.target.value)}
          />
        </div>
        <Button type="submit" disabled={running || (q === "" && labels.length === 0)}>
          <Search aria-hidden="true" />
          {t("memorisation-search-button")}
        </Button>
        {recall.kind !== "idle" ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setText("");
              onClear();
            }}
          >
            <X aria-hidden="true" />
            {t("memorisation-search-clear")}
          </Button>
        ) : null}
      </form>
      <p id="memorisation-search-help" className="text-xs text-muted-foreground md:w-1/2">
        {t("memorisation-search-help")}
      </p>
      {running ? (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader className="size-4 animate-spin" aria-hidden="true" />
          {t("memorisation-searching")}
        </p>
      ) : null}
      {recall.kind === "failed" ? (
        <p role="alert" className="text-sm text-destructive-label">
          {recall.missingId
            ? t("memorisation-no-id", { id: recall.query })
            : t("memorisation-recall-failed")}
        </p>
      ) : null}
      {recall.kind === "done" ? (
        <div className="space-y-3">
          <h3 className="text-subsection-title font-semibold" dir="auto">
            {t("memorisation-results-title", { query: recall.query })}
          </h3>
          {recall.matches.length === 0 ? (
            <p role="status" className="text-sm text-muted-foreground">
              {t("memorisation-no-match")}
            </p>
          ) : (
            <ul
              aria-label={t("memorisation-results-title", { query: recall.query })}
              className="space-y-3"
            >
              {recall.matches.map((match) => (
                <MemorisationRow
                  key={match.id}
                  item={match}
                  onDelete={onDelete}
                  onLabel={onLabel}
                  activeLabels={activeLabels}
                />
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}
