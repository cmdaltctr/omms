import { Loader } from "lucide-react";
import { RepeatChoice } from "./RepeatChoice";
import { SizeCapForm } from "./SizeCapForm";
import { useMemorisationSettings, type SettingsStatus } from "@/hooks/useMemorisationSettings";
import { Callout } from "$lib/components/skills/Callout";
import { useI18n } from "$lib/i18n";
import { SIZE_RANGE } from "$lib/memorisation-model";

const SECTION = "space-y-3 rounded-xl border border-border bg-card p-4";

/** The saved message of a status, or null when the status is a problem. */
const SAVED: Partial<Record<SettingsStatus["kind"], string>> = {
  "repeat-saved": "memorisation-repeat-saved",
  "size-saved": "memorisation-size-saved",
};

/** The two global settings of memorisation: what a repeat does, and the size cap. */
export function MemorisationSettings() {
  const { t, language } = useI18n();
  const settings = useMemorisationSettings();
  const { status } = settings;
  const changed =
    settings.loaded &&
    (settings.sizeText.trim() !== String(settings.savedSize ?? "") ||
      settings.unit !== settings.savedUnit);

  const problem = (() => {
    if (!status) return null;
    if (status.kind === "out-of-range") {
      const { min, max } = SIZE_RANGE[status.unit];
      const number = new Intl.NumberFormat(language);
      return t(`memorisation-range-${status.unit}`, {
        min: number.format(min),
        max: number.format(max),
      });
    }
    if (status.kind === "load-failed") return t("memorisation-settings-load-failed");
    if (status.kind === "stale") return t("memorisation-settings-stale");
    if (status.kind === "failed") return t("memorisation-settings-failed");
    return null;
  })();

  return (
    <section aria-labelledby="memorisation-settings" className="space-y-3">
      <h2
        id="memorisation-settings"
        className="text-section-title font-semibold text-muted-foreground"
      >
        {t("memorisation-settings-title")}
      </h2>
      {settings.busy ? (
        <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader className="size-4 animate-spin" aria-hidden="true" />
          {t("memorisation-settings-saving")}
        </p>
      ) : status && SAVED[status.kind] ? (
        <p role="status" className="text-sm">
          {t(SAVED[status.kind]!)}
        </p>
      ) : null}
      {problem ? <Callout tone="danger">{problem}</Callout> : null}
      <div className="grid items-start gap-3 lg:grid-cols-2">
        <div className={SECTION}>
          <h3 className="text-subsection-title font-semibold">{t("memorisation-repeat-title")}</h3>
          <p className="text-xs text-muted-foreground">{t("memorisation-repeat-intro")}</p>
          <RepeatChoice
            value={settings.repeat}
            disabled={settings.busy || !settings.loaded}
            onChoose={(value) => void settings.chooseRepeat(value)}
          />
        </div>
        <div className={SECTION}>
          <h3 className="text-subsection-title font-semibold">{t("memorisation-size-title")}</h3>
          <p className="text-xs text-muted-foreground">{t("memorisation-size-intro")}</p>
          <SizeCapForm
            sizeText={settings.sizeText}
            unit={settings.unit}
            busy={settings.busy || !settings.loaded}
            changed={changed}
            onSize={settings.setSizeText}
            onUnit={settings.setUnit}
            onSave={() => void settings.saveSize()}
          />
        </div>
      </div>
    </section>
  );
}
