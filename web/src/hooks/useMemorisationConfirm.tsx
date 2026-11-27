import type { ReactNode } from "react";
import type { SaveResult, useMemorisationSettings } from "@/hooks/useMemorisationSettings";
import { useSettingsConfirm } from "@/hooks/useSettingsConfirm";
import { statusProblem } from "$lib/components/memorisation/status-problem";
import type { ConfirmResult } from "$lib/components/settings/SettingsConfirmDialog";
import { useI18n } from "$lib/i18n";
import { PRESETS, type Preset, type Repeat } from "$lib/memorisation-model";

type Settings = ReturnType<typeof useMemorisationSettings>;

/**
 * Puts each Memorisation settings save behind the shared confirm dialog. Nothing is sent until the
 * user confirms. A failure keeps the dialog open with the server's reason; the range and
 * config-changed cases use the page's own localised sentence. Render `dialog` once.
 */
export function useMemorisationConfirm(settings: Settings) {
  const { t, language } = useI18n();
  const { ask, dialog } = useSettingsConfirm();
  const number = new Intl.NumberFormat(language);

  const answer = (result: SaveResult): ConfirmResult => {
    if (result.success) return { success: true };
    const localised = result.status.kind === "stale" || result.status.kind === "out-of-range";
    const reason = localised ? "" : result.error;
    return {
      success: false,
      error:
        reason || statusProblem(result.status, t, language) || t("memorisation-settings-failed"),
    };
  };
  const request = (
    title: string,
    body: ReactNode,
    confirm: string,
    busy: string,
    run: () => Promise<SaveResult>
  ) =>
    ask({
      title,
      body,
      confirmLabel: confirm,
      busyLabel: busy,
      run: async () => answer(await run()),
    });

  return {
    dialog,
    askRepeat: (value: Repeat) =>
      request(
        t("memorisation-confirm-repeat-title"),
        <p>{t(`memorisation-confirm-repeat-${value}`)}</p>,
        t("memorisation-confirm-repeat-confirm"),
        t("memorisation-confirm-repeat-busy"),
        () => settings.chooseRepeat(value)
      ),
    askRerank: (value: boolean) => {
      const state = value ? "on" : "off";
      request(
        t(`memorisation-confirm-rerank-${state}-title`),
        <p>{t(`memorisation-confirm-rerank-${state}`)}</p>,
        t(`memorisation-confirm-rerank-${state}-confirm`),
        t("memorisation-confirm-rerank-busy"),
        () => settings.chooseRerank(value)
      );
    },
    /** Checks the number first: a bad one shows its range message and opens no dialog. */
    askSize: () => {
      const cap = settings.checkSize();
      if (!cap) return;
      request(
        t("memorisation-confirm-size-title"),
        <p>{t(`memorisation-confirm-size-${cap.unit}`, { size: number.format(cap.size) })}</p>,
        t("memorisation-confirm-size-confirm"),
        t("memorisation-confirm-size-busy"),
        () => settings.saveSize(cap.size, cap.unit)
      );
    },
    /** `values` already passed the editor's checks. `done` runs after the save succeeds. */
    askPresets: (values: Record<Preset, number>, done: () => void) => {
      const { movedCap } = settings.presetPlan(values);
      request(
        t("memorisation-confirm-presets-title"),
        <>
          <p>{t("memorisation-confirm-presets-intro")}</p>
          <ul className="my-2 list-disc ps-5">
            {PRESETS.map((preset) => (
              <li key={preset}>
                {t("memorisation-confirm-preset-line", {
                  name: t(`memorisation-preset-${preset}`),
                  size: number.format(values[preset]),
                })}
              </li>
            ))}
          </ul>
          {movedCap ? (
            <p>
              {t(`memorisation-confirm-presets-cap-${movedCap.unit}`, {
                size: number.format(movedCap.size),
                name: t(`memorisation-preset-${movedCap.preset}`),
              })}
            </p>
          ) : null}
        </>,
        t("memorisation-preset-save"),
        t("memorisation-confirm-presets-busy"),
        async () => {
          const result = await settings.savePresets(values);
          if (result.success) done();
          return result;
        }
      );
    },
  };
}
