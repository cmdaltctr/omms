import type { SettingsStatus } from "@/hooks/useMemorisationSettings";
import type { TranslateFn } from "$lib/i18n";
import { SIZE_RANGE } from "$lib/memorisation-model";

/** The sentence for a status that is a problem, or null for an idle or saved status. */
export function statusProblem(
  status: SettingsStatus | undefined,
  t: TranslateFn,
  language: string
): string | null {
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
  if (status.kind === "rerank-failed" || status.kind === "presets-failed") {
    return status.reason || t("memorisation-settings-failed");
  }
  if (status.kind === "failed") return t("memorisation-settings-failed");
  return null;
}
