import { ArrowRight } from "lucide-react";
import { useCatalogueText } from "$lib/i18n/settings-catalogue";
import type { SettingsChange } from "$lib/settings-changes";

/**
 * The list in a settings confirm dialog: each setting the save changes, with its saved value struck
 * through and its new value after it. The rows are already translated. A screen reader hears
 * "changes to" between the two values.
 */
export function SettingsChangeList({ changes }: { changes: readonly SettingsChange[] }) {
  const t = useCatalogueText();
  return (
    <dl className="space-y-2">
      {changes.map((change) => (
        <div key={change.key} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <dt className="font-medium">{change.label}</dt>
          <dd className="min-w-0 break-words">
            <s className="text-muted-foreground line-through">{change.from}</s>
            <ArrowRight
              className="mx-1 inline size-3.5 align-middle text-muted-foreground rtl:-scale-x-100"
              aria-hidden="true"
            />
            <span className="sr-only">{t("changes to")}</span>
            <span>{change.to}</span>
          </dd>
        </div>
      ))}
    </dl>
  );
}
