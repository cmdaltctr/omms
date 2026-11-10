import { useI18n } from "$lib/i18n";
import type { BulkDeleteResult as Result } from "$lib/memorisation-model";

/** The result line of a bulk delete: how many went, then each skipped ID with its reason. */
export function BulkDeleteResult({ result }: { result: Result }) {
  const { t } = useI18n();
  return (
    <div role="status" className="space-y-1 text-sm">
      <p>{t("memorisation-bulk-deleted", { count: result.deleted.length })}</p>
      {result.skipped.map((skip) => (
        <p key={skip.id} className="text-muted-foreground">
          <bdi>
            {t("memorisation-skipped", {
              id: skip.id,
              reason: t(`memorisation-skipped-${skip.reason}`),
            })}
          </bdi>
        </p>
      ))}
    </div>
  );
}
