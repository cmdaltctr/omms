import { Label } from "$lib/components/ui/label";
import { Tooltip } from "$lib/components/ui/tooltip";
import { useI18n } from "$lib/i18n";

/**
 * The `memorisationRerank` switch. It stays visible and disabled, with the
 * reason in its tooltip and an accessible description, until the reranker
 * server URL and model are set (design decision 8).
 */
export function RerankSwitch({
  value,
  ready,
  busy,
  onChange,
}: {
  value: boolean;
  ready: boolean;
  busy: boolean;
  onChange: (value: boolean) => void;
}) {
  const { t } = useI18n();
  const reason = t("memorisation-rerank-disabled");
  // A disabled checkbox cannot take focus, so the wrapper span stands in for it.
  const box = (
    <input
      id="memorisation-rerank"
      type="checkbox"
      role="switch"
      checked={value}
      disabled={busy || !ready}
      aria-describedby={ready ? "memorisation-rerank-help" : "memorisation-rerank-reason"}
      onChange={(event) => onChange(event.target.checked)}
    />
  );
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        {ready ? (
          box
        ) : (
          <Tooltip content={reason}>
            <span
              tabIndex={0}
              className="inline-flex rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
            >
              {box}
              <span id="memorisation-rerank-reason" className="sr-only">
                {reason}
              </span>
            </span>
          </Tooltip>
        )}
        <Label htmlFor="memorisation-rerank">{t("memorisation-rerank-label")}</Label>
      </div>
      <p id="memorisation-rerank-help" className="text-xs text-muted-foreground">
        {t("memorisation-rerank-intro")}
      </p>
    </div>
  );
}
