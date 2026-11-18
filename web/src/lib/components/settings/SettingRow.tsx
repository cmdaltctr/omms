import type { ReactNode } from "react";
import { Label } from "$lib/components/ui/label";
import { useCatalogueText } from "$lib/i18n/settings-catalogue";
import { findCatalogueEntry } from "$lib/settings-catalogue";

/**
 * One setting: a plain name, a one-line description, the default and what it affects, with the
 * config key as small secondary text. The control goes in as `children`. The texts come from the
 * settings catalogue, so every card words a setting the same way and in every language. A setting
 * with no catalogue entry shows its control alone.
 */
export function SettingRow({
  setting,
  controlId,
  projectNote = false,
  children,
}: {
  /** The config key, as in the catalogue. */
  setting: string;
  /** The id of the control, so the name is its label. */
  controlId: string;
  /** True when the current project's file decides this setting. */
  projectNote?: boolean;
  children: ReactNode;
}) {
  const t = useCatalogueText();
  const entry = findCatalogueEntry(setting);
  if (!entry) return <>{children}</>;
  return (
    <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
      <div className="min-w-0 space-y-1 sm:max-w-[60%]">
        <Label htmlFor={controlId} className="font-medium">
          {t(entry.name)}
        </Label>
        <p className="text-xs text-muted-foreground">{t(entry.description)}</p>
        <p className="text-xs text-muted-foreground">
          {t("Default")}: <bdi>{t(entry.default)}</bdi>
          {" · "}
          {t("Affects")}: <bdi>{t(entry.affects)}</bdi>
        </p>
        {projectNote ? (
          <p className="text-xs text-status-warning">
            {t("This project's file decides this setting here.")}
          </p>
        ) : null}
        <span className="block text-start text-xs text-muted-foreground">
          <code dir="ltr">{entry.key}</code>
        </span>
      </div>
      <div className="min-w-0 sm:w-72 sm:max-w-full">{children}</div>
    </div>
  );
}
