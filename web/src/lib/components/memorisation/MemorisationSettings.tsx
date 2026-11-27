import { Loader } from "lucide-react";
import { PresetEditor } from "./PresetEditor";
import { RepeatChoice } from "./RepeatChoice";
import { RerankSwitch } from "./RerankSwitch";
import { SizeCapForm } from "./SizeCapForm";
import { useMemorisationConfirm } from "@/hooks/useMemorisationConfirm";
import { useMemorisationSettings, type SettingsStatus } from "@/hooks/useMemorisationSettings";
import { statusProblem } from "./status-problem";
import { Callout } from "$lib/components/skills/Callout";
import { useI18n } from "$lib/i18n";

const SECTION = "space-y-3 rounded-xl border border-border bg-card p-4";

/** The saved message of a status, or null when the status is a problem. */
const SAVED: Partial<Record<SettingsStatus["kind"], string>> = {
  "repeat-saved": "memorisation-repeat-saved",
  "size-saved": "memorisation-size-saved",
  "rerank-saved": "memorisation-rerank-saved",
  "presets-saved": "memorisation-preset-saved",
};

/** The two global settings of memorisation: what a repeat does, and the size cap. */
export function MemorisationSettings() {
  const { t, language } = useI18n();
  const settings = useMemorisationSettings();
  const confirm = useMemorisationConfirm(settings);
  const { status } = settings;
  const changed =
    settings.loaded &&
    (settings.sizeText.trim() !== String(settings.savedSize ?? "") ||
      settings.unit !== settings.savedUnit);

  const problem = statusProblem(status, t, language);

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
            onChoose={confirm.askRepeat}
          />
        </div>
        <div className={SECTION}>
          <h3 className="text-subsection-title font-semibold">{t("memorisation-size-title")}</h3>
          <p className="text-xs text-muted-foreground">{t("memorisation-size-intro")}</p>
          <SizeCapForm
            sizeText={settings.sizeText}
            unit={settings.unit}
            presets={settings.presets}
            busy={settings.busy || !settings.loaded}
            changed={changed}
            onSize={settings.setSizeText}
            onPreset={settings.choosePreset}
            onUnit={settings.chooseUnit}
            onSave={confirm.askSize}
          />
          <PresetEditor
            presets={settings.presets}
            busy={settings.busy || !settings.loaded}
            onSave={confirm.askPresets}
          />
        </div>
        <div className={SECTION}>
          <RerankSwitch
            value={settings.rerank}
            ready={settings.rerankerReady}
            busy={settings.busy || !settings.loaded}
            onChange={confirm.askRerank}
          />
        </div>
      </div>
      {confirm.dialog}
    </section>
  );
}
