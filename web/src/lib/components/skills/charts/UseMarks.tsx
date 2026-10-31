import type { ChartConfig } from "$lib/components/ui/chart";
import { useSettingsText } from "$lib/i18n/settings";

/*
 * The marks every skill use chart shares. Successful uses take the success
 * status colour and failed uses the error colour, the tokens the status
 * badges use, so every theme sets them.
 */

const SUCCESS = "var(--status-success)";
const FAILED = "var(--destructive)";

export function useUseConfig(): ChartConfig {
  const s = useSettingsText();
  return {
    succeeded: { label: s("Successful"), color: SUCCESS },
    failed: { label: s("Failed"), color: FAILED },
  };
}

/** A 1px card-coloured edge on each segment leaves a 2px gap between stacked parts. */
export const SEGMENT_GAP = { stroke: "var(--card)", strokeWidth: 1 } as const;

/** The legend under each use chart, in the bar colours. */
export function UsesLegend() {
  const s = useSettingsText();
  const items = [
    { label: s("Successful"), background: SUCCESS },
    { label: s("Failed"), background: FAILED },
  ];
  return (
    <ul className="flex flex-wrap items-center justify-center gap-4 pt-3 text-xs">
      {items.map((item) => (
        <li key={item.label} className="flex items-center gap-1.5">
          <span
            className="size-2.5 shrink-0 rounded-[2px]"
            style={{ background: item.background }}
          />
          {item.label}
        </li>
      ))}
    </ul>
  );
}
