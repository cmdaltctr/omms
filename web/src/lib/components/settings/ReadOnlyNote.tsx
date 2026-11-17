import { useSettingsSnapshot } from "@/hooks/useSettingsSnapshot";
import { useCatalogueText } from "$lib/i18n/settings-catalogue";

/** True while the global config file cannot be read: every Save and Apply is then off. */
export function useSettingsReadOnly(): boolean {
  const { snapshot } = useSettingsSnapshot<{ readOnly?: boolean }>();
  return snapshot?.readOnly === true;
}

/** The one plain reason a card shows beside its turned-off Save or Apply button. */
export function ReadOnlyNote({ show }: { show: boolean }) {
  const t = useCatalogueText();
  if (!show) return null;
  return (
    <p className="text-xs text-muted-foreground">
      {t("Saving is turned off until the file is fixed.")}
    </p>
  );
}
